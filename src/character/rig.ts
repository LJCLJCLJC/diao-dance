import * as THREE from 'three';

/**
 * Bind pose of the IMG_0562 dancer (metres, Y-up, facing +Z, origin on the floor).
 * Every bone's rest local rotation is identity, so a captured pose is just one local
 * quaternion per bone. Must stay in sync with `rig.bones` in character-sculpt-spec.json.
 */
export const BONE_DEFS = [
  { name: 'hips', parent: null, pos: [0, 0.96, 0] },
  { name: 'spine', parent: 'hips', pos: [0, 1.06, -0.005] },
  { name: 'chest', parent: 'spine', pos: [0, 1.24, -0.01] },
  { name: 'neck', parent: 'chest', pos: [0, 1.44, -0.01] },
  { name: 'head', parent: 'neck', pos: [0, 1.535, 0.0] },
  { name: 'jaw', parent: 'head', pos: [0, 1.548, 0.02] },
  { name: 'clavicle-l', parent: 'chest', pos: [0.03, 1.4, -0.005] },
  { name: 'upperarm-l', parent: 'clavicle-l', pos: [0.185, 1.395, -0.015] },
  { name: 'forearm-l', parent: 'upperarm-l', pos: [0.225, 1.115, -0.025] },
  { name: 'hand-l', parent: 'forearm-l', pos: [0.25, 0.865, 0.0] },
  { name: 'clavicle-r', parent: 'chest', pos: [-0.03, 1.4, -0.005] },
  { name: 'upperarm-r', parent: 'clavicle-r', pos: [-0.185, 1.395, -0.015] },
  { name: 'forearm-r', parent: 'upperarm-r', pos: [-0.225, 1.115, -0.025] },
  { name: 'hand-r', parent: 'forearm-r', pos: [-0.25, 0.865, 0.0] },
  { name: 'thigh-l', parent: 'hips', pos: [0.095, 0.92, 0.0] },
  { name: 'shin-l', parent: 'thigh-l', pos: [0.1, 0.5, 0.005] },
  { name: 'foot-l', parent: 'shin-l', pos: [0.105, 0.085, -0.01] },
  { name: 'thigh-r', parent: 'hips', pos: [-0.095, 0.92, 0.0] },
  { name: 'shin-r', parent: 'thigh-r', pos: [-0.1, 0.5, 0.005] },
  { name: 'foot-r', parent: 'shin-r', pos: [-0.105, 0.085, -0.01] },
  { name: 'hem-f', parent: 'hips', pos: [0, 0.88, 0.14] },
  { name: 'hem-b', parent: 'hips', pos: [0, 0.88, -0.13] },
  { name: 'hem-l', parent: 'hips', pos: [0.19, 0.88, 0.0] },
  { name: 'hem-r', parent: 'hips', pos: [-0.19, 0.88, 0.0] },
] as const;

export type BoneName = (typeof BONE_DEFS)[number]['name'];

/** End points used for bone directions (rest), e.g. by the motion retargeter and pose probes. */
export const BONE_TIPS: Partial<Record<BoneName, [number, number, number]>> = {
  head: [0, 1.72, 0.0],
  jaw: [0, 1.53, 0.09],
  'hand-l': [0.26, 0.69, 0.015],
  'hand-r': [-0.26, 0.69, 0.015],
  'foot-l': [0.11, 0.02, 0.16],
  'foot-r': [-0.11, 0.02, 0.16],
};

export const HEM_BONES: BoneName[] = ['hem-f', 'hem-b', 'hem-l', 'hem-r'];

export const BONE_INDEX: Record<BoneName, number> = Object.fromEntries(
  BONE_DEFS.map((b, i) => [b.name, i]),
) as Record<BoneName, number>;

export function restPosition(name: BoneName): THREE.Vector3 {
  const def = BONE_DEFS[BONE_INDEX[name]];
  return new THREE.Vector3(def.pos[0], def.pos[1], def.pos[2]);
}

export interface Rig {
  bones: Record<BoneName, THREE.Bone>;
  list: THREE.Bone[];
  skeleton: THREE.Skeleton;
  rootBone: THREE.Bone;
}

export function createRig(): Rig {
  const bones = {} as Record<BoneName, THREE.Bone>;
  const list: THREE.Bone[] = [];
  for (const def of BONE_DEFS) {
    const bone = new THREE.Bone();
    bone.name = def.name;
    const p = def.parent ? BONE_DEFS[BONE_INDEX[def.parent]].pos : [0, 0, 0];
    bone.position.set(def.pos[0] - p[0], def.pos[1] - p[1], def.pos[2] - p[2]);
    if (def.parent) bones[def.parent].add(bone);
    bones[def.name] = bone;
    list.push(bone);
  }
  const rootBone = bones.hips;
  rootBone.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  return { bones, list, skeleton, rootBone };
}

/** Captures every bone's local position/quaternion so poses can be reset to bind. */
export function snapshotRest(rig: Rig): { pos: THREE.Vector3[]; quat: THREE.Quaternion[] } {
  return {
    pos: rig.list.map((b) => b.position.clone()),
    quat: rig.list.map((b) => b.quaternion.clone()),
  };
}
