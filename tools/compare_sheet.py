"""Pair 3D renders with the source video frames at the same dance times.

Usage: python tools/compare_sheet.py <cdp-output.json> <out.jpg> <t1> <t2> ...
The CDP output holds the data URLs returned by __DIAO__.snap() after __DIAO__.seek(t), in order.
Each column is [video frame | 3D render] at time t.
"""
import base64
import re
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
FPS = 30000 / 1001


def main() -> None:
    src = Path(sys.argv[1]).read_text(encoding="utf-8", errors="ignore")
    out = Path(sys.argv[2])
    times = [float(t) for t in sys.argv[3:]]
    urls = re.findall(r"data:image/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)", src)
    if len(urls) < len(times):
        raise SystemExit(f"{len(urls)} renders for {len(times)} times")
    frames = sorted((ROOT / "reference" / "frames").glob("f_*.png"))
    cols = []
    for t, data in zip(times, urls):
        render = cv2.imdecode(np.frombuffer(base64.b64decode(data), np.uint8), cv2.IMREAD_COLOR)
        video = cv2.imread(str(frames[min(len(frames) - 1, round(t * FPS))]))
        h = 568
        render = cv2.resize(render, (round(render.shape[1] * h / render.shape[0]), h), interpolation=cv2.INTER_AREA)
        video = cv2.resize(video, (round(video.shape[1] * h / video.shape[0]), h), interpolation=cv2.INTER_AREA)
        pair = np.hstack([video, render])
        cv2.putText(pair, f"{t:.2f}s", (8, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
        cols.append(pair)
    per_row = 3
    rows = []
    for i in range(0, len(cols), per_row):
        row = cols[i:i + per_row]
        while len(row) < per_row:
            row.append(np.zeros_like(cols[0]))
        rows.append(np.hstack([np.pad(c, ((4, 4), (4, 4), (0, 0))) for c in row]))
    sheet = np.vstack(rows)
    scale = min(1.0, 2400 / sheet.shape[1])
    sheet = cv2.resize(sheet, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), sheet, [cv2.IMWRITE_JPEG_QUALITY, 88])
    print("wrote", out)


if __name__ == "__main__":
    main()
