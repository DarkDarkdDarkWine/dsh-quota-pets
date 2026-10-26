形象图放这里（docs/pet-contract.md 是完整规范）。

目录结构（每只宠物一个文件夹，一态一文件）：

  assets/deepseek/idle.webp      待机循环动画
  assets/deepseek/idle.png       待机静态兜底
  assets/deepseek/working.webp   干活循环
  assets/deepseek/done.webp      一次完成庆祝（~3s 后回 idle）
  assets/deepseek/error.webp     出错持帧（到下次 run）
  assets/deepseek/sleeping.webp  空闲 10 分钟睡觉

宠物文件夹：glm / minimax / kimi / deepseek / default
状态名：idle / working / done / error / sleeping（Batch 2: waiting / wake / stumble）

动画统一 webp（或 apng），静态兜底 png。缺的按链回退：
<state> 动画 → <state> 静态 → idle 动画 → idle 静态 → 内置 SVG 占位。

放好文件后刷新页面即生效（宿主 3 秒重扫）。
写完素材跑 `python3 scripts/validate-assets.py` 校验尺寸/透明角/字节预算。
