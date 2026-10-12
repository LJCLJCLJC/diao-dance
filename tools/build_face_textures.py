"""Build the projected face textures (closed smile / open shout) and the shared face layout.

The head mesh's UVs are an orthographic front projection of its bind-pose vertices into
RECT (metres), so a texel at (u, v) lands on the head point (x, y) = RECT(u, v). Each source frame
is warped with a similarity transform that puts both eye centres on fixed canonical positions,
which keeps the two expression textures pixel-registered.

Outputs public/tex/face_closed.webp, public/tex/face_open.webp (RGBA, alpha = feathered face oval),
public/tex/face_layout.json and reference/faces/face_debug.png.
"""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
FRAMES = ROOT / "reference" / "frames"
OUT_TEX = ROOT / "public" / "tex"
OUT_DBG = ROOT / "reference" / "faces"

SOURCES = {"closed": 80, "open": 84}
RECT = {"x0": -0.085, "x1": 0.085, "y0": 1.455, "y1": 1.7}
TEX_W, TEX_H = 512, 738
EYE_X, EYE_Y = 0.032, 1.585
WB_GAINS = np.array([1.00, 1.40, 1.66])  # white sneakers -> neutral (R, G, B)
UPSCALE = 4

RIGHT_EYE = [33, 133, 159, 145, 160, 144, 158, 153]   # subject's right eye (image left)
LEFT_EYE = [362, 263, 386, 374, 385, 380, 387, 373]
FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
             152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]


def world_to_px(x: float, y: float) -> tuple[float, float]:
    u = (x - RECT["x0"]) / (RECT["x1"] - RECT["x0"])
    v = (y - RECT["y0"]) / (RECT["y1"] - RECT["y0"])
    return u * TEX_W, (1 - v) * TEX_H


def px_to_world_y(py: float) -> float:
    return RECT["y0"] + (1 - py / TEX_H) * (RECT["y1"] - RECT["y0"])


def nose_px(frame_index: int) -> tuple[float, float]:
    raw = json.loads((ROOT / "reference" / "pose" / "raw.json").read_text())
    w, h = raw["frameSize"]
    for key in ("forward", "reverse"):
        entry = raw[key][frame_index]
        if entry:
            x, y = entry["image"][0][:2]
            return x * w, y * h
    raise SystemExit(f"no pose for frame {frame_index}")


def detect(frame: np.ndarray, center: tuple[float, float]) -> np.ndarray:
    cx, cy = center
    half = 70
    x0, y0 = int(max(0, cx - half)), int(max(0, cy - half - 10))
    crop = frame[y0:y0 + 2 * half, x0:x0 + 2 * half]
    big = cv2.resize(crop, None, fx=UPSCALE, fy=UPSCALE, interpolation=cv2.INTER_CUBIC)
    with mp.solutions.face_mesh.FaceMesh(static_image_mode=True, refine_landmarks=True, max_num_faces=1,
                                         min_detection_confidence=0.2) as fm:
        res = fm.process(cv2.cvtColor(big, cv2.COLOR_BGR2RGB))
    if not res.multi_face_landmarks:
        raise SystemExit("FaceMesh found no face")
    bh, bw = big.shape[:2]
    pts = np.array([[l.x * bw / UPSCALE + x0, l.y * bh / UPSCALE + y0] for l in res.multi_face_landmarks[0].landmark])
    return pts


