"""Decode data-URL captures returned by __DIAO__.snap() (via CDP) into image files.

Usage: python tools/save_snap.py <cdp-output.txt|json> <out.png|jpg> [more_outputs...]
The input may contain one data URL or a JSON array of them (one output path per image).
"""
import base64
import re
import sys
from pathlib import Path

src = Path(sys.argv[1]).read_text(encoding="utf-8", errors="ignore")
urls = re.findall(r"data:image/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)", src)
outs = sys.argv[2:]
if not urls:
    raise SystemExit("no data URL found")
for data, out in zip(urls, outs):
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_bytes(base64.b64decode(data))
    print("wrote", out)
