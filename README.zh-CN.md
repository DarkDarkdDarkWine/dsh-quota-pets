# dsh-quota-pets

[English README](README.md)

**额度桌宠** — 给 DeepSeek Harness 配一套桌面宠物，每家 Coding Plan LLM 一只：

| 宠物 | Provider | 主题色 |
|---|---|---|
| 🦊 耳廓狐博士 | GLM（z.ai / bigmodel） | 紫 `#8B7CF6` |
| 🐹 小仓鼠 | MiniMax | 粉 `#FF7DA0` |
| 🐰 月兔 | Kimi（Moonshot） | 金黄 `#F5C445` |
| 🐋 小鲸鱼 | DeepSeek | 蓝 `#4D6BFE` |
| 🧡 兔耳帽少女 | 小米 MiMo | 橙 `#FF6900` |

五只全部为全帧动画（idle / working / done / error / sleeping，WebP、≤12fps、
按字节预算精调——素材规格见[资产合同](docs/pet-contract.md)）。

额度数据完全复用 [dsh-quota-hub](https://github.com/DarkDarkdDarkWine/dsh-quota-hub)
（`/dsh-quota-hub/status.json`），本插件不碰任何 API Key；没装 quota-hub 时
桌宠照常出现（问号态）。

## 行为

**显示规则：跟随当前模型** —— 同一时刻只显示当前会话正在用的模型那只，
切模型时旧宠淡出、新宠淡入。全新的空白对话先不显示宠物，发出第一条
消息、模型确定后才登场（检测不到就不出场）。

| 状态 | 表现 |
|---|---|
| 待机 | 轻盈浮动；点击跳一下并立即刷新 |
| 会话运行中 | 各自的干饭/干活姿势（鲸鱼干饭、耳廓狐翻书、仓鼠跑轮、月兔揉面、少女抱兔）+ 金光晕 ⚡ |
| 一轮完成 | 一次性庆祝动作（约 3 秒）✅ 后回到待机 |
| 出错 | 垂头姿势 + 角标 ❌ |
| 挂机 10 分钟 | 睡觉 💤（鲸鱼蜷睡、少女枕兔…） |

额度压力只以角标/气泡/滤镜叠加呈现，不做成美术：悬停出气泡（最紧张
窗口 + 重置倒计时）；≥70% 警告色 / ≥90% 危险色；未配 Key 或停用 → 幽灵
半透明；查询失败 → 问号 ❓ 气泡显示原因。

右键菜单：临时预览形象 / 大小（64/88/112px）/ 重置位置 / 开发者状态
循环。位置与大小全宠共享，记忆在 localStorage。完整状态机与设计对照表见
[docs/pet-capabilities.md](docs/pet-capabilities.md)。

## 自定义形象

素材放在 `assets/<petId>/<state>.webp`（动画）+ `<state>-static.webp` 或
`.png`（reduced-motion 静态兜底），热加载秒级生效——命名规则见
[assets/README.txt](assets/README.txt)，校验脚本
`scripts/validate-assets.py`，完整规格见[资产合同](docs/pet-contract.md)。
出图提示词见 [docs/image-prompts.md](docs/image-prompts.md)。

## 安装

```
dsh plugin --profile <name> add github:DarkDarkdDarkWine/dsh-quota-pets
```

与 dsh-quota-hub 配对使用效果最佳。

## License

MIT
