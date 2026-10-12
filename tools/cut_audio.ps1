# Cuts the "叼你妈的" line out of the clip. The four syllable peaks sit at ~2.72/2.92/3.15/3.35 s
# in the 250-3500 Hz speech band, so 2.66-3.44 s keeps a little air on both sides.
param(
  [double]$Start = 2.66,
  [double]$End = 3.44,
  [double]$PeakDb = -1.0
)
# Windows PowerShell 5.1 turns redirected native stderr into errors, so exit codes are checked instead.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$dur = [math]::Round($End - $Start, 3)
$fadeOut = [math]::Round($dur - 0.01, 3)
New-Item -ItemType Directory -Force -Path reference\audio, public\audio | Out-Null
$raw = 'reference\audio\diao_raw.wav'

ffmpeg -hide_banner -loglevel error -y -i reference\IMG_0562.mp4 -vn `
  -af "atrim=start=${Start}:end=${End},asetpts=PTS-STARTPTS,pan=mono|c0=0.5*c0+0.5*c1,afade=t=in:st=0:d=0.01,afade=t=out:st=${fadeOut}:d=0.01" `
  -ar 44100 -c:a pcm_s16le $raw
if ($LASTEXITCODE -ne 0) { throw "ffmpeg cut failed" }

$det = ffmpeg -hide_banner -nostats -i $raw -af volumedetect -f null - 2>&1 | ForEach-Object { "$_" } | Select-String 'max_volume: (-?[\d\.]+) dB'
$maxDb = [double]$det.Matches[0].Groups[1].Value
$gain = [math]::Round($PeakDb - $maxDb, 2)
Write-Host "segment $Start-$End s, peak $maxDb dB, gain $gain dB"

ffmpeg -hide_banner -loglevel error -y -i $raw -af "volume=${gain}dB" -c:a aac -b:a 128k -movflags +faststart public\audio\diao.m4a
Get-Item public\audio\diao.m4a | Select-Object Name, Length
