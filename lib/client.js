/**
 * dsh-quota-pets — client side (the pets themselves).
 *
 * One chibi mascot per LLM coding plan:
 *
 *   GLM 猫头鹰博士 · MiniMax 小仓鼠 · Kimi 月兔 · DeepSeek 小鲸鱼
 *   (+ "default" — the mystery pet shown when no model matches)
 *
 * Display rule: only the pet for the CURRENTLY ACTIVE model is shown.
 * Switching models fades the old pet out and the new one in.
 *
 * State model (four orthogonal dimensions, see docs/pet-contract.md §1):
 *   identity   : which pet (model → petId via PROVIDER_UI regex; single seam)
 *   activity   : idle / working / done / error / sleeping  (animation file)
 *   pressure   : ok / warn / critical / unknown / ghost    (quota overlay:
 *                badge + filter + bubble only — poses belong to the art)
 *   availability: quota-hub reachable / configured
 *
 * Activity derivation (docs/pet-contract.md §2):
 *   debug override > error hold > running → working > done (~3s) >
 *   idle >10min → sleeping > idle
 * `done`/`error` come from the HOST-aggregated outcome
 * (/dsh-quota-pets/events.json?session=…) — the host settles the
 * done-vs-error race and publishes one value; the client additionally
 * guards with a falling-edge + ≥4s run check when events are unavailable.
 *
 * Asset resolution per pet & state (docs/pet-contract.md §4):
 *   assets/<petId>/<state>.webp (animated) → <state>.png (static) →
 *   idle animated/static → built-in SVG placeholder.
 *   prefers-reduced-motion skips straight to the static file.
 *
 * Quota numbers are reused from dsh-quota-hub (/dsh-quota-hub/status.json);
 * this plugin's host side only serves assets/ and the events feed.
 *
 * Plain DOM for the pets (mounted on body, independent of any UI slot);
 * React is used only to register an invisible composer.dock spy that
 * reports the current session's model + running flag.
 */
window.__ModuleLoader__.load({
  id: "dsh-quota-pets",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var CLIENT_DIAG_VERSION = "diag2-20261028";
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
    const EVENTS_POLL_MS = 2_000;
    const STORAGE_KEY = "dsh-quota-pets:state-v1";
    const STAGE_ID = "dsh-quota-pets-stage";
    const STYLE_ID = "dsh-quota-pets-style";
    const CUSTOM_MAX_BYTES = 1_500_000;
    /** done animation is held ~3s before returning to idle (contract §2). */
    const DONE_HOLD_MS = 3_000;
    /** a run must last at least this long for a falling edge to count as done. */
    const MIN_RUN_MS = 4_000;
    /** no activity for this long → sleeping. */
    const SLEEP_AFTER_MS = 10 * 60_000;
    const ACTIVITIES = ["idle", "working", "done", "error", "sleeping"];

    /** 家底清单 + default 神秘宠（模型没匹配上时的兜底）。 */
    const PROVIDER_UI = {
      glm: { id: "glm", label: "GLM", match: /zai|bigmodel|zhipu|glm/i, color: "#8B7CF6", animal: "猫头鹰博士" },
      minimax: { id: "minimax", label: "MiniMax", match: /minimax|minimaxi|abab/i, color: "#FF7DA0", animal: "小仓鼠" },
      kimi: { id: "kimi", label: "Kimi", match: /kimi|moonshot/i, color: "#F5C445", animal: "月兔" },
      deepseek: { id: "deepseek", label: "DeepSeek", match: /deepseek/i, color: "#4D6BFE", animal: "小鲸鱼" },
      default: { id: "default", label: "?", match: /(?:)/, color: "#8E8E93", animal: "神秘宠" },
    };
    const PROVIDER_IDS = Object.keys(PROVIDER_UI).filter(function (id) { return id !== "default"; });

    // ---- persisted state ------------------------------------------------------

    /** { pos: {x,y}|null, size: px, custom: {id:dataUrl} } — pos/size shared by all pets */
    const state = loadState();

    function loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          // v2: pos/size are global; reject legacy per-pet maps ({id:{x,y}}) so they fall back to defaults
          const posOk = parsed.pos && Number.isFinite(parsed.pos.x) && Number.isFinite(parsed.pos.y);
          const sizeOk = Number.isFinite(Number(parsed.size)) && Number(parsed.size) > 0;
          return {
            pos: posOk ? { x: parsed.pos.x, y: parsed.pos.y } : null,
            size: sizeOk ? Number(parsed.size) : 0,
            custom: parsed.custom && typeof parsed.custom === "object" ? parsed.custom : {},
          };
        }
      } catch (_) {}
      return { pos: null, size: 0, custom: {} };
    }

    function saveState() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (cause) {
        toast("保存设置失败（localStorage 满？）：自定义大图建议放进插件 assets/ 目录用宿主伺服", "err");
      }
    }

    // ---- built-in placeholder art (temporary actors until real art lands) -----

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
      /** 神秘宠：没匹配上模型时的兜底剪影。 */
      default: svgUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150">
  <ellipse cx="60" cy="144" rx="24" ry="4" fill="rgba(142,142,147,.18)"/>
  <circle cx="60" cy="62" r="34" fill="#6E6E73"/>
  <circle cx="60" cy="64" r="28" fill="#B9B9BE"/>
  <path d="M32 60 A28 28 0 0 1 88 60 L88 64 Q60 74 32 64 Z" fill="#8E8E93"/>
  <circle cx="50" cy="60" r="7" fill="#3A3A3E"/><circle cx="70" cy="60" r="7" fill="#3A3A3E"/>
  <text x="60" y="64" font-size="11" fill="#E8E8ED" text-anchor="middle" font-family="monospace">?</text>
  <ellipse cx="44" cy="70" rx="4.2" ry="2.4" fill="#FFB3B3" opacity=".7"/><ellipse cx="76" cy="70" rx="4.2" ry="2.4" fill="#FFB3B3" opacity=".7"/>
  <path d="M55 73 Q60 77 65 73" stroke="#8E8E93" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="M46 96 L74 96 L80 128 L40 128 Z" fill="#5A5A5E"/>
  <rect x="47" y="128" width="8" height="10" rx="4" fill="#B9B9BE"/><rect x="65" y="128" width="8" height="10" rx="4" fill="#B9B9BE"/>
  <path d="M46 100 q-9 6 -7 17" stroke="#5A5A5E" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M74 100 q9 6 7 17" stroke="#5A5A5E" stroke-width="7" fill="none" stroke-linecap="round"/>
