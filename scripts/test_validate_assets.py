"""Tests for scripts/validate-assets.py (stdlib unittest + Pillow).

Run: python3 -m unittest discover -s scripts -p 'test_*.py'

Every test builds a tiny synthetic pet in a temp dir — real assets are never
touched. The baseline pet passes every check; each test breaks one thing.
"""

from __future__ import annotations

import importlib.util
import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw

_SPEC = importlib.util.spec_from_file_location("validate_assets", Path(__file__).with_name("validate-assets.py"))
assert _SPEC is not None and _SPEC.loader is not None
va = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = va  # dataclasses resolve annotations via sys.modules
_SPEC.loader.exec_module(va)

CANVAS = 512
STATES = ("idle", "working", "done", "error", "sleeping")
ONE_SHOTS = ("done", "error")

# A frame is described by (body x offset, accent colour or None[, seated]).
FrameSpec = tuple


def draw(dx: int = 0, accent: tuple[int, int, int] | None = None, seated: bool = False) -> Image.Image:
    """Opaque body centred on the canvas, feet near the bottom, badge corner empty.

    `seated` swaps the tall standing body for a short wide one with the same
    centre line — a pose change big enough to break continuity.
    """
    im = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    left, top, right = (106, 300, 406) if seated else (156, 120, 356)
    d.rectangle((left + dx, top, right + dx, 480), fill=(90, 120, 200, 255))
    # soft edge: libwebp crops frames to their visible area, and a fully
    # opaque crop would be written without an alpha channel at all
    d.rectangle((left - 2 + dx, top - 2, right + 2 + dx, 482), outline=(90, 120, 200, 128), width=2)
    if accent is not None:
        d.rectangle((206 + dx, 200, 306 + dx, 300), fill=(*accent, 255))
    return im


# Baseline: small sway loops (seamless ping-pong), one-shots that flash an
# accent mid-way and end on a held accent pose that blends back to idle.
GOLD, RED = (250, 200, 40), (220, 40, 40)
BASE: dict[str, list[FrameSpec]] = {
    "idle": [(0, None), (2, None), (4, None), (2, None)],
    "working": [(0, None), (3, None), (6, None), (3, None)],
    "done": [(0, None), (0, GOLD), (2, GOLD), (0, GOLD)],
    "error": [(0, None), (0, RED), (-2, RED), (0, RED)],
    "sleeping": [(0, None), (1, None), (2, None), (1, None)],
}
STATIC: dict[str, FrameSpec] = {
    "idle": (0, None),
    "working": (3, None),
    "done": (0, GOLD),
    "error": (0, RED),
    "sleeping": (1, None),
}


def write_pet(
    root: Path,
    anims: dict[str, list[FrameSpec]] | None = None,
    statics: dict[str, FrameSpec] | None = None,
    loops: dict[str, int] | None = None,
    pet: str = "glm",
) -> Path:
    anims = {**BASE, **(anims or {})}
    statics = {**STATIC, **(statics or {})}
    loops = loops or {}
    folder = root / pet
    folder.mkdir(parents=True)
    for state in STATES:
        frames = [draw(*spec) for spec in anims[state]]
        loop = loops.get(state, 1 if state in ONE_SHOTS else 0)
        frames[0].save(
            folder / f"{state}.webp",
            save_all=True,
            append_images=frames[1:],
            duration=100,
            loop=loop,
            lossless=True,
        )
        draw(*statics[state]).save(folder / f"{state}.png")
    return root


def run(build: Callable[[Path], Path]) -> "va.Report":
    with tempfile.TemporaryDirectory() as tmp:
        return va.validate(build(Path(tmp)))


def joined(report: "va.Report") -> str:
    return "\n".join(report.errors + report.warnings)


class BaselineTest(unittest.TestCase):
    def test_baseline_pet_is_clean(self) -> None:
        report = run(write_pet)
        self.assertEqual(report.errors, [])
        self.assertEqual(report.warnings, [])


