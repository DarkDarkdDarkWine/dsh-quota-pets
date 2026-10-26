/**
 * dsh-quota-pets — 界面端（桌宠本体）。
 *
 * 四只娘化小宠物，一只是一家 Coding Plan：
 *
 *   GLM 猫头鹰博士 · MiniMax 小仓鼠 · Kimi 月兔 · DeepSeek 小鲸鱼
 *
 * 显示规则（跟随模型）：
 *   同一时刻只显示「当前会话正在用的模型」那一只；切模型时旧宠淡出、
 *   新宠淡入。没探测到模型 / 没匹配上任何一家时暂时不显示。
 *
 * 状态联动（额度 + 会话）：
 *   - 余量充足（<70%）：轻盈浮动
 *   - 用量 ≥70%（warn）：焦虑摇摆 + ⚠️
 *   - 用量 ≥90%（critical）：躺平变灰 + 💧，气泡常驻「快没电啦」
 *   - 查询失败 / 未配 Key：问号 / 幽灵态
 *   - 当前模型选中即高亮发光；会话 running 时进入敲键盘态 ⚡
 *
 * 额度数据完全复用 dsh-quota-hub 宿主端（/dsh-quota-hub/status.json），
 * 本插件宿主端只伺服 assets/ 里的自定义形象。形象解析顺序：
 *
 *   右键菜单「换形象」选的本地图（localStorage） > assets/ 目录变体 >
 *   内置 SVG 占位（等 Codex 出图后扔进 assets/ 即可替换）
 *
 * 纯 DOM，不用 React 渲染桌宠（挂 body，独立于任何界面槽位）；
 * React 只用来注册一个隐形的 composer.dock 侦听器探测当前会话模型。
 */
