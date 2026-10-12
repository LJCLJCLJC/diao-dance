"""Bake public/anim/dance.json from the MediaPipe passes plus hand-keyed upper-body poses.

Pipeline
  1. Blend the forward and reversed MediaPipe passes per frame (reverse dominates the cropped
     0-2.1 s section, where it carries tracking from the full-body frames), weighted by visibility.
  2. Convert to rig space (Y up, character faces +Z), smooth in time, and undo the handheld camera
     pitch/roll by aligning a slowly varying body axis with +Y.
  3. Solve local bone rotations for the 24-bone rig in src/character/rig.ts: hips/chest/head from
     landmark bases, limbs by swing + hinge twist (knee/elbow bend plane), feet flattened on contact.
  4. Root height from floor contact; horizontal root from support-foot locking with a slow leak.
  5. 0-2.1 s: the camera only sees the dancer from the waist down, so spine/arms/head come from the
     KEYS table below and cross-fade into the capture by 2.2 s.

Run: tools/.venv/Scripts/python tools/retarget_dance.py [--debug]
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "reference" / "pose" / "raw.json"
OUT = ROOT / "public" / "anim" / "dance.json"
RIG_TS = ROOT / "src" / "character" / "rig.ts"

OUT_FPS = 30
DURATION = 3.45

# ---------------------------------------------------------------- quaternion helpers (x, y, z, w)


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ])


def qinv(q):
    return np.array([-q[0], -q[1], -q[2], q[3]])


def qrot(q, v):
    u = q[:3]
    t = 2.0 * np.cross(u, v)
    return v + q[3] * t + np.cross(u, t)


def qnorm(q):
    return q / np.linalg.norm(q)


def q_axis_angle(axis, ang):
    axis = axis / (np.linalg.norm(axis) + 1e-12)
    s = math.sin(ang / 2)
    return np.array([axis[0] * s, axis[1] * s, axis[2] * s, math.cos(ang / 2)])


def q_from_unit_vectors(a, b):
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    r = float(np.dot(a, b)) + 1.0
    if r < 1e-6:
        axis = np.cross([1.0, 0, 0], a) if abs(a[0]) < 0.9 else np.cross([0, 1.0, 0], a)
        return q_axis_angle(axis, math.pi)
    c = np.cross(a, b)
    return qnorm(np.array([c[0], c[1], c[2], r]))


def q_from_basis(x, y, z):
    m = np.stack([x, y, z], axis=1)
    tr = m[0, 0] + m[1, 1] + m[2, 2]
    if tr > 0:
        s = 0.5 / math.sqrt(tr + 1.0)
        q = [(m[2, 1] - m[1, 2]) * s, (m[0, 2] - m[2, 0]) * s, (m[1, 0] - m[0, 1]) * s, 0.25 / s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = 2.0 * math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2])
        q = [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = 2.0 * math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2])
        q = [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = 2.0 * math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1])
        q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
    return qnorm(np.array(q))


def basis_xy(x, y_ref):
    """Orthonormal frame with exact X and Y as close as possible to y_ref."""
    x = x / np.linalg.norm(x)
    z = np.cross(x, y_ref)
    z /= np.linalg.norm(z)
    y = np.cross(z, x)
    return q_from_basis(x, y, z)


def slerp(a, b, t):
    d = float(np.dot(a, b))
    if d < 0:
        b = -b
        d = -d
    if d > 0.9995:
        return qnorm(a + (b - a) * t)
    th = math.acos(d)
    return (math.sin((1 - t) * th) * a + math.sin(t * th) * b) / math.sin(th)


def q_euler_deg(x, y, z):
    """Matches THREE.Euler(..., 'XYZ') -> Quaternion."""
    qx = q_axis_angle(np.array([1.0, 0, 0]), math.radians(x))
    qy = q_axis_angle(np.array([0, 1.0, 0]), math.radians(y))
    qz = q_axis_angle(np.array([0, 0, 1.0]), math.radians(z))
    return qmul(qmul(qx, qy), qz)


def q_to_euler_deg(q):
    x, y, z, w = q
    m00 = 1 - 2 * (y * y + z * z)
    m01 = 2 * (x * y - z * w)
    m02 = 2 * (x * z + y * w)
    m12 = 2 * (y * z - x * w)
    m22 = 1 - 2 * (x * x + y * y)
    m11 = 1 - 2 * (x * x + z * z)
    m21 = 2 * (y * z + x * w)
    ey = math.asin(max(-1.0, min(1.0, m02)))
    if abs(m02) < 0.9999:
        ex = math.atan2(-m12, m22)
        ez = math.atan2(-m01, m00)
    else:
        ex = math.atan2(m21, m11)
        ez = 0.0
    return np.degrees([ex, ey, ez])


def angle_of(q):
    return 2 * math.degrees(math.acos(min(1.0, abs(q[3]))))


def scale_rot(q, s):
    return slerp(np.array([0, 0, 0, 1.0]), q, s)


def clamp_rot(q, max_deg):
    a = angle_of(q)
    return q if a <= max_deg else scale_rot(q, max_deg / a)


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


IDQ = np.array([0, 0, 0, 1.0])

# ---------------------------------------------------------------- rig (parsed from rig.ts)


def load_rig():
    src = RIG_TS.read_text(encoding="utf-8")
    bones = []
    for m in re.finditer(r"\{ name: '([\w-]+)', parent: (null|'([\w-]+)'), pos: \[([^\]]+)\] \}", src):
        bones.append({"name": m.group(1), "parent": m.group(3), "pos": np.array([float(v) for v in m.group(4).split(",")])})
    tips_block = src[src.index("BONE_TIPS"):src.index("HEM_BONES")]
    tips = {m.group(1): np.array([float(v) for v in m.group(2).split(",")])
            for m in re.finditer(r"'?([\w-]+)'?: \[([^\]]+)\]", tips_block)}
    if len(bones) != 24:
        raise SystemExit(f"rig.ts parse failed: {len(bones)} bones")
    return bones, tips


BONES, TIPS = load_rig()
NAMES = [b["name"] for b in BONES]
BI = {n: i for i, n in enumerate(NAMES)}
POS = {b["name"]: b["pos"] for b in BONES}
PARENT = {b["name"]: b["parent"] for b in BONES}
OFFSET = {n: POS[n] - (POS[PARENT[n]] if PARENT[n] else 0) for n in NAMES}


def rest_dir(bone, child=None):
    end = POS[child] if child else TIPS[bone]
    d = end - POS[bone]
    return d / np.linalg.norm(d)


def fk(local, hips_pos):
    wq, wp = {}, {}
    for n in NAMES:
        p = PARENT[n]
        if p is None:
            wq[n] = local[n]
            wp[n] = hips_pos.copy()
        else:
            wq[n] = qmul(wq[p], local[n])
            wp[n] = wp[p] + qrot(wq[p], OFFSET[n])
    return wq, wp


# Sole contact points relative to each foot bone (from buildSneaker: sole z -0.09..0.2, bottom y 0).
def sole_points(sg):
    return [np.array([sg * x, -0.085, z]) for x, z in [(0.035, -0.075), (-0.035, -0.075), (0.04, 0.13), (-0.04, 0.13), (0.0, 0.2)]]


SOLE = {"l": sole_points(1), "r": sole_points(-1)}
SOLE_REST_MIN = 0.0

# ---------------------------------------------------------------- landmarks

LM_NAMES = None


def load_landmarks():
    global LM_NAMES
    raw = json.loads(RAW.read_text())
    LM_NAMES = raw["landmarkNames"]
    n = raw["frameCount"]
    P = np.full((2, n, 33, 3), np.nan)
    V = np.zeros((2, n, 33))
    for k, key in enumerate(["forward", "reverse"]):
        for f, e in enumerate(raw[key]):
            if e is None:
                continue
            w = np.array(e["world"])
            P[k, f] = np.stack([w[:, 0], -w[:, 1], -w[:, 2]], axis=1)
            V[k, f] = w[:, 3]
    # Reverse pass owns the cropped opening; both agree once the full body is in frame.
    frames = np.arange(n)
    w_rev = np.clip(1.0 - 0.5 * (frames - 60) / 12.0, 0.5, 1.0)
    W = np.stack([1 - w_rev, w_rev])[:, :, None] * np.maximum(V, 0.05)
    W[np.isnan(P[..., 0])] = 0
    Pz = np.nan_to_num(P)
    tot = W.sum(axis=0)
    comb = (Pz * W[..., None]).sum(axis=0) / np.maximum(tot, 1e-6)[..., None]
    vis = (V * (W > 0)).max(axis=0)
    missing = tot.sum(axis=1) == 0
    good = np.where(~missing)[0]
    for f in np.where(missing)[0]:
        j = good[np.argmin(np.abs(good - f))]
        comb[f] = comb[j]
    return comb, vis, raw["fps"]


def gaussian_smooth(x, sigma):
    """Smooth along axis 0 with edge padding; sigma may be an array (per frame)."""
    n = x.shape[0]
    sig = np.broadcast_to(np.asarray(sigma, float), (n,))
    out = np.empty_like(x)
    for i in range(n):
        s = max(sig[i], 1e-3)
        r = int(math.ceil(3 * s))
        idx = np.clip(np.arange(i - r, i + r + 1), 0, n - 1)
        w = np.exp(-0.5 * ((np.arange(-r, r + 1)) / s) ** 2)
        out[i] = np.tensordot(w / w.sum(), x[idx], axes=(0, 0))
    return out


def lm(frame, name):
    return frame[LM_NAMES.index(name)]


def mid(frame, a, b):
    return 0.5 * (lm(frame, a) + lm(frame, b))


def gravity_align(L, fps):
    """Rotate each frame so a slowly varying body axis points along +Y (undoes camera pitch/roll)."""
    n = L.shape[0]
    t = np.arange(n) / fps
    axis = np.zeros((n, 3))
    for f in range(n):
        legs = mid(L[f], "LEFT_HIP", "RIGHT_HIP") - mid(L[f], "LEFT_ANKLE", "RIGHT_ANKLE")
        torso = mid(L[f], "LEFT_SHOULDER", "RIGHT_SHOULDER") - mid(L[f], "LEFT_HIP", "RIGHT_HIP")
        legs /= np.linalg.norm(legs)
        torso /= np.linalg.norm(torso)
        k = smoothstep(1.9, 2.3, t[f])
        axis[f] = legs + k * torso
    axis = gaussian_smooth(axis, 7.0)
    out = np.empty_like(L)
    for f in range(n):
        a = axis[f] / np.linalg.norm(axis[f])
        q = q_from_unit_vectors(a, np.array([0, 1.0, 0]))
        out[f] = np.array([qrot(q, p) for p in L[f]])
    return out


# ---------------------------------------------------------------- pose solve

R_THIGH = {s: rest_dir(f"thigh-{s}", f"shin-{s}") for s in "lr"}
R_SHIN = {s: rest_dir(f"shin-{s}", f"foot-{s}") for s in "lr"}
R_FOOT = {s: rest_dir(f"foot-{s}") for s in "lr"}
R_UPPER = {s: rest_dir(f"upperarm-{s}", f"forearm-{s}") for s in "lr"}
R_FORE = {s: rest_dir(f"forearm-{s}", f"hand-{s}") for s in "lr"}
R_HAND = {s: rest_dir(f"hand-{s}") for s in "lr"}
X = np.array([1.0, 0, 0])
Y = np.array([0, 1.0, 0])
SIDE = {"l": "LEFT", "r": "RIGHT"}


def twist_to_hinge(q_swing, parent_wq, d_world, hinge_local, n_world, weight):
    """Rotate q_swing about the bone axis so the child's hinge axis lines up with n_world."""
    if weight <= 0:
        return q_swing
    h = qrot(qmul(parent_wq, q_swing), hinge_local)
    h_p = h - np.dot(h, d_world) * d_world
    n_p = n_world - np.dot(n_world, d_world) * d_world
    if np.linalg.norm(h_p) < 1e-6 or np.linalg.norm(n_p) < 1e-6:
        return q_swing
    h_p /= np.linalg.norm(h_p)
    n_p /= np.linalg.norm(n_p)
    phi = math.atan2(np.dot(np.cross(h_p, n_p), d_world), np.dot(h_p, n_p))
    d_local = qrot(qinv(parent_wq), d_world)
    return qmul(q_axis_angle(d_local, phi * weight), q_swing)


