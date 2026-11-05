# dsh-quota-pets

[English README](README.md)

**额度桌宠** — 给 DeepSeek Harness 配一套桌面宠物，每家 Coding Plan LLM 一只：

| 宠物 | Provider | 主题色 |
|---|---|---|
| 🦊 阔耳狐娘 | GLM（z.ai / bigmodel） | 紫 `#8B7CF6` |
| 🎙️ 海螺记者娘 | MiniMax | 粉 `#FF7DA0` |
| 🎵 星月少女 | Kimi（Moonshot） | 金黄 `#F5C445` |
| 🐋 鲸鱼娘 | DeepSeek | 蓝 `#4D6BFE` |
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
| 会话运行中 | 各自的干饭/干活姿势（鲸鱼娘干饭、阔耳狐娘翻书、记者娘打板、星月少女吹笛、兔耳帽少女抱兔）+ 金光晕 ⚡ |
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
`.png`（reduced-motion 静态兜底），另可放过渡片段 `<from>-to-<to>.webp`，
切换状态时先播一遍（GLM 翻开书、MiniMax 拿起记录板或坐下睡觉）；热加载秒级生效——命名规则见
[assets/README.txt](assets/README.txt)，校验脚本
`scripts/validate-assets.py`，完整规格见[资产合同](docs/pet-contract.md)。

## 安装

```
dsh plugin --profile <name> add github:DarkDarkdDarkWine/dsh-quota-pets
```

与 dsh-quota-hub 配对使用效果最佳。

## 设计来源

五只形象均为**社区拟人设计**的 Q 版改绘，不是各家公司的官方吉祥物。
制作期记录的参考来源：

- **DeepSeek 鲸鱼娘** — 以 [fisharchive.cc](https://fisharchive.cc/) 的 Q
  版二设为基准（站点标注角色二设 CC BY-NC-SA 4.0）。
- **GLM 阔耳狐娘** — 社区狐娘参考（整理站收录）及
  [ai-chan-sheets](https://github.com/lmy414/ai-chan-sheets) 项目（角色
  作者 ZipZipPipe，仓库 CC BY-NC-SA）。
- **Kimi 星月少女** — Kimi 角色作者
  [ZipZipPipe](https://www.bilibili.com/opus/1238267551429951496)（非对称
  服装出自原作者说明）。
- **MiniMax 海螺记者娘** — MiniMax 角色作者
  [ZipZipPipe](https://www.bilibili.com/opus/1236803362705375305)，辅以
  ai-chan-sheets 的结构补全资料。
- **MiMo 兔耳帽少女** — MiMo 角色作者甶丶（[投稿标注 CC
  BY-NC](https://github.com/lmy414/ai-girl-stickers/issues/35)，
  [ai-girls](https://github.com/shuaizenge/ai-girls/tree/main/characters/mimo)
  有收录）。

来源未标注授权的，仅作参考记录，不主张超出来源本身的任何权利。

## License

- **代码**（`lib/`、`scripts/`、`test/`）：[MIT](LICENSE)。
- **美术素材**（`assets/` 下全部图片）：[CC BY-NC-SA 4.0](assets/LICENSE)
  ——形象改绘自以「非商业」（部分还有「相同方式共享」）条款发布的社区设计，
  所以图片**不是** MIT，不可商用。署名清单见 [assets/LICENSE](assets/LICENSE)。
