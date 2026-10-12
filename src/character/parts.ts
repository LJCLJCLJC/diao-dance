import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { applyInfluences, loftTube, Ring, setAo, smooth } from './loft';
import { FaceLayout } from './faceLayout';
import { BONE_INDEX as B, restPosition } from './rig';
import { stripToCore } from './garments';

export const HEAD_CENTER = new THREE.Vector3(0, 1.6, 0.0);
const HEAD_R = { a: 0.08, b: 0.122, c: 0.102 };

/** Deformed-sphere head surface for a unit direction, in character space. */
export function headSurface(dir: THREE.Vector3, L: FaceLayout, out = new THREE.Vector3()): THREE.Vector3 {
  const { x: ux, y: uy, z: uz } = dir;
  let x = ux * HEAD_R.a;
  const y = uy * HEAD_R.b;
  let z = uz * HEAD_R.c;
  if (uy < 0) {
    const k = -uy;
    x *= 1 - 0.2 * k * k;
    if (uz < 0) z *= 1 - 0.3 * k;
  }
  if (uy > 0 && uz < 0) z *= 1 + 0.07 * uy;
  if (uz > 0) z *= 1 - 0.14 * ux * ux;
  out.set(x, y, z).add(HEAD_CENTER);
  if (uz > 0.2) {
    const front = smooth(0.2, 0.6, uz);
    const ax = Math.abs(out.x);
    let dz = 0;
    const tNose = smooth(L.eyeY - 0.004, L.noseTipY, out.y);
    if (out.y > L.noseTipY - 0.016 && out.y < L.eyeY + 0.004) {
      const sigma = 0.008 + 0.007 * tNose;
      const amp = 0.022 * tNose * (out.y < L.noseTipY ? Math.exp(-(((out.y - L.noseTipY) / 0.007) ** 2)) : 1);
      dz += amp * Math.exp(-((out.x / sigma) ** 2));
    }
    dz -= 0.005 * Math.exp(-(((ax - L.eyeX) / 0.014) ** 2 + ((out.y - L.eyeY) / 0.01) ** 2));
    dz += 0.004 * Math.exp(-(((out.y - L.browY) / 0.008) ** 2)) * Math.exp(-(((ax - 0.03) / 0.03) ** 2));
    dz += 0.005 * Math.exp(-(((out.y - L.mouthY) / 0.008) ** 2)) * Math.exp(-((out.x / 0.022) ** 2));
    dz += 0.006 * Math.exp(-(((out.y - (L.chinY + 0.012)) / 0.012) ** 2)) * Math.exp(-((out.x / 0.025) ** 2));
    dz += 0.004 * Math.exp(-(((ax - 0.045) / 0.02) ** 2 + ((out.y - (L.eyeY - 0.03)) / 0.02) ** 2));
    out.z += dz * front;
  }
  return out;
}

/** Head mesh: continuous volume, UVs = front projection into the face rect, attribute aFront. */
export function buildHead(L: FaceLayout): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 72, 56);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const d = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    headSurface(d, L, p);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geo.computeVertexNormals();
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal');
  const front = new Float32Array(pos.count);
  const { x0, x1, y0, y1 } = L.rect;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    uv.setXY(i, (p.x - x0) / (x1 - x0), (p.y - y0) / (y1 - y0));
    front[i] = smooth(0.12, 0.5, nor.getZ(i)) * smooth(HEAD_CENTER.z - 0.02, HEAD_CENTER.z + 0.03, p.z);
  }
  geo.setAttribute('aFront', new THREE.Float32BufferAttribute(front, 1));
  applyInfluences(geo, (q) => {
    const jaw = smooth(L.mouthY + 0.002, L.mouthY - 0.014, q.y) * smooth(HEAD_CENTER.z - 0.01, HEAD_CENTER.z + 0.04, q.z);
    return [[B.head, 1 - jaw], [B.jaw, jaw]];
  });
  setAo(geo, (q, n) => 1 - 0.18 * smooth(1.5, 1.47, q.y) * (n.y < 0 ? 1 : 0.4));
  return geo;
}

