import * as THREE from 'three';
import { HEM_BONES, Rig } from '../character/rig';

const HEM_LEN = 0.15;
const MAX_SWING = THREE.MathUtils.degToRad(30);
const STIFFNESS = 240;
const DAMPING = 13;
/** jeans half-width at the hem height (~0.085) plus a little cloth clearance */
const THIGH_RADIUS = 0.095;
const STEP = 1 / 120;

interface HemState {
  bone: THREE.Bone;
  /** pivot and rest tip in hips-local space */
  pivot: THREE.Vector3;
  restTip: THREE.Vector3;
  restDir: THREE.Vector3;
  outward: THREE.Vector3;
  tip: THREE.Vector3;
  vel: THREE.Vector3;
  /** simulated pivot -> tip direction in hips-local space */
  localDir: THREE.Vector3;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _delta = new THREE.Quaternion();
const IDENTITY = new THREE.Quaternion();
const _target = new THREE.Vector3();
const _pivotW = new THREE.Vector3();
const _out = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Spring-damper pendulums for the four shirt-hem helper bones. Each hem tip lags behind its
 * hips-driven target in world space, flares out with hip yaw speed (the shirt swinging when he
 * twists) and is pushed out of the thighs. Call after the body pose is applied each frame.
 */
export class HemSprings {
  private hem: HemState[];
  private prevHips = new THREE.Quaternion();
  private yawRate = 0;
  private primed = false;

  constructor(private rig: Rig) {
    this.hem = HEM_BONES.map((name) => {
      const bone = rig.bones[name];
      const pivot = bone.position.clone();
      const outward = new THREE.Vector3(pivot.x, 0, pivot.z).normalize();
      const restTip = pivot.clone().addScaledVector(outward, 0.012).add(new THREE.Vector3(0, -HEM_LEN, 0));
      return {
        bone, pivot, restTip, outward,
        restDir: restTip.clone().sub(pivot).normalize(),
        tip: new THREE.Vector3(), vel: new THREE.Vector3(), localDir: new THREE.Vector3(),
      };
    });
  }

  /** Snap the tips to their targets (after seeks or long pauses). */
  reset(): void {
    this.primed = false;
  }

  update(dt: number): void {
    const hips = this.rig.bones.hips;
    hips.updateWorldMatrix(true, true);
    _m.copy(hips.matrixWorld);
    hips.getWorldQuaternion(_q);
    _qInv.copy(_q).invert();

    if (!this.primed || dt > 0.2) {
      for (const h of this.hem) {
        h.tip.copy(h.restTip).applyMatrix4(_m);
        h.vel.set(0, 0, 0);
        h.bone.quaternion.identity();
      }
      this.prevHips.copy(_q);
      this.yawRate = 0;
      this.primed = true;
      return;
    }

    if (dt > 0) {
      _delta.copy(this.prevHips).invert().premultiply(_q);
      const rate = (2 * Math.sign(_delta.w || 1) * _delta.y) / dt;
      this.yawRate += (rate - this.yawRate) * Math.min(1, dt * 12);
      this.prevHips.copy(_q);
    }
    const flare = Math.min(0.4, (0.19 * this.yawRate * this.yawRate) / 9.8);

    const thighs = (['l', 'r'] as const).map((s) => [
      this.rig.bones[`thigh-${s}`].getWorldPosition(new THREE.Vector3()),
      this.rig.bones[`shin-${s}`].getWorldPosition(new THREE.Vector3()),
    ]);

    const steps = Math.min(8, Math.max(1, Math.ceil(dt / STEP)));
    const h = dt / steps;
    for (const st of this.hem) {
      _out.copy(st.outward).applyQuaternion(_q);
      _target.copy(st.restTip).applyMatrix4(_m).addScaledVector(_out, HEM_LEN * flare);
      _target.addScaledVector(UP, HEM_LEN * (1 - Math.cos(Math.atan(flare))));
      for (let i = 0; i < steps; i++) {
        _a.subVectors(_target, st.tip).multiplyScalar(STIFFNESS).addScaledVector(st.vel, -DAMPING);
        st.vel.addScaledVector(_a, h);
        st.tip.addScaledVector(st.vel, h);
      }
      for (const [p0, p1] of thighs) pushOutOfCapsule(st, p0, p1);
      _pivotW.copy(st.pivot).applyMatrix4(_m);
      st.localDir.subVectors(st.tip, _pivotW).applyQuaternion(_qInv).normalize();
    }

    // One cloth tube: each panel shares part of its neighbours' swing so the hem never kinks
    // where the front/back and side panels meet.
    this.hem.forEach((st, i) => {
      const [a, b] = NEIGHBOURS[i];
      _a.subVectors(this.hem[a].localDir, this.hem[a].restDir);
      _b.subVectors(this.hem[b].localDir, this.hem[b].restDir);
      _d.copy(st.localDir).multiplyScalar(1 - 2 * COUPLING)
        .addScaledVector(st.restDir, 2 * COUPLING)
        .addScaledVector(_a, COUPLING)
        .addScaledVector(_b, COUPLING)
        .normalize();
      st.bone.quaternion.setFromUnitVectors(st.restDir, _d);
      const angle = 2 * Math.acos(THREE.MathUtils.clamp(st.bone.quaternion.w, -1, 1));
      if (angle > MAX_SWING) st.bone.quaternion.slerp(IDENTITY, 1 - MAX_SWING / angle);
    });
  }
}

/** HEM_BONES order is front, back, left, right; each panel's two adjacent panels. */
const NEIGHBOURS: Array<[number, number]> = [[2, 3], [2, 3], [0, 1], [0, 1]];
const COUPLING = 0.22;

function pushOutOfCapsule(st: HemState, p0: THREE.Vector3, p1: THREE.Vector3): void {
  _b.subVectors(p1, p0);
  const t = THREE.MathUtils.clamp(_c.subVectors(st.tip, p0).dot(_b) / _b.lengthSq(), 0, 1);
  _c.copy(p0).addScaledVector(_b, t);
  _a.subVectors(st.tip, _c);
  const dist = _a.length();
  if (dist >= THIGH_RADIUS || dist < 1e-6) return;
  _a.divideScalar(dist);
  st.tip.copy(_c).addScaledVector(_a, THIGH_RADIUS);
  const vn = st.vel.dot(_a);
  if (vn < 0) st.vel.addScaledVector(_a, -vn);
}
