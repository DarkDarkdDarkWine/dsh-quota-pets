# Pet Asset Contract v1.5 (frozen for Batch 1)

Single source of truth shared by the plugin builder and the artist (image
generation). If either side needs something not covered here, the contract is
amended first — code is never patched around a gap.

Changelog v1.4 → v1.5: statics may ship as `<state>-static.webp` (lossy,
≤ 100 KB) when the PNG form cannot fit 150 KB. Measured reality: the GLM
fennec (fur + book + bells) is entropy-limited at ~280 KB even quantized
to 64 colors, while a q75 lossy WebP static is ~30 KB with better
fidelity. Simple art keeps using `<state>.png`. The builder may also
uniformly decimate loop frames (preserving loop duration; only fps drops)
when a state cannot fit its byte budget — used for detail-rich `sleeping`
loops (fur entropy floors at ~830 KB at 36 frames; 24 frames ≈ 560 KB
with better per-frame quality). Per-pet animated guideline: ≤ 3 MB.

Changelog v1.3 → v1.4: animated byte budget 400 KB → 750 KB per file.
Measured reality: full-body secondary motion (tail, ears, ahoge) on every
frame pushes a 24-frame `idle` to ~540 KB and a 36-frame `sleeping` to
~740 KB at q50 — the old 400 KB assumed localized hand motion. Static
budget unchanged. Builder-side alpha posterization (≤ 8 levels) is an
allowed processing step to fit the budget; at ≤ 112 px display size it is
invisible. Guideline: all animated files for one pet together ≤ 2.2 MB.

Changelog v1.2 → v1.3: `working` loop relaxed to 0.8–1.6 s and ≤ 14 frames —
the confirmed eating cycle (bowl → chopsticks → mouth → chew → back) does
not fit the typing-era 0.4–0.8 s; validator frame cap updated to match.

Changelog v1.1 → v1.2: single animated format (WebP); pilot scope — one full
pet first, not four at once; frame-rate and frame-count caps make the byte
budget achievable; held-pose requirements and code-side display durations;
badge corner must be fully transparent (testable); anchor rules scoped to
rest poses; `waiting` added to Batch 2.

## 1. Pet IDs and folder layout

One folder per pet, one file per state:

```
assets/
  deepseek/     idle.webp idle.png  working.webp working.png  done.webp done.png  error.webp error.png  sleeping.webp sleeping.png
  glm/          ...   # added after the pilot validates the pipeline
  minimax/      ...
  kimi/         ...
  default/      ...   # mystery pet shown when no provider matches
```

- Animated file: `<state>.webp`. Static fallback: `<state>.png`. The loader
  prefers the `.webp`, falls back to the `.png`. (APNG is accepted only in
  the named file `<state>.apng` if WebP animation genuinely cannot be
  produced — flag it before delivering.)
- GIF is not accepted for animation (1-bit transparency gives jagged edges).

**Atlas vs per-state — decided: per-state files.** Reason: our state set
does not map one-to-one onto the standard Codex V1 spritesheet rows, and
per-state files carry their own resolution. If the artist's tool natively
emits a Codex V1 atlas (8 columns, 192×208 cells), the deliverable is still
per-state files; slicing an atlas into per-state frames is a mechanical
conversion owned by the builder, not a contract change. Never ship a raw
atlas.

The old flat dot-style naming (`glm.warn.png`) is **deprecated**. No
hyphens anywhere.

## 2. States (Batch 1)

| State | Type | Trigger | Loop rule | Code displays it |
|---|---|---|---|---|
| `idle` | loop | default, no run in progress | seamless, 2–4 s | until state changes |
| `working` | loop | run in progress | seamless, 0.8–1.6 s | until run ends |
| `done` | one-shot | run ended cleanly (session-stable, run ≥ 4 s) | ≤ 1.2 s, hold last frame | ~3 s, then back to idle |
| `error` | one-shot, hold | run ended with an error | ≤ 1.2 s, hold last frame | until the next run starts |
| `sleeping` | loop | idle timeout ≈ 10 min (no run, no interaction) | seamless, 3–4 s | until woken |

