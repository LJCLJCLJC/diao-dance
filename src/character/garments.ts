import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyInfluences, Influence, loftTube, Ring, sampleProfile, smooth } from './loft';
import { BONE_INDEX as B, restPosition } from './rig';

/** Shirt torso profile: [y, half-width, half-depth, centre z]. Oversized and slightly flared. */
const TORSO_KEYS: Array<[number, number, number, number]> = [
  [0.74, 0.198, 0.148, 0.004],
  [0.8, 0.194, 0.143, 0.003],
  [0.9, 0.186, 0.135, 0.0],
  [1.0, 0.18, 0.128, -0.002],
  [1.1, 0.178, 0.126, -0.004],
  [1.2, 0.184, 0.126, -0.006],
  [1.29, 0.194, 0.12, -0.008],
  [1.35, 0.198, 0.108, -0.01],
  [1.385, 0.18, 0.096, -0.01],
  [1.408, 0.135, 0.08, -0.01],
  [1.428, 0.082, 0.066, -0.008],
];

export function torsoFront(y: number): THREE.Vector3 {
  const s = sampleProfile(TORSO_KEYS, y);
  return new THREE.Vector3(0, y, s.cz + s.rz);
}

/** Skin weights for anything riding the shirt torso (shell, placket, pocket, buttons). */
export function torsoInfluence(p: THREE.Vector3): Influence[] {
  const out: Influence[] = [];
  const y = p.y;
  if (y >= 1.28) out.push([B.chest, 1]);
  else if (y >= 1.15) { const t = smooth(1.15, 1.28, y); out.push([B.spine, 1 - t], [B.chest, t]); }
  else if (y >= 1.02) out.push([B.spine, 1]);
  else if (y >= 0.92) { const t = smooth(0.92, 1.02, y); out.push([B.hips, 1 - t], [B.spine, t]); }
  else out.push([B.hips, 1]);

  const side = p.x >= 0 ? 'l' : 'r';
  const k = smooth(0.1, 0.19, Math.abs(p.x)) * smooth(1.2, 1.36, y);
  if (k > 0) {
    for (const inf of out) inf[1] *= 1 - k;
    out.push([B[`clavicle-${side}`], k * 0.55], [B[`upperarm-${side}`], k * 0.45]);
  }
  const h = smooth(0.93, 0.76, y) * 0.85;
  if (h > 0) {
    for (const inf of out) inf[1] *= 1 - h;
    const len = Math.hypot(p.x, p.z) || 1;
    const dx = p.x / len;
    const dz = p.z / len;
    out.push(
      [B['hem-f'], h * Math.max(0, dz) ** 2],
      [B['hem-b'], h * Math.max(0, -dz) ** 2],
      [B['hem-l'], h * Math.max(0, dx) ** 2],
      [B['hem-r'], h * Math.max(0, -dx) ** 2],
    );
  }
  return out;
}

function torsoAo(p: THREE.Vector3): number {
  let ao = 1;
  ao -= 0.18 * Math.exp(-(((p.y - 0.97) / 0.05) ** 2));
  ao -= 0.25 * smooth(0.14, 0.19, Math.abs(p.x)) * Math.exp(-(((p.y - 1.27) / 0.06) ** 2));
  ao -= 0.12 * smooth(0.8, 0.74, p.y);
  return ao;
}

export function buildShirtTorso(): THREE.BufferGeometry {
  const rings: Ring[] = [];
  for (let y = 0.74; y <= 1.4281; y += 0.0175) {
    const s = sampleProfile(TORSO_KEYS, y);
    rings.push({ c: new THREE.Vector3(0, y, s.cz), rx: s.rx, rz: s.rz, e: 2.4 - 0.4 * smooth(1.3, 1.42, y) });
  }
  return loftTube(rings, {
    segments: 56,
    uRepeat: 1,
    vScale: 1.4,
    influence: (_r, _t, p) => torsoInfluence(p),
    ao: (_r, _t, p) => torsoAo(p),
  });
}

