import * as THREE from 'three';
import { BONE_INDEX as B } from '../character/rig';
import { addPose, createPose, Pose, poseFromDegrees } from './pose';
import { IDLE_STANCE } from './probes';

const stance = poseFromDegrees(IDLE_STANCE.bones, IDLE_STANCE.hips);
const layer = createPose();
const euler = new THREE.Euler();
const D = THREE.MathUtils.degToRad;

function setDeg(pose: Pose, bone: number, x: number, y: number, z: number): void {
  pose.q[bone].setFromEuler(euler.set(D(x), D(y), D(z)));
}

/**
 * Hero-frame stance with breathing (~4.2 s cycle), a slow weight sway (~7 s) and small head drift,
 * all as an additive layer so the stance itself stays exactly the 3.0 s reference pose at rest.
 */
export function sampleIdle(time: number, out: Pose): Pose {
  const br = Math.sin((time / 4.2) * Math.PI * 2);
  const brIn = Math.max(0, br);
  const sway = Math.sin((time / 7.0) * Math.PI * 2);
  const drift = Math.sin(time * 0.53) * 0.6 + Math.sin(time * 1.31 + 1.7) * 0.4;
  const nod = Math.sin(time * 0.71 + 0.4) * 0.6 + Math.sin(time * 1.9) * 0.4;

  for (const q of layer.q) q.identity();
  setDeg(layer, B.hips, 0, sway * 1.6, sway * 0.9);
  setDeg(layer, B.spine, -br * 0.5, -sway * 0.8, -sway * 0.6);
  setDeg(layer, B.chest, -br * 1.1, -sway * 0.6, -sway * 0.3);
  setDeg(layer, B.neck, br * 0.7, drift * 1.2, 0);
  setDeg(layer, B.head, br * 0.4 + nod * 1.2, drift * 2.2, nod * 0.6);
  setDeg(layer, B['clavicle-l'], 0, 0, brIn * 1.2);
  setDeg(layer, B['clavicle-r'], 0, 0, -brIn * 1.2);
  setDeg(layer, B['upperarm-l'], br * 0.6, 0, -brIn * 0.8 + sway * 0.6);
  setDeg(layer, B['upperarm-r'], -br * 0.6, 0, brIn * 0.8 + sway * 0.6);
  setDeg(layer, B['forearm-l'], -drift * 1.2, 0, 0);
  setDeg(layer, B['forearm-r'], drift * 1.0, 0, 0);
  setDeg(layer, B['thigh-r'], 0, 0, -sway * 0.9);
  setDeg(layer, B['thigh-l'], 0, 0, -sway * 0.9);
  layer.hips.set(sway * 0.007, brIn * 0.002, 0);
  return addPose(out, stance, layer);
}
