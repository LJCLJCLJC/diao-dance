import * as THREE from 'three';

/** [boneIndex, weight] */
export type Influence = [number, number];

export interface Ring {
  c: THREE.Vector3;
  /** half extent along the section's side axis */
  rx: number;
  /** half extent along the section's forward axis */
  rz: number;
  /** superellipse exponent (2 = ellipse, >2 = boxier) */
  e?: number;
  w?: Influence[];
}

export interface LoftOptions {
  segments: number;
  /** reference side axis; the section's forward axis is side x tangent */
  side?: THREE.Vector3;
  /** start angle and sweep (radians); default full loop starting at the back */
  thetaStart?: number;
  thetaLength?: number;
  influence?: (ring: number, theta: number, p: THREE.Vector3) => Influence[];
  ao?: (ring: number, theta: number, p: THREE.Vector3) => number;
  uRepeat?: number;
  /** v grows with arc length times this factor (metres -> texture units) */
  vScale?: number;
  clampMinY?: number;
}

export const smooth = (a: number, b: number, x: number): number => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function normalizeInfluences(list: Influence[]): Influence[] {
  const merged = new Map<number, number>();
  for (const [b, w] of list) if (w > 1e-5) merged.set(b, (merged.get(b) ?? 0) + w);
  const sorted = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = sorted.reduce((s, [, w]) => s + w, 0) || 1;
  return sorted.map(([b, w]) => [b, w / sum] as Influence);
}

/** Adds skinIndex/skinWeight attributes from a per-vertex influence function. */
export function applyInfluences(geo: THREE.BufferGeometry, fn: (p: THREE.Vector3, i: number) => Influence[]): void {
  const pos = geo.getAttribute('position');
  const idx = new Uint16Array(pos.count * 4);
  const wts = new Float32Array(pos.count * 4);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const inf = normalizeInfluences(fn(p, i));
    for (let k = 0; k < inf.length; k++) {
      idx[i * 4 + k] = inf[k][0];
      wts[i * 4 + k] = inf[k][1];
    }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
}

/** Rigid binding of a whole geometry to one bone (L3 isolates inside a skinned mesh). */
export function bindRigid(geo: THREE.BufferGeometry, bone: number): void {
  applyInfluences(geo, () => [[bone, 1]]);
}

/** Vertex colour channel used as baked ambient occlusion (multiplies albedo). */
export function setAo(geo: THREE.BufferGeometry, fn: (p: THREE.Vector3, n: THREE.Vector3) => number): void {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const a = THREE.MathUtils.clamp(fn(p, n), 0, 1);
    col.set([a, a, a], i * 3);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
}

/**
 * Lofts superellipse sections through ring centres. Rings should run bottom -> top
 * (or heel -> toe) so the forward axis is consistent. The UV seam sits at the back.
 */
export function loftTube(rings: Ring[], opts: LoftOptions): THREE.BufferGeometry {
  const seg = opts.segments;
  const sideRef = opts.side ?? new THREE.Vector3(1, 0, 0);
  const t0 = opts.thetaStart ?? -Math.PI / 2;
  const tl = opts.thetaLength ?? Math.PI * 2;
  const full = Math.abs(tl - Math.PI * 2) < 1e-6;
  const cols = seg + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const skinIdx: number[] = [];
  const skinW: number[] = [];
  const colors: number[] = [];
  const tangent = new THREE.Vector3();
  const n = new THREE.Vector3();
  const f = new THREE.Vector3();
  const p = new THREE.Vector3();
  let arc = 0;

  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    const prev = rings[Math.max(0, r - 1)].c;
    const next = rings[Math.min(rings.length - 1, r + 1)].c;
    tangent.subVectors(next, prev).normalize();
    n.copy(sideRef).addScaledVector(tangent, -sideRef.dot(tangent)).normalize();
    f.crossVectors(n, tangent).normalize();
    if (r > 0) arc += ring.c.distanceTo(rings[r - 1].c);
    const e = ring.e ?? 2;
    for (let s = 0; s <= seg; s++) {
      const u = s / seg;
      const th = t0 + u * tl;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const cs = Math.sign(c) * Math.pow(Math.abs(c), 2 / e);
      const ss = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / e);
      p.copy(ring.c).addScaledVector(n, cs * ring.rx).addScaledVector(f, ss * ring.rz);
      if (opts.clampMinY !== undefined && p.y < opts.clampMinY) p.y = opts.clampMinY;
      positions.push(p.x, p.y, p.z);
      uvs.push(u * (opts.uRepeat ?? 1), arc * (opts.vScale ?? 1));
      const inf = normalizeInfluences(opts.influence ? opts.influence(r, th, p) : ring.w ?? [[0, 1]]);
      for (let k = 0; k < 4; k++) {
        skinIdx.push(inf[k]?.[0] ?? 0);
        skinW.push(inf[k]?.[1] ?? 0);
      }
      const ao = opts.ao ? THREE.MathUtils.clamp(opts.ao(r, th, p), 0, 1) : 1;
      colors.push(ao, ao, ao);
    }
  }

  const index: number[] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let s = 0; s < seg; s++) {
      const a = r * cols + s;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      index.push(a, b, d, a, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIdx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  if (full) weldSeamNormals(geo, rings.length, cols);
  return geo;
}

function weldSeamNormals(geo: THREE.BufferGeometry, rows: number, cols: number): void {
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    const i0 = r * cols;
    const i1 = r * cols + cols - 1;
    a.fromBufferAttribute(nor, i0);
    b.fromBufferAttribute(nor, i1);
    a.add(b).normalize();
    nor.setXYZ(i0, a.x, a.y, a.z);
    nor.setXYZ(i1, a.x, a.y, a.z);
  }
  nor.needsUpdate = true;
}

/** Interpolates ring definitions keyed by height for smooth silhouettes. */
export function sampleProfile(
  keys: Array<[number, number, number, number?]>,
  y: number,
): { rx: number; rz: number; cz: number } {
  for (let i = 0; i < keys.length - 1; i++) {
    const [y0, rx0, rz0, cz0 = 0] = keys[i];
    const [y1, rx1, rz1, cz1 = 0] = keys[i + 1];
    if (y >= y0 && y <= y1) {
      const t = smooth(0, 1, (y - y0) / (y1 - y0));
      return { rx: rx0 + (rx1 - rx0) * t, rz: rz0 + (rz1 - rz0) * t, cz: cz0 + (cz1 - cz0) * t };
    }
  }
  const last = y < keys[0][0] ? keys[0] : keys[keys.length - 1];
  return { rx: last[1], rz: last[2], cz: last[3] ?? 0 };
}