export function buildSleeve(side: 'l' | 'r'): THREE.BufferGeometry {
  const sg = side === 'l' ? 1 : -1;
  const H = restPosition(`hand-${side}`);
  const E = restPosition(`forearm-${side}`);
  const S = restPosition(`upperarm-${side}`);
  const dirFore = new THREE.Vector3().subVectors(H, E).normalize();
  const dirUp = new THREE.Vector3().subVectors(S, E).normalize();
  const along = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);
  const ua = B[`upperarm-${side}`];
  const fa = B[`forearm-${side}`];
  const cl = B[`clavicle-${side}`];
  const hd = B[`hand-${side}`];
  const rings: Ring[] = [
    { c: H.clone().addScaledVector(dirFore, 0.018), rx: 0.047, rz: 0.043, w: [[fa, 0.75], [hd, 0.25]] },
    { c: H.clone().addScaledVector(dirFore, 0.004), rx: 0.05, rz: 0.046, w: [[fa, 0.85], [hd, 0.15]] },
    { c: H.clone().addScaledVector(dirFore, -0.012), rx: 0.05, rz: 0.046, w: [[fa, 1]] },
    { c: H.clone().addScaledVector(dirFore, -0.03), rx: 0.046, rz: 0.042, w: [[fa, 1]] },
    { c: along(H, E, 0.45), rx: 0.05, rz: 0.046, w: [[fa, 1]] },
    { c: E.clone().addScaledVector(dirFore, 0.045), rx: 0.054, rz: 0.05, w: [[fa, 0.9], [ua, 0.1]] },
    { c: E.clone(), rx: 0.057, rz: 0.053, w: [[fa, 0.5], [ua, 0.5]] },
    { c: E.clone().addScaledVector(dirUp, 0.045), rx: 0.06, rz: 0.056, w: [[ua, 0.9], [fa, 0.1]] },
    { c: along(E, S, 0.5), rx: 0.064, rz: 0.06, w: [[ua, 1]] },
    { c: along(E, S, 0.8), rx: 0.068, rz: 0.066, w: [[ua, 1]] },
    { c: new THREE.Vector3(S.x - sg * 0.004, S.y - 0.035, S.z), rx: 0.07, rz: 0.069, w: [[ua, 0.85], [cl, 0.15]] },
    { c: new THREE.Vector3(S.x - sg * 0.008, S.y - 0.012, S.z), rx: 0.064, rz: 0.064, w: [[ua, 0.65], [cl, 0.35]] },
    { c: new THREE.Vector3(S.x - sg * 0.012, S.y + 0.004, S.z), rx: 0.045, rz: 0.048, w: [[ua, 0.5], [cl, 0.5]] },
    { c: new THREE.Vector3(S.x - sg * 0.014, S.y + 0.01, S.z), rx: 0.012, rz: 0.014, w: [[ua, 0.5], [cl, 0.5]] },
  ];
  return loftTube(rings, {
    segments: 28,
    vScale: 1.4,
    ao: (r) => (r === 6 ? 0.86 : r <= 1 ? 0.9 : 0.97),
  });
}

/** Collar band (open at the front) + two collar points lying on the upper chest. */
export function buildCollar(): THREE.BufferGeometry {
  const rings: Ring[] = [];
  for (let i = 0; i <= 3; i++) {
    const y = 1.418 + i * 0.015;
    const r = 0.073 - i * 0.0024;
    rings.push({ c: new THREE.Vector3(0, y, -0.009), rx: r, rz: r * 0.95 });
  }
  const band = loftTube(rings, {
    segments: 32,
    thetaStart: Math.PI / 2 + 0.45,
    thetaLength: Math.PI * 2 - 0.9,
    ao: () => 0.9,
  });
  const points: THREE.BufferGeometry[] = [band];
  for (const sg of [1, -1]) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(sg * 0.042, 0.004);
    shape.lineTo(sg * 0.014, -0.058);
    shape.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.003, bevelEnabled: false });
    g.rotateX(-0.25);
    g.rotateY(sg * 0.35);
    g.translate(sg * 0.026, 1.452, 0.054);
    const ao = stripToCore(g);
    (ao.getAttribute('color') as THREE.BufferAttribute).array.fill(0.92);
    points.push(ao);
  }
  const merged = mergeGeometries(points.map(stripToCore), false)!;
  applyInfluences(merged, (p) => (p.y > 1.43 ? [[B.chest, 0.75], [B.neck, 0.25]] : torsoInfluence(p)));
  return merged;
}

/** Placket ribbon + left chest pocket, both following the torso front surface. */
export function buildShirtTrim(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const placket: Ring[] = [];
  for (let y = 0.745; y <= 1.39; y += 0.02) {
    const f = torsoFront(y);
    placket.push({ c: new THREE.Vector3(0, y, f.z + 0.0015), rx: 0.013, rz: 0.0028, e: 6 });
  }
  parts.push(loftTube(placket, { segments: 12, vScale: 1.4, ao: () => 0.93 }));

  // Patch pocket on the wearer's left chest: a slice of the torso surface lifted by 2.5 mm.
  const pocketRings: Ring[] = [];
  for (let y = 1.205; y <= 1.3001; y += 0.019) {
    const s = sampleProfile(TORSO_KEYS, y);
    pocketRings.push({ c: new THREE.Vector3(0, y, s.cz), rx: s.rx + 0.0025, rz: s.rz + 0.0025, e: 2.4 });
  }
  const e = 2.4;
  const thetaAt = (x: number) => Math.acos(Math.pow(x / sampleProfile(TORSO_KEYS, 1.25).rx, e / 2));
  const tA = thetaAt(0.125);
  const tB = thetaAt(0.042);
  parts.push(loftTube(pocketRings, { segments: 8, thetaStart: tA, thetaLength: tB - tA, ao: (r) => (r === 0 ? 0.82 : 0.92) }));
  const merged = mergeGeometries(parts.map(stripToCore), false)!;
  applyInfluences(merged, (p) => torsoInfluence(p));
  return merged;
}