def clamp_twist(q, axis, max_deg):
    """Swing-twist split about `axis` (local rest bone direction); limits the twist part."""
    proj = np.dot(q[:3], axis) * axis
    tw = np.array([proj[0], proj[1], proj[2], q[3]])
    if np.linalg.norm(tw) < 1e-9:
        return q
    tw = qnorm(tw)
    swing = qmul(q, qinv(tw))
    return qmul(swing, clamp_rot(tw, max_deg))


def hinge_only(q, axis_local, lo, hi):
    """Keep only the rotation about one local axis, clamped to [lo, hi] degrees."""
    v = q[:3]
    proj = np.dot(v, axis_local) * axis_local
    tw = np.array([proj[0], proj[1], proj[2], q[3]])
    if np.linalg.norm(tw) < 1e-9:
        return IDQ.copy()
    tw = qnorm(tw)
    ang = 2 * math.atan2(np.dot(tw[:3], axis_local), tw[3])
    ang = math.radians(min(hi, max(lo, math.degrees(ang))))
    return q_axis_angle(axis_local, ang)


def solve_frame(F, t):
    local = {n: IDQ.copy() for n in NAMES}
    full = smoothstep(1.9, 2.3, t)
    knee_bias = KNEE_BIAS_CROPPED + (KNEE_BIAS - KNEE_BIAS_CROPPED) * full
    hipL, hipR = lm(F, "LEFT_HIP"), lm(F, "RIGHT_HIP")
    hip_mid = 0.5 * (hipL + hipR)
    sh_mid = mid(F, "LEFT_SHOULDER", "RIGHT_SHOULDER")
    torso_up = (sh_mid - hip_mid) / np.linalg.norm(sh_mid - hip_mid)

    q_hips = basis_xy(hipL - hipR, qnorm_vec(Y + 0.25 * torso_up))
    local["hips"] = q_hips

    q_chest_w = basis_xy(lm(F, "LEFT_SHOULDER") - lm(F, "RIGHT_SHOULDER"), torso_up)
    rel = qmul(qinv(q_hips), q_chest_w)
    local["spine"] = scale_rot(rel, 0.45)
    local["chest"] = qmul(qinv(local["spine"]), rel)

    ear_mid = mid(F, "LEFT_EAR", "RIGHT_EAR")
    x_h = lm(F, "LEFT_EAR") - lm(F, "RIGHT_EAR")
    fwd = lm(F, "NOSE") - ear_mid
    fwd /= np.linalg.norm(fwd)
    y_h = np.cross(fwd, x_h / np.linalg.norm(x_h))
    q_head_w = qmul(basis_xy(x_h, y_h), q_axis_angle(X, math.radians(-HEAD_PITCH_OFFSET)))
    rel = qmul(qinv(q_chest_w), q_head_w)
    local["neck"] = scale_rot(rel, 0.4)
    local["head"] = qmul(qinv(local["neck"]), rel)

    wq, _ = fk(local, POS["hips"])
    for s in "lr":
        S = SIDE[s]
        hp, kn, an = lm(F, f"{S}_HIP"), lm(F, f"{S}_KNEE"), lm(F, f"{S}_ANKLE")
        toe, heel = lm(F, f"{S}_FOOT_INDEX"), lm(F, f"{S}_HEEL")
        u = qnorm_vec(kn - hp)
        l = qnorm_vec(an - kn)
        fdir = qnorm_vec(toe - an)
        pw = wq["hips"]
        q = q_from_unit_vectors(R_THIGH[s], qrot(qinv(pw), u))
        bend = math.degrees(math.acos(np.clip(np.dot(u, l), -1, 1)))
        heading = qnorm_vec(toe - heel)
        n_fb = np.cross(heading, u)
        n = np.cross(u, l)
        if np.linalg.norm(n) > 1e-6 and np.dot(n, n_fb) < 0:
            n = -n
        wb = smoothstep(8, 25, bend)
        n_mix = qnorm_vec(wb * qnorm_vec(n) + (1 - wb) * qnorm_vec(n_fb)) if np.linalg.norm(n) > 1e-6 else qnorm_vec(n_fb)
        q = twist_to_hinge(q, pw, u, X, n_mix, 1.0)
        local[f"thigh-{s}"] = clamp_twist(q, R_THIGH[s], 40)
        wq, _ = fk(local, POS["hips"])
        q = q_from_unit_vectors(R_SHIN[s], qrot(qinv(wq[f"thigh-{s}"]), l))
        q = hinge_only(q, X, 0, 140)
        flex = 2 * math.degrees(math.atan2(q[0], q[3]))
        local[f"shin-{s}"] = q_axis_angle(X, math.radians(max(0.0, flex - knee_bias) * KNEE_GAIN))
        wq, _ = fk(local, POS["hips"])
        q = q_from_unit_vectors(R_FOOT[s], qrot(qinv(wq[f"shin-{s}"]), fdir))
        local[f"foot-{s}"] = clamp_rot(q, 45)

        sh, el, wr = lm(F, f"{S}_SHOULDER"), lm(F, f"{S}_ELBOW"), lm(F, f"{S}_WRIST")
        hand = 0.5 * (lm(F, f"{S}_INDEX") + lm(F, f"{S}_PINKY"))
        u = qnorm_vec(el - sh)
        l = qnorm_vec(wr - el)
        wq, _ = fk(local, POS["hips"])
        pw = wq[f"clavicle-{s}"]
        q = q_from_unit_vectors(R_UPPER[s], qrot(qinv(pw), u))
        bend = math.degrees(math.acos(np.clip(np.dot(u, l), -1, 1)))
        n = np.cross(u, l)
        if np.linalg.norm(n) > 1e-6:
            q = twist_to_hinge(q, pw, u, -X, qnorm_vec(n), smoothstep(15, 40, bend))
        q = clamp_twist(q, R_UPPER[s], 80)
        sg = 1 if s == "l" else -1
        local[f"upperarm-{s}"] = qmul(q_axis_angle(np.array([0, 0, 1.0]), math.radians(-sg * ARM_ADDUCT)), q)
        wq, _ = fk(local, POS["hips"])
        q = q_from_unit_vectors(R_FORE[s], qrot(qinv(wq[f"upperarm-{s}"]), l))
        local[f"forearm-{s}"] = hinge_only(q, X, -150, 5)
        wq, _ = fk(local, POS["hips"])
        q = q_from_unit_vectors(R_HAND[s], qrot(qinv(wq[f"forearm-{s}"]), qnorm_vec(hand - wr)))
        local[f"hand-{s}"] = clamp_rot(scale_rot(q, 0.6), 35)
    return local


