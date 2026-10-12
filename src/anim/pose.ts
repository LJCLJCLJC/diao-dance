import * as THREE from 'three';
import { BONE_DEFS, BoneName, Rig } from '../character/rig';

/** Local rotation per bone (identity = bind) plus the hips' local offset from bind. */
export interface Pose {
  q: THREE.Quaternion[];
  hips: THREE.Vector3;
}

export const BONE_COUNT = BONE_DEFS.length;

export function createPose(): Pose {
  return { q: BONE_DEFS.map(() => new THREE.Quaternion()), hips: new THREE.Vector3() };
}

export function copyPose(out: Pose, src: Pose): Pose {
  for (let i = 0; i < BONE_COUNT; i++) out.q[i].copy(src.q[i]);
  out.hips.copy(src.hips);
  return out;
}

export function blendPose(out: Pose, a: Pose, b: Pose, t: number): Pose {
  for (let i = 0; i < BONE_COUNT; i++) out.q[i].slerpQuaternions(a.q[i], b.q[i], t);
  out.hips.lerpVectors(a.hips, b.hips, t);
  return out;
}

const euler = new THREE.Euler();
const tmp = new THREE.Quaternion();

/** Builds a pose from Euler degrees (XYZ order) per bone; unspecified bones stay at bind. */
export function poseFromDegrees(spec: Partial<Record<BoneName, [number, number, number]>>, hips: [number, number, number] = [0, 0, 0]): Pose {
  const pose = createPose();
  BONE_DEFS.forEach((def, i) => {
    const d = spec[def.name];
    if (d) pose.q[i].setFromEuler(euler.set(THREE.MathUtils.degToRad(d[0]), THREE.MathUtils.degToRad(d[1]), THREE.MathUtils.degToRad(d[2])));
  });
  pose.hips.set(...hips);
  return pose;
}

/** Composes `add` on top of `base` (local post-multiplication), e.g. breathing on the idle stance. */
export function addPose(out: Pose, base: Pose, add: Pose, weight = 1): Pose {
  for (let i = 0; i < BONE_COUNT; i++) {
    tmp.identity().slerp(add.q[i], weight);
    out.q[i].copy(base.q[i]).multiply(tmp);
  }
  out.hips.copy(base.hips).addScaledVector(add.hips, weight);
  return out;
}

export function applyPose(rig: Rig, pose: Pose, restHips: THREE.Vector3): void {
  for (let i = 0; i < BONE_COUNT; i++) rig.list[i].quaternion.copy(pose.q[i]);
  rig.bones.hips.position.copy(restHips).add(pose.hips);
}