export function buildButtons(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const y = 0.8 + i * 0.1;
    const f = torsoFront(y);
    const g = new THREE.CylinderGeometry(0.0048, 0.0048, 0.0022, 10);
    g.rotateX(Math.PI / 2);
    g.translate(0, y, f.z + 0.0045);
    parts.push(g);
  }
  const merged = mergeGeometries(parts.map(stripToCore), false)!;
  applyInfluences(merged, (p) => torsoInfluence(p));
  return merged;
}

export function buildJeansLeg(side: 'l' | 'r'): THREE.BufferGeometry {
  const sg = side === 'l' ? 1 : -1;
  const th = B[`thigh-${side}`];
  const sh = B[`shin-${side}`];
  const keys: Array<[number, number, number, number, number]> = [
    // y, centre x, rx, rz, centre z
    [0.07, 0.106, 0.073, 0.071, -0.008],
    [0.122, 0.106, 0.074, 0.072, -0.008],
    [0.127, 0.106, 0.066, 0.064, -0.008],
    [0.2, 0.105, 0.064, 0.061, -0.006],
    [0.32, 0.104, 0.064, 0.061, -0.002],
    [0.5, 0.101, 0.068, 0.064, 0.004],
    [0.62, 0.099, 0.077, 0.072, 0.004],
    [0.72, 0.097, 0.085, 0.08, 0.003],
    // Under the shirt: kept ~2 cm inside the shell so lifted thighs do not poke through it.
    [0.8, 0.093, 0.088, 0.083, 0.002],
    [0.88, 0.087, 0.088, 0.084, 0.0],
    [0.95, 0.08, 0.09, 0.084, -0.002],
    [1.01, 0.074, 0.088, 0.082, -0.004],
  ];
  const rings: Ring[] = keys.map(([y, cx, rx, rz, cz]) => ({ c: new THREE.Vector3(sg * cx, y, cz), rx, rz }));
  return loftTube(rings, {
    segments: 28,
    vScale: 1.2,
    influence: (_r, _t, p) => {
      const y = p.y;
      if (y >= 0.9) return [[B.hips, 1]];
      if (y >= 0.74) { const t = smooth(0.74, 0.9, y); return [[th, 1 - t], [B.hips, t]]; }
      if (y >= 0.46) { const t = smooth(0.46, 0.54, y); return [[sh, 1 - t], [th, t]]; }
      return [[sh, 1]];
    },
    ao: (r, _t, p) => {
      let ao = 1;
      if (r === 2) ao -= 0.25;
      ao -= 0.15 * Math.exp(-(((p.y - 0.5) / 0.04) ** 2)) * (p.z < 0 ? 1 : 0.3);
      ao -= 0.25 * smooth(0.1, 0.0, Math.abs(p.x)) * smooth(0.7, 0.85, p.y);
      return ao;
    },
  });
}

export function buildNeck(): THREE.BufferGeometry {
  const rings: Ring[] = [];
  for (let i = 0; i <= 8; i++) {
    const y = 1.385 + i * 0.022;
    rings.push({ c: new THREE.Vector3(0, y, -0.012 + i * 0.0018), rx: 0.058 - i * 0.0008, rz: 0.056 - i * 0.0004 });
  }
  return loftTube(rings, {
    segments: 24,
    influence: (_r, _t, p) => {
      if (p.y < 1.425) return [[B.chest, 1]];
      if (p.y < 1.48) { const t = smooth(1.425, 1.48, p.y); return [[B.chest, 1 - t], [B.neck, t]]; }
      const t = smooth(1.5, 1.555, p.y);
      return [[B.neck, 1 - t], [B.head, t]];
    },
    ao: (_r, _t, p) => 0.8 + 0.2 * smooth(1.4, 1.46, p.y),
  });
}

/** Keeps only the attributes shared by every part so mergeGeometries accepts them. */
export function stripToCore(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', geo.getAttribute('position'));
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  out.setAttribute('normal', geo.getAttribute('normal'));
  const uv = geo.getAttribute('uv');
  out.setAttribute('uv', uv ?? new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
  const col = geo.getAttribute('color');
  out.setAttribute('color', col ?? new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 3).fill(1), 3));
  return out;
}