class LoopCountTest(unittest.TestCase):
    def test_infinite_one_shot_is_an_error(self) -> None:
        report = run(lambda r: write_pet(r, loops={"done": 0}))
        self.assertTrue(any("done.webp" in e and "loop" in e for e in report.errors), joined(report))

    def test_finite_loop_state_is_an_error(self) -> None:
        report = run(lambda r: write_pet(r, loops={"idle": 1}))
        self.assertTrue(any("idle.webp" in e and "loop" in e for e in report.errors), joined(report))


class StaticMatchTest(unittest.TestCase):
    def test_static_far_from_every_frame_warns(self) -> None:
        report = run(lambda r: write_pet(r, statics={"working": (120, None)}))
        self.assertTrue(any("working.png" in w and "no frame" in w for w in report.warnings), joined(report))

    def test_static_matching_a_later_frame_is_fine(self) -> None:
        report = run(lambda r: write_pet(r, statics={"working": (6, None)}))
        self.assertFalse(any("working.png" in w for w in report.warnings), joined(report))


class StaticIsIdleTest(unittest.TestCase):
    def test_one_shot_static_identical_to_idle_static_warns(self) -> None:
        anims = {"done": [(0, None), (2, None), (0, None)]}
        report = run(lambda r: write_pet(r, anims=anims, statics={"done": (0, None)}))
        self.assertTrue(any("done.png" in w and "idle" in w for w in report.warnings), joined(report))


class StaticIsWorkingTest(unittest.TestCase):
    """Reduced-motion users see only statics: done/error must not look like working."""

    def test_one_shot_static_identical_to_working_static_warns(self) -> None:
        anims = {"error": [(3, None), (0, RED), (-2, RED), (0, RED)]}
        report = run(lambda r: write_pet(r, anims=anims, statics={"error": (3, None)}))
        self.assertTrue(any("error.png" in w and "working pose" in w for w in report.warnings), joined(report))

    def test_one_shot_static_on_its_reaction_pose_is_fine(self) -> None:
        anims = {"error": [(3, None), (0, RED), (-2, RED), (0, RED)]}
        report = run(lambda r: write_pet(r, anims=anims, statics={"error": (-2, RED)}))
        self.assertFalse(any("working pose" in w for w in report.warnings), joined(report))


SEATED_WORKING = [(0, None, True), (3, None, True), (6, None, True), (3, None, True)]


def pose_warnings(report: "va.Report", state: str = "done") -> list[str]:
    return [w for w in report.warnings if f"{state}.webp" in w and "contract §6" in w]


class PoseContinuityTest(unittest.TestCase):
    """One-shots follow a working run and hand back to idle (contract §6)."""

    def test_baseline_one_shots_connect(self) -> None:
        self.assertEqual(pose_warnings(run(write_pet)), [])

    def test_one_shot_that_never_returns_to_idle_warns_on_last_frame(self) -> None:
        stays_seated = [(0, GOLD, True), (2, GOLD, True), (0, GOLD, True)]
        report = run(lambda r: write_pet(r, anims={"working": SEATED_WORKING, "done": stays_seated},
                                         statics={"working": (3, None, True), "done": (0, GOLD, True)}))
        warnings = pose_warnings(report)
        self.assertEqual(len(warnings), 1, joined(report))
        self.assertIn("last frame is", warnings[0])
        self.assertNotIn("first frame is", warnings[0])

    def test_one_shot_that_ignores_the_working_pose_warns_on_first_frame(self) -> None:
        report = run(lambda r: write_pet(r, anims={"working": SEATED_WORKING},
                                         statics={"working": (3, None, True)}))
        warnings = pose_warnings(report)
        self.assertEqual(len(warnings), 1, joined(report))
        self.assertIn("first frame is", warnings[0])
        self.assertNotIn("last frame is", warnings[0])

    def test_one_shot_from_seated_working_back_to_standing_idle_is_fine(self) -> None:
        stand_up = [(0, GOLD, True), (0, GOLD), (2, GOLD), (0, GOLD)]
        report = run(lambda r: write_pet(r, anims={"working": SEATED_WORKING, "done": stand_up,
                                                   "error": [(0, RED, True), (0, RED), (-2, RED), (0, RED)]},
                                         statics={"working": (3, None, True)}))
        self.assertEqual(pose_warnings(report) + pose_warnings(report, "error"), [], joined(report))