/**
 * Hair: a parametric scalp shell whose lower edge follows a smooth hairline curve
 * (forehead, temples, sideburns, behind the ears, nape). Fuller on top-front, short on the sides.
 * Rigid on the head bone.
 */
export function buildHair(L: FaceLayout): THREE.BufferGeometry {
  const frontEl = Math.asin(THREE.MathUtils.clamp((L.browY + 0.032 - HEAD_CENTER.y) / HEAD_R.b, -1, 1));
  const hairlineEl = (theta: number) => {
    const c = Math.cos(theta);
    let el = c >= 0 ? THREE.MathUtils.lerp(0.05, frontEl, Math.pow(c, 1.4)) : THREE.MathUtils.lerp(0.05, -0.62, Math.pow(-c, 0.8));
    const sideburn = Math.exp(-(((Math.abs(theta) - 1.18) / 0.12) ** 2));
    el -= 0.28 * sideburn;
    const behindEar = Math.exp(-(((Math.abs(theta) - 1.75) / 0.25) ** 2));
    el -= 0.12 * behindEar;
    return el;
  };
  const cols = 72;
  const rows = 26;
  const positions: number[] = [];
  const uvs: number[] = [];
  const d = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    for (let c = 0; c <= cols; c++) {
      const theta = -Math.PI + (c / cols) * Math.PI * 2;
      const el0 = hairlineEl(theta);
      const el = el0 + (Math.PI / 2 - 0.001 - el0) * (1 - Math.pow(1 - t, 1.6));
      d.set(Math.sin(theta) * Math.cos(el), Math.sin(el), Math.cos(theta) * Math.cos(el));
      headSurface(d, L, p);
      const edge = smooth(0, 0.12, t);
      const topFront = Math.max(0, d.y) * smooth(-0.4, 0.6, d.z);
      const sideTrim = 1 - 0.5 * Math.abs(d.x) * (1 - Math.max(0, d.y));
      const thick = (0.0015 + 0.008 * edge + 0.013 * topFront * edge) * sideTrim;
      const rad = p.distanceTo(HEAD_CENTER);
      p.sub(HEAD_CENTER).multiplyScalar(1 + thick / rad).add(HEAD_CENTER);
      p.y += 0.002 * topFront * edge - 0.006 * Math.max(0, d.y) ** 4;
      positions.push(p.x, p.y, p.z);
      uvs.push(c / cols, t);
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const e = a + cols + 1;
      const f = e + 1;
      index.push(a, b, e, b, f, e);
    }
  }
  const cap = new THREE.BufferGeometry();
  cap.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  cap.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  cap.setIndex(index);
  cap.computeVertexNormals();
  const merged = stripToCore(cap);
  setAo(merged, (q) => 0.72 + 0.28 * smooth(1.58, 1.7, q.y));
  return merged;
}

export function buildEar(side: 'l' | 'r', L: FaceLayout): THREE.BufferGeometry {
  const sg = side === 'l' ? 1 : -1;
  const g = new THREE.SphereGeometry(1, 16, 12);
  g.scale(0.011, 0.03, 0.02);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    if (x * sg < 0) pos.setX(i, x * 0.4);
  }
  g.rotateY(sg * 0.35);
  g.rotateZ(-sg * 0.12);
  g.translate(sg * 0.077, L.eyeY - 0.012, -0.006);
  g.computeVertexNormals();
  setAo(g, (_q, n) => 0.8 + 0.2 * Math.abs(n.x));
  return g;
}

function roundedRectCurve(cx: number, cy: number, z: number, w: number, h: number, r: number): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  const corners: Array<[number, number, number]> = [
    [cx + w / 2 - r, cy + h / 2 - r, 0],
    [cx - w / 2 + r, cy + h / 2 - r, Math.PI / 2],
    [cx - w / 2 + r, cy - h / 2 + r, Math.PI],
    [cx + w / 2 - r, cy - h / 2 + r, Math.PI * 1.5],
  ];
  for (const [x, y, a0] of corners) {
    for (let k = 0; k <= 4; k++) {
      const a = a0 + (k / 4) * (Math.PI / 2);
      pts.push(new THREE.Vector3(x + Math.cos(a) * r, y + Math.sin(a) * r, z));
    }
  }
  return new THREE.CatmullRomCurve3(pts, true);
}