window.__ModuleLoader__.load({
  id: "dsh-quota-pets",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = null;
    try {
      react = require("react");
    } catch (_) {
      react = null;
    }

    const QUOTA_BASE = "/dsh-quota-hub";
    const PET_BASE = "/dsh-quota-pets";
    const POLL_MS = 30_000;
    const STORAGE_KEY = "dsh-quota-pets:state-v1";
    const STAGE_ID = "dsh-quota-pets-stage";
    const STYLE_ID = "dsh-quota-pets-style";
    const CUSTOM_MAX_BYTES = 1_500_000;

    /** 家底清单（当前同一时刻只显示一只，顺序不再影响布局）。 */
    const PROVIDER_UI = {
      glm: { id: "glm", label: "GLM", match: /zai|bigmodel|zhipu|glm/i, color: "#8B7CF6", animal: "猫头鹰博士" },
      minimax: { id: "minimax", label: "MiniMax", match: /minimax|minimaxi|abab/i, color: "#FF7DA0", animal: "小仓鼠" },
      kimi: { id: "kimi", label: "Kimi", match: /kimi|moonshot/i, color: "#F5C445", animal: "月兔" },
      deepseek: { id: "deepseek", label: "DeepSeek", match: /deepseek/i, color: "#4D6BFE", animal: "小鲸鱼" },
    };
    const PROVIDER_IDS = Object.keys(PROVIDER_UI);

    // ---- 持久化状态 -----------------------------------------------------------

    /** { hidden: {id:true}, pos: {id:{x,y}}, size: {id:px}, custom: {id:dataUrl} } */
    const state = loadState();

    function loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            hidden: parsed.hidden && typeof parsed.hidden === "object" ? parsed.hidden : {},
            pos: parsed.pos && typeof parsed.pos === "object" ? parsed.pos : {},
            size: parsed.size && typeof parsed.size === "object" ? parsed.size : {},
            custom: parsed.custom && typeof parsed.custom === "object" ? parsed.custom : {},
          };
        }
      } catch (_) {}
      return { hidden: {}, pos: {}, size: {}, custom: {} };
    }

    function saveState() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (cause) {
        toast("保存设置失败（localStorage 满？）：自定义大图建议放进插件 assets/ 目录用宿主伺服", "err");
      }
    }

    // ---- 内置占位形象（娘化 SVG，出图前的临时演员） ----------------------------

    const PLACEHOLDERS = {
      deepseek: svgUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150">
  <ellipse cx="60" cy="144" rx="26" ry="4" fill="rgba(77,107,254,.18)"/>
  <path d="M84 30 q12 -10 18 0 q-9 6 -18 8 z" fill="#4D6BFE"/>
  <circle cx="52" cy="10" r="2.6" fill="#9DB8FF"/><circle cx="62" cy="6" r="3.2" fill="#9DB8FF"/><circle cx="71" cy="10" r="2.4" fill="#9DB8FF"/>
  <circle cx="60" cy="60" r="38" fill="#4D6BFE"/>
  <circle cx="60" cy="60" r="36" fill="#3D5BE0"/>
  <circle cx="60" cy="62" r="29" fill="#FFE8D6"/>
  <path d="M31 58 q6 16 29 16 q23 0 29 -16 q-8 26 -29 26 q-21 0 -29 -26 z" fill="#4D6BFE"/>
  <path d="M28 52 A34 34 0 0 1 92 52 L92 60 Q60 74 28 60 Z" fill="#4D6BFE"/>
  <circle cx="50" cy="58" r="4" fill="#2C2A33"/><circle cx="70" cy="58" r="4" fill="#2C2A33"/>
  <circle cx="51.4" cy="56.6" r="1.3" fill="#fff"/><circle cx="71.4" cy="56.6" r="1.3" fill="#fff"/>
  <ellipse cx="44" cy="68" rx="4.6" ry="2.6" fill="#FFB3B3" opacity=".85"/><ellipse cx="76" cy="68" rx="4.6" ry="2.6" fill="#FFB3B3" opacity=".85"/>
  <path d="M55 71 Q60 75.5 65 71" stroke="#B06A5E" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="M44 96 L76 96 L82 128 L38 128 Z" fill="#4D6BFE"/>
  <path d="M40 118 L80 118 L82 128 L38 128 Z" fill="#E8F0FF"/>
  <circle cx="60" cy="97" r="3.4" fill="#E8F0FF"/>
  <rect x="47" y="128" width="8" height="10" rx="4" fill="#FFE8D6"/><rect x="65" y="128" width="8" height="10" rx="4" fill="#FFE8D6"/>
  <path d="M44 100 q-10 6 -8 18" stroke="#4D6BFE" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M76 100 q10 6 8 18" stroke="#4D6BFE" stroke-width="7" fill="none" stroke-linecap="round"/>
</svg>`),
      kimi: svgUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150">
  <ellipse cx="60" cy="144" rx="24" ry="4" fill="rgba(245,196,69,.2)"/>
  <ellipse cx="46" cy="16" rx="7" ry="22" fill="#F5DFA0" transform="rotate(-10 46 16)"/>
  <ellipse cx="46" cy="16" rx="3.6" ry="15" fill="#FFC9D6" transform="rotate(-10 46 16)"/>
  <ellipse cx="74" cy="16" rx="7" ry="22" fill="#F5DFA0" transform="rotate(10 74 16)"/>
  <ellipse cx="74" cy="16" rx="3.6" ry="15" fill="#FFC9D6" transform="rotate(10 74 16)"/>
  <circle cx="60" cy="62" r="34" fill="#F5DFA0"/>
  <path d="M26 60 A34 34 0 0 1 94 60 L94 66 Q60 78 26 66 Z" fill="#EFCB74"/>
  <circle cx="60" cy="64" r="28" fill="#FFE8D6"/>
  <path d="M32 58 A28 28 0 0 1 88 58 L88 62 Q60 72 32 62 Z" fill="#F5DFA0"/>
  <path d="M76 36 a8 8 0 1 0 6 12 a6.4 6.4 0 1 1 -6 -12 z" fill="#FFB930"/>
  <circle cx="50" cy="60" r="4" fill="#3A2E2A"/><circle cx="70" cy="60" r="4" fill="#3A2E2A"/>
  <circle cx="51.4" cy="58.6" r="1.3" fill="#fff"/><circle cx="71.4" cy="58.6" r="1.3" fill="#fff"/>
  <ellipse cx="44" cy="70" rx="4.6" ry="2.6" fill="#FFB3B3" opacity=".9"/><ellipse cx="76" cy="70" rx="4.6" ry="2.6" fill="#FFB3B3" opacity=".9"/>
  <path d="M55 73 Q60 77.5 65 73" stroke="#B06A5E" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="M46 96 L74 96 L80 128 L40 128 Z" fill="#2B3A67"/>
  <path d="M52 102 l2.6 2 l2.6 -2 l2.6 2 l2.6 -2" stroke="#F5DFA0" stroke-width="1.6" fill="none"/>
  <rect x="48" y="128" width="8" height="10" rx="4" fill="#FFE8D6"/><rect x="64" y="128" width="8" height="10" rx="4" fill="#FFE8D6"/>
  <path d="M46 100 q-9 6 -7 17" stroke="#2B3A67" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M74 100 q9 6 7 17" stroke="#2B3A67" stroke-width="7" fill="none" stroke-linecap="round"/>
</svg>`),
      glm: svgUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150">
  <ellipse cx="60" cy="144" rx="25" ry="4" fill="rgba(139,124,246,.18)"/>
  <path d="M28 44 q-8 -6 -6 -14 q10 2 12 10 z" fill="#8B7CF6"/>
  <path d="M92 44 q8 -6 6 -14 q-10 2 -12 10 z" fill="#8B7CF6"/>
  <circle cx="60" cy="62" r="34" fill="#8B7CF6"/>
  <circle cx="60" cy="64" r="28" fill="#FFE8D6"/>
  <path d="M32 60 A28 28 0 0 1 88 60 L88 64 Q60 74 32 64 Z" fill="#9D90FF"/>
  <circle cx="50" cy="60" r="9.5" fill="rgba(255,255,255,.28)" stroke="#4A3F8C" stroke-width="2"/>
  <circle cx="70" cy="60" r="9.5" fill="rgba(255,255,255,.28)" stroke="#4A3F8C" stroke-width="2"/>
  <path d="M59.5 60 h1" stroke="#4A3F8C" stroke-width="2"/>
  <path d="M40.5 58 h-8 M79.5 58 h8" stroke="#4A3F8C" stroke-width="2"/>
  <circle cx="50" cy="60" r="3.8" fill="#2C2A33"/><circle cx="70" cy="60" r="3.8" fill="#2C2A33"/>
  <circle cx="51.2" cy="58.8" r="1.2" fill="#fff"/><circle cx="71.2" cy="58.8" r="1.2" fill="#fff"/>
  <ellipse cx="43" cy="70" rx="4.2" ry="2.4" fill="#FFB3B3" opacity=".85"/><ellipse cx="77" cy="70" rx="4.2" ry="2.4" fill="#FFB3B3" opacity=".85"/>
  <path d="M55.5 72.5 Q60 76.5 64.5 72.5" stroke="#B06A5E" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="M45 96 L75 96 L81 128 L39 128 Z" fill="#4A3F8C"/>
  <rect x="70" y="103" width="16" height="20" rx="2" fill="#FFF8E7" stroke="#C9A96B" stroke-width="1.4" transform="rotate(12 78 113)"/>
  <path d="M73 108 l10 2 M72.5 113 l10 2 M72 118 l7 1.5" stroke="#C9A96B" stroke-width="1.2" transform="rotate(12 78 113)"/>
  <rect x="47" y="128" width="8" height="10" rx="4" fill="#FFE8D6"/><rect x="65" y="128" width="8" height="10" rx="4" fill="#FFE8D6"/>
  <path d="M45 100 q-9 6 -7 17" stroke="#4A3F8C" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M75 100 q9 5 8 12" stroke="#4A3F8C" stroke-width="7" fill="none" stroke-linecap="round"/>