class LoopSeamTest(unittest.TestCase):
    def test_loop_that_jumps_back_warns(self) -> None:
        march = [(0, None), (4, None), (8, None), (12, None), (16, None), (20, None)]
        report = run(lambda r: write_pet(r, anims={"working": march}, statics={"working": (8, None)}))
        self.assertTrue(any("working.webp" in w and "seam" in w for w in report.warnings), joined(report))


class RepeatedEndpointTest(unittest.TestCase):
    def test_loop_whose_last_frame_repeats_the_first_warns(self) -> None:
        repeat = [(0, None), (2, None), (4, None), (2, None), (0, None)]
        report = run(lambda r: write_pet(r, anims={"idle": repeat}))
        self.assertTrue(any("idle.webp" in w and "repeats the first" in w for w in report.warnings), joined(report))

    def test_seamless_ping_pong_is_fine(self) -> None:
        self.assertFalse(any("repeats the first" in w for w in run(write_pet).warnings))


class CenteringTest(unittest.TestCase):
    def test_state_shifted_sideways_warns(self) -> None:
        shifted = [(40, None), (41, None), (42, None), (41, None)]
        report = run(lambda r: write_pet(r, anims={"sleeping": shifted}, statics={"sleeping": (41, None)}))
        self.assertTrue(any("center" in w and "sleeping" in w for w in report.warnings), joined(report))


class DiffMetricTest(unittest.TestCase):
    def test_colour_hidden_under_zero_alpha_is_ignored(self) -> None:
        clean = draw()
        dirty = clean.copy()
        ImageDraw.Draw(dirty).rectangle((0, 0, 100, 100), fill=(255, 0, 255, 0))  # invisible leftovers
        self.assertEqual(va.diff(clean, dirty), 0)

    def test_visible_change_still_counts(self) -> None:
        self.assertGreater(va.diff(draw(), draw(accent=GOLD)), 1)


class EdgeContactTest(unittest.TestCase):
    def test_solid_art_touching_the_canvas_edge_warns(self) -> None:
        def build(r: Path) -> Path:
            write_pet(r)
            still = draw()
            ImageDraw.Draw(still).rectangle((100, 400, 160, CANVAS - 1), fill=(90, 120, 200, 255))
            still.save(r / "glm" / "idle.png")  # foot cut off by the bottom edge
            return r

        report = run(build)
        self.assertTrue(any("idle.png" in w and "edge" in w for w in report.warnings), joined(report))

    def test_soft_edge_reaching_the_border_is_fine(self) -> None:
        def build(r: Path) -> Path:
            write_pet(r)
            still = draw()
            ImageDraw.Draw(still).line((0, 300, 0, 320), fill=(90, 120, 200, 100))
            still.save(r / "glm" / "idle.png")
            return r

        report = run(build)
        self.assertFalse(any("edge" in w for w in report.warnings), joined(report))


class StrictModeTest(unittest.TestCase):
    def exit_code(self, build: Callable[[Path], Path], *flags: str) -> int:
        with tempfile.TemporaryDirectory() as tmp, redirect_stdout(io.StringIO()):
            return va.main([str(build(Path(tmp))), *flags])

    def test_warnings_pass_by_default_and_fail_in_strict_mode(self) -> None:
        def build(r: Path) -> Path:
            return write_pet(r, statics={"working": (120, None)})

        self.assertEqual(self.exit_code(build), 0)
        self.assertEqual(self.exit_code(build, "--strict"), 1)

    def test_clean_pet_passes_strict_mode(self) -> None:
        self.assertEqual(self.exit_code(write_pet, "--strict"), 0)


if __name__ == "__main__":
    unittest.main()
