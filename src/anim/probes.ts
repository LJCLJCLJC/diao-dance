import { BoneName } from '../character/rig';

type DegPose = Partial<Record<BoneName, [number, number, number]>>;

/**
 * Rig stress poses (bind-relative Euler degrees, XYZ). Axis notes for this rig:
 * -X raises a hanging arm/leg forward, +X on a shin/forearm bends it back/forward respectively
 * as noted, +Z abducts the left arm (right arm uses -Z), +Y turns toward the character's left.
 */
export const PROBES: Record<string, { bones: DegPose; hips?: [number, number, number] }> = {
  bind: { bones: {} },
  tpose: { bones: { 'upperarm-l': [0, 0, 80], 'upperarm-r': [0, 0, -80] } },
  armsForward: { bones: { 'upperarm-l': [-85, 0, -6], 'upperarm-r': [-85, 0, 6] } },
  elbows90: { bones: { 'upperarm-l': [-20, 0, 0], 'upperarm-r': [-20, 0, 0], 'forearm-l': [-90, 0, 0], 'forearm-r': [-90, 0, 0] } },
  squat: {
    bones: { 'thigh-l': [-80, 0, 4], 'thigh-r': [-80, 0, -4], 'shin-l': [100, 0, 0], 'shin-r': [100, 0, 0], spine: [15, 0, 0], chest: [10, 0, 0], 'foot-l': [-20, 0, 0], 'foot-r': [-20, 0, 0] },
    hips: [0, -0.32, -0.05],
  },
  twist: { bones: { spine: [0, 25, 0], chest: [0, 25, 0], neck: [0, 15, 0], head: [0, 25, 0] } },
  kick: { bones: { 'thigh-r': [-60, 0, -5], 'shin-r': [30, 0, 0], 'upperarm-r': [0, 0, -120], 'upperarm-l': [-30, 0, 30], 'forearm-l': [-60, 0, 0] } },
};

/** Relaxed stance from the 3.0 s hero frame: weight on the right leg, left foot out, head to his left. */
export const IDLE_STANCE: { bones: DegPose; hips: [number, number, number] } = {
  bones: {
    hips: [0, 6, -3],
    spine: [2, 2, 2],
    chest: [3, 4, 1.5],
    neck: [4, 6, 2],
    head: [-2, 9, 3],
    'clavicle-l': [0, 0, -2],
    'clavicle-r': [0, 0, 2],
    'upperarm-l': [-4, 0, -2],
    'upperarm-r': [-6, 0, 3],
    'forearm-l': [-14, 0, 0],
    'forearm-r': [-12, 0, 0],
    'hand-l': [-5, 0, 0],
    'hand-r': [-5, 0, 0],
    'thigh-l': [-7, 24, 5],
    'shin-l': [11, 0, 0],
    'foot-l': [-3, 0, 0],
    'thigh-r': [1, -4, -2],
    'shin-r': [2, 0, 0],
  },
  hips: [-0.015, -0.008, 0],
};
