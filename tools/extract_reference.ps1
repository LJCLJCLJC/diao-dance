# Rebuilds reference/ from the original clip. Frames are written auto-rotated (portrait 320x568);
# ffmpeg numbers them from 1, so video frame n is reference/frames/f_{n+1:03}.png.
param(
  [string]$Source = "D:\Users\ljc_8\Documents\Tencent Files\872904129\FileRecv\IMG_0562.mp4"
)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

New-Item -ItemType Directory -Force -Path reference\frames, reference\sheets, reference\faces | Out-Null
if (Test-Path -LiteralPath $Source) { Copy-Item -LiteralPath $Source reference\IMG_0562.mp4 -Force }
$v = 'reference\IMG_0562.mp4'

ffmpeg -hide_banner -loglevel error -y -i $v -fps_mode passthrough 'reference\frames\f_%03d.png'
ffmpeg -hide_banner -loglevel error -y -i $v -vf "select='not(mod(n\,3))',scale=128:227,tile=10x4" -frames:v 1 -fps_mode passthrough reference\sheets\sheet_every3.png
ffmpeg -hide_banner -loglevel error -y -i $v -vf "select='between(n\,72\,103)',crop=160:160:140:0,scale=320:320:flags=lanczos,tile=8x4" -frames:v 1 -fps_mode passthrough reference\sheets\faces_72_103.png

# Full-body hero reference (t = 3.0 s) and the two face source frames (closed smile / open shout).
Copy-Item reference\frames\f_091.png reference\hero_t3.0.png -Force
Copy-Item reference\frames\f_081.png reference\faces\face_closed_src.png -Force
Copy-Item reference\frames\f_085.png reference\faces\face_open_src.png -Force
Write-Host "reference/ rebuilt"