def qnorm_vec(v):
    return v / (np.linalg.norm(v) + 1e-12)


HEAD_PITCH_OFFSET = 0.0
# BlazePose reads his baggy-jeans stance as ~20-25 deg of knee bend where the video shows near-straight
# legs at 2.8-3.1 s; remove that bias but keep (slightly amplify) the bounces.
KNEE_BIAS = 14.0
KNEE_BIAS_CROPPED = 5.0
KNEE_GAIN = 1.2
# Elbow landmarks sit on the outside of the baggy sleeves, so captured arms hang ~6 deg too wide.
ARM_ADDUCT = 6.0
# The phone camera sits off to his right, so the capture reads ~20 deg more hip yaw than the
# front-on look of the hero frame; target this median yaw over 2.2-3.3 s.
HIPS_YAW_TARGET = 12.0


# Image-space ankle gap / shin length runs ~1.3x (full body) to ~1.45x (cropped, after undoing the
# steeper camera pitch) wider than the world landmarks, so spread knees/feet away from the hips.
LEG_SPREAD = (1.45, 1.3)
LEG_POINTS = ["KNEE", "ANKLE", "HEEL", "FOOT_INDEX"]


def widen_stance(L, fps):
    out = L.copy()
    for f in range(L.shape[0]):
        k = smoothstep(1.9, 2.3, f / fps)
        s = LEG_SPREAD[0] + (LEG_SPREAD[1] - LEG_SPREAD[0]) * k
        hip_mid = mid(L[f], "LEFT_HIP", "RIGHT_HIP")
        d = lm(L[f], "LEFT_HIP") - lm(L[f], "RIGHT_HIP")
        side = qnorm_vec(np.array([d[0], 0.0, d[2]]))
        for name in LEG_POINTS:
            for S in ("LEFT", "RIGHT"):
                i = LM_NAMES.index(f"{S}_{name}")
                lat = np.dot(L[f, i] - hip_mid, side)
                out[f, i] = L[f, i] + side * lat * (s - 1)
    return out