def similarity(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """2x3 similarity transform mapping two source points onto two destination points."""
    s0, s1 = src
    d0, d1 = dst
    vs = s1 - s0
    vd = d1 - d0
    scale = np.linalg.norm(vd) / np.linalg.norm(vs)
    ang = np.arctan2(vd[1], vd[0]) - np.arctan2(vs[1], vs[0])
    c, s = np.cos(ang) * scale, np.sin(ang) * scale
    rot = np.array([[c, -s], [s, c]])
    t = d0 - rot @ s0
    return np.hstack([rot, t[:, None]])


TARGET_SKIN = np.array([206, 156, 136]) / 255.0  # sRGB albedo the face median is matched to


def delight(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """White balance, flatten broad baked shading, then match the face median to a skin albedo.

    The per-channel median match keeps relative variation (flush on cheeks/nose) but removes the
    sodium-light cast and the phone's exposure; a soft knee stops highlights from clipping.
    """
    W = np.array([0.2126, 0.7152, 0.0722])
    src = rgb.astype(np.float32) / 255.0
    lin = src ** 2.2 * WB_GAINS[None, None, :]
    m = mask > 0.5
    L = np.maximum(lin @ W, 1e-4)
    chroma = lin / L[..., None]
    Lb = cv2.GaussianBlur(L, (0, 0), 30)
    Lflat = L / np.power(Lb, 0.92) * np.power(float(np.median(Lb[m])), 0.92)
    med_L = float(np.median(Lflat[m]))
    Lflat = med_L * np.power(Lflat / med_L, 0.85)

    target_lin = TARGET_SKIN ** 2.2
    tgt_chroma = target_lin / float(target_lin @ W)
    med_chroma = np.median(chroma[m], axis=0)
    # The phone saturated the flushed cheeks while the lit temple stayed neutral; compressing
    # the per-pixel chroma deviation (log space) keeps lips/flush readable without turning the
    # neutral side cyan once the red median is mapped onto the skin albedo.
    rel = np.log(np.maximum(chroma, 1e-4) / np.maximum(med_chroma, 1e-4))
    chroma = tgt_chroma[None, None, :] * np.exp(0.45 * rel)
    Lflat *= float(target_lin @ W) / float(np.median(Lflat[m]))
    lin = chroma * Lflat[..., None]
    knee = 0.7
    over = np.maximum(lin - knee, 0)
    lin = np.minimum(lin, knee) + over / (1 + over / (1 - knee))
    out = np.clip(lin, 0, 1) ** (1 / 2.2)
    return (out * 255).astype(np.uint8)


def symmetrize_shading(rgb: np.ndarray, strength: float = 0.85) -> np.ndarray:
    """Even out one-sided lighting: replace the mid-frequency luminance with its mirror average.

    Fine detail (eyes, nostrils, lips) is untouched, so features do not ghost even though the face
    is slightly yawed.
    """
    lin = (rgb.astype(np.float32) / 255.0) ** 2.2
    Y = np.maximum(lin @ np.array([0.2126, 0.7152, 0.0722]), 1e-4)
    Yb = cv2.GaussianBlur(Y, (0, 0), 12)
    Ys = 0.5 * (Yb + Yb[:, ::-1])
    ratio = np.power(Ys / np.maximum(Yb, 1e-4), strength)[..., None]
    out = np.clip(lin * ratio, 0, 1) ** (1 / 2.2)
    return (out * 255).astype(np.uint8)


BROW_R = ([70, 63, 105, 66, 107], [46, 53, 52, 65, 55])
BROW_L = ([300, 293, 334, 296, 336], [276, 283, 282, 295, 285])
LID_R = ([33, 246, 161, 160, 159, 158, 157, 173, 133], [33, 7, 163, 144, 145, 153, 154, 155, 133])
LID_L = ([263, 466, 388, 387, 386, 385, 384, 398, 362], [263, 249, 390, 373, 374, 380, 381, 382, 362])
LIP_SEAM = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308]


def paint(rgb: np.ndarray, layer: np.ndarray, color: tuple[int, int, int], alpha: float, blur: float) -> np.ndarray:
    a = cv2.GaussianBlur(layer.astype(np.float32), (0, 0), blur)[..., None] * alpha
    return (rgb * (1 - a) + np.array(color)[None, None, :] * a).astype(np.uint8)


def enhance_features(rgb: np.ndarray, upper: np.ndarray, lower: np.ndarray, mouth_open: bool) -> np.ndarray:
    """Soft brows, lid lines and lip seam along FaceMesh contours.

    The source face is ~45 px wide, so after warping the squinting eyes and brows dissolve into
    the skin; a light painted pass keeps them readable at the hero distance.
    """
    out = rgb
    for top, bottom in (BROW_R, BROW_L):
        layer = np.zeros(rgb.shape[:2], np.float32)
        poly = np.vstack([upper[top], upper[bottom][::-1]]).astype(np.int32)
        cv2.fillPoly(layer, [poly], 1.0)
        out = paint(out, layer, (38, 26, 22), 0.55, 3)
    for top, bottom in (LID_R, LID_L):
        opening = np.zeros(rgb.shape[:2], np.float32)
        cv2.fillPoly(opening, [np.vstack([upper[top], upper[bottom][::-1]]).astype(np.int32)], 1.0)
        out = paint(out, opening, (52, 36, 32), 0.55, 2)
        lid = np.zeros(rgb.shape[:2], np.float32)
        cv2.polylines(lid, [upper[top].astype(np.int32)], False, 1.0, 4)
        out = paint(out, lid, (30, 20, 18), 0.6, 1.5)
    if not mouth_open:
        seam = np.zeros(rgb.shape[:2], np.float32)
        cv2.polylines(seam, [lower[LIP_SEAM].astype(np.int32)], False, 1.0, 3)
        out = paint(out, seam, (120, 52, 48), 0.45, 1.5)
    return out


def remove_speculars(rgb: np.ndarray) -> np.ndarray:
    Y = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    local = cv2.GaussianBlur(Y, (0, 0), 7)
    spots = ((Y > local * 1.18) & (Y > 170)).astype(np.uint8)
    spots = cv2.dilate(spots, np.ones((5, 5), np.uint8))
    return cv2.inpaint(rgb, spots, 6, cv2.INPAINT_TELEA)


def clean_outliers(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Inpaint pixels inside the face that are not skin-like after correction (leaf leaks, glare)."""
    f = rgb.astype(np.float32)
    r, g = f[..., 0], f[..., 1]
    lum = f @ np.array([0.299, 0.587, 0.114])
    local = cv2.GaussianBlur(lum, (0, 0), 6)
    glare = (lum > local + 22) & (lum > 190)
    leaf = g > r * 0.86
    bad = ((leaf | glare) & (mask > 0.3)).astype(np.uint8)
    bad = cv2.dilate(bad, np.ones((5, 5), np.uint8))
    out = cv2.inpaint(rgb, bad, 5, cv2.INPAINT_TELEA)
    soft = cv2.GaussianBlur(bad.astype(np.float32), (0, 0), 3)[..., None]
    return (rgb * (1 - soft) + out * soft).astype(np.uint8)


def unsharp(img: np.ndarray, amount: float = 1.0, sigma: float = 2.5) -> np.ndarray:
    blur = cv2.GaussianBlur(img, (0, 0), sigma)
    return cv2.addWeighted(img, 1 + amount, blur, -amount, 0)


def warp_frame(frame_index: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Returns (warped BGR, landmarks in texture px, source-validity mask)."""
    frame = cv2.imread(str(FRAMES / f"f_{frame_index + 1:03d}.png"))
    pts = detect(frame, nose_px(frame_index))
    eye_r = pts[RIGHT_EYE].mean(axis=0)
    eye_l = pts[LEFT_EYE].mean(axis=0)
    dst_r = np.array(world_to_px(-EYE_X, EYE_Y))
    dst_l = np.array(world_to_px(EYE_X, EYE_Y))
    M = similarity(np.array([eye_r, eye_l]), np.array([dst_r, dst_l]))
    warped = cv2.warpAffine(frame, M, (TEX_W, TEX_H), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)
    valid = cv2.warpAffine(np.full(frame.shape[:2], 255, np.uint8), M, (TEX_W, TEX_H), flags=cv2.INTER_LINEAR,
                           borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    valid = cv2.GaussianBlur(cv2.erode(valid, np.ones((9, 9), np.uint8)).astype(np.float32) / 255.0, (0, 0), 6)
    tp = (M[:, :2] @ pts.T).T + M[:, 2]
    return warped, tp, valid


def build(name: str, frame_index: int, layout: dict | None, upper_from: int | None) -> tuple[dict, np.ndarray]:
    warped, tp, valid = warp_frame(frame_index)
    if upper_from is not None:
        # Frame 80 (closed smile) is cut off above the brows and its eyes are blurred, so the upper
        # face comes from the upper_from frame. Both are eye-registered, so only the region below
        # the nose differs between the two expression textures.
        up, tp_up, _ = warp_frame(upper_from)
        seam = (tp_up[4][1] + tp[13][1]) / 2 - 6
        rows = np.arange(TEX_H, dtype=np.float32)[:, None, None]
        w_low = np.clip((rows - (seam - 14)) / 28, 0, 1)
        w_low = w_low * w_low * (3 - 2 * w_low)
        warped = (up * (1 - w_low) + warped * w_low).astype(np.uint8)
        tp_upper = tp_up
        valid = np.ones_like(valid)
    else:
        tp_upper = tp

    mask = np.zeros((TEX_H, TEX_W), np.float32)
    for pts_set in (tp, tp_upper):
        oval = pts_set[FACE_OVAL]
        centroid = oval.mean(axis=0)
        oval = centroid + (oval - centroid) * np.array([0.84, 0.93])
        cv2.fillPoly(mask, [oval.astype(np.int32)], 1.0)
    rgb = cv2.cvtColor(warped, cv2.COLOR_BGR2RGB)
    r, g, b = [rgb[..., i].astype(np.float32) for i in range(3)]
    foliage = ((g > r * 0.85) & (g >= b)).astype(np.float32)
    foliage = cv2.GaussianBlur(cv2.dilate(foliage, np.ones((9, 9), np.uint8)), (0, 0), 5)
    mask = mask * (1 - foliage)
    mask = cv2.GaussianBlur(mask, (0, 0), 16)

    rgb = cv2.bilateralFilter(rgb, 5, 18, 5)
    rgb = remove_speculars(rgb)
    rgb = delight(rgb, mask)
    rgb = symmetrize_shading(rgb)
    rgb = unsharp(rgb)
    mouth = np.zeros(mask.shape, np.uint8)
    lips = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]
    cv2.fillPoly(mouth, [tp[lips].astype(np.int32)], 1)
    mouth = cv2.dilate(mouth, np.ones((9, 9), np.uint8))
    keep = rgb.copy()
    rgb = clean_outliers(rgb, mask)
    rgb[mouth > 0] = keep[mouth > 0]
    rgb = enhance_features(rgb, tp_upper, tp, mouth_open=name == "open")
    rgba = np.dstack([rgb, (mask * 255).astype(np.uint8)])
    OUT_TEX.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(OUT_TEX / f"face_{name}.webp"), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_WEBP_QUALITY, 92])

    if layout is None:
        skin = np.median(rgb[mask > 0.6], axis=0)
        brow = tp_upper[[105, 334, 66, 296]].mean(axis=0)
        layout = {
            "rect": RECT,
            "texSize": [TEX_W, TEX_H],
            "eyeX": EYE_X,
            "eyeY": EYE_Y,
            "browY": round(px_to_world_y(brow[1]), 4),
            "noseTipY": round(px_to_world_y(tp_upper[4][1]), 4),
            "mouthY": round(px_to_world_y(((tp[13] + tp[14]) / 2)[1]), 4),
            "mouthHalfWidth": round(abs(tp[291][0] - tp[61][0]) / 2 / TEX_W * (RECT["x1"] - RECT["x0"]), 4),
            "chinY": round(px_to_world_y(tp[152][1]), 4),
            "skinTone": "#{:02x}{:02x}{:02x}".format(*[int(c) for c in skin]),
            "sourceFrames": SOURCES,
        }

    dbg = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2BGR).copy()
    for idx in RIGHT_EYE + LEFT_EYE + FACE_OVAL + [4, 13, 14, 152, 61, 291]:
        cv2.circle(dbg, tuple(int(v) for v in tp[idx]), 2, (0, 255, 0), -1)
    for key in ("eyeY", "noseTipY", "mouthY", "chinY", "browY"):
        y = int(world_to_px(0, layout[key])[1])
        cv2.line(dbg, (0, y), (TEX_W, y), (0, 200, 255), 1)
        cv2.putText(dbg, key, (4, y - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 200, 255), 1)
    return layout, dbg


def main() -> None:
    layout, dbg_closed = build("closed", SOURCES["closed"], None, upper_from=SOURCES["open"])
    _, dbg_open = build("open", SOURCES["open"], layout, upper_from=None)
    (OUT_TEX / "face_layout.json").write_text(json.dumps(layout, indent=2))
    OUT_DBG.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(OUT_DBG / "face_debug.png"), np.hstack([dbg_closed, dbg_open]))
    print(json.dumps(layout, indent=2))


if __name__ == "__main__":
    main()
