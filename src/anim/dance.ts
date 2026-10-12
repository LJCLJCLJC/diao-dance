import * as THREE from 'three';
import { BONE_INDEX, BoneName, restPosition } from '../character/rig';
import { Pose } from './pose';

/** Shape of public/anim/dance.json as written by tools/retarget_dance.py. */
interface DanceData {
  fps: number;
  duration: number;
  frameCount: number;
  bones: BoneName[];
  /** absolute local hips position per frame, flattened xyz */
  hips: number[];
  /** local quaternion per frame, flattened xyzw */
  rotations: Record<BoneName, number[]>;
}

export interface Dance {
  clip: THREE.AnimationClip;
  duration: number;
  /** Writes the clip at time `t` (clamped to the clip) into `out`; bones without tracks become bind. */
  sample(t: number, out: Pose): Pose;
}

export async function loadDance(url = `${import.meta.env.BASE_URL}anim/dance.json`): Promise<Dance> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`dance.json: HTTP ${res.status}`);
  const data = (await res.json()) as DanceData;
  const times = Array.from({ length: data.frameCount }, (_, i) => i / data.fps);

  const rotTracks = data.bones.map((b) => new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, data.rotations[b]));
  const hipsTrack = new THREE.VectorKeyframeTrack('hips.position', times, data.hips);
  const clip = new THREE.AnimationClip('diao-dance', data.duration, [...rotTracks, hipsTrack]);

  // QuaternionKeyframeTrack's linear factory yields a slerping QuaternionLinearInterpolant.
  const rotSamplers = rotTracks.map((track, i) => ({ bone: BONE_INDEX[data.bones[i]], interp: track.InterpolantFactoryMethodLinear() }));
  const hipsSampler = hipsTrack.InterpolantFactoryMethodLinear();
  const restHips = restPosition('hips');
  const tracked = new Set(rotSamplers.map((s) => s.bone));

  return {
    clip,
    duration: data.duration,
    sample(t, out) {
      const tt = THREE.MathUtils.clamp(t, 0, data.duration);
      for (const s of rotSamplers) {
        const r = s.interp.evaluate(tt);
        out.q[s.bone].set(r[0], r[1], r[2], r[3]);
      }
      for (let i = 0; i < out.q.length; i++) if (!tracked.has(i)) out.q[i].identity();
      const h = hipsSampler.evaluate(tt);
      out.hips.set(h[0] - restHips.x, h[1] - restHips.y, h[2] - restHips.z);
      return out;
    },
  };
}