def median_filter(L, radius=2):
    """Per-coordinate temporal median: removes single-frame tracking flips before smoothing."""
    n = L.shape[0]
    out = np.empty_like(L)
    for i in range(n):
        out[i] = np.median(L[max(0, i - radius):min(n, i + radius + 1)], axis=0)
    return out


def face_front(L, fps):
    yaws = []
    for f in range(int(2.2 * fps), int(3.3 * fps)):
        d = lm(L[f], "LEFT_HIP") - lm(L[f], "RIGHT_HIP")
        yaws.append(math.degrees(math.atan2(-d[2], d[0])))
    off = math.radians(HIPS_YAW_TARGET - float(np.median(yaws)))
    q = q_axis_angle(Y, off)
    return np.array([[qrot(q, p) for p in F] for F in L]), math.degrees(off)


def calibrate_head(L, fps):
    """Nose sits below the ear line, so a level gaze reads as pitched down; measure it on 2.2-3.2 s."""
    global HEAD_PITCH_OFFSET
    vals = []
    for f in range(int(2.2 * fps), int(3.2 * fps)):
        F = L[f]
        ear_mid = mid(F, "LEFT_EAR", "RIGHT_EAR")
        fwd = qnorm_vec(lm(F, "NOSE") - ear_mid)
        torso_up = qnorm_vec(mid(F, "LEFT_SHOULDER", "RIGHT_SHOULDER") - mid(F, "LEFT_HIP", "RIGHT_HIP"))
        vals.append(math.degrees(math.asin(np.clip(-np.dot(fwd, torso_up), -1, 1))))
    HEAD_PITCH_OFFSET = float(np.median(vals)) - 4.0


