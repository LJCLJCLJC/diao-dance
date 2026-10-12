"""Run MediaPipe Pose over every frame, forward and reversed, and keep both passes.

The first ~2 s only show the dancer from the waist down, so BlazePose's face-anchored detector
usually cannot lock on. Tracking the clip backwards starts from the full-body frames near 3 s and
lets the tracker follow the body into the cropped section.

Outputs
  reference/pose/raw.json              landmarks per pass/frame (image + world, with visibility)
  reference/pose/overlay/*.png         per-frame skeleton overlays (gitignored)
  reference/pose/overlay_sheet_*.png   contact sheets for review
  reference/hero_t3.0_isolated.png     hero frame with background replaced by flat grey
"""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
FRAMES = ROOT / "reference" / "frames"
OUT = ROOT / "reference" / "pose"
HERO_FRAME = 90

mp_pose = mp.solutions.pose
LM = mp_pose.PoseLandmark


def load_frames() -> list[np.ndarray]:
    paths = sorted(FRAMES.glob("f_*.png"))
    if len(paths) != 120:
        raise SystemExit(f"expected 120 frames in {FRAMES}, found {len(paths)}")
    return [cv2.imread(str(p)) for p in paths]


def run_pass(frames: list[np.ndarray], order: list[int], keep_masks: set[int]) -> tuple[dict, dict]:
    results: dict[int, dict | None] = {}
    masks: dict[int, np.ndarray] = {}
    with mp_pose.Pose(
        static_image_mode=False,
        model_complexity=2,
        smooth_landmarks=True,
        enable_segmentation=True,
        min_detection_confidence=0.3,
        min_tracking_confidence=0.3,
    ) as pose:
        for i in order:
            rgb = cv2.cvtColor(frames[i], cv2.COLOR_BGR2RGB)
            r = pose.process(rgb)
            if r.pose_landmarks is None:
                results[i] = None
                continue
            img = [[l.x, l.y, l.z, l.visibility] for l in r.pose_landmarks.landmark]
            world = [[l.x, l.y, l.z, l.visibility] for l in r.pose_world_landmarks.landmark]
            results[i] = {"image": img, "world": world}
            if i in keep_masks and r.segmentation_mask is not None:
                masks[i] = r.segmentation_mask.copy()
    return results, masks


def draw_overlay(frame: np.ndarray, entry: dict | None, label: str) -> np.ndarray:
    img = frame.copy()
    h, w = img.shape[:2]
    if entry is not None:
        pts = entry["image"]
        for a, b in mp_pose.POSE_CONNECTIONS:
            pa, pb = pts[a], pts[b]
            vis = min(pa[3], pb[3])
            color = (0, 255, 0) if vis > 0.6 else (0, 200, 255) if vis > 0.3 else (0, 0, 255)
            cv2.line(img, (int(pa[0] * w), int(pa[1] * h)), (int(pb[0] * w), int(pb[1] * h)), color, 2)
        for p in pts:
            cv2.circle(img, (int(p[0] * w), int(p[1] * h)), 3, (255, 255, 255), -1)
    cv2.putText(img, label, (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    return img


def contact_sheet(images: list[np.ndarray], cols: int, scale: float) -> np.ndarray:
    small = [cv2.resize(im, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) for im in images]
    h, w = small[0].shape[:2]
    rows = (len(small) + cols - 1) // cols
    sheet = np.zeros((rows * h, cols * w, 3), np.uint8)
    for k, im in enumerate(small):
        r, c = divmod(k, cols)
        sheet[r * h:(r + 1) * h, c * w:(c + 1) * w] = im
    return sheet


def main() -> None:
    frames = load_frames()
    n = len(frames)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "overlay").mkdir(exist_ok=True)

    fwd, masks = run_pass(frames, list(range(n)), {HERO_FRAME})
    rev, _ = run_pass(frames, list(range(n - 1, -1, -1)), set())

    raw = {
        "fps": 30000 / 1001,
        "frameCount": n,
        "frameSize": [frames[0].shape[1], frames[0].shape[0]],
        "landmarkNames": [l.name for l in LM],
        "forward": [fwd[i] for i in range(n)],
        "reverse": [rev[i] for i in range(n)],
    }
    (OUT / "raw.json").write_text(json.dumps(raw))

    def coverage(passes: dict) -> str:
        found = [i for i in range(n) if passes[i] is not None]
        return f"{len(found)}/{n} frames" + (f" (first {found[0]}, last {found[-1]})" if found else "")

    print("forward:", coverage(fwd))
    print("reverse:", coverage(rev))

    overlays = []
    for i in range(n):
        a = draw_overlay(frames[i], fwd[i], f"F{i}")
        b = draw_overlay(frames[i], rev[i], f"R{i}")
        pair = np.hstack([a, b])
        cv2.imwrite(str(OUT / "overlay" / f"o_{i:03d}.png"), pair)
        overlays.append(pair)
    picks = list(range(0, n, 4))
    half = len(picks) // 2
    cv2.imwrite(str(OUT / "overlay_sheet_a.png"), contact_sheet([overlays[i] for i in picks[:half]], 5, 0.4))
    cv2.imwrite(str(OUT / "overlay_sheet_b.png"), contact_sheet([overlays[i] for i in picks[half:]], 5, 0.4))

    if HERO_FRAME in masks:
        m = cv2.GaussianBlur(masks[HERO_FRAME], (5, 5), 0)[..., None]
        grey = np.full_like(frames[HERO_FRAME], 128)
        iso = (frames[HERO_FRAME] * m + grey * (1 - m)).astype(np.uint8)
        cv2.imwrite(str(ROOT / "reference" / "hero_t3.0_isolated.png"), iso)
        cv2.imwrite(str(ROOT / "reference" / "hero_t3.0_mask.png"), (masks[HERO_FRAME] * 255).astype(np.uint8))
        print("wrote isolated hero reference")


if __name__ == "__main__":
    main()