**Held poses:** the last frames of `done` and especially `error` may be
held on screen for minutes — they must read clearly as a pose, not a
mid-motion blur. `error`'s final pose is clearly "upset" and blends toward
idle.

Signal note — verified against the host Event catalog: `agent/status`,
`agent/turn-stopping`, `agent/error`, and `approval/request` all exist; the
**host** decides the run outcome (clean vs error) and publishes one settled
value, so the client cannot flash `done` before `error` arrives.

Batch 2 (do not generate yet): `waiting` (approval requested), `stumble`,
idle blink/glance variants, `wake` (one-shot: sleeping → idle).

Pressure levels (quota ≥70% / ≥90%) and data-unavailability are **code
overlays only** (filters, badge, bubble) — never separate art. Do not draw
them.

## 3. Canvas and shipped size

- **Shipped size: 512 × 512 px square, transparent background** (real
  alpha, not white). 1024 px masters may be kept by the artist but are not
  shipped — the pet displays at 64 / 88 / 112 px width, scaled
  proportionally, so 512 is ≥ 4× the largest display size.
- Rest poses (first frame of `idle`, last frames of one-shots): full body,
  standing, facing viewer, **horizontally centered**; feet baseline at ~92%
  of canvas height. Mid-animation frames may leave the baseline (hops,
  stretches) — that is expected.
- Character height ≤ 85% of canvas in rest poses; outer 7% margin on every
  side free of critical detail. **Tall silhouettes beware:** rabbit ears or
  owl tufts must not intrude into the top-right badge corner.

## 4. Reserved overlay area

The top-right **18% × 18%** corner must be **fully transparent in every
frame** (not merely "unimportant" — code stamps the state badge ⚡ 💧 ❓ 💤
there, and the validator checks alpha). Whole-image filters (desaturation,
dimming, working glow) may touch every pixel.

## 5. Deliverables (Batch 1 = pipeline pilot)

1. **Scope: `deepseek` first, all five states.** The other three pets are
   generated only after the pilot renders correctly in the plugin. Style
   consistency across pets comes from the shared style guide, not from
   generating them simultaneously.
2. Per state: `<state>.webp` (animated) **and** a static fallback (= representative key pose of the state, not frame 1 — e.g. `working`'s static shows mid-keystroke, so reduced-motion mode never looks idle). Static form is either `<state>.png` (≤ 150 KB) or, when the PNG is entropy-limited above that budget (detail-rich art), `<state>-static.webp` (lossy, ≤ 100 KB). The `-static` suffix always lands in the static slot regardless of extension (host v1.5).
3. Frame caps (make the byte budget achievable): ≤ 12 fps everywhere; frame
   count ≤ 36 (`idle`), ≤ 14 (`working`), ≤ 14 (`done`), ≤ 14 (`error`),
   ≤ 48 (`sleeping`). Lossy WebP is fine — sprites tolerate it.
4. Byte budget: animated ≤ 750 KB per file, static ≤ 150 KB (`.png`) or ≤ 100 KB (`-static.webp`).

## 6. Transitions

- The first frame of `idle` is the canonical rest pose; every one-shot
  state's **last** frame must be pose-compatible with it (no teleporting
  limbs between state switches).
- `sleeping` should end its loop in a pose a short `wake` one-shot
  (Batch 2) can start from.
- Frame timing inside a state is the artist's; code controls only display
  duration and remounting (one-shots re-mount to replay).

## 7. Fallback chain (code behavior, for reference)

`<state>.webp → <state>.png → idle.webp → idle.png → built-in SVG
placeholder`. Reduced-motion mode goes straight to `<state>.png`. A missing
file degrades gracefully, never to broken UI.

## 8. Enforcement

`scripts/validate-assets.py` checks every delivered file against this
contract: dimensions, alpha background, byte budgets, badge-corner
transparency, foot baseline of rest poses, and first/last-frame
pose-similarity (idle vs one-shot endings). Deliveries that fail validation
are not accepted into `assets/`.