# ---------------------------------------------------------------- hand-keyed upper body (0-2.2 s)

# Bind-relative Euler degrees (XYZ), same convention as src/anim/probes.ts.
# -X raises an arm forward, +Z abducts the left arm (right uses -Z), -Y on the left upper arm
# rotates it inward (forearm across the belly), +Y on spine/chest turns toward his left.
PHONE_L = {"upperarm-l": (-10, -40, -4), "forearm-l": (-58, 0, 0), "hand-l": (-6, 0, 10)}
HANG_R = {"upperarm-r": (-6, 6, 4), "forearm-r": (-16, 0, 0), "hand-r": (-6, 0, 0)}
KEYS: list[tuple[float, dict]] = [
    (0.00, {**PHONE_L, **HANG_R, "spine": (3, -2, 0), "chest": (3, -2, 0), "neck": (8, 0, 0), "head": (6, 0, 0)}),
    (0.30, {**PHONE_L, **HANG_R, "spine": (3, 4, -2), "chest": (3, 4, -1), "neck": (8, 0, 0), "head": (6, 0, 0)}),
    (0.60, {**PHONE_L, **HANG_R, "spine": (4, -4, 2), "chest": (4, -5, 1), "neck": (9, 0, 0), "head": (7, 0, 0),
            "upperarm-r": (-10, 6, 8)}),
    (0.90, {**PHONE_L, "upperarm-r": (-4, 6, 6), "forearm-r": (-20, 0, 0), "hand-r": (-6, 0, 0),
            "spine": (4, 3, -2), "chest": (4, 4, -1), "neck": (8, 0, 0), "head": (6, 0, 0)}),
    (1.10, {"upperarm-l": (-22, -20, 10), "forearm-l": (-60, 0, 0), "hand-l": (-6, 0, 0),
            "upperarm-r": (12, 0, -16), "forearm-r": (-24, 0, 0), "spine": (6, 12, 0), "chest": (5, 12, 0), "neck": (6, -6, 0), "head": (4, -6, 0)}),
    (1.30, {"upperarm-l": (16, 0, 22), "forearm-l": (-30, 0, 0), "upperarm-r": (-34, 10, -10), "forearm-r": (-46, 0, 0),
            "spine": (6, 18, 2), "chest": (5, 16, 2), "neck": (4, -10, 0), "head": (2, -8, 0)}),
    (1.50, {"upperarm-l": (-10, 0, 62), "forearm-l": (-26, 0, 0), "hand-l": (0, 0, 10), "upperarm-r": (-20, 10, -14), "forearm-r": (-60, 0, 0),
            "spine": (5, -10, 4), "chest": (4, -12, 4), "neck": (4, 8, 0), "head": (2, 6, 0)}),
    (1.62, {"upperarm-l": (-6, 0, 48), "forearm-l": (-30, 0, 0), "upperarm-r": (-6, 0, -28), "forearm-r": (-30, 0, 0),
            "spine": (5, -4, 0), "chest": (4, -4, 0), "neck": (4, 4, 0), "head": (2, 4, 0)}),
    (1.74, {"upperarm-l": (-14, -10, 12), "forearm-l": (-50, 0, 0), "upperarm-r": (-14, 0, -58), "forearm-r": (-24, 0, 0), "hand-r": (0, 0, -10),
            "spine": (5, 12, -4), "chest": (4, 14, -4), "neck": (4, -8, 0), "head": (2, -6, 0)}),
    (1.90, {"upperarm-l": (-24, -10, 18), "forearm-l": (-56, 0, 0), "upperarm-r": (-10, 0, -26), "forearm-r": (-40, 0, 0),
            "spine": (8, 6, 0), "chest": (6, 6, 0), "neck": (4, -2, 0), "head": (2, -2, 0)}),
    (2.05, {"upperarm-l": (-40, -6, 16), "forearm-l": (-50, 0, 0), "upperarm-r": (8, 0, -14), "forearm-r": (-36, 0, 0),
            "spine": (10, 10, 0), "chest": (8, 8, 0), "neck": (2, -4, 0), "head": (0, -2, 0)}),
]
KEY_BONES = ["spine", "chest", "neck", "head", "upperarm-l", "forearm-l", "hand-l", "upperarm-r", "forearm-r", "hand-r"]
MANUAL_FADE = (1.85, 2.2)

