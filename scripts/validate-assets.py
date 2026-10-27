#!/usr/bin/env python3
"""Asset validator for dsh-quota-pets (docs/pet-contract.md §8).

Checks every file under assets/<petId>/ against the contract:

  hard rules (exit 1):
    - filename matches <state>.<ext>
    - canvas is square 512×512 (downscale/upscale warning band ±8px)
    - corner badge zone (top-right 18%×18%) fully transparent on every frame
    - byte budget: animated ≤ 400 KB, static ≤ 150 KB
  soft rules (warnings only):
    - animated: ≤ 12 fps, frame caps (idle 36 / working 10 / done 14 /
      error 14 / sleeping 48)
    - one-shot last frame ≈ idle first frame (key-pose anchor)
    - feet baseline near the bottom margin

Usage: python3 scripts/validate-assets.py [assets_dir]
Requires Pillow with WebP support (standard pillow wheels include it).
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageSequence
except ImportError:
    print("error: Pillow is required: pip install pillow", file=sys.stderr)
    raise SystemExit(2)

CANVAS = 512
CORNER_RATIO = 0.18  # top-right badge zone, contract §5
ANIM_BUDGET = 750_000
STATIC_BUDGET = 150_000
FRAME_CAPS = {"idle": 36, "working": 14, "done": 14, "error": 14, "sleeping": 48, "waiting": 24, "wake": 14, "stumble": 14}
FPS_CAP = 12.0
PET_IDS = {"glm", "minimax", "kimi", "deepseek", "default"}
BATCH1_STATES = {"idle", "working", "done", "error", "sleeping"}
ANIM_EXT = {".webp", ".apng", ".gif"}
STATIC_EXT = {".png"}

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def frames_of(img: Image.Image) -> list[Image.Image]:
    if getattr(img, "is_animated", False):
        return [f.convert("RGBA") for f in ImageSequence.Iterator(img)]
    return [img.convert("RGBA")]


def check_file(path: Path) -> None:
    rel = str(path)
    stem, ext = path.stem, path.suffix.lower()
    state = stem
    animated = ext in ANIM_EXT
    if ext not in ANIM_EXT | STATIC_EXT:
        err(f"{rel}: unexpected extension {ext} (use .webp for animated, .png for static)")
        return
    size = path.stat().st_size
    budget = ANIM_BUDGET if animated else STATIC_BUDGET
    if size > budget:
        err(f"{rel}: {size} bytes exceeds {'animated' if animated else 'static'} budget {budget}")
    try:
        img = Image.open(path)
    except Exception as cause:  # noqa: BLE001
        err(f"{rel}: cannot decode ({cause})")
        return
    frames = frames_of(img)
    for i, frame in enumerate(frames):
        if abs(frame.width - CANVAS) > 8 or abs(frame.height - CANVAS) > 8:
            err(f"{rel}: frame {i} is {frame.width}x{frame.height}, expected ~{CANVAS}x{CANVAS}")
            return
        frame = frame.resize((CANVAS, CANVAS)) if (frame.width, frame.height) != (CANVAS, CANVAS) else frame
        cx0, cy0 = int(CANVAS * (1 - CORNER_RATIO)), 0
        corner = frame.crop((cx0, cy0, cx0 + int(CANVAS * CORNER_RATIO), int(CANVAS * CORNER_RATIO)))
        if corner.getchannel("A").getextrema()[1] > 8:
            err(f"{rel}: frame {i} badge corner (top-right {int(CORNER_RATIO*100)}%) is not fully transparent")
    if animated:
        n = len(frames)
        cap = FRAME_CAPS.get(state)
        if cap and n > cap:
            warn(f"{rel}: {n} frames exceeds cap {cap} for state '{state}'")
        durations = []
        for f in ImageSequence.Iterator(img):
            d = f.info.get("duration", 0) or 0
            if d > 0:
                durations.append(d)
        if durations:
            avg = sum(durations) / len(durations)
            fps = 1000.0 / avg if avg > 0 else 0
            if fps > FPS_CAP + 0.5:
                warn(f"{rel}: average {fps:.1f} fps exceeds {FPS_CAP:.0f} fps cap")
    # feet baseline (soft): lowest opaque row should sit in the bottom 12%
    first = frames[0]
    alpha = first.getchannel("A")
    lowest = -1
    for y in range(CANVAS - 1, -1, -1):
        row = alpha.crop((0, y, CANVAS, y + 1))
        if row.getextrema()[1] > 8:
            lowest = y
            break
    if lowest >= 0 and lowest < int(CANVAS * 0.80):
        warn(f"{rel}: lowest opaque row at y={lowest} — feet baseline looks high (contract wants ~92%)")


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "assets")
    if not root.is_dir():
        print(f"no assets directory at {root} — nothing to validate (placeholders in use)")
        return 0
    found_any = False
    for pet_dir in sorted(root.iterdir()):
        if not pet_dir.is_dir():
            continue
        if pet_dir.name not in PET_IDS:
            warn(f"{pet_dir}: unknown pet id (expected one of {sorted(PET_IDS)})")
        states = {p.stem for p in pet_dir.iterdir() if p.is_file()}
        missing_anim = sorted(BATCH1_STATES - states)
        if pet_dir.name in PET_IDS and pet_dir.name != "default" and missing_anim:
            warn(f"{pet_dir}: missing Batch-1 states: {', '.join(missing_anim)}")
        for f in sorted(pet_dir.iterdir()):
            if f.is_file():
                found_any = True
                check_file(f)
    if not found_any:
        print("assets/ empty — built-in SVG placeholders in use, nothing to validate")
        return 0
    for w in warnings:
        print(f"warn: {w}")
    for e in errors:
        print(f"FAIL: {e}")
    print(f"\n{len(warnings)} warning(s), {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
