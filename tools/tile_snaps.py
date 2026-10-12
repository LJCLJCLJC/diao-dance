"""Tile every data-URL image found in a CDP output file into one contact sheet.

Usage: python tools/tile_snaps.py <cdp-output.json> <out.jpg> [columns] [label ...]
"""
import base64
import re
import sys
from pathlib import Path

import cv2
import numpy as np


def main() -> None:
    src = Path(sys.argv[1]).read_text(encoding="utf-8", errors="ignore")
    out = Path(sys.argv[2])
    cols = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    labels = sys.argv[4:]
    urls = re.findall(r"data:image/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)", src)
    if not urls:
        raise SystemExit("no images in input")
    ims = [cv2.imdecode(np.frombuffer(base64.b64decode(u), np.uint8), cv2.IMREAD_COLOR) for u in urls]
    h = min(im.shape[0] for im in ims)
    ims = [cv2.resize(im, (round(im.shape[1] * h / im.shape[0]), h), interpolation=cv2.INTER_AREA) for im in ims]
    w = max(im.shape[1] for im in ims)
    ims = [np.pad(im, ((0, 0), (0, w - im.shape[1]), (0, 0))) for im in ims]
    for im, label in zip(ims, labels):
        cv2.putText(im, label, (10, 34), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2)
    while len(ims) % cols:
        ims.append(np.zeros_like(ims[0]))
    sheet = np.vstack([np.hstack(ims[i:i + cols]) for i in range(0, len(ims), cols)])
    scale = min(1.0, 2400 / sheet.shape[1])
    sheet = cv2.resize(sheet, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), sheet, [cv2.IMWRITE_JPEG_QUALITY, 88])
    print("wrote", out)


if __name__ == "__main__":
    main()