# Additive fixes on top of the capture: (start, peak, end, bone, Euler degrees at the peak).
# BlazePose loses depth on the fling at 2.45-2.75 s, where the video shows the right arm level.
BUMPS = [
    (2.40, 2.60, 2.80, "upperarm-r", (8, 0, -32)),
    (2.40, 2.60, 2.80, "forearm-r", (12, 0, 0)),
]


def bump_weight(t, a, p, b):
    if t <= a or t >= b:
        return 0.0
    return smoothstep(a, p, t) if t < p else 1.0 - smoothstep(p, b, t)


def key_pose(t):
    """Catmull-Rom-free keyed pose: smoothstep between neighbouring keys, missing bones hold bind."""
    times = [k[0] for k in KEYS]
    if t <= times[0]:
        a = b = KEYS[0][1]
        u = 0.0
    elif t >= times[-1]:
        a = b = KEYS[-1][1]
        u = 0.0
    else:
        i = max(j for j, kt in enumerate(times) if kt <= t)
        a, b = KEYS[i][1], KEYS[i + 1][1]
        u = (t - times[i]) / (times[i + 1] - times[i])
        u = u * u * (3 - 2 * u)
    out = {}
    for n in KEY_BONES:
        qa = q_euler_deg(*a.get(n, (0, 0, 0)))
        qb = q_euler_deg(*b.get(n, (0, 0, 0)))
        out[n] = slerp(qa, qb, u)
    return out


