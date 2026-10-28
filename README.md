# dsh-quota-pets

**Quota Pets** — a chibi desktop-pet companion for DeepSeek Harness, one mascot per LLM coding plan:

| Pet | Provider | Theme color |
|---|---|---|
| 🦊 Fennec Scholar | GLM (z.ai / bigmodel) | Purple `#8B7CF6` |
| 🐹 Little Hamster | MiniMax | Pink `#FF7DA0` |
| 🐰 Moon Rabbit | Kimi (Moonshot) | Gold `#F5C445` |
| 🐋 Little Whale | DeepSeek | Blue `#4D6BFE` |

Quota data is consumed entirely from
[dsh-quota-hub](https://github.com/DarkDarkdDarkWine/dsh-quota-hub)
(`/dsh-quota-hub/status.json`) — this plugin never touches your API keys.
Without quota-hub installed, the pet still runs (question-mark state).

[简体中文说明点这里](README.zh-CN.md)

## Behavior

**Follows the active model** — only one pet is visible at a time: the one
matching the model of the current session. Switching models fades the old
pet out and the new one in (nothing is shown when no provider matches).

| State | Behavior |
|---|---|
| Healthy (<70% used) | Gentle floating; click to hop + refresh now |
| Used ≥70% | Anxious swaying ⚠️ |
| Used ≥90% | Faints sideways, desaturated 💧, persistent "almost out of quota" bubble |
| No key / disabled | Ghost mode 💤 |
| Query failed | Question mark ❓, bubble shows the error |
| Session running | Glowing highlight + typing animation ⚡ |

Hover for a bubble (worst window usage + reset countdown). Right-click menu:
change avatar / size (64/88/112px) / reset position. Pet position is
remembered in localStorage. Full state machine and animation-design
reference in [docs/pet-capabilities.md](docs/pet-capabilities.md) (Chinese).

## Custom avatars

Two ways:

1. **Recommended**: drop images into the package's `assets/` directory
   (naming rules in [assets/README.txt](assets/README.txt)). The host serves
   them same-origin; per-state variants are supported
   (`kimi.warn.png`, `glm.work.png`, …) and hot-swap within ~30s — no
   refresh needed.
2. Right-click the pet → "Change avatar…" to pick a local file
   (≤1.5MB, stored in the browser).

Without either, a built-in SVG placeholder mascot is shown. Prompt pack for
generating the four mascots: [docs/image-prompts.md](docs/image-prompts.md)
(Chinese).

## Install

```
dsh plugin --profile <name> add github:DarkDarkdDarkWine/dsh-quota-pets
```

Pairs best with
[dsh-quota-hub](https://github.com/DarkDarkdDarkWine/dsh-quota-hub).

## License

MIT
