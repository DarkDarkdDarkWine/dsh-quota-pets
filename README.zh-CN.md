# dsh-quota-pets

[English README](README.md)

**额度桌宠** — 给 DeepSeek Harness 配一套桌面宠物，每家 Coding Plan LLM 一只：

| 宠物 | Provider | 主题色 |
|---|---|---|
| 🦊 耳廓狐博士 | GLM（z.ai / bigmodel） | 紫 `#8B7CF6` |
| 🐹 小仓鼠 | MiniMax | 粉 `#FF7DA0` |
| 🐰 月兔 | Kimi（Moonshot） | 金黄 `#F5C445` |
| 🐋 小鲸鱼 | DeepSeek | 蓝 `#4D6BFE` |

额度数据完全复用 [dsh-quota-hub](https://github.com/DarkDarkdDarkWine/dsh-quota-hub)
（`/dsh-quota-hub/status.json`），本插件不碰任何 API Key；没装 quota-hub 时
桌宠照常出现（问号态）。

## 行为

**显示规则：跟随当前模型** —— 同一时刻只显示当前会话正在用的模型那只，
切模型时旧宠淡出、新宠淡入（未匹配到模型时暂不显示）。

| 状态 | 表现 |
|---|---|
| 余量充足（<70%） | 轻盈浮动；点击跳一下并立即刷新 |
| 用量 ≥70% | 焦虑摇摆 ⚠️ |
| 用量 ≥90% | 躺平变灰 💧，气泡常驻「快没电啦」 |
| 未配 Key / 停用 | 幽灵半透明 💤 |
| 查询失败 | 问号 ❓，气泡显示原因 |
| 会话运行中 | 高亮发光 + 敲键盘态 ⚡ |

悬停出气泡（最紧张窗口 + 重置倒计时）；右键菜单：换形象 / 大小 /
重置位置。位置记忆在 localStorage。完整状态机与动作设计对照表见
[docs/pet-capabilities.md](docs/pet-capabilities.md)。

## 自定义形象

两种方式：

1. **推荐**：出图后扔进本包 `assets/` 目录（命名见
   [assets/README.txt](assets/README.txt)），宿主端同源伺服，支持按状态
   提供不同图（`kimi.warn.png`、`glm.work.png` 等），约 30 秒自动生效。
2. 页面上右键宠物 → 「换形象…」选本地图（≤1.5MB，存浏览器 localStorage）。

两者都没有时显示内置 SVG 占位形象。出图提示词见
[docs/image-prompts.md](docs/image-prompts.md)。

## 安装

```
dsh plugin --profile <name> add github:DarkDarkdDarkWine/dsh-quota-pets
```

与 dsh-quota-hub 配对使用效果最佳。

## License

MIT