# ---------------------------------------------------------------- main


def main() -> None:
    debug = "--debug" in sys.argv
    L, vis, fps = load_landmarks()
    n_src = L.shape[0]
    t_src = np.arange(n_src) / fps
    sigma = np.where(t_src < 2.1, 1.6, 1.0)
    L = gaussian_smooth(median_filter(L), sigma)
    L = gravity_align(L, fps)
    L, yaw_off = face_front(L, fps)
    L = widen_stance(L, fps)
    calibrate_head(L, fps)

    n_out = int(math.ceil(DURATION * OUT_FPS)) + 1
    poses = []
    for k in range(n_out):
        t = k / OUT_FPS
        fsrc = min(t * fps, n_src - 1.001)
        f0 = int(fsrc)
        a = fsrc - f0
        F = L[f0] * (1 - a) + L[f0 + 1] * a
        local = solve_frame(F, t)
        wm = 1.0 - smoothstep(*MANUAL_FADE, t)
        if wm > 0:
            kp = key_pose(t)
            for nme in KEY_BONES:
                local[nme] = slerp(local[nme], kp[nme], wm)
        for a, p, b, nme, deg in BUMPS:
            w = bump_weight(t, a, p, b)
            if w > 0:
                local[nme] = qmul(scale_rot(q_euler_deg(*deg), w), local[nme])
        poses.append(local)

    # Quaternion hemisphere continuity + light smoothing.
    for nme in NAMES:
        for k in range(1, n_out):
            if np.dot(poses[k][nme], poses[k - 1][nme]) < 0:
                poses[k][nme] = -poses[k][nme]
        arr = np.array([p[nme] for p in poses])
        arr = gaussian_smooth(arr, 0.9)
        for k in range(n_out):
            poses[k][nme] = qnorm(arr[k])

    # Feet: flatten onto the floor when low (two passes: contact needs the root height first).
    def sole_min(wq, wp, s):
        return min((wp[f"foot-{s}"] + qrot(wq[f"foot-{s}"], p))[1] for p in SOLE[s])

    root = np.zeros((n_out, 3))
    for k in range(n_out):
        wq, wp = fk(poses[k], POS["hips"])
        lows = {s: sole_min(wq, wp, s) for s in "lr"}
        floor = min(lows.values())
        for s in "lr":
            contact = smoothstep(0.07, 0.015, lows[s] - floor)
            if contact <= 0:
                continue
            fw = wq[f"foot-{s}"]
            fwd = qrot(fw, np.array([0, 0, 1.0]))
            yaw = math.atan2(fwd[0], fwd[2])
            flat = q_axis_angle(Y, yaw)
            target = qmul(qinv(wq[f"shin-{s}"]), flat)
            poses[k][f"foot-{s}"] = clamp_rot(slerp(poses[k][f"foot-{s}"], target, contact), 50)
        wq, wp = fk(poses[k], POS["hips"])
        root[k, 1] = SOLE_REST_MIN - min(sole_min(wq, wp, s) for s in "lr")

    # Horizontal root: keep the lower (support) foot still, leak back to centre.
    prev = None
    acc = np.zeros(2)
    for k in range(n_out):
        wq, wp = fk(poses[k], POS["hips"])
        feet = {s: np.array([wp[f"foot-{s}"][0], wp[f"foot-{s}"][2]]) for s in "lr"}
        lows = {s: sole_min(wq, wp, s) for s in "lr"}
        if prev is not None:
            wl = 1.0 / (1.0 + math.exp((lows["l"] - lows["r"]) / 0.01))
            d = wl * (feet["l"] - prev["l"]) + (1 - wl) * (feet["r"] - prev["r"])
            acc = acc * 0.95 - d
        acc = np.clip(acc, -0.12, 0.12)
        root[k, 0], root[k, 2] = acc
        prev = feet
    root[:, 0] = gaussian_smooth(root[:, 0], 1.5)
    root[:, 2] = gaussian_smooth(root[:, 2], 1.5)
    root[:, 1] = gaussian_smooth(root[:, 1], 1.0)

    bones_out = [n for n in NAMES if n not in ("jaw", "hem-f", "hem-b", "hem-l", "hem-r")]
    out = {
        "fps": OUT_FPS,
        "duration": DURATION,
        "frameCount": n_out,
        "bones": bones_out,
        "hips": [round(float(v), 4) for k in range(n_out) for v in (POS["hips"] + root[k])],
        "rotations": {nme: [round(float(v), 4) for k in range(n_out) for v in poses[k][nme]] for nme in bones_out},
        "source": "MediaPipe Pose (forward + reversed passes) retargeted by tools/retarget_dance.py; "
                  "upper body 0-2.2 s hand-keyed (camera framed the waist down).",
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT.relative_to(ROOT)}: {n_out} frames, head pitch offset {HEAD_PITCH_OFFSET:.1f} deg, yaw offset {yaw_off:.1f} deg")

    if debug:
        for k in range(0, n_out, 3):
            p = poses[k]
            e = lambda b: " ".join(f"{v:+4.0f}" for v in q_to_euler_deg(p[b]))
            print(f"t={k / OUT_FPS:4.2f} root={root[k, 0]:+.3f},{root[k, 1]:+.3f},{root[k, 2]:+.3f} hips[{e('hips')}] "
                  f"thL[{e('thigh-l')}] shL[{e('shin-l')}] thR[{e('thigh-r')}] shR[{e('shin-r')}] "
                  f"uaR[{e('upperarm-r')}] faR[{e('forearm-r')}] chest[{e('chest')}] head[{e('head')}]")


if __name__ == "__main__":
    main()
