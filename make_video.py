#!/usr/bin/env python3
"""Build a 30-second portrait slideshow video from photos with background music.

Usage:
    python3 make_video.py [--photos DIR] [--audio FILE] [--out FILE]
                          [--duration SECONDS] [--audio-start SECONDS]

Photos are taken from the photos directory in alphabetical order, so name them
01.jpg, 02.jpg, ... to control the sequence. The output is 1080x1920 (9:16,
reels/shorts friendly) with a gentle Ken Burns zoom on each photo and smooth
crossfades between them. If an audio file is provided (or found in audio/),
it is trimmed to the video length with a fade-out at the end.
"""

import argparse
import subprocess
import sys
from pathlib import Path

WIDTH, HEIGHT = 1080, 1920
FPS = 30
XFADE = 0.8  # crossfade duration in seconds


def find_photos(photos_dir: Path) -> list[Path]:
    exts = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
    photos = sorted(p for p in photos_dir.iterdir()
                    if p.suffix.lower() in exts and p.is_file())
    return photos


def find_audio(audio_arg: str | None) -> Path | None:
    if audio_arg:
        p = Path(audio_arg)
        if not p.is_file():
            sys.exit(f"Audio file not found: {p}")
        return p
    audio_dir = Path("audio")
    if audio_dir.is_dir():
        for p in sorted(audio_dir.iterdir()):
            if p.suffix.lower() in {".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus"}:
                return p
    return None


def build_command(photos: list[Path], audio: Path | None, out: Path,
                  total: float, audio_start: float) -> list[str]:
    n = len(photos)
    # Each photo is on screen for `per` seconds; consecutive clips overlap by XFADE.
    per = (total + (n - 1) * XFADE) / n

    cmd = ["ffmpeg", "-y"]
    for p in photos:
        cmd += ["-loop", "1", "-t", f"{per:.3f}", "-i", str(p)]
    if audio is not None:
        cmd += ["-ss", f"{audio_start:.3f}", "-i", str(audio)]

    frames = round(per * FPS)
    filters = []
    for i in range(n):
        # Fill the 9:16 frame, then apply a slow zoom-in (Ken Burns).
        # Upscale before zoompan to avoid jitter from integer rounding.
        filters.append(
            f"[{i}:v]scale={WIDTH * 2}:{HEIGHT * 2}:force_original_aspect_ratio=increase,"
            f"crop={WIDTH * 2}:{HEIGHT * 2},"
            f"zoompan=z='1+0.08*on/{frames}':d={frames}"
            f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
            f":s={WIDTH}x{HEIGHT}:fps={FPS},"
            f"format=yuv420p,setsar=1[v{i}]"
        )

    # Chain crossfades: v0 + v1 -> f1, f1 + v2 -> f2, ...
    last = "v0"
    for i in range(1, n):
        offset = i * (per - XFADE)
        out_label = f"f{i}" if i < n - 1 else "vout"
        filters.append(
            f"[{last}][v{i}]xfade=transition=fade:duration={XFADE}"
            f":offset={offset:.3f}[{out_label}]"
        )
        last = out_label
    if n == 1:
        filters.append("[v0]copy[vout]")

    if audio is not None:
        filters.append(
            f"[{n}:a]atrim=0:{total},afade=t=in:st=0:d=1,"
            f"afade=t=out:st={total - 2.5}:d=2.5[aout]"
        )

    cmd += ["-filter_complex", ";".join(filters), "-map", "[vout]"]
    if audio is not None:
        cmd += ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]
    cmd += ["-t", f"{total:.3f}", "-c:v", "libx264", "-preset", "medium",
            "-crf", "18", "-r", str(FPS), "-movflags", "+faststart", str(out)]
    return cmd


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--photos", default="photos", help="directory with photos (default: photos/)")
    ap.add_argument("--audio", default=None, help="audio file (default: first file in audio/)")
    ap.add_argument("--out", default="memories.mp4", help="output file (default: memories.mp4)")
    ap.add_argument("--duration", type=float, default=30.0, help="video length in seconds")
    ap.add_argument("--audio-start", type=float, default=0.0,
                    help="seconds to skip into the song before it starts playing")
    args = ap.parse_args()

    photos_dir = Path(args.photos)
    if not photos_dir.is_dir():
        sys.exit(f"Photos directory not found: {photos_dir}")
    photos = find_photos(photos_dir)
    if not photos:
        sys.exit(f"No photos found in {photos_dir}/ (jpg/png/webp)")

    audio = find_audio(args.audio)
    if audio is None:
        print("Note: no audio file found; rendering video without sound.")

    print(f"Photos ({len(photos)}): " + ", ".join(p.name for p in photos))
    if audio:
        print(f"Audio: {audio} (starting at {args.audio_start:.1f}s)")

    cmd = build_command(photos, audio, Path(args.out), args.duration, args.audio_start)
    print("Rendering...")
    subprocess.run(cmd, check=True)
    print(f"Done: {args.out}")


if __name__ == "__main__":
    main()