</svg>`),
      minimax: svgUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150">
  <ellipse cx="60" cy="144" rx="24" ry="4" fill="rgba(255,157,182,.22)"/>
  <circle cx="38" cy="32" r="11" fill="#FF9FB6"/><circle cx="38" cy="32" r="6" fill="#FFD3DE"/>
  <circle cx="82" cy="32" r="11" fill="#FF9FB6"/><circle cx="82" cy="32" r="6" fill="#FFD3DE"/>
  <circle cx="60" cy="62" r="34" fill="#FF9FB6"/>
  <circle cx="60" cy="64" r="28" fill="#FFE8D6"/>
  <path d="M32 60 A28 28 0 0 1 88 60 L88 64 Q60 76 32 64 Z" fill="#FF9FB6"/>
  <path d="M36 50 q8 -8 16 -2 q6 -10 16 -2 q8 -6 14 4" stroke="#FF7DA0" stroke-width="3.4" fill="none" stroke-linecap="round"/>
  <circle cx="50" cy="60" r="4.2" fill="#3A2E2A"/><circle cx="70" cy="60" r="4.2" fill="#3A2E2A"/>
  <circle cx="51.4" cy="58.6" r="1.4" fill="#fff"/><circle cx="71.4" cy="58.6" r="1.4" fill="#fff"/>
  <ellipse cx="41" cy="68" rx="6.4" ry="4" fill="#FFB3B3"/><ellipse cx="79" cy="68" rx="6.4" ry="4" fill="#FFB3B3"/>
  <path d="M56 72 q4 5 8 0" stroke="#B06A5E" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <circle cx="60" cy="41" r="3" fill="#FF7DA0"/>
  <path d="M46 96 L74 96 L80 128 L40 128 Z" fill="#FF6F91"/>
  <path d="M48 104 L72 104 L74 122 L46 122 Z" fill="#FFF3F6"/>
  <rect x="47" y="128" width="8" height="10" rx="4" fill="#FFE8D6"/><rect x="65" y="128" width="8" height="10" rx="4" fill="#FFE8D6"/>
  <path d="M46 100 q-9 6 -7 17" stroke="#FF6F91" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M74 100 q9 6 7 17" stroke="#FF6F91" stroke-width="7" fill="none" stroke-linecap="round"/>
</svg>`),
    };

    function svgUri(markup) {
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup.replace(/\s+/g, " ").trim());
    }

    // ---- 样式 -----------------------------------------------------------------

    const CSS = [
      "#" + STAGE_ID + "{position:fixed;inset:0;pointer-events:none;z-index:9998}",
      ".qp-pet{position:absolute;pointer-events:auto;display:flex;flex-direction:column;align-items:center;user-select:none;-webkit-user-select:none;line-height:1;transition:opacity .25s ease}",
      ".qp-pet.qp-away{opacity:0 !important;pointer-events:none}",
      ".qp-fig{position:relative;cursor:grab;transition:filter .3s,opacity .3s;animation:qp-float 3.2s ease-in-out infinite;will-change:transform}",
      ".qp-fig:active{cursor:grabbing}",
      ".qp-fig.qp-dragging{animation:none;cursor:grabbing;z-index:2}",
      ".qp-img{display:block;width:100%;height:auto;image-rendering:auto;pointer-events:none}",
      ".qp-fig.qp-glow .qp-img{filter:drop-shadow(0 0 9px rgba(255,214,102,.95)) drop-shadow(0 0 3px rgba(255,255,255,.8))}",
      ".qp-fig.qp-mood-warn{animation:qp-sway 1s ease-in-out infinite}",
      ".qp-fig.qp-mood-critical{animation:qp-breath 4s ease-in-out infinite;transform:rotate(94deg) translateY(4px) scale(.97)}",
      ".qp-fig.qp-mood-critical .qp-img{filter:grayscale(.75) brightness(.93)}",
      ".qp-fig.qp-mood-ghost{animation:qp-float 4.5s ease-in-out infinite;opacity:.35}",
      ".qp-fig.qp-mood-ghost .qp-img{filter:grayscale(1)}",
      ".qp-fig.qp-mood-unknown{animation:qp-float 4s ease-in-out infinite;opacity:.85}",
      ".qp-fig.qp-working{animation:qp-type .34s ease-in-out infinite}",
      ".qp-fig.qp-hop{animation:qp-hop .55s ease-out 2}",
      "@keyframes qp-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}",
      "@keyframes qp-sway{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}",
      "@keyframes qp-breath{0%,100%{transform:rotate(94deg) translateY(4px) scale(.97)}50%{transform:rotate(94deg) translateY(4px) scale(1.02)}}",
      "@keyframes qp-type{0%,100%{transform:translateY(0) rotate(-1.2deg)}50%{transform:translateY(-2.5px) rotate(1.2deg)}}",
      "@keyframes qp-hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-16px)}}",
      ".qp-badge{position:absolute;top:-6px;right:-8px;font-size:15px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));animation:qp-float 2.2s ease-in-out infinite;pointer-events:none}",
      ".qp-tag{margin-top:3px;display:flex;align-items:center;gap:5px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,rgba(20,20,26,.82)) 88%,transparent);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:999px;padding:2px 8px;font-size:11px;color:var(--dsw-alias-label-primary,#eee);backdrop-filter:blur(4px)}",
      ".qp-tag b{font-weight:600}",
      ".qp-dot{width:7px;height:7px;border-radius:50%;flex:none}",
      ".qp-pet.qp-hidden-tag .qp-tag{opacity:.55}",
      ".qp-bubble{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);max-width:210px;white-space:nowrap;background:var(--dsw-alias-bg-layer-2,rgba(28,28,36,.94));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));color:var(--dsw-alias-label-primary,#f2f2f5);font-size:12px;border-radius:10px;padding:6px 10px;opacity:0;pointer-events:none;transition:opacity .18s;z-index:3;box-shadow:0 4px 16px rgba(0,0,0,.3)}",
      ".qp-bubble::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:6px solid transparent;border-top-color:var(--dsw-alias-bg-layer-2,rgba(28,28,36,.94))}",
      ".qp-pet.qp-show-bubble .qp-bubble{opacity:1}",
      ".qp-bubble.qp-auto{animation:qp-pulse 2.4s ease-in-out infinite}",
      "@keyframes qp-pulse{0%,100%{transform:translateX(-50%) scale(1)}50%{transform:translateX(-50%) scale(1.045)}}",
      ".qp-menu{position:fixed;z-index:9999;min-width:170px;background:var(--dsw-alias-bg-layer-2,#1c1c24);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));border-radius:10px;padding:4px;box-shadow:0 8px 28px rgba(0,0,0,.4);font-size:12.5px}",
      ".qp-menu button{display:block;width:100%;text-align:left;background:none;border:none;color:var(--dsw-alias-label-primary,#eee);padding:7px 10px;border-radius:7px;cursor:pointer;font-size:12.5px;font-family:inherit}",
      ".qp-menu button:hover{background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.09))}",
      ".qp-menu button:disabled{opacity:.4;cursor:default}",
      ".qp-menu .qp-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.14))}",
      ".qp-toast{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);z-index:10000;background:var(--dsw-alias-bg-layer-2,#1c1c24);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));color:var(--dsw-alias-label-primary,#f2f2f5);border-radius:10px;padding:8px 14px;font-size:12.5px;box-shadow:0 6px 24px rgba(0,0,0,.35);animation:qp-toast-in .2s ease-out}",
      ".qp-toast.qp-err{border-color:var(--dsw-alias-state-error-primary,#e5484d)}",
      "@keyframes qp-toast-in{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}",
    ].join("\n");

    function ensureStyle() {
      if (document.getElementById(STYLE_ID) !== null) return;
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    // ---- 数据源：额度（复用 dsh-quota-hub）+ 形象清单 --------------------------

    const runtime = {
      quota: null, // dsh-quota-hub 的 status payload
      quotaError: null,
      health: null, // 本插件宿主端 health.json（assets 形象清单）
      activeProviders: [], // 当前会话模型命中的 provider
      running: false, // 当前会话是否在跑
      refreshing: false,
      pets: {}, // provider -> pet 对象
      failedSrcs: {}, // provider -> Set（加载失败的记忆，避免每帧闪重试）
    };

    async function fetchJson(url, init) {
      const res = await fetch(url, Object.assign({ headers: { accept: "application/json" }, cache: "no-store" }, init || {}));
      if (!res.ok && res.status !== 404) throw new Error("HTTP " + res.status);
      return res.status === 404 ? null : res.json();
    }

    async function pollQuota() {
      try {
        runtime.quota = await fetchJson(QUOTA_BASE + "/status.json");
        runtime.quotaError = null;
      } catch (cause) {
        runtime.quotaError = String(cause);
      }
      renderAll();
    }

    async function pollHealth() {
      try {
        runtime.health = await fetchJson(PET_BASE + "/health.json");
      } catch (_) {
        runtime.health = null; // 老宿主没有本插件宿主端路由：只用占位/自定义图
      }
      renderAll();
    }

    async function refreshQuotaNow() {
      if (runtime.refreshing) return;
      runtime.refreshing = true;
      try {
        runtime.quota = await fetchJson(QUOTA_BASE + "/refresh.json", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        runtime.quotaError = null;
      } catch (cause) {
        runtime.quotaError = String(cause);
      } finally {
        runtime.refreshing = false;
      }
      renderAll();
    }

    function snapshotOf(providerId) {
      const payload = runtime.quota;
      if (!payload || !Array.isArray(payload.providers)) return null;
      return payload.providers.find(function (p) { return p && p.provider === providerId; }) || null;
    }

    function severityOf(usedPercent) {
      if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) return "unknown";
      if (usedPercent >= 90) return "critical";
      if (usedPercent >= 70) return "warn";
      return "ok";
    }

    function worstView(snapshot) {
      if (!snapshot || snapshot.ok !== true) return null;
      const windows = Array.isArray(snapshot.windows) ? snapshot.windows : [];
      if (windows.length === 0) return null;
      return windows.find(function (w) { return w.id === snapshot.worstWindowId; }) || windows.reduce(function (acc, w) {
        if (acc === null) return w;
        if (typeof w.usedPercent !== "number") return acc;
        if (typeof acc.usedPercent !== "number") return w;
        return w.usedPercent > acc.usedPercent ? w : acc;
      }, null);
    }

    /** 组合出一只宠物的完整视图状态。 */
    function petView(providerId) {
      const ui = PROVIDER_UI[providerId];
      const snapshot = snapshotOf(providerId);
      const view = {
        id: providerId,
        label: ui.label,
        color: ui.color,
        hidden: state.hidden[providerId] === true,
        working: runtime.activeProviders.indexOf(providerId) >= 0 && runtime.running === true,
        active: runtime.activeProviders.indexOf(providerId) >= 0,
        mood: "unknown",
        usedPercent: null,
        severity: "unknown",
        bubble: "",
        bubbleAuto: false,
        tagDetail: "—",
      };
      if (runtime.quotaError && !runtime.quota) {
        view.mood = "unknown";
        view.bubble = ui.label + "：连不上 dsh-quota-hub（" + runtime.quotaError + "）";
        return view;
      }
      if (!snapshot) {
        view.mood = "unknown";
        view.bubble = ui.label + "：额度监控没有返回这一家";
        return view;
      }
      if (snapshot.disabled === true) {
        view.mood = "ghost";
        view.bubble = ui.label + "：已在额度监控里停用";
        view.tagDetail = "停用";
        return view;
      }
      if (snapshot.needsKey) {
        view.mood = "ghost";
        view.bubble = ui.label + "：还没配 Key，查不了额度";
        view.tagDetail = "无Key";
        return view;
      }
      if (snapshot.ok !== true) {
        view.mood = "unknown";
        view.bubble = ui.label + "：" + String(snapshot.error || "查询失败");
        view.tagDetail = "?";
        return view;
      }
      const worst = worstView(snapshot);
      const used = worst ? worst.usedPercent : null;
      view.usedPercent = typeof used === "number" ? used : null;
      view.severity = severityOf(used);
      view.mood = view.severity;
      view.tagDetail = view.usedPercent === null ? "n/a" : (Math.round(view.usedPercent * 10) / 10).toFixed(1) + "%";
      const lines = [ui.label + " 已用 " + (view.usedPercent === null ? "未知" : view.tagDetail)];
      if (worst && worst.title) lines.push(worst.title + "窗口");
      const reset = worst ? countdown(worst.resetAt) : "";
      if (reset) lines.push(reset);
      view.bubble = lines.join(" · ");
      if (view.severity === "critical") {
        view.bubbleAuto = true;
        view.bubble = "快没电啦 " + view.tagDetail + "！" + (reset ? " " + reset : "");
      }
      return view;
    }

    function countdown(iso) {
      if (typeof iso !== "string" || iso === "") return "";
      const target = Date.parse(iso);
      if (!Number.isFinite(target)) return "";
      const diff = target - Date.now();
      if (diff <= 0) return "即将重置";
      const minutes = Math.round(diff / 60000);
      if (minutes < 60) return minutes + " 分后重置";
      const hours = Math.floor(minutes / 60);
      if (hours < 48) return hours + " 时 " + (minutes % 60) + " 分后重置";
      return Math.floor(hours / 24) + " 天后重置";
    }

    // ---- 形象解析 --------------------------------------------------------------

    function avatarSrcFor(providerId, view) {
      const custom = state.custom[providerId];
      if (custom && !failed(providerId, custom)) return custom;
      const health = runtime.health;
      const avatars = health && typeof health === "object" && health.avatars && typeof health.avatars === "object" ? health.avatars[providerId] : null;
      if (avatars && typeof avatars === "object" && health.base) {
        // 变体选择：干活 > critical > warn > base；缺的逐级回退 base
        const want = view.working ? ["work", "critical", "warn", "base"] : view.mood === "critical" ? ["critical", "base"] : view.mood === "warn" ? ["warn", "base"] : ["base"];
        for (const key of want) {
          const file = avatars[key];
          if (file && file.name && !failed(providerId, file.name)) {
            return health.base + "/avatar/" + encodeURIComponent(file.name) + "?v=" + (file.v || 0);
          }
        }
      }
      return PLACEHOLDERS[providerId] || PLACEHOLDERS.glm;
    }

    function failed(providerId, src) {
      const set = runtime.failedSrcs[providerId];
      return set !== undefined && set.has(src);
    }

    function markFailed(providerId, src) {
      if (src.indexOf("data:") === 0) return; // 占位 SVG 不记失败
      (runtime.failedSrcs[providerId] = runtime.failedSrcs[providerId] || new Set()).add(src);
      renderAll();
    }

    // ---- 桌宠 DOM --------------------------------------------------------------

    const DEFAULT_SIZE = 88;
    const SIZES = [64, 88, 112];

    function petSize(providerId) {
      const n = Number(state.size[providerId]);
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_SIZE;
    }

    /** 默认布局：右下角单只驻点（同一时刻只显示当前模型那只）。 */
    function defaultPos(providerId) {
      const size = petSize(providerId);
      return {
        x: Math.max(8, window.innerWidth - size - 26),
        y: Math.max(8, window.innerHeight - 172),
      };
    }

    function ensurePet(providerId) {
      const ui = PROVIDER_UI[providerId];
      let pet = runtime.pets[providerId];
      if (pet) return pet;
      pet = { id: providerId, root: null, img: null, hover: false, dragging: false, away: true, awayTimer: null };
      runtime.pets[providerId] = pet;

      const root = document.createElement("div");
      root.className = "qp-pet";
      root.dataset.provider = providerId;

      const bubble = document.createElement("div");
      bubble.className = "qp-bubble";

      const fig = document.createElement("div");
      fig.className = "qp-fig";

      const img = document.createElement("img");
      img.className = "qp-img";
      img.alt = ui.label + " 桌宠";
      img.draggable = false;
      img.addEventListener("error", function () {
        markFailed(providerId, img.getAttribute("src") || "");
      });
      fig.appendChild(img);

      const badge = document.createElement("span");
      badge.className = "qp-badge";
      fig.appendChild(badge);

      const tag = document.createElement("div");
      tag.className = "qp-tag";
      const dot = document.createElement("span");
      dot.className = "qp-dot";
      const name = document.createElement("b");
      name.textContent = ui.label;
      const detail = document.createElement("span");
      detail.className = "qp-detail";
      tag.appendChild(dot);
      tag.appendChild(name);
      tag.appendChild(detail);

      root.appendChild(bubble);
      root.appendChild(fig);
      root.appendChild(tag);

      // 悬停气泡
      root.addEventListener("mouseenter", function () { pet.hover = true; syncBubble(pet); });
      root.addEventListener("mouseleave", function () { pet.hover = false; syncBubble(pet); });

      // 点击（无拖拽位移时）→ 立即刷新 + 跳一下
      root.addEventListener("click", function (event) {
        if (pet.dragging || event.detail === 0) return;
        void refreshQuotaNow();
        fig.classList.remove("qp-hop");
        void fig.offsetWidth;
        fig.classList.add("qp-hop");
      });

      root.addEventListener("contextmenu", function (event) {
        event.preventDefault();
        openMenu(event.clientX, event.clientY, providerId);
      });

      // 拖拽（pointer capture，阈值区分点击）
      fig.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) return;
        const start = { x: event.clientX, y: event.clientY };
        const base = { x: root.offsetLeft, y: root.offsetTop };
        let moved = false;
        pet.dragging = false;
        fig.setPointerCapture(event.pointerId);
        fig.classList.add("qp-dragging");
        const move = function (ev) {
          const dx = ev.clientX - start.x;
          const dy = ev.clientY - start.y;
          if (!moved && Math.abs(dx) + Math.abs(dy) > 4) {
            moved = true;
            pet.dragging = true;
          }
          if (moved) {
            root.style.left = clampX(base.x + dx, providerId) + "px";
            root.style.top = clampY(base.y + dy) + "px";
          }
        };
        const up = function (ev) {
          fig.releasePointerCapture(ev.pointerId);
          fig.removeEventListener("pointermove", move);
          fig.removeEventListener("pointerup", up);
          fig.removeEventListener("pointercancel", up);
          fig.classList.remove("qp-dragging");
          if (moved) {
            state.pos[providerId] = { x: root.offsetLeft, y: root.offsetTop };
            saveState();
          }
          // 让 click 判定跳过刚结束的拖拽
          setTimeout(function () { pet.dragging = false; }, 60);
        };
        fig.addEventListener("pointermove", move);
        fig.addEventListener("pointerup", up);
        fig.addEventListener("pointercancel", up);
      });

      runtime.petsStage.appendChild(root);
      pet.root = root;
      pet.fig = fig;
      pet.img = img;
      pet.badge = badge;
      pet.bubble = bubble;
      pet.dot = dot;
      pet.detail = detail;
      return pet;
    }

    function clampX(x, providerId) {
      return Math.min(Math.max(4, x), Math.max(4, window.innerWidth - petSize(providerId) - 4));
    }

    function clampY(y) {
      return Math.min(Math.max(4, y), window.innerHeight - 60);
    }

    const SEVERITY_COLOR = {
      ok: "var(--dsw-alias-state-success-primary,#46a758)",
      warn: "var(--dsw-alias-state-warn-primary,#f5a524)",
      critical: "var(--dsw-alias-state-error-primary,#e5484d)",
      unknown: "var(--dsw-alias-state-idle-primary,#8e8e93)",
      ghost: "var(--dsw-alias-state-idle-primary,#8e8e93)",
    };

    function badgeFor(view) {
      if (view.working) return "⚡";
      if (view.mood === "critical") return "💧";
      if (view.mood === "warn") return "⚠️";
      if (view.mood === "ghost") return "💤";
      if (view.mood === "unknown") return "❓";
      return "";
    }

    function syncBubble(pet) {
      const view = petView(pet.id);
      pet.root.classList.toggle("qp-show-bubble", pet.hover || view.bubbleAuto);
      pet.bubble.classList.toggle("qp-auto", view.bubbleAuto && !pet.hover);
      pet.bubble.textContent = view.bubble;
    }

    function renderPet(providerId) {
      const view = petView(providerId);
      const pet = ensurePet(providerId);

      // 显示规则：只显示当前会话正在用的模型那只（其余淡出收起）
      const shouldShow = view.active && !view.hidden;
      if (!shouldShow) {
        if (!pet.away) {
          pet.away = true;
          pet.root.classList.add("qp-away");
          clearTimeout(pet.awayTimer);
          pet.awayTimer = setTimeout(function () {
            if (pet.away) pet.root.style.display = "none";
          }, 280);
        }
        return;
      }
      pet.away = false;
      clearTimeout(pet.awayTimer);
      const wasHidden = pet.root.style.display === "none";
      pet.root.style.display = "";
      if (wasHidden) {
        pet.root.classList.add("qp-away");
        void pet.root.offsetWidth; // 先停在透明再淡入，保证切换模型有过渡
      }
      pet.root.classList.remove("qp-away");

      // 位置：记忆位置 > 默认右下角
      const pos = state.pos[providerId] || defaultPos(providerId);
      const size = petSize(providerId);
      pet.root.style.width = size + "px";
      pet.root.style.left = clampX(pos.x, providerId) + "px";
      pet.root.style.top = clampY(pos.y) + "px";

      // 形象
      const src = avatarSrcFor(providerId, view);
      if (pet.img.getAttribute("src") !== src) pet.img.setAttribute("src", src);

      // 状态类
      const figClass = "qp-fig" + (view.active ? " qp-glow" : "") + (view.mood !== "ok" ? " qp-mood-" + view.mood : "") + (view.working ? " qp-working" : "");
      if (pet.fig.className !== figClass) pet.fig.className = figClass;

      pet.badge.textContent = badgeFor(view);

      // 铭牌
      pet.dot.style.background = view.color;
      pet.detail.textContent = view.tagDetail;
      pet.detail.style.color = SEVERITY_COLOR[view.mood] || SEVERITY_COLOR.unknown;
      pet.root.classList.toggle("qp-hidden-tag", view.mood === "ghost" || view.mood === "unknown");

      syncBubble(pet);
    }

    function renderAll() {
      if (!runtime.petsStage) return;
      for (const id of PROVIDER_IDS) renderPet(id);
    }

    // ---- 右键菜单 / toast ------------------------------------------------------

    let menuEl = null;

    function closeMenu() {
      if (menuEl) {
        menuEl.remove();
        menuEl = null;
      }
    }

    function toast(text, kind) {
      const el = document.createElement("div");
      el.className = "qp-toast" + (kind === "err" ? " qp-err" : "");
      el.textContent = text;
      document.body.appendChild(el);
      setTimeout(function () { el.remove(); }, 2600);
    }

    function openMenu(x, y, providerId) {
      closeMenu();
      const ui = PROVIDER_UI[providerId];
      const menu = document.createElement("div");
      menu.className = "qp-menu";

      const item = function (label, opts, onClick) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        if (opts && opts.disabled) btn.disabled = true;
        if (opts && opts.hint) btn.title = opts.hint;
        btn.addEventListener("click", function () {
          closeMenu();
          onClick();
        });
        menu.appendChild(btn);
      };
      const sep = function () {
        const el = document.createElement("div");
        el.className = "qp-menu-sep";
        menu.appendChild(el);
      };

      item("换形象…（选本地图）", null, function () { pickCustom(providerId); });
      item("恢复默认形象", { disabled: !state.custom[providerId] }, function () {
        delete state.custom[providerId];
        delete runtime.failedSrcs[providerId];
        saveState();
        renderAll();
      });
      const sizeNow = petSize(providerId);
      const nextSize = SIZES[(SIZES.indexOf(sizeNow) + 1) % SIZES.length] || DEFAULT_SIZE;
      item("大小：" + sizeNow + "px → " + nextSize + "px", null, function () {
        state.size[providerId] = nextSize;
        delete state.pos[providerId]; // 换大小后回默认驻点
        saveState();
        renderAll();
      });
      sep();
      item("重置位置（回到右下角）", null, function () {
        state.pos = {};
        saveState();
        renderAll();
      });
      sep();
      item("关于 dsh-quota-pets", null, function () {
        toast("额度桌宠 · 只显示当前模型 · 额度复用 dsh-quota-hub · 形象放 assets/ 目录", "");
      });

      document.body.appendChild(menu);
      const rect = menu.getBoundingClientRect();
      menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + "px";
      menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + "px";
      menuEl = menu;

      setTimeout(function () {
        const away = function (event) {
          if (menuEl && !menuEl.contains(event.target)) {
            closeMenu();
            document.removeEventListener("pointerdown", away, true);
          }
        };
        document.addEventListener("pointerdown", away, true);
      }, 0);
    }

    let fileInput = null;

    function pickCustom(providerId) {
      if (!fileInput) {
        fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/png,image/gif,image/webp,image/jpeg,image/svg+xml";
        fileInput.style.display = "none";
        document.body.appendChild(fileInput);
        fileInput.addEventListener("change", function () {
          const file = fileInput.files && fileInput.files[0];
          fileInput.value = "";
          if (!file || !fileInput.dataset.provider) return;
          const providerId = fileInput.dataset.provider;
          if (file.size > CUSTOM_MAX_BYTES) {
            toast("图片太大（" + Math.round(file.size / 1024) + "KB，上限 1.5MB）。大图请放进插件的 assets/ 目录用宿主伺服", "err");
            return;
          }
          const reader = new FileReader();
          reader.onload = function () {
            state.custom[providerId] = String(reader.result);
            delete runtime.failedSrcs[providerId];
            saveState();
            renderAll();
            toast(PROVIDER_UI[providerId].label + " 换上新形象啦");
          };
          reader.onerror = function () { toast("读取图片失败", "err"); };
          reader.readAsDataURL(file);
        });
      }
      fileInput.dataset.provider = providerId;
      fileInput.click();
    }

    // ---- 当前会话模型侦听（隐形 dock 侦听器 + sessions 服务） -------------------

    let sessionsService = null;

    function rememberSessions(candidate) {
      if (candidate && typeof candidate.binding === "function") sessionsService = candidate;
    }

    function modelFromSelection(sel) {
      if (!sel || typeof sel !== "object") return null;
      const provider = typeof sel.provider === "string" ? sel.provider : "";
      const name = typeof sel.model === "string" ? sel.model : typeof sel.name === "string" ? sel.name : "";
      if (!provider && !name) return null;
      return { provider: provider, name: name };
    }

    function faceSelection(face) {
      try {
        const snap = face && typeof face.getSnapshot === "function" ? face.getSnapshot() : null;
        if (!snap || typeof snap !== "object") return null;
        return modelFromSelection(snap.next) || modelFromSelection(snap.lastUsed);
      } catch (_) {
        return null;
      }
    }

    function detectModel(ownerProps) {
      const session = ownerProps && typeof ownerProps === "object" && ownerProps.session && typeof ownerProps.session === "object" ? ownerProps.session : null;
      let face = null;
      try {
        face = session && session.projections && typeof session.projections.faceOf === "function" ? session.projections.faceOf("modelSelection") : null;
      } catch (_) {
        face = null;
      }
      if (face) {
        const m = faceSelection(face);
        if (m) return { provider: m.provider, name: m.name, face: face };
      }
      const sessionId =
        ownerProps && typeof ownerProps.sessionId === "string"
          ? ownerProps.sessionId
          : session && typeof session.sessionId === "string"
            ? session.sessionId
            : null;
      if (sessionsService && sessionId) {
        try {
          const binding = sessionsService.binding(sessionId);
          face = binding && binding.session && binding.session.projections && typeof binding.session.projections.faceOf === "function" ? binding.session.projections.faceOf("modelSelection") : null;
          if (face) {
            const m = faceSelection(face);
            if (m) return { provider: m.provider, name: m.name, face: face };
          }
        } catch (_) {}
      }
      const direct =
        modelFromSelection(session ? session.model : null) ||
        (function () {
          const ms = session ? session.modelSelection : null;
          if (!ms || typeof ms !== "object") return null;
          return modelFromSelection(ms.next) || modelFromSelection(ms.lastUsed);
        })();
      if (direct) return { provider: direct.provider, name: direct.name, face: null };
      return null;
    }

    function matchedProviders(detected) {
      if (!detected) return [];
      const hay = (detected.provider || "") + " " + (detected.name || "");
      return PROVIDER_IDS.filter(function (id) {
        try {
          return PROVIDER_UI[id].match.test(hay);
        } catch (_) {
          return false;
        }
      });
    }

    /** 隐形侦听器：挂在 composer dock，每次渲染汇报「当前模型 + running」。 */
    function makeModelSpy(reactLib) {
      return function ModelSpy(ownerProps) {
        const detected = detectModel(ownerProps);
        const face = detected ? detected.face : null;
        const tick = reactLib.useState(0);
        const setTick = tick[1];
        reactLib.useEffect(
          function () {
            if (!face || typeof face.subscribe !== "function") return undefined;
            let alive = true;
            const dispose = face.subscribe(function () {
              if (alive) setTick(function (n) { return n + 1; });
            });
            return function () {
              alive = false;
              if (typeof dispose === "function") dispose();
            };
          },
          [face],
        );
        // 渲染即汇报（模型切换、会话切换、running 变化都会触发 dock 重渲染）
        const active = matchedProviders(detected);
        const running = !!(ownerProps && ownerProps.session && ownerProps.session.running === true);
        if (active.join(",") !== runtime.activeProviders.join(",") || running !== runtime.running) {
          runtime.activeProviders = active;
          runtime.running = running;
          queueMicrotask(renderAll);
        }
        return null;
      };
    }

    // ---- 启动 ------------------------------------------------------------------

    let started = false;

    function boot() {
      if (started) return;
      started = true;
      ensureStyle();

      const stage = document.createElement("div");
      stage.id = STAGE_ID;
      document.body.appendChild(stage);
      runtime.petsStage = stage;

      for (const id of PROVIDER_IDS) ensurePet(id);
      renderAll();

      void pollQuota();
      void pollHealth();
      setInterval(function () {
        if (document.visibilityState === "visible") {
          void pollQuota();
          void pollHealth();
        }
      }, POLL_MS);
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") {
          void pollQuota();
          void pollHealth();
        }
      });
      window.addEventListener("resize", function () {
        for (const id of PROVIDER_IDS) {
          const pet = runtime.pets[id];
          if (!pet || pet.root.style.display === "none") continue;
          pet.root.style.left = clampX(pet.root.offsetLeft, id) + "px";
          pet.root.style.top = clampY(pet.root.offsetTop) + "px";
        }
      });
    }

    function waitForBody() {
      if (document.body) {
        boot();
        return;
      }
      const timer = setInterval(function () {
        if (document.body) {
          clearInterval(timer);
          boot();
        }
      }, 120);
    }

    function apply(ctx) {
      waitForBody();

      // sessions 服务（detectModel 的正路数据源），失败不致命
      if (ctx && typeof ctx.inject === "function") {
        try {
          ctx.inject(["sessions"], function (ready) {
            rememberSessions(ready && ready.sessions ? ready.sessions : ready);
          });
        } catch (_) {}
        try {
          if (typeof ctx.get === "function") rememberSessions(ctx.get("sessions"));
        } catch (_) {}
      }

      // 隐形 dock 侦听器：探测当前会话模型（高亮 + 工作态）
      const wire = function (ready) {
        if (!react) return;
        const spy = makeModelSpy(react);
        const register = function () {
          try {
            ready.slots.inject("conversation.composer.dock", function () {
              ready.slots.register(
                {
                  name: "conversation.composer.dock",
                  id: "dsh-quota-pets-spy",
                  order: 90,
                  label: function () { return "额度桌宠"; },
                },
                function (ownerProps) { return react.createElement(spy, ownerProps || null); },
              );
            });
          } catch (_) {}
        };
        if (typeof ready.effect === "function") ready.effect(register, "dsh-quota-pets: dock spy");
        else register();
      };

      if (ctx && typeof ctx.inject === "function") {
        ctx.inject(["slots"], wire);
      } else if (ctx && ctx.slots !== undefined) {
        wire(ctx);
      }
    }

    exports.apply = apply;
    return module.exports;
  },
});
