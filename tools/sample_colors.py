"""Average sRGB colour of named regions in a reference frame (ffmpeg does the decoding).

Usage: python tools/sample_colors.py reference/hero_t3.0.png
Regions are (x, y, w, h) in the auto-rotated 320x568 frame.
"""
import json
import subprocess
import sys

REGIONS = {
    "shirt_front": (150, 150, 36, 60),
    "shirt_sleeve": (128, 175, 14, 40),
    "shirt_shadow_side": (238, 170, 14, 40),
    "jeans_thigh": (140, 300, 26, 50),
    "jeans_shin": (122, 360, 20, 40),
    "shoe": (110, 432, 18, 22),
    "skin_cheek": (212, 66, 12, 12),
    "skin_neck": (205, 100, 12, 8),
    "skin_hand": (126, 268, 10, 12),
    "hair": (198, 22, 28, 8),
    "asphalt": (60, 500, 60, 40),
    "hedge": (30, 100, 60, 100),
    "curb": (40, 318, 40, 8),
}


def average_rgb(path: str, x: int, y: int, w: int, h: int) -> tuple[int, int, int]:
    out = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-i", path,
            "-vf", f"crop={w}:{h}:{x}:{y},scale=1:1:flags=area",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ],
        check=True,
        capture_output=True,
    ).stdout
    return out[0], out[1], out[2]


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else "reference/hero_t3.0.png"
    result = {}
    for name, (x, y, w, h) in REGIONS.items():
        r, g, b = average_rgb(path, x, y, w, h)
        result[name] = {"rgb": [r, g, b], "hex": f"#{r:02x}{g:02x}{b:02x}", "region": [x, y, w, h]}
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
