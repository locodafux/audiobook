"""Timing file and the lossless join (mutagen lengths, ffmpeg concat -c copy, ffprobe check)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from mutagen.mp3 import MP3

# ffprobe length of the joined file must match the sum of the pieces within this much.
JOIN_TOLERANCE_S = 1.0
JOIN_TOLERANCE_REL = 0.005


def mp3_length(path: Path) -> float:
    return float(MP3(str(path)).info.length)


def ffprobe_length(path: Path) -> float:
    out = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if out.returncode != 0 or not out.stdout.strip():
        raise RuntimeError(f"ffprobe failed: {out.stderr.strip()[-500:]}")
    return float(out.stdout.strip())


def concat_mp3(clips: list[Path], dest: Path) -> None:
    if not clips:
        raise ValueError("nothing to join")
    listing = dest.with_suffix(".concat.txt")
    lines = ("file '" + str(c.resolve()).replace("'", r"'\''") + "'" for c in clips)
    listing.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        out = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(listing),
                "-c",
                "copy",
                str(dest),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
    finally:
        listing.unlink(missing_ok=True)
    if out.returncode != 0:
        raise RuntimeError(f"ffmpeg join failed ({out.returncode}): {out.stderr[-1000:]}")


def build_timing(sentences: list[str], lengths: list[float]) -> dict:
    """Start/end are the cumulative measured length of each sentence's own mp3."""
    t = 0.0
    items = []
    for i, (text, length) in enumerate(zip(sentences, lengths, strict=True)):
        items.append({"i": i, "t": text, "s": round(t, 2), "e": round(t + length, 2)})
        t += length
    return {"v": 1, "sentences": items}


def timing_bytes(timing: dict) -> bytes:
    return json.dumps(timing, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def check_join(joined: Path, lengths: list[float]) -> float:
    """Return the joined length, or raise if it disagrees with the pieces."""
    expected = sum(lengths)
    actual = ffprobe_length(joined)
    if abs(actual - expected) > max(JOIN_TOLERANCE_S, JOIN_TOLERANCE_REL * expected):
        raise RuntimeError(
            f"joined audio is {actual:.2f}s but the sentences add up to {expected:.2f}s"
        )
    return actual