/** Glasses registered over the frames baked into the face photo. Returns [frame, lenses]. */
export function buildGlasses(L: FaceLayout): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const probe = new THREE.Vector3();
  const zAt = (x: number, y: number) => {
    let best = -1;
    for (let az = -0.8; az <= 0.8; az += 0.01) {
      for (let el = -0.5; el <= 0.5; el += 0.01) {
        const d = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
        headSurface(d, L, probe);
        if (Math.abs(probe.x - x) < 0.004 && Math.abs(probe.y - y) < 0.004) best = Math.max(best, probe.z);
      }
    }
    return best;
  };
  const w = 0.05;
  const h = 0.034;
  const lensY = L.eyeY - 0.002;
  const zFace = Math.max(zAt(L.eyeX, lensY), zAt(L.eyeX + 0.02, lensY));
  const z = zFace + 0.011;
  const frames: THREE.BufferGeometry[] = [];
  const lenses: THREE.BufferGeometry[] = [];
  for (const sg of [1, -1]) {
    const cx = sg * (L.eyeX + 0.002);
    frames.push(new THREE.TubeGeometry(roundedRectCurve(cx, lensY, z, w, h, 0.009), 48, 0.0017, 6, true));
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + 0.009, -h / 2);
    shape.lineTo(w / 2 - 0.009, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + 0.009);
    shape.lineTo(w / 2, h / 2 - 0.009);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - 0.009, h / 2);
    shape.lineTo(-w / 2 + 0.009, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - 0.009);
    shape.lineTo(-w / 2, -h / 2 + 0.009);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + 0.009, -h / 2);
    const lens = new THREE.ShapeGeometry(shape, 4);
    lens.translate(cx, lensY, z - 0.001);
    lenses.push(lens);
    const hinge = new THREE.Vector3(sg * (L.eyeX + 0.002 + w / 2), lensY + h / 2 - 0.006, z);
    const ear = new THREE.Vector3(sg * 0.079, L.eyeY - 0.004, -0.012);
    const temple = new THREE.CatmullRomCurve3([hinge, new THREE.Vector3(sg * 0.074, lensY + 0.006, z - 0.03), ear]);
    frames.push(new THREE.TubeGeometry(temple, 16, 0.0015, 5, false));
  }
  const bridge = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-(L.eyeX + 0.002 - w / 2), lensY + 0.008, z),
    new THREE.Vector3(0, lensY + 0.011, z + 0.004),
    new THREE.Vector3(L.eyeX + 0.002 - w / 2, lensY + 0.008, z),
  ]);
  frames.push(new THREE.TubeGeometry(bridge, 12, 0.0016, 5, false));
  return [mergeGeometries(frames.map(stripToCore), false)!, mergeGeometries(lenses.map(stripToCore), false)!];
}

/** Relaxed hanging hand in character space (palm facing the thigh, fingers loosely curled). */
export function buildHand(side: 'l' | 'r'): THREE.BufferGeometry {
  const sg = side === 'l' ? 1 : -1;
  const wrist = restPosition(`hand-${side}`);
  const parts: THREE.BufferGeometry[] = [];
  const palm = new RoundedBoxGeometry(0.03, 0.09, 0.08, 3, 0.013);
  palm.translate(0, -0.05, 0.004);
  parts.push(palm);
  const fingerZ = [0.026, 0.009, -0.007, -0.022];
  const proxLen = [0.034, 0.037, 0.035, 0.028];
  const distLen = [0.03, 0.033, 0.031, 0.025];
  fingerZ.forEach((fz, i) => {
    const r = 0.0088 - i * 0.0006;
    const knuckle = new THREE.Vector3(0, -0.094, fz);
    const prox = new THREE.CapsuleGeometry(r, proxLen[i], 4, 8);
    prox.translate(0, -proxLen[i] / 2, 0);
    prox.rotateZ(-sg * 0.35);
    prox.translate(knuckle.x, knuckle.y, knuckle.z);
    parts.push(prox);
    const a1 = -sg * 0.35;
    const mid = knuckle.clone().add(new THREE.Vector3(Math.sin(a1) * proxLen[i], -Math.cos(a1) * proxLen[i], 0));
    const dist = new THREE.CapsuleGeometry(r * 0.92, distLen[i], 4, 8);
    dist.translate(0, -distLen[i] / 2, 0);
    dist.rotateZ(-sg * 1.15);
    dist.translate(mid.x, mid.y, mid.z);
    parts.push(dist);
  });
  const thumb = new THREE.CapsuleGeometry(0.0105, 0.042, 4, 8);
  thumb.translate(0, -0.021, 0);
  thumb.rotateX(0.35);
  thumb.rotateZ(-sg * 0.5);
  thumb.translate(-sg * 0.008, -0.04, 0.042);
  parts.push(thumb);
  const merged = mergeGeometries(parts.map(stripToCore), false)!;
  merged.translate(wrist.x, wrist.y, wrist.z);
  setAo(merged, (q) => 0.85 + 0.15 * smooth(wrist.y - 0.16, wrist.y - 0.05, q.y));
  return merged;
}

