# dsh-quota-pets

**Quota Pets** — a chibi desktop-pet companion for DeepSeek Harness, one mascot per LLM coding plan:

| Pet | Provider | Theme color |
|---|---|---|
| 🦊 Fennec Scholar | GLM (z.ai / bigmodel) | Purple `#8B7CF6` |
| 🐹 Little Hamster | MiniMax | Pink `#FF7DA0` |
| 🐰 Moon Rabbit | Kimi (Moonshot) | Gold `#F5C445` |
| 🐋 Little Whale | DeepSeek | Blue `#4D6BFE` |
| 🧡 Bunny-Hood Girl | Xiaomi MiMo | Orange `#FF6900` |

All five mascots are fully animated (idle / working / done / error / sleeping,
WebP, ≤12 fps, tuned to fit tight byte budgets — see the asset
[contract](docs/pet-contract.md)).

Quota data is consumed entirely from
[dsh-quota-hub](https://github.com/DarkDarkdDarkWine/dsh-quota-hub)
(`/dsh-quota-hub/status.json`) — this plugin never touches your API keys.
Without quota-hub installed, the pet still runs (question-mark state).

[简体中文说明点这里](README.zh-CN.md)

## Behavior

**Follows the active model** — only one pet is visible at a time: the one
matching the model of the current session. Switching models fades the old
pet out and the new one in. A brand-new conversation shows no pet until the
first query fixes the model (nothing matches → nothing shown).

| State | Behavior |
|---|---|
| Idle | Gentle floating; click to hop + refresh now |
| Session running | Working pose (each pet's own: whale eating, fennec flipping pages, hamster running, rabbit kneading, girl with her plush) + glow ⚡ |
| Run finished | One-shot celebration (~3s) ✅, then back to idle |
| Run errored | Drooping pose, badge ❌ |
| Idle 10 min | Sleeping 💤 (whale curl, girl naps on her rabbit…) |

Quota pressure is rendered as an overlay (badge + bubble + filter), never as
art: hover for the worst window usage + reset countdown; ≥70% warn / ≥90%
critical coloring; no key or disabled provider → ghost mode; query failed →
question mark ❓ with the error in the bubble.

Right-click menu: temporary avatar preview / size (64/88/112px) / reset
position / developer state cycler. Position and size are shared across all
pets and remembered in localStorage. Full state machine and design reference
in [docs/pet-capabilities.md](docs/pet-capabilities.md) (Chinese).

## Custom avatars

Assets live in `assets/<petId>/<state>.webp` (animated) plus
`<state>-static.webp` or `.png` (static fallback for reduced-motion), hot-swapped
within seconds — naming rules in [assets/README.txt](assets/README.txt),
validation via `scripts/validate-assets.py`, full spec in the asset
[contract](docs/pet-contract.md). Prompt pack for generating mascots:
[docs/image-prompts.md](docs/image-prompts.md) (Chinese).

## Install

```
dsh plugin --profile <name> add github:DarkDarkdDarkWine/dsh-quota-pets
```

Pairs best with
[dsh-quota-hub](https://github.com/DarkDarkdDarkWine/dsh-quota-hub).

## License

MIT