</svg>`),
    };

    function svgUri(markup) {
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup.replace(/\s+/g, " ").trim());
    }

    // ---- styles ---------------------------------------------------------------
    // Pose-related animation lives in the art now (per-state WebP/APNG).
    // CSS keeps only: float for STATIC sources, overlay filters (pressure),
    // working glow, hop, and UI chrome. No rotation poses in code anymore.

    const CSS = [
      "#" + STAGE_ID + "{position:fixed;inset:0;pointer-events:none;z-index:9998}",
      ".qp-pet{position:absolute;pointer-events:auto;display:flex;flex-direction:column;align-items:center;user-select:none;-webkit-user-select:none;line-height:1;transition:opacity .25s ease}",
      ".qp-pet.qp-away{opacity:0 !important;pointer-events:none}",
      ".qp-fig{position:relative;cursor:grab;transition:filter .3s,opacity .3s;will-change:transform}",
      ".qp-fig.qp-static{animation:qp-float 3.2s ease-in-out infinite}",
      ".qp-fig:active{cursor:grabbing}",
      ".qp-fig.qp-dragging{animation:none !important;cursor:grabbing;z-index:2}",
      ".qp-img{display:block;width:100%;height:auto;image-rendering:auto;pointer-events:none}",
      ".qp-fig.qp-working.qp-static{animation:qp-type .34s ease-in-out infinite}",
      ".qp-fig.qp-working .qp-img{filter:drop-shadow(0 0 9px rgba(255,214,102,.95)) drop-shadow(0 0 3px rgba(255,255,255,.8))}",
      ".qp-fig.qp-pressure-critical .qp-img{filter:grayscale(.75) brightness(.93)}",
      ".qp-fig.qp-pressure-ghost{opacity:.35}",
      ".qp-fig.qp-pressure-ghost .qp-img{filter:grayscale(1)}",
      ".qp-fig.qp-pressure-unknown{opacity:.85}",
      ".qp-fig.qp-hop{animation:qp-hop .55s ease-out 2 !important}",
      "@keyframes qp-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}",
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

    const reducedMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ---- data sources: quota (dsh-quota-hub) + assets + host events -----------

    const runtime = {
      quota: null,
      quotaError: null,
      health: null, // { ok, base, pets: { petId: { state: { anim:{file,v}, static:{file,v} } } } }
      activeProviders: [], // providers matched for the current session's model
      running: false,
      sessionId: null,
      // activity state machine
      errorHold: false,
      doneUntil: 0,
      lastInteraction: Date.now(),
      prevRunning: false,
      runStart: 0,
      runSession: null,
      hostOutcome: null, // { kind:'done'|'error', at, seq } from events.json
      debugState: null, // developer preview override
      refreshing: false,
      pets: {},
      failedSrcs: {},
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
        runtime.health = null; // host side not loaded: placeholders only
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

    /** Poll the host-aggregated run outcome for the current session (2s). */
    async function pollEvents() {
      if (!runtime.sessionId) return;
      try {
        const payload = await fetchJson(PET_BASE + "/events.json?session=" + encodeURIComponent(runtime.sessionId));
        const s = payload && payload.session;
        if (!s) return;
        if (s.outcome === "done" || s.outcome === "error") {
          runtime.hostOutcome = { kind: s.outcome, at: s.outcomeAt || 0, seq: s.seq || 0 };
          applyHostOutcome();
        }
      } catch (_) {
        // events feed unavailable on old hosts; spy fallback covers done
      }
    }

    /** Host outcome wins over the client's falling-edge guess. */
    function applyHostOutcome() {
      const o = runtime.hostOutcome;
      if (!o || runtime.running) return; // stale (a new run is live)
      if (o.kind === "error") {
        runtime.errorHold = true;
        runtime.doneUntil = 0;
      } else if (o.at > Date.now() - DONE_HOLD_MS) {
        runtime.doneUntil = Math.max(runtime.doneUntil, Date.now() + DONE_HOLD_MS);
        runtime.errorHold = false;
      }
      renderAll();
    }

    function noteInteraction() {
      runtime.lastInteraction = Date.now();
    }

    /** running edge tracking (spy is the fast source; host events refine outcome) */
    function noteRunning(running) {
      if (running) {
        runtime.errorHold = false;
        runtime.doneUntil = 0;
        runtime.runStart = Date.now();
        runtime.runSession = runtime.sessionId;
        noteInteraction();
      } else if (
        runtime.prevRunning &&
        runtime.runSession === runtime.sessionId &&
        Date.now() - runtime.runStart >= MIN_RUN_MS
      ) {
        // provisional done; pollEvents may still upgrade this to error
        if (!runtime.errorHold) runtime.doneUntil = Date.now() + DONE_HOLD_MS;
      }
      runtime.prevRunning = running;
    }

    /** activity dimension — docs/pet-contract.md §2 priority order. */
    function deriveActivity() {
      if (runtime.debugState) return runtime.debugState;
      if (runtime.running) return "working";
      if (runtime.errorHold) return "error";
      if (Date.now() < runtime.doneUntil) return "done";
      if (Date.now() - runtime.lastInteraction > SLEEP_AFTER_MS) return "sleeping";
      return "idle";
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

    /** pressure dimension (quota overlay): badge + filter + bubble text. */
    function pressureView(petId) {
      const ui = PROVIDER_UI[petId];
      const view = { pressure: "unknown", bubble: "", bubbleAuto: false, tagDetail: "—" };
      if (petId === "default") {
        view.bubble = "神秘宠：当前模型没有匹配到任何一家 Coding Plan";
        view.tagDetail = "?";
        return view;
      }
      if (runtime.quotaError && !runtime.quota) {
        view.bubble = ui.label + "：连不上 dsh-quota-hub（" + runtime.quotaError + "）";
        return view;
      }
      const snapshot = snapshotOf(petId);
      if (!snapshot) {
        view.bubble = ui.label + "：额度监控没有返回这一家";
        return view;
      }
      if (snapshot.disabled === true) {
        view.pressure = "ghost";
        view.bubble = ui.label + "：已在额度监控里停用";
        view.tagDetail = "停用";
        return view;
      }
      if (snapshot.needsKey) {
        view.pressure = "ghost";
        view.bubble = ui.label + "：还没配 Key，查不了额度";
        view.tagDetail = "无Key";
        return view;
      }
      if (snapshot.ok !== true) {
        view.pressure = "unknown";
        view.bubble = ui.label + "：" + String(snapshot.error || "查询失败");
        view.tagDetail = "?";
        return view;
      }
      const worst = worstView(snapshot);
      const used = worst ? worst.usedPercent : null;
      view.usedPercent = typeof used === "number" ? used : null;
      view.pressure = severityOf(used);
      view.tagDetail = view.usedPercent === null ? "n/a" : (Math.round(view.usedPercent * 10) / 10).toFixed(1) + "%";
      const lines = [ui.label + " 已用 " + (view.usedPercent === null ? "未知" : view.tagDetail)];
      if (worst && worst.title) lines.push(worst.title + "窗口");
      const reset = worst ? countdown(worst.resetAt) : "";
      if (reset) lines.push(reset);
      view.bubble = lines.join(" · ");
      if (view.pressure === "critical") {
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

    // ---- asset resolution (contract §4 fallback chain) -------------------------

    /** Which pet is on stage right now (single seam: model → petId). */
    function activePetId() {
      return runtime.activeProviders.length > 0 ? runtime.activeProviders[0] : "default";
    }

    function petAssets(petId) {
      const health = runtime.health;
      const pets = health && typeof health === "object" && health.pets && typeof health.pets === "object" ? health.pets : null;
      return pets ? pets[petId] || null : null;
    }

    function assetUrl(petId, entry, extra) {
      return PET_BASE + "/avatar/" + encodeURIComponent(petId) + "/" + encodeURIComponent(entry.file) + "?v=" + (entry.v || 0) + (extra || "");
    }

    /**
     * Resolve <petId, activity> to a displayable source.
     * Chain: custom preview > <state>.anim > <state>.static > idle.anim >
     * idle.static > built-in SVG. reduced-motion goes static-first.
     * Returns { src, animated, remountKey }.
     */
    function avatarSrcFor(petId, activity) {
      const custom = state.custom[petId];
      if (custom && !failed(petId, custom)) return { src: custom, animated: false, remountKey: 0 };
      const assets = petAssets(petId);
      if (assets) {
        const states = reducedMotion ? [activity, "idle"] : [activity, activity, "idle"];
        // pass 0: animated for the state; pass 1: static for the state; pass 2: idle
        for (let pass = 0; pass < 3; pass += 1) {
          const st = states[pass];
          const entry = assets[st];
          if (!entry) continue;
          const pick = function (slot) {
            const e = entry[slot];
            if (e && !failed(petId, e.file)) return { url: assetUrl(petId, e), animated: slot === "anim" };
            return null;
          };
          if (reducedMotion) {
            const s = pick("static");
            if (s) return { src: s.url, animated: false, remountKey: 0 };
          } else if (pass === 0) {
            const a = pick("anim");
            if (a) return { src: a.url, animated: true, remountKey: 0 };
          } else {
            const s = pick("static");
            if (s) return { src: s.url, animated: false, remountKey: 0 };
            if (pass === 2) {
              const a = pick("anim");
              if (a) return { src: a.url, animated: true, remountKey: 0 };
            }
          }
        }
      }
      return { src: PLACEHOLDERS[petId] || PLACEHOLDERS.default, animated: false, remountKey: 0 };
    }

    function failed(petId, src) {
      const set = runtime.failedSrcs[petId];
      return set !== undefined && set.has(src);
    }

    function markFailed(petId, src) {
      if (src.indexOf("data:") === 0) return; // placeholders never "fail"
      (runtime.failedSrcs[petId] = runtime.failedSrcs[petId] || new Set()).add(src);
      renderAll();
    }

    // ---- pet DOM ----------------------------------------------------------------

    const DEFAULT_SIZE = 88;
    const SIZES = [64, 88, 112];

    function petSize() {
      return state.size > 0 ? state.size : DEFAULT_SIZE;
    }

    /** 默认布局：右下角单只驻点（同一时刻只显示当前模型那只）。 */
    function defaultPos() {
      const size = petSize();
      return {
        x: Math.max(8, window.innerWidth - size - 26),
        y: Math.max(8, window.innerHeight - 172),
      };
    }

    function ensurePet(petId) {
      const ui = PROVIDER_UI[petId];
      let pet = runtime.pets[petId];
      if (pet) return pet;
      pet = { id: petId, root: null, img: null, hover: false, dragging: false, away: true, awayTimer: null, lastStateKey: "", remount: 0 };
      runtime.pets[petId] = pet;

      const root = document.createElement("div");
      root.className = "qp-pet";
      root.dataset.pet = petId;
      // start hidden: only the active pet's render path ever shows a node
      // (inactive pets never receive left/top or an img src, so they must
      // not linger visible at the stage's top-left origin)
      root.style.display = "none";

      const bubble = document.createElement("div");
      bubble.className = "qp-bubble";

      const fig = document.createElement("div");
      fig.className = "qp-fig";

      const img = document.createElement("img");
      img.className = "qp-img";
      img.alt = ui.label + " 桌宠";
      img.draggable = false;
      img.addEventListener("error", function () {
        markFailed(petId, img.getAttribute("src") || "");
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

      root.addEventListener("mouseenter", function () { pet.hover = true; syncBubble(pet); });
      root.addEventListener("mouseleave", function () { pet.hover = false; syncBubble(pet); });

      root.addEventListener("click", function (event) {
        if (pet.dragging || event.detail === 0) return;
        noteInteraction();
        void refreshQuotaNow();
        fig.classList.remove("qp-hop");
        void fig.offsetWidth;
        fig.classList.add("qp-hop");
      });

      root.addEventListener("contextmenu", function (event) {
        event.preventDefault();
        openMenu(event.clientX, event.clientY, petId);
      });

      // drag (pointer capture; 4px threshold separates click from drag)
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
            noteInteraction();
          }
          if (moved) {
            root.style.left = clampX(base.x + dx, petSize()) + "px";
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
            state.pos = { x: root.offsetLeft, y: root.offsetTop };
            saveState();
          }
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

    function clampX(x, size) {
      return Math.min(Math.max(4, x), Math.max(4, window.innerWidth - size - 4));
    }

    function clampY(y) {
      return Math.min(Math.max(4, y), window.innerHeight - 60);
    }

    const PRESSURE_COLOR = {
      ok: "var(--dsw-alias-state-success-primary,#46a758)",
      warn: "var(--dsw-alias-state-warn-primary,#f5a524)",
      critical: "var(--dsw-alias-state-error-primary,#e5484d)",
      unknown: "var(--dsw-alias-state-idle-primary,#8e8e93)",
      ghost: "var(--dsw-alias-state-idle-primary,#8e8e93)",
    };

    const ACTIVITY_BADGE = { working: "⚡", error: "❌", done: "✅", sleeping: "💤" };
    const PRESSURE_BADGE = { critical: "💧", warn: "⚠️", ghost: "💤", unknown: "❓" };

    function badgeFor(activity, pressure) {
      return ACTIVITY_BADGE[activity] || PRESSURE_BADGE[pressure] || "";
    }

    function syncBubble(pet) {
      const view = pressureView(pet.id);
      pet.root.classList.toggle("qp-show-bubble", pet.hover || view.bubbleAuto);
      pet.bubble.classList.toggle("qp-auto", view.bubbleAuto && !pet.hover);
      pet.bubble.textContent = view.bubble;
    }

    function renderPet(petId) {
      const ui = PROVIDER_UI[petId];
      const pet = ensurePet(petId);
      const active = petId === activePetId();

      // display rule: only the active model's pet (default pet when unmatched)
      if (!active) {
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
        void pet.root.offsetWidth; // start transparent, then fade in
        noteInteraction();
      }
      pet.root.classList.remove("qp-away");

      const size = petSize();
      const pos = state.pos || defaultPos();
      pet.root.style.width = size + "px";
      pet.root.style.left = clampX(pos.x, size) + "px";
      pet.root.style.top = clampY(pos.y) + "px";

      const activity = deriveActivity();
      const pressure = pressureView(petId);

      // image: one-shot states (done/error) remount to replay their animation
      const source = avatarSrcFor(petId, activity);
      const oneshot = activity === "done" || activity === "error";
      const stateKey = activity + "|" + source.src;
      if (pet.lastStateKey !== stateKey) {
        if (oneshot && pet.lastStateKey.split("|")[0] === activity) pet.remount += 1; // replay same file
        pet.lastStateKey = stateKey;
        const bust = oneshot ? "&rk=" + pet.remount : "";
        pet.img.setAttribute("src", source.src + (source.src.indexOf("data:") === 0 || !bust ? "" : bust));
      }

      // state classes: float/typing only for STATIC sources (animated art
      // supplies its own motion); pressure = filter only; no poses in code.
      const figClass =
        "qp-fig" +
        (source.animated ? "" : " qp-static") +
        (activity === "working" ? " qp-working" : "") +
        (pressure.pressure === "critical" ? " qp-pressure-critical" : "") +
        (pressure.pressure === "ghost" ? " qp-pressure-ghost" : "") +
        (pressure.pressure === "unknown" ? " qp-pressure-unknown" : "");
      if (pet.fig.className !== figClass) pet.fig.className = figClass;

      pet.badge.textContent = badgeFor(activity, pressure.pressure);

      // name tag
      pet.dot.style.background = ui.color;
      pet.detail.textContent = activity === "idle" || activity === "working" ? pressure.tagDetail : activity;
      pet.detail.style.color =
        activity === "error"
          ? PRESSURE_COLOR.critical
          : activity === "done"
            ? PRESSURE_COLOR.ok
            : PRESSURE_COLOR[pressure.pressure] || PRESSURE_COLOR.unknown;
      pet.root.classList.toggle("qp-hidden-tag", pressure.pressure === "ghost" || pressure.pressure === "unknown");

      syncBubble(pet);
    }

    function renderAll() {
      if (!runtime.petsStage) return;
      const ids = PROVIDER_IDS.concat(["default"]);
      for (const id of ids) renderPet(id);
    }

    // ---- context menu / toast ------------------------------------------------------

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

    function openMenu(x, y, petId) {
      closeMenu();
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

      noteInteraction();
      item("临时预览形象…（刷新前有效）", { hint: "正式形象放插件 assets/<宠物>/ 目录" }, function () { pickCustom(petId); });
      item("恢复默认形象", { disabled: !state.custom[petId] }, function () {
        delete state.custom[petId];
        delete runtime.failedSrcs[petId];
        saveState();
        renderAll();
      });
      const sizeNow = petSize();
      const nextSize = SIZES[(SIZES.indexOf(sizeNow) + 1) % SIZES.length] || DEFAULT_SIZE;
      item("大小：" + sizeNow + "px → " + nextSize + "px", null, function () {
        state.size = nextSize;
        state.pos = null; // resize returns to the default spot
        saveState();
        renderAll();
      });
      sep();
      item("重置位置（回到右下角）", null, function () {
        state.pos = null;
        saveState();
        renderAll();
      });
      sep();
      const dbg = runtime.debugState
        ? "开发者：状态预览（" + runtime.debugState + "）→ 下一个"
        : "开发者：循环状态预览（idle 起）";
      item(dbg, null, function () {
        if (!runtime.debugState) runtime.debugState = "idle";
        else {
          const idx = ACTIVITIES.indexOf(runtime.debugState);
          runtime.debugState = idx >= 0 && idx < ACTIVITIES.length - 1 ? ACTIVITIES[idx + 1] : null;
        }
        toast(runtime.debugState ? "状态预览：" + runtime.debugState : "状态预览关闭", "");
        renderAll();
      });
      item("开发者：诊断信息", null, function () {
        const diag =
          "v=" + CLIENT_DIAG_VERSION +
          " model=" + diagLastModel + " via=" + diagLastVia +
          " sid=" + (runtime.sessionId || "-") +
          " services[sessions=" + (!!sessionsService) + ",modelDirectories=" + (!!modelDirectoriesService) + "]" +
          " active=[" + runtime.activeProviders.join(",") + "]";
        console.info("[dsh-quota-pets] " + diag);
        dumpDiag("menu", runtime.lastOwnerProps || null);
        toast("诊断已打印到控制台", diag);
      });
      item("关于 dsh-quota-pets", null, function () {
        toast("额度桌宠 · 只显示当前模型 · 额度复用 dsh-quota-hub · 形象放 assets/<宠物>/ 目录", "");
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

    function pickCustom(petId) {
      if (!fileInput) {
        fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/png,image/gif,image/webp,image/jpeg,image/svg+xml,image/apng";
        fileInput.style.display = "none";
        document.body.appendChild(fileInput);
        fileInput.addEventListener("change", function () {
          const file = fileInput.files && fileInput.files[0];
          fileInput.value = "";
          if (!file || !fileInput.dataset.pet) return;
          const id = fileInput.dataset.pet;
          if (file.size > CUSTOM_MAX_BYTES) {
            toast("图片太大（" + Math.round(file.size / 1024) + "KB，上限 1.5MB）。正式形象请放 assets/<宠物>/ 目录", "err");
            return;
          }
          const reader = new FileReader();
          reader.onload = function () {
            state.custom[id] = String(reader.result);
            delete runtime.failedSrcs[id];
            saveState();
            renderAll();
            toast(PROVIDER_UI[id].label + " 临时换上预览形象（刷新页面后失效）");
          };
          reader.onerror = function () { toast("读取图片失败", "err"); };
          reader.readAsDataURL(file);
        });
      }
      fileInput.dataset.pet = petId;
      fileInput.click();
    }

    // ---- current-session model spy (invisible dock component + sessions) -------

    let sessionsService = null;
    // ctx.modelDirectories (from @deepseek-ai/dsh-client-ui-model-selection): the same
    // per-session source the composer model seat uses. Its snapshot falls back to the
    // catalog default when the session's modelSelection face is empty — which is exactly
    // the state of a brand-new standard-mode conversation (create mode writes face.next
    // at session creation, standard mode does not).
    let modelDirectoriesService = null;

    let diagLastModel = "-";
    let diagLastVia = "-";

    function rememberSessions(candidate) {
      if (candidate && typeof candidate.binding === "function") {
        if (!sessionsService) console.debug("[dsh-quota-pets] service sessions: acquired");
        sessionsService = candidate;
      }
    }

    function rememberModelDirectories(candidate) {
      if (candidate && typeof candidate.directoryFor === "function") {
        if (!modelDirectoriesService) console.debug("[dsh-quota-pets] service modelDirectories: acquired");
        modelDirectoriesService = candidate;
      }
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

    function sessionSnapshotId(ownerProps) {
      const session = ownerProps && typeof ownerProps === "object" && ownerProps.session && typeof ownerProps.session === "object" ? ownerProps.session : null;
      if (ownerProps && typeof ownerProps.sessionId === "string") return ownerProps.sessionId;
      if (session && typeof session.sessionId === "string") return session.sessionId;
      if (session && typeof session.id === "string") return session.id;
      return null;
    }

    function safeJson(v) {
      try {
        const t = JSON.stringify(v, function (k, val) {
          return typeof val === "function" ? "<fn>" : val;
        });
        return t === undefined ? String(v) : t.length > 900 ? t.slice(0, 900) + "…" : t;
      } catch (e) {
        return "<unserializable: " + (e && e.message) + ">";
      }
    }

    function dumpDiag(tag, ownerProps) {
      const session = ownerProps && ownerProps.session;
      let faceSnap = null;
      try {
        const face = session && session.projections && typeof session.projections.faceOf === "function" ? session.projections.faceOf("modelSelection") : null;
        faceSnap = face && typeof face.getSnapshot === "function" ? face.getSnapshot() : String(face);
      } catch (e) {
        faceSnap = "<face threw: " + (e && e.message) + ">";
      }
      let dirSnap = null;
      try {
        const sid = sessionSnapshotId(ownerProps);
        if (modelDirectoriesService && sid) {
          const dir = modelDirectoriesService.directoryFor(sid);
          dirSnap = dir && typeof dir.getSnapshot === "function" ? dir.getSnapshot() : String(dir);
        } else {
          dirSnap = modelDirectoriesService ? "<no sid>" : "<no service>";
        }
      } catch (e) {
        dirSnap = "<directory threw: " + (e && e.message) + ">";
      }
      console.info(
        "[dsh-quota-pets] diag " + tag +
        " ownerPropsKeys=" + (ownerProps ? Object.keys(ownerProps).join("|") : "-") +
        " sessionKeys=" + (session ? Object.keys(session).slice(0, 25).join("|") : "-") +
        "\n  faceSnap=" + safeJson(faceSnap) +
        "\n  dirSnap=" + safeJson(dirSnap),
      );
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
        if (m) return { provider: m.provider, name: m.name, face: face, directory: null, via: "face" };
      }
      const sessionId = sessionSnapshotId(ownerProps);
      if (sessionsService && sessionId) {
        try {
          const binding = sessionsService.binding(sessionId);
          face = binding && binding.session && binding.session.projections && typeof binding.session.projections.faceOf === "function" ? binding.session.projections.faceOf("modelSelection") : null;
          if (face) {
            const m = faceSelection(face);
            if (m) return { provider: m.provider, name: m.name, face: face, directory: null, via: "face" };
          }
        } catch (_) {}
      }
      if (modelDirectoriesService && sessionId) {
        try {
          const dir = modelDirectoriesService.directoryFor(sessionId);
          if (dir && typeof dir.getSnapshot === "function") {
            const snap = dir.getSnapshot();
            const m = modelFromSelection(snap && snap.current);
            if (m) return { provider: m.provider, name: m.name, face: null, directory: dir, via: "directory" };
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
      if (direct) return { provider: direct.provider, name: direct.name, face: null, directory: null, via: "direct" };
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

    /** Invisible spy on the composer dock: reports model + running + sessionId. */
    function makeModelSpy(reactLib) {
      return function ModelSpy(ownerProps) {
        const detected = detectModel(ownerProps);
        const face = detected ? detected.face : null;
        const directory = detected ? detected.directory : null;
        const tick = reactLib.useState(0);
        const setTick = tick[1];
        reactLib.useEffect(
          function () {
            // subscribe to BOTH when available: a blank session's face stays empty
            // while the composer records the user's pick in the directory store, so
            // face-only subscription misses model switches before the first query.
            const sources = [face, directory].filter(function (x) {
              return x && typeof x.subscribe === "function";
            });
            if (sources.length === 0) return undefined;
            let alive = true;
            const disposes = sources.map(function (target) {
              return target.subscribe(function () {
                if (alive) setTick(function (n) { return n + 1; });
              });
            });
            return function () {
              alive = false;
              disposes.forEach(function (dispose) {
                if (typeof dispose === "function") dispose();
              });
            };
          },
          [face, directory],
        );
        // while detection fails, retry on a slow timer — covers services that
        // arrive after mount and any missed subscription
        reactLib.useEffect(
          function () {
            if (detected) return undefined;
            const h = setInterval(function () {
              setTick(function (n) { return n + 1; });
            }, 5000);
            return function () {
              clearInterval(h);
            };
          },
          [detected ? 1 : 0],
        );
        // hooks must run unconditionally — early returns live below this line
        const active = matchedProviders(detected);
        const session = ownerProps && ownerProps.session && typeof ownerProps.session === "object" ? ownerProps.session : null;
        const running = !!(session && session.running === true);
        const sessionId = sessionSnapshotId(ownerProps) || null;
        let dirty = false;
        if (active.join(",") !== runtime.activeProviders.join(",")) {
          runtime.activeProviders = active;
          dirty = true;
        }
        if (running !== runtime.running) {
          noteRunning(running);
          runtime.running = running;
          dirty = true;
        }
        if (sessionId && sessionId !== runtime.sessionId) {
          runtime.sessionId = sessionId;
          runtime.hostOutcome = null;
          dirty = true;
        }
        runtime.lastOwnerProps = ownerProps;
        const diagModel = detected ? detected.provider + "/" + detected.name : "null";
        const diagVia = detected ? detected.via || "?" : "none";
        const diagSid = sessionId || "-";
        if (diagModel !== diagLastModel || diagVia !== diagLastVia) {
          diagLastModel = diagModel;
          diagLastVia = diagVia;
          console.debug("[dsh-quota-pets] spy sid=" + diagSid + " model=" + diagModel + " via=" + diagVia + " services[sessions=" + (!!sessionsService) + ",modelDirectories=" + (!!modelDirectoriesService) + "]");
        }
        if (dirty) queueMicrotask(renderAll);
        return null;
      };
    }

    // ---- boot ---------------------------------------------------------------------

    let started = false;

    function boot() {
      if (started) return;
      started = true;
      // After a generation swap (install without a host restart) a page
      // refresh injects BOTH the old and the new client bundle — two module
      // instances, two stages, duplicated pets. Last-loaded wins: tear down
      // any stage/style a stale instance mounted, then mount ours (the stale
      // instance keeps writing to detached nodes, which is harmless).
      const staleStage = document.getElementById(STAGE_ID);
      if (staleStage) staleStage.remove();
      const staleStyle = document.getElementById(STYLE_ID);
      if (staleStyle) staleStyle.remove();
      console.debug("[dsh-quota-pets] client " + CLIENT_DIAG_VERSION + " boot");
      ensureStyle();

      const stage = document.createElement("div");
      stage.id = STAGE_ID;
      document.body.appendChild(stage);
      runtime.petsStage = stage;

      const ids = PROVIDER_IDS.concat(["default"]);
      for (const id of ids) ensurePet(id);
      renderAll();

      void pollQuota();
      void pollHealth();
      setInterval(function () {
        if (document.visibilityState !== "visible") return;
        void pollQuota();
        void pollHealth();
        void pollEvents();
      }, POLL_MS);
      // faster cadence while a run is live (or just finished) so done/error land promptly
      setInterval(function () {
        if (document.visibilityState === "visible" && (runtime.running || Date.now() < runtime.doneUntil + 2_000 || runtime.errorHold)) {
          void pollEvents();
        }
      }, EVENTS_POLL_MS);
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") {
          void pollQuota();
          void pollHealth();
          void pollEvents();
        }
      });
      window.addEventListener("resize", function () {
        for (const id of ids) {
          const pet = runtime.pets[id];
          if (!pet || pet.root.style.display === "none") continue;
          pet.root.style.left = clampX(pet.root.offsetLeft, petSize()) + "px";
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

      // sessions + modelDirectories services (data sources for detectModel) — non-fatal
      if (ctx && typeof ctx.inject === "function") {
        try {
          ctx.inject(["sessions"], function (ready) {
            rememberSessions(ready && ready.sessions ? ready.sessions : ready);
          });
        } catch (_) {}
        try {
          if (typeof ctx.get === "function") rememberSessions(ctx.get("sessions"));
        } catch (_) {}
        try {
          ctx.inject(["modelDirectories"], function (ready) {
            rememberModelDirectories(ready && ready.modelDirectories ? ready.modelDirectories : ready);
          });
        } catch (_) {}
        try {
          if (typeof ctx.get === "function") rememberModelDirectories(ctx.get("modelDirectories"));
        } catch (_) {}
      }

      // invisible dock spy: current session model + running + sessionId
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
