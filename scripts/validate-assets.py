#!/usr/bin/env python3
"""Asset validator for dsh-quota-pets (docs/pet-contract.md §8).

Checks every file under assets/<petId>/ against the contract.

  per-file, hard rules (errors, exit 1):
    - filename matches <state>.<ext> or <state>-static.<ext>
    - canvas is square 512×512 (±8 px tolerated)
    - corner badge zone (top-right 18%×18%) fully transparent on every frame
    - byte budget: animated ≤ 750 KB, static .png ≤ 150 KB,
      <state>-static.webp ≤ 100 KB
    - loop count: one-shot animations (done, error) = 1, looping
      animations (idle, working, sleeping, …) = 0
  per-file, soft rules (warnings):
    - ≤ 12 fps; frame caps (idle 36 / working 14 / done 14 / error 14 /
      sleeping 48)
    - feet baseline: lowest opaque row in the bottom 20%
    - no cut-off edges: no pixel with alpha > 128 on the outermost 1 px
      border in any frame (full-bleed framing is allowed, contract §3)
  per-pet, soft rules (warnings) — `diff` is the mean absolute RGBA
  difference (0–255) of two 512×512 frames:
    - static ↔ animation: some frame of the state's animation is within
      12 of its static (the static is a key pose of that animation)
    - done/error static must not be the idle static (diff ≥ 3)
    - pose continuity: one-shot first and last frames within 20 of the
      idle first frame (contract §6)
    - loop seam: diff(last, first) ≤ 1.3 × the mean frame-to-frame step
    - centering: horizontal centre of every state's first frame within
      16 px across the pet's states

Usage: python3 scripts/validate-assets.py [assets_dir] [--strict]
  --strict  also exit 1 when there are warnings
Tests:  python3 -m unittest discover -s scripts -p 'test_*.py'
Requires Pillow with WebP support (standard pillow wheels include it).
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from pathlib import Path

try:
    from PIL import Image, ImageChops, ImageSequence, ImageStat
except ImportError:
    print("error: Pillow is required: pip install pillow", file=sys.stderr)
    raise SystemExit(2)

CANVAS = 512
CORNER_RATIO = 0.18  # top-right badge zone, contract §4
ANIM_BUDGET = 750_000
STATIC_BUDGET = 150_000          # .png statics
STATIC_LOSSY_BUDGET = 100_000    # <state>-static.webp (contract v1.5)
FRAME_CAPS = {"idle": 36, "working": 14, "done": 14, "error": 14, "sleeping": 48, "waiting": 24, "wake": 14, "stumble": 14}
FPS_CAP = 12.0
PET_IDS = {"glm", "minimax", "kimi", "deepseek", "mimo", "default"}
BATCH1_STATES = ("idle", "working", "done", "error", "sleeping")
ONE_SHOT_STATES = {"done", "error", "wake", "stumble"}
LOOP_STATES = ("idle", "working", "sleeping")
ANIM_EXT = {".webp", ".apng", ".gif"}
STATIC_EXT = {".png"}

# per-pet thresholds (calibrated on the Batch 1 art, see contract §8)
STATIC_MATCH_MAX = 12.0
STATIC_DISTINCT_MIN = 3.0
POSE_CONTINUITY_MAX = 20.0
SEAM_RATIO_MAX = 1.3
CENTER_SPREAD_MAX = 16
BBOX_ALPHA = 16
EDGE_ALPHA_MAX = 128  # contract §3: solid art must not touch the canvas border


@dataclass
class Report:
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def err(self, msg: str) -> None:
        self.errors.append(msg)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def frames_of(img: Image.Image) -> list[Image.Image]:
    if getattr(img, "is_animated", False):
        return [f.convert("RGBA") for f in ImageSequence.Iterator(img)]
    return [img.convert("RGBA")]


def canvas_frames(path: Path) -> list[Image.Image]:
    """All frames as RGBA at exactly CANVAS×CANVAS (decode errors → [])."""
    try:
        frames = frames_of(Image.open(path))
    except Exception:  # noqa: BLE001 — reported by check_file
        return []
    return [f if f.size == (CANVAS, CANVAS) else f.resize((CANVAS, CANVAS)) for f in frames]


def diff(a: Image.Image, b: Image.Image) -> float:
    """Mean absolute RGBA difference, 0–255."""
    return sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) / 4


def center_x(frame: Image.Image) -> float | None:
    box = frame.getchannel("A").point(lambda v: 255 if v > BBOX_ALPHA else 0).getbbox()
    return None if box is None else (box[0] + box[2]) / 2


def edge_sides(frame: Image.Image) -> list[str]:
    """Canvas sides whose outermost 1 px row/column holds solid pixels."""
    alpha = frame.getchannel("A")
    w, h = alpha.size
    strips = {"top": (0, 0, w, 1), "bottom": (0, h - 1, w, h), "left": (0, 0, 1, h), "right": (w - 1, 0, w, h)}
    return [side for side, box in strips.items() if alpha.crop(box).getextrema()[1] > EDGE_ALPHA_MAX]


def split_name(path: Path) -> tuple[str, bool]:
    """(state, forced_static) for `<state>.<ext>` / `<state>-static.<ext>`."""
    stem = path.stem.lower()
    if stem.endswith("-static"):
        return stem[: -len("-static")], True
    return stem, False


# ---------------------------------------------------------------------------
# per-file checks
# ---------------------------------------------------------------------------


def check_file(path: Path, report: Report) -> None:
    rel = str(path)
    ext = path.suffix.lower()
    state, forced_static = split_name(path)
    animated = ext in ANIM_EXT and not forced_static
    if ext not in ANIM_EXT | STATIC_EXT:
        report.err(f"{rel}: unexpected extension {ext} (use .webp for animated, .png for static)")
        return
    size = path.stat().st_size
    budget = (ANIM_BUDGET if animated else
              STATIC_LOSSY_BUDGET if forced_static and ext in ANIM_EXT else STATIC_BUDGET)
    if size > budget:
        report.err(f"{rel}: {size} bytes exceeds {'animated' if animated else 'static'} budget {budget}")
    try:
        img = Image.open(path)
    except Exception as cause:  # noqa: BLE001
        report.err(f"{rel}: cannot decode ({cause})")
        return
    frames = frames_of(img)
    for i, frame in enumerate(frames):
        if abs(frame.width - CANVAS) > 8 or abs(frame.height - CANVAS) > 8:
            report.err(f"{rel}: frame {i} is {frame.width}x{frame.height}, expected ~{CANVAS}x{CANVAS}")
            return
        frame = frame.resize((CANVAS, CANVAS)) if (frame.width, frame.height) != (CANVAS, CANVAS) else frame
        cx0 = int(CANVAS * (1 - CORNER_RATIO))
        corner = frame.crop((cx0, 0, cx0 + int(CANVAS * CORNER_RATIO), int(CANVAS * CORNER_RATIO)))
        if corner.getchannel("A").getextrema()[1] > 8:
            report.err(f"{rel}: frame {i} badge corner (top-right {int(CORNER_RATIO*100)}%) is not fully transparent")
    touching = [i for i, frame in enumerate(frames) if edge_sides(frame)]
    if touching:
        sides = "/".join(edge_sides(frames[touching[0]]))
        report.warn(
            f"{rel}: solid art touches the canvas edge ({sides}) in {len(touching)} frame(s), first at frame "
            f"{touching[0]} — it will look cut off; keep alpha ≤ {EDGE_ALPHA_MAX} on the outer 1 px (contract §3)"
        )
    if animated and len(frames) > 1:
        check_animation(rel, state, img, len(frames), report)
    check_baseline(rel, frames[0], report)


def check_animation(rel: str, state: str, img: Image.Image, n: int, report: Report) -> None:
    cap = FRAME_CAPS.get(state)
    if cap and n > cap:
        report.warn(f"{rel}: {n} frames exceeds cap {cap} for state '{state}'")
    durations = [d for d in ((f.info.get("duration", 0) or 0) for f in ImageSequence.Iterator(img)) if d > 0]
    if durations:
        avg = sum(durations) / len(durations)
        fps = 1000.0 / avg if avg > 0 else 0
        if fps > FPS_CAP + 0.5:
            report.warn(f"{rel}: average {fps:.1f} fps exceeds {FPS_CAP:.0f} fps cap")
    loop = img.info.get("loop")
    want = 1 if state in ONE_SHOT_STATES else 0
    if loop != want:
        kind = "one-shot (play once, hold last frame)" if want == 1 else "looping (infinite)"
        report.err(f"{rel}: loop count {loop}, expected {want} for {kind} state '{state}'")


def check_baseline(rel: str, first: Image.Image, report: Report) -> None:
    """Feet baseline (soft): lowest opaque row should sit in the bottom 20%."""
    box = first.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if box is not None and box[3] - 1 < int(CANVAS * 0.80):
        report.warn(f"{rel}: lowest opaque row at y={box[3] - 1} — feet baseline looks high (feet should sit near the bottom, contract §3)")


# ---------------------------------------------------------------------------
# per-pet checks (cross-file)
# ---------------------------------------------------------------------------


def static_path(pet_dir: Path, state: str) -> Path | None:
    for candidate in (pet_dir / f"{state}-static.webp", pet_dir / f"{state}.png"):
        if candidate.is_file():
            return candidate
    return None


def check_pet(pet_dir: Path, report: Report) -> None:
    anims = {s: canvas_frames(pet_dir / f"{s}.webp") for s in BATCH1_STATES if (pet_dir / f"{s}.webp").is_file()}
    anims = {s: fs for s, fs in anims.items() if len(fs) > 1}
    statics = {s: p for s in BATCH1_STATES if (p := static_path(pet_dir, s)) is not None}
    static_frames = {s: fs[0] for s, p in statics.items() if (fs := canvas_frames(p))}
    check_static_match(pet_dir, anims, statics, static_frames, report)
    check_static_distinct(statics, static_frames, report)
    check_pose_continuity(pet_dir, anims, report)
    check_loop_seams(pet_dir, anims, report)
    check_centering(pet_dir, anims, report)


def check_static_match(pet_dir: Path, anims: dict, statics: dict, static_frames: dict, report: Report) -> None:
    for state, still in static_frames.items():
        if state not in anims:
            continue
        best = min(diff(still, f) for f in anims[state])
        if best > STATIC_MATCH_MAX:
            report.warn(
                f"{statics[state]}: no frame of {pet_dir / (state + '.webp')} is within {STATIC_MATCH_MAX:g} "
                f"of this static (closest {best:.1f}) — the static should be a key pose of its own animation"
            )


def check_static_distinct(statics: dict, static_frames: dict, report: Report) -> None:
    idle = static_frames.get("idle")
    if idle is None:
        return
    for state in ("done", "error"):
        still = static_frames.get(state)
        if still is not None and (d := diff(still, idle)) < STATIC_DISTINCT_MIN:
            report.warn(
                f"{statics[state]}: static is just the idle pose (diff {d:.1f} < {STATIC_DISTINCT_MIN:g} "
                f"vs idle static) — show the {state} key pose"
            )


def check_pose_continuity(pet_dir: Path, anims: dict, report: Report) -> None:
    idle = anims.get("idle")
    if not idle:
        return
    for state in ("done", "error"):
        frames = anims.get(state)
        if not frames:
            continue
        first, last = diff(frames[0], idle[0]), diff(frames[-1], idle[0])
        if max(first, last) > POSE_CONTINUITY_MAX:
            report.warn(
                f"{pet_dir / (state + '.webp')}: first={first:.1f} last={last:.1f} vs idle first frame "
                f"(> {POSE_CONTINUITY_MAX:g}) — one-shots must start and end pose-compatible with idle (contract §6)"
            )


def check_loop_seams(pet_dir: Path, anims: dict, report: Report) -> None:
    for state in LOOP_STATES:
        frames = anims.get(state)
        if not frames or len(frames) < 3:
            continue
        steps = [diff(frames[i], frames[i + 1]) for i in range(len(frames) - 1)]
        mean = sum(steps) / len(steps)
        if mean <= 0:
            continue
        seam = diff(frames[-1], frames[0])
        if seam / mean > SEAM_RATIO_MAX:
            report.warn(
                f"{pet_dir / (state + '.webp')}: loop seam {seam:.1f} is {seam / mean:.2f}× the mean frame step "
                f"{mean:.1f} (> {SEAM_RATIO_MAX:g}×) — the last frame should flow into the first"
            )


def check_centering(pet_dir: Path, anims: dict, report: Report) -> None:
    centers = {s: c for s, fs in anims.items() if (c := center_x(fs[0])) is not None}
    if len(centers) < 2:
        return
    spread = max(centers.values()) - min(centers.values())
    if spread > CENTER_SPREAD_MAX:
        listing = ", ".join(f"{s}={c:.0f}" for s, c in centers.items())
        report.warn(
            f"{pet_dir}: horizontal center of first frames differs by {spread:.0f}px across states "
            f"(> {CENTER_SPREAD_MAX}px): {listing}"
        )


# ---------------------------------------------------------------------------
# entry points
# ---------------------------------------------------------------------------


def validate(root: Path) -> Report:
    report = Report()
    for pet_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        if pet_dir.name not in PET_IDS:
            report.warn(f"{pet_dir}: unknown pet id (expected one of {sorted(PET_IDS)})")
        states = {split_name(p)[0] for p in pet_dir.iterdir() if p.is_file()}
        missing = [s for s in BATCH1_STATES if s not in states]
        if pet_dir.name in PET_IDS and pet_dir.name != "default" and missing:
            report.warn(f"{pet_dir}: missing Batch-1 states: {', '.join(missing)}")
        for f in sorted(pet_dir.iterdir()):
            if f.is_file():
                check_file(f, report)
        check_pet(pet_dir, report)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate dsh-quota-pets assets against docs/pet-contract.md.")
    parser.add_argument("assets_dir", nargs="?", default=str(Path(__file__).resolve().parent.parent / "assets"))
    parser.add_argument("--strict", action="store_true", help="exit 1 on warnings too")
    args = parser.parse_args(argv)
    root = Path(args.assets_dir)
    if not root.is_dir():
        print(f"no assets directory at {root} — nothing to validate (placeholders in use)")
        return 0
    if not any(p.is_file() for d in root.iterdir() if d.is_dir() for p in d.iterdir()):
        print("assets/ empty — built-in SVG placeholders in use, nothing to validate")
        return 0
    report = validate(root)
    for w in report.warnings:
        print(f"warn: {w}")
    for e in report.errors:
        print(f"FAIL: {e}")
    print(f"\n{len(report.warnings)} warning(s), {len(report.errors)} error(s)")
    if report.errors or (args.strict and report.warnings):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