/** Low-top sneaker in character space: lofted upper + extruded cup sole + lace bars. Returns [upper, sole]. */
export function buildSneaker(side: 'l' | 'r'): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const sg = side === 'l' ? 1 : -1;
  const cx = sg * 0.108;
  const soleTop = 0.027;
  const rings: Ring[] = [
    { c: new THREE.Vector3(cx, soleTop + 0.03, -0.074), rx: 0.03, rz: 0.03 },
    { c: new THREE.Vector3(cx, soleTop + 0.038, -0.062), rx: 0.04, rz: 0.042 },
    { c: new THREE.Vector3(cx, soleTop + 0.036, -0.02), rx: 0.045, rz: 0.046 },
    { c: new THREE.Vector3(cx, soleTop + 0.032, 0.04), rx: 0.048, rz: 0.042 },
    { c: new THREE.Vector3(cx, soleTop + 0.024, 0.1), rx: 0.047, rz: 0.032 },
    { c: new THREE.Vector3(cx, soleTop + 0.018, 0.15), rx: 0.042, rz: 0.024 },
    { c: new THREE.Vector3(cx, soleTop + 0.014, 0.18), rx: 0.03, rz: 0.017 },
    { c: new THREE.Vector3(cx, soleTop + 0.012, 0.192), rx: 0.012, rz: 0.008 },
  ];
  const upper = loftTube(rings, { segments: 28, side: new THREE.Vector3(1, 0, 0), clampMinY: soleTop - 0.002 });
  const laces: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const z = 0.0 + i * 0.026;
    const y = soleTop + (i < 2 ? 0.068 : 0.06 - (i - 2) * 0.008);
    const bar = new THREE.BoxGeometry(0.034, 0.003, 0.005);
    bar.rotateX(-0.35);
    bar.translate(cx, y, z);
    laces.push(bar);
  }
  const upperMerged = mergeGeometries([upper, ...laces].map(stripToCore), false)!;
  setAo(upperMerged, (q) => 0.82 + 0.18 * smooth(soleTop, soleTop + 0.03, q.y));

  const shape = new THREE.Shape();
  const hw = 0.05;
  shape.moveTo(-hw * 0.8, 0.08);
  shape.quadraticCurveTo(0, 0.095, hw * 0.8, 0.08);
  shape.quadraticCurveTo(hw, 0.06, hw, 0.0);
  shape.lineTo(hw * 0.95, -0.15);
  shape.quadraticCurveTo(hw * 0.7, -0.205, 0, -0.205);
  shape.quadraticCurveTo(-hw * 0.7, -0.205, -hw * 0.95, -0.15);
  shape.lineTo(-hw, 0.0);
  shape.quadraticCurveTo(-hw, 0.06, -hw * 0.8, 0.08);
  const sole = new THREE.ExtrudeGeometry(shape, { depth: soleTop - 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2 });
  sole.rotateX(-Math.PI / 2);
  sole.translate(cx, 0.003, 0.0);
  return [upperMerged, sole];
}

export function buildPhone(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const body = new RoundedBoxGeometry(0.072, 0.148, 0.008, 3, 0.008);
  const screen = new THREE.PlaneGeometry(0.066, 0.14);
  screen.translate(0, 0, 0.0041);
  return [body, screen];
}