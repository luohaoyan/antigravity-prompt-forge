/**
 * Antigravity Composer Prompt Optimize Widget (v1.4.0 — 性能安全版)
 *
 * 移植自 CodexPlusPlusScriptMarket:
 * - scripts/prompt-optimize.js (v1.0.4 by Codex++ Community)
 * - scripts/prompt-enhancement.js (v1.0.1 by Meowv)
 *
 * v1.3.0 -> v1.4.0 修复的致命问题（曾导致窗口全黑、渲染进程卡死）:
 * 1) 删除 setInterval(ensureHostAndButton, 800) 轮询 —— 原来每秒 1.25 次全文档 querySelectorAll 扫描 + 每个候选元素 getBoundingClientRect 强制重排；
 * 2) 不再自建第二个 MutationObserver —— 原来与汉化器 i18n_runner.js 的 childList/subtree observer 互相触发，
 *    形成"汉化改写 -> widget observer -> widget 改 DOM -> 汉化 observer -> ..."的活锁；
 *    改为复用 window.__AG_PROMPT_OPTIMIZE_SCHEDULE 钩子（由 i18n_runner 提供），在汉化器自己的节流队列里被动唤醒；
 * 3) 所有布局读取只用"单次 geometry epoch 缓存"(同一个 tick 内 boxRect/buttonRect 只测一次)，
 *    不再对 composer 内每个 button 逐个 getBoundingClientRect；
 * 4) 定位改用 ResizeObserver + IntersectionObserver + scroll/resize 的 passive 监听（rAF 合并），
 *    只跟随输入框，不做全文档扫描；
 * 5) 任何一次调度都在 requestIdleCallback(<=120ms, timeout 400) 或 rAF 里执行，主线程永不被同步阻塞。
 *
 * 功能与 v1.3.0 完全一致：
 * - 左键 [✨ 增强]：调用外部 LLM 改写底部输入框草稿；再点 [↩ 还原] 恢复原文；
 * - 右键 [✨ 增强]：可视化设置面板（OpenAI / Anthropic / Gemini / 任意 OpenAI 兼容端点、模型、4 种风格、自定义 System Prompt、测试连接）；
 * - 未填 API Key 时自动走"内置钩子前缀"模式（写入 ✨:style 前缀，由插件 PreInvocation 钩子增强）。
 *
 * 与插件设置共享：读写 %USERPROFILE%\.gemini\config\plugins\prompt-optimize\data\settings.json
 * （能读到就用插件里已配置的 API Key，读不到则退回 localStorage，完全离线安全）。
 */
(function () {
  "use strict";

  var INSTANCE_KEY = "__antigravityPromptOptimizeV2";
  if (window[INSTANCE_KEY] && typeof window[INSTANCE_KEY].ensure === "function") {
    try { window[INSTANCE_KEY].ensure(); } catch (_e) {}
    return;
  }

  var SETTINGS_KEY = "antigravity.promptOptimize.settings.v2";
  var STYLE_ID = "ag-prompt-optimize-style-v2";
  var HOST_ATTR = "data-ag-prompt-optimize-host";
  var BTN_ATTR = "data-ag-prompt-optimize-btn";
  var PANEL_ATTR = "data-ag-prompt-optimize-panel";
  var TOAST_ATTR = "data-ag-prompt-optimize-toast";
  var MIN_INTERVAL_MS = 120;   // 两次重新定位之间的最小间隔（节流下限）
  var IDLE_TIMEOUT_MS = 400;   // requestIdleCallback 兜底超时

  var DEFAULT_PROMPTS = {
    enhanced:
      "You are a prompt enhancement assistant. Improve the user prompt while preserving its intent and language.\n" +
      "1. Detect the language of the user input and write the enhanced prompt in that exact same language (Chinese input -> Chinese output).\n" +
      "2. Return ONLY the enhanced prompt text; no explanations, prefaces, or markdown fences around the whole answer.\n" +
      "3. Preserve @file references, file paths, URLs, and fenced code blocks unchanged.\n" +
      "4. Clarify task scope, constraints, edge cases, and expected output format.",
    coding:
      "You are a software-engineering prompt editor. Rewrite the user's draft for a coding agent.\n" +
      "Keep the same language as the input.\n" +
      "Make explicit: task, in-scope files/areas, acceptance criteria, non-goals, and verification steps.\n" +
      "Preserve @file references, file paths, URLs, and fenced code blocks unchanged.\n" +
      "Output ONLY the optimized prompt.",
    structured:
      "You are a prompt engineer. Rewrite the user's draft into a structured spec with these sections:\n" +
      "Goal / Context / Requirements / Constraints / Deliverables / Acceptance criteria / Open questions.\n" +
      "Keep the same language as the input. Preserve @file references, paths, URLs and code blocks unchanged.\n" +
      "Output ONLY the structured prompt.",
    concise:
      "You compress prompts. Keep every hard constraint, drop all fluff, keep the original language,\n" +
      "preserve @file references, paths, URLs and code blocks. Output ONLY the compressed prompt."
  };

  var DEFAULT_BASE_URLS = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    gemini: "https://generativelanguage.googleapis.com/v1beta"
  };

  var DEFAULT_MODELS = {
    openai: "gpt-4o-mini",
    anthropic: "claude-haiku-4-5-20251001",
    gemini: "gemini-2.5-flash"
  };

  var state = {
    loading: false,
    mode: "idle",
    originalText: null,
    optimizedText: null,
    abortCtrl: null,
    toastTimer: 0,
    lastSeenText: ""          // 上一帧输入框内容，用于识别"已发送"（非空 → 空）
  };

  // ---------- 调度器：全局唯一，绝不并发重入 ----------
  var schedule = {
    pending: false,
    lastRun: 0,
    timer: 0,
    rafId: 0
  };

  function nowMs() {
    return Date.now();
  }

  function runSafely() {
    schedule.pending = false;
    schedule.lastRun = nowMs();
    try { ensureHostAndButton(); } catch (_e) { /* 永不让异常冒泡进宿主渲染循环 */ }
  }

  function requestEnsure(throttle) {
    var wait = throttle ? Math.max(0, MIN_INTERVAL_MS - (nowMs() - schedule.lastRun)) : 0;
    if (schedule.pending) return;
    schedule.pending = true;
    if (wait <= 0 && typeof window.requestAnimationFrame === "function") {
      schedule.rafId = window.requestAnimationFrame(function () { runSafely(); });
      return;
    }
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(function () { runSafely(); }, { timeout: IDLE_TIMEOUT_MS });
    } else {
      schedule.timer = setTimeout(runSafely, wait || 16);
    }
  }

  // 由 i18n_runner 汉化器的节流队列调用（存在就复用，避免第二套 MutationObserver）
  window.__AG_PROMPT_OPTIMIZE_SCHEDULE = function () { requestEnsure(true); };

  // ---------- 设置 ----------
  function deepMergePrompts(obj) {
    var out = {};
    for (var k in DEFAULT_PROMPTS) out[k] = DEFAULT_PROMPTS[k];
    if (obj && typeof obj === "object") {
      for (var k2 in obj) {
        if (typeof obj[k2] === "string" && obj[k2].trim()) out[k2] = obj[k2];
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // 持久化：localStorage 是「按源(origin)隔离」的，而反重力每次启动都会用随机端口
  // 起本地语言服务器（origin 形如 https://127.0.0.1:<随机端口>），换端口就等于换了
  // 一个全新的 origin，localStorage 读到的是空的 —— 这不是重新登录导致的，而是
  // 每次重启/重连都如此。所以真正的存储必须是「端口无关」的：
  //   window.nativeStorage（preload 暴露）→ 落到 %APPDATA%\Antigravity\app_storage.json
  // 这个文件跟登录态、端口都无关，重新登录后依然存在。
  // localStorage 仍然保留，只当同步缓存用（打开面板时能立即出值，不必等异步）。
  // ---------------------------------------------------------------------------
  var NATIVE_STORAGE_KEY = SETTINGS_KEY;
  var nativeCache = null;         // nativeStorage 里的最新原始 JSON 字符串
  var nativeHydratePromise = null; // 一次性 hydrate 的 promise

  function hasNativeStorage() {
    try {
      var ns = window.nativeStorage;
      return !!(ns && typeof ns.getItems === "function" && typeof ns.updateItems === "function");
    } catch (_e) { return false; }
  }

  function parseSettingsRaw(raw) {
    if (!raw || typeof raw !== "string") return null;
    try {
      var p = JSON.parse(raw);
      return p && typeof p === "object" && !Array.isArray(p) ? p : null;
    } catch (_e) { return null; }
  }

  /** 从 nativeStorage 拉取一次配置，写回 nativeCache + localStorage 缓存。 */
  function hydrateSettings() {
    if (nativeHydratePromise) return nativeHydratePromise;
    if (!hasNativeStorage()) { nativeHydratePromise = Promise.resolve(null); return nativeHydratePromise; }
    nativeHydratePromise = Promise.resolve()
      .then(function () { return window.nativeStorage.getItems(); })
      .then(function (items) {
        if (!items || typeof items !== "object") return null;
        var v = items[NATIVE_STORAGE_KEY];
        if (typeof v !== "string" || !parseSettingsRaw(v)) return null;
        nativeCache = v;
        try { window.localStorage.setItem(SETTINGS_KEY, v); } catch (_e) {}
        return parseSettingsRaw(v);
      })
      .catch(function () { nativeHydratePromise = null; return null; });
    return nativeHydratePromise;
  }

  /** 把当前配置镜像到 nativeStorage（端口无关的持久层）。 */
  function persistSettings(raw) {
    nativeCache = raw;
    if (!hasNativeStorage()) return;
    try {
      var patch = {};
      patch[NATIVE_STORAGE_KEY] = raw;
      void Promise.resolve(window.nativeStorage.updateItems(patch)).catch(function () {});
    } catch (_e) {}
  }

  function loadSettings() {
    var base = {
      protocol: "openai",
      baseUrl: DEFAULT_BASE_URLS.openai,
      apiKey: "",
      model: DEFAULT_MODELS.openai,
      style: "enhanced",
      fallbackPrefixMode: true,
      systemPrompts: deepMergePrompts(null)
    };
    // 读取顺序：nativeStorage 已 hydrate 的值 → localStorage（同端口缓存 / 旧版遗留）→ 宿主注入
    var raw = nativeCache;
    try { if (!raw) raw = window.localStorage.getItem(SETTINGS_KEY); } catch (_e) { raw = null; }
    if (!raw) {
      try {
        var host = window.__AG_PLUGIN_SETTINGS_V1;
        if (host && typeof host === "object") raw = JSON.stringify(host);
      } catch (_e2) { raw = null; }
    }
    if (!raw) return base;
    try {
      var parsed = JSON.parse(raw);
      var merged = Object.assign(base, parsed || {});
      merged.systemPrompts = deepMergePrompts(parsed && parsed.systemPrompts);
      return merged;
    } catch (_e3) {
      return base;
    }
  }

  function saveSettings(next) {
    var raw = null;
    try { raw = JSON.stringify(next); } catch (_e) { raw = null; }
    if (!raw) return;
    // 防护：把已有 API Key 覆盖成空（重新登录 / 面板在 hydrate 完成前被打开时最容易发生）
    // 时，保留旧 Key，避免「配置被清空」。
    try {
      var prev = parseSettingsRaw(nativeCache) || parseSettingsRaw(window.localStorage.getItem(SETTINGS_KEY));
      if (prev && !String(next.apiKey || "").trim() && String(prev.apiKey || "").trim()) {
        next.apiKey = prev.apiKey;
        raw = JSON.stringify(next);
      }
    } catch (_e2) {}
    try { window.localStorage.setItem(SETTINGS_KEY, raw); } catch (_e) {}
    persistSettings(raw);
  }

  // ---------- 样式 ----------
  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      "[" + HOST_ATTR + "] { position: fixed; z-index: 2147483000; display: flex; align-items: center; gap: 4px; pointer-events: auto; }" +
      "[" + BTN_ATTR + "] { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 26px; min-width: 28px; padding: 0 9px;" +
      " border-radius: 999px; border: 1px solid rgba(255,255,255,0.14); background: rgba(39,39,42,0.85); color: #e4e4e7;" +
      " font: 500 12px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; cursor: pointer; user-select: none;" +
      " transition: background .15s ease, border-color .15s ease; box-shadow: 0 2px 8px rgba(0,0,0,0.25); }" +
      "[" + BTN_ATTR + "]:hover { background: rgba(63,63,70,0.95); border-color: rgba(255,255,255,0.3); color: #fff; }" +
      "[" + BTN_ATTR + "][data-state='loading'] { border-color: rgba(96,165,250,0.6); color: #93c5fd; }" +
      "[" + BTN_ATTR + "][data-state='optimized'] { border-color: rgba(74,222,128,0.5); color: #86efac; }" +
      "[" + TOAST_ATTR + "] { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); z-index: 2147483600;" +
      " max-width: min(520px, calc(100vw - 32px)); padding: 9px 14px; border-radius: 10px; background: rgba(24,24,27,0.96);" +
      " border: 1px solid rgba(255,255,255,0.16); color: #f4f4f5; font: 500 12.5px/1.5 system-ui, sans-serif; box-shadow: 0 12px 32px rgba(0,0,0,.5); }" +
      "[" + PANEL_ATTR + "] { position: fixed; inset: 0; z-index: 2147483500; display: grid; place-items: center;" +
      " background: rgba(0,0,0,0.5); backdrop-filter: blur(2px); }" +
      "[" + PANEL_ATTR + "] .ag-card { width: min(540px, calc(100vw - 24px)); max-height: 86vh; overflow: auto; background: #18181b;" +
      " border: 1px solid rgba(255,255,255,0.14); border-radius: 14px; padding: 16px; box-shadow: 0 20px 50px rgba(0,0,0,0.55);" +
      " color: #e4e4e7; font: 13px/1.5 system-ui, sans-serif; }" +
      "[" + PANEL_ATTR + "] .ag-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }" +
      "[" + PANEL_ATTR + "] h3 { margin: 0; font-size: 14px; }" +
      "[" + PANEL_ATTR + "] .ag-x { width: 26px; height: 26px; padding: 0; display: inline-flex; align-items: center;" +
      " justify-content: center; background: transparent; border: 1px solid transparent; border-radius: 6px;" +
      " color: #a1a1aa; font-size: 16px; line-height: 1; }" +
      "[" + PANEL_ATTR + "] .ag-x:hover { background: #3f3f46; color: #fff; border-color: rgba(255,255,255,0.2); }" +
      "[" + PANEL_ATTR + "] .ag-field { display: grid; gap: 4px; margin-bottom: 10px; font-size: 12px; color: #d4d4d8; }" +
      "[" + PANEL_ATTR + "] .ag-inline { display: flex; gap: 6px; align-items: center; }" +
      "[" + PANEL_ATTR + "] .ag-inline select, [" + PANEL_ATTR + "] .ag-inline input { flex: 1 1 auto; min-width: 0; }" +
      "[" + PANEL_ATTR + "] .ag-inline button { flex: 0 0 auto; padding: 7px 10px; white-space: nowrap; }" +
      "[" + PANEL_ATTR + "] label { display: grid; gap: 4px; margin-bottom: 10px; font-size: 12px; color: #d4d4d8; }" +
      "[" + PANEL_ATTR + "] input, [" + PANEL_ATTR + "] select, [" + PANEL_ATTR + "] textarea {" +
      " width: 100%; box-sizing: border-box; border-radius: 8px; border: 1px solid rgba(255,255,255,0.16);" +
      " background: #27272a; color: #f4f4f5; padding: 7px 10px; font: inherit; }" +
      "[" + PANEL_ATTR + "] textarea { font-family: ui-monospace, Consolas, monospace; font-size: 12px; resize: vertical; }" +
      "[" + PANEL_ATTR + "] .ag-row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }" +
      "[" + PANEL_ATTR + "] button { border-radius: 8px; border: 1px solid rgba(255,255,255,0.16); background: #27272a;" +
      " color: #f4f4f5; padding: 7px 14px; font: inherit; cursor: pointer; }" +
      "[" + PANEL_ATTR + "] button[data-act='save'] { background: #2563eb; border-color: #2563eb; }" +
      "[" + PANEL_ATTR + "] .ag-status { margin-top: 8px; font-size: 12px; color: #a1a1aa; word-break: break-all; }";
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function showToast(msg) {
    try {
      var old = document.querySelectorAll("[" + TOAST_ATTR + "]");
      for (var i = 0; i < old.length; i++) old[i].remove();
      var t = document.createElement("div");
      t.setAttribute(TOAST_ATTR, "true");
      t.textContent = msg;
      (document.body || document.documentElement).appendChild(t);
      if (state.toastTimer) clearTimeout(state.toastTimer);
      state.toastTimer = setTimeout(function () { try { t.remove(); } catch (_e) {} }, 2800);
    } catch (_e) {}
  }

  // ---------- DOM 探测（零强制重排：同一 tick 内只测一次） ----------
  var geo = { tick: 0, boxes: null, vh: 0, vw: 0 };

  function beginGeoEpoch() {
    geo.tick++;
    geo.boxes = new Map();
    geo.vh = window.innerHeight || 0;
    geo.vw = window.innerWidth || 0;
  }

  function rectOf(el) {
    if (!el) return null;
    if (geo.boxes && geo.boxes.has(el)) return geo.boxes.get(el);
    var r = el.getBoundingClientRect();
    var box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    if (geo.boxes) geo.boxes.set(el, box);
    return box;
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1 || !el.isConnected) return false;
    if (el.hasAttribute(PANEL_ATTR)) return false;
    var st = window.getComputedStyle(el);
    if (!st) return false;
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    var r = rectOf(el);
    return !!r && r.width > 0 && r.height > 0;
  }

  // 实测反重力 2.31.0 的对话框结构（CDP 采样）：
  //   div[contenteditable=true][data-placeholder="消息输入框"]  (rect 340,707,1290,747, height 40)
  //   └ … 5 层 div 后到 .surface-composer-card  (rect 336,703,1294,783, 内含 5 个 button)
  //   底部工具行 y≈749: [添加上下文][Gemini 4 Hyd…][请求审核][语音录音][Start Voice]
  var INPUT_SELECTORS = [
    "[contenteditable='true'][data-placeholder]",
    "[contenteditable='true'][aria-label*='消息']",
    "[contenteditable='true'][role='textbox']",
    "[contenteditable='true'].ProseMirror",
    "textarea[placeholder*='输入任何问题']",
    "textarea[placeholder*='Ask anything']",
    "[contenteditable='true']",
    "textarea"
  ];
  var COMPOSER_SELECTORS = [
    ".surface-composer-card",
    "[class*='surface-composer']",
    "[class*='composer-card']"
  ];

  function findChatInput() {
    var best = null;
    var bestScore = -1;
    for (var s = 0; s < INPUT_SELECTORS.length; s++) {
      var list = document.querySelectorAll(INPUT_SELECTORS[s]);
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (!isVisible(el)) continue;
        var r = rectOf(el);
        if (r.width < 220 || r.height < 18) continue;
        if (r.bottom < geo.vh * 0.35) continue;   // 只要视口下半部分的输入区
        var ph = (el.getAttribute("placeholder") || "") + " " + (el.getAttribute("aria-label") || "") + " " + (el.getAttribute("data-placeholder") || "");
        var score = r.bottom + (r.width > 360 ? 200 : 0) + (/输入任何问题|Ask anything|引用文件|指令|prompt|message/i.test(ph) ? 400 : 0);
        if (score > bestScore) { bestScore = score; best = el; }
      }
    }
    return best;
  }

  function findComposerBox(inputEl) {
    if (!inputEl) return null;
    // 1) 反重力自带类名优先（最稳，且一定是含工具行的卡片）
    for (var s = 0; s < COMPOSER_SELECTORS.length; s++) {
      var hit = null;
      try { hit = inputEl.closest(COMPOSER_SELECTORS[s]); } catch (_e) {}
      if (!hit) {
        var list = document.querySelectorAll(COMPOSER_SELECTORS[s]);
        for (var q = 0; q < list.length; q++) {
          if (list[q].contains(inputEl)) { hit = list[q]; break; }
        }
      }
      if (hit) return hit;
    }
    // 2) 兜底：向上找到同时"包含输入框 + 至少 2 个 button"的最近祖先
    var cur = inputEl.parentElement;
    for (var i = 0; cur && cur !== document.body && i < 10; i++, cur = cur.parentElement) {
      var r = rectOf(cur);
      if (!r || r.width < 280) continue;
      if (cur.querySelectorAll("button, [role='button']").length >= 2) return cur;
    }
    return inputEl.parentElement;
  }

  // 在 composer 卡片内找"最底部工具行里最靠左的可见按钮"（反重力里就是 [请求审核]），
  // 把 ✨ 增强 按钮插在它左边，视觉上就是"对话框内右下角"。
  function findRightAnchorButton(box) {
    if (!box) return null;
    var boxRect = rectOf(box);
    if (!boxRect) return null;
    var candidates = box.querySelectorAll("button, [role='button']");
    var rowBottom = -Infinity;
    var rowItems = [];
    for (var i = 0; i < candidates.length; i++) {
      var b = candidates[i];
      if (b.hasAttribute(BTN_ATTR)) continue;
      if (b.closest("[" + PANEL_ATTR + "]")) continue;
      var r = rectOf(b);
      if (!r || r.width <= 0 || r.height <= 0) continue;
      if (r.left < boxRect.left + 4 || r.right > boxRect.right + 4) continue;   // 必须落在卡片内
      rowBottom = Math.max(rowBottom, r.bottom);
      rowItems.push({ el: b, r: r });
    }
    if (!rowItems.length) return null;
    // 取最底一行（±6px 容差），再取该行最右边那组里的最左一个
    var best = null;
    for (var k = 0; k < rowItems.length; k++) {
      var it = rowItems[k];
      if (Math.abs(it.r.bottom - rowBottom) > 10) continue;
      if (it.r.left < boxRect.left + boxRect.width * 0.45) continue;   // 右半边
      if (!best || it.r.left < best.r.left) best = it;
    }
    return best ? best.el : null;
  }

  function readInputText(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return String(el.value || "");
    return String(el.innerText || el.textContent || "");
  }

  function writeInputText(el, text) {
    if (!el) return false;
    try {
      el.focus();
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc && desc.set) desc.set.call(el, text);
        else el.value = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertReplacementText" }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      // Lexical(反重力composer) 只接受一次 insertText：
      // 额外调用 execCommand("selectAll") 会把选区扩到整篇文档，导致文本重复；
      // 之后再补发合成 InputEvent 会让 Lexical 回滚成旧状态。故这里只做一次精确替换。
      var want = String(text);
      // 反重力 2.31 的输入框是 Lexical 编辑器，实测结论（CDP 反复验证）：
      //  - execCommand("selectAll"/"insertText") 返回 true 但内容被回滚 → 不可用
      //  - 合成 KeyboardEvent(ctrl+A) + KeyboardEvent(Backspace) 能真正清空
      //  - 合成 ClipboardEvent("paste") + DataTransfer 能真正写入
      // 所以统一走"全选删除 + 粘贴"这条 Lexical 原生路径。
      try {
        el.focus();
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", keyCode: 65, ctrlKey: true, bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", code: "Backspace", keyCode: 8, bubbles: true, cancelable: true }));
        var dt = null;
        try { dt = new DataTransfer(); dt.setData("text/plain", want); } catch (_edt) { dt = null; }
        if (dt && typeof ClipboardEvent === "function") {
          el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
        }
        return true;
      } catch (_e1) {
        return false;
      }
    } catch (_e) {
      return false;
    }
  }

  // ---------- LLM 请求 ----------
  function buildEndpoint(baseUrl, protocol, model) {
    var raw = String(baseUrl || DEFAULT_BASE_URLS[protocol] || DEFAULT_BASE_URLS.openai).trim().replace(/\/+$/, "");
    if (protocol === "anthropic") {
      if (!/\/messages$/i.test(raw)) raw += (/\/v\d+$/i.test(raw) ? "" : "/v1") + "/messages";
      return raw;
    }
    if (protocol === "gemini") {
      if (raw.indexOf(":generateContent") === -1) {
        if (!/\/v1(?:beta)?$/i.test(raw) && raw.indexOf("/models") === -1) raw += "/v1beta";
        raw += raw.indexOf("/models/") === -1 ? "/models/" + encodeURIComponent(model || "gemini-2.5-flash") + ":generateContent" : ":generateContent";
      }
      return raw;
    }
    if (!/\/chat\/completions$/i.test(raw)) {
      raw += (/\/v\d+(?:beta\d*)?$/i.test(raw) ? "" : "/v1") + "/chat/completions";
    }
    return raw;
  }

  async function requestOptimize(draft, settings, signal, testing) {
    var protocol = settings.protocol || "openai";
    var sys = testing ? "Return only OK." : (settings.systemPrompts && settings.systemPrompts[settings.style]) || DEFAULT_PROMPTS[settings.style] || DEFAULT_PROMPTS.enhanced;
    var model = (settings.model || DEFAULT_MODELS[protocol] || "gpt-4o-mini").trim();
    var url = buildEndpoint(settings.baseUrl, protocol, model);
    var headers = { "Content-Type": "application/json" };
    var body;

    if (protocol === "anthropic") {
      headers["x-api-key"] = settings.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      body = { model: model, max_tokens: 4096, temperature: 0.3, system: sys, messages: [{ role: "user", content: draft }] };
    } else if (protocol === "gemini") {
      headers["x-goog-api-key"] = settings.apiKey;
      body = { systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: "user", parts: [{ text: draft }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 4096 } };
    } else {
      headers["Authorization"] = "Bearer " + settings.apiKey;
      body = { model: model, temperature: 0.3, messages: [{ role: "system", content: sys }, { role: "user", content: draft }] };
    }

    var res = await fetch(url, { method: "POST", headers: headers, body: JSON.stringify(body), signal: signal });
    var data = await res.json();
    if (!res.ok) throw new Error((data && data.error && data.error.message) || ("HTTP " + res.status));
    var out = "";
    if (protocol === "anthropic") out = (data.content && data.content[0] && data.content[0].text) || "";
    else if (protocol === "gemini") out = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || "";
    else out = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
    return String(out || "").replace(/^<(think|thinking)>[\s\S]*?<\/\1>\s*/i, "").trim();
  }

  // ---------- 发送检测与状态复位 ----------
  // 消息发出去以后，本次增强会话就结束了：必须回到 ✨ 增强 的空闲态，
  // 否则按钮会一直显示「↩ 还原」，用户点它就会把上一轮的旧草稿重新灌进新输入框。
  function resetToIdle(silent) {
    var was = state.mode;
    state.mode = "idle";
    state.originalText = null;
    state.optimizedText = null;
    state.lastSeenText = "";
    refreshButton();
    if (!silent && was === "optimized") showToast("✨ 已发送，增强会话已结束");
  }

  function inputIsEmpty(el) {
    try {
      return !String(readInputText(el) || "").replace(/\s+/g, "");
    } catch (_e) {
      return false;
    }
  }

  // 判定"这一轮对话已经发出"：输入框被平台清空，而本轮确实处于优化态
  function maybeMarkSent() {
    if (state.mode !== "optimized" || state.loading) return;
    var el = findChatInput();
    if (!el) return;
    if (!inputIsEmpty(el)) return;
    var btn = document.querySelector("[" + BTN_ATTR + "]");
    if (!btn || btn.getAttribute("data-state") !== "optimized") return;
    // 发送后平台会先清空输入框再渲染消息，延迟一帧确认，避免"清空瞬间"误判
    setTimeout(function () {
      if (state.mode !== "optimized" || state.loading) return;
      var el2 = findChatInput();
      if (el2 && inputIsEmpty(el2)) resetToIdle(true);
    }, 350);
  }

  // ---------- 交互 ----------
  async function onButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (state.loading) {
      if (state.abortCtrl) state.abortCtrl.abort();
      return;
    }
    var inputEl = findChatInput();
    if (!inputEl) { showToast("未找到当前对话框输入区"); return; }
    if (state.mode === "optimized" && state.originalText != null) {
      var nowText = String(readInputText(inputEl) || "");
      var stillThisRound = state.optimizedText != null &&
        String(state.optimizedText).trim() === nowText.trim();
      if (!stillThisRound) {
        // 本轮结果已经不在输入框里（刚发出去 / 用户已改过）：只复位状态，绝不把旧草稿写回去
        resetToIdle(true);
        showToast("✨ 已回到增强态（上一轮内容已不在此输入框，未改动）");
        return;
      }
      writeInputText(inputEl, state.originalText);
      state.mode = "idle";
      state.originalText = null;
      state.optimizedText = null;
      refreshButton();
      showToast("↩ 已还原原始提示词");
      return;
    }
    var current = readInputText(inputEl).trim();
    if (!current) { showToast("请先在对话框中输入提示词草稿（右键 ✨ 可打开设置）"); return; }

    var settings = loadSettings();
    if (!settings.apiKey) {
      if (settings.fallbackPrefixMode) {
        state.originalText = current;
        var prefixed = current.indexOf("✨") === 0 ? current : "✨:" + settings.style + " " + current;
        writeInputText(inputEl, prefixed);
        state.mode = "optimized";
        refreshButton();
        showToast("✨ 已添加增强前缀，回车发送即自动强化（右键 ✨ 可配外部 API Key）");
        return;
      }
      openSettingsModal();
      return;
    }

    state.loading = true;
    refreshButton();
    var ctrl = new AbortController();
    state.abortCtrl = ctrl;
    var timer = setTimeout(function () { try { ctrl.abort(); } catch (_e) {} }, 45000);
    try {
      var out = await requestOptimize(current, settings, ctrl.signal, false);
      clearTimeout(timer);
      if (!out) { showToast("模型返回为空，请检查模型名或 Base URL"); return; }
      state.originalText = current;
      state.optimizedText = out;
      state.mode = "optimized";
      writeInputText(inputEl, out);
      showToast("✅ 提示词已增强（再点一次 ↩ 可还原原文）");
    } catch (err) {
      clearTimeout(timer);
      var msg = err && err.name === "AbortError" ? "已取消" : (err && err.message ? err.message : String(err));
      showToast("❌ 增强失败：" + msg);
    } finally {
      state.loading = false;
      state.abortCtrl = null;
      refreshButton();
    }
  }

  function refreshButton(btn) {
    var b = btn || document.querySelector("[" + BTN_ATTR + "]");
    if (!b) return;
    if (state.loading) {
      b.setAttribute("data-state", "loading");
      b.textContent = "⟳ 优化中";
      b.title = "点击取消本次优化";
    } else if (state.mode === "optimized") {
      b.setAttribute("data-state", "optimized");
      b.textContent = "↩ 还原";
      b.title = "左键还原原始提示词 · 右键打开 Prompt Optimize 设置";
    } else {
      b.setAttribute("data-state", "idle");
      b.textContent = "✨ 增强";
      b.title = "左键调用 AI 强化提示词 · 右键打开 Prompt Optimize 设置";
    }
  }

  // ---------- 模型候选 ----------
  var MODEL_PRESETS = {
    openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o4-mini", "deepseek-chat", "deepseek-reasoner", "deepseek-flash"],
    anthropic: ["claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929", "claude-opus-4-1-20250805"],
    gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"]
  };

  /** 用给定候选重建下拉；保留当前选中值。 */
  function fillModelOptions(sel, list, current) {
    if (!sel) return;
    var keep = current || sel.value || "";
    var html = '<option value="">（选择模型 / 或手动输入）</option>';
    for (var i = 0; i < list.length; i++) {
      var m = String(list[i] || "").trim();
      if (!m) continue;
      html += '<option value="' + m.replace(/"/g, "&quot;") + '">' + m + "</option>";
    }
    sel.innerHTML = html;
    var hit = false;
    for (var j = 0; j < sel.options.length; j++) {
      if (sel.options[j].value === keep) { sel.value = keep; hit = true; break; }
    }
    if (!hit) sel.value = "";
  }

  /** 按协议拼出 /models 端点。 */
  function modelsEndpoint(baseUrl, protocol) {
    var b = String(baseUrl || "").replace(/\/+$/, "");
    if (protocol === "anthropic") return b + "/v1/models";
    if (protocol === "gemini") return b + "/models";
    return b + "/models";
  }

  /** 从上游拉取模型列表。返回字符串数组。 */
  async function fetchUpstreamModels(cfg) {
    var url = modelsEndpoint(cfg.baseUrl, cfg.protocol);
    var headers = {};
    if (cfg.protocol === "anthropic") {
      headers["x-api-key"] = cfg.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (cfg.protocol === "gemini") {
      headers["x-goog-api-key"] = cfg.apiKey;
    } else {
      headers["Authorization"] = "Bearer " + cfg.apiKey;
    }
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (_e) {} }, 20000) : null;
    var res;
    try {
      res = await fetch(url, { method: "GET", headers: headers, signal: ctrl ? ctrl.signal : undefined });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) throw new Error("HTTP " + res.status + " " + (await res.text().catch(function () { return ""; })).slice(0, 120));
    var data = await res.json();
    var arr = [];
    if (data && Array.isArray(data.data)) {
      for (var i = 0; i < data.data.length; i++) arr.push(data.data[i] && (data.data[i].id || data.data[i].name));
    } else if (data && Array.isArray(data.models)) {
      for (var k = 0; k < data.models.length; k++) {
        var mm = data.models[k] || {};
        var nm = mm.name || mm.id || "";
        nm = String(nm).replace(/^models\//, "");
        arr.push(nm);
      }
    }
    var seen = {};
    return arr.filter(function (x) {
      x = String(x || "").trim();
      if (!x || seen[x]) return false;
      seen[x] = 1;
      return true;
    }).sort();
  }

  // ---------- 设置面板 ----------
  function openSettingsModal() {
    try {
      var old = document.querySelector("[" + PANEL_ATTR + "]");
      if (old) { old.remove(); return; }
      var s = loadSettings();
      var modal = document.createElement("div");
      modal.setAttribute(PANEL_ATTR, "true");
      modal.innerHTML =
        '<div class="ag-card">' +
        '<div class="ag-head"><h3>✨ Prompt Optimize 设置</h3>' +
        '<button class="ag-x" title="关闭" data-act="close">✕</button></div>' +
        '<label>协议<select data-k="protocol"><option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option></select></label>' +
        '<label>API Base URL<input type="url" data-k="baseUrl" placeholder="https://api.openai.com/v1"></label>' +
        '<label>API Key（留空则左键 ✨ 自动走内置钩子前缀模式）<input type="password" data-k="apiKey" placeholder="sk-..."></label>' +
        '<div class="ag-field"><span>模型</span><div class="ag-inline">' +
        '<select data-k="modelSelect"><option value="">（选择模型 / 或手动输入）</option></select>' +
        '<input type="text" data-k="model" placeholder="gpt-4o-mini">' +
        '<button data-act="fetch-models" title="从当前 Base URL + API Key 拉取可用模型列表">⇩ 导入</button>' +
        '</div></div>' +
        '<label>预设风格<select data-k="style"><option value="enhanced">enhanced（综合增强）</option><option value="coding">coding（编程）</option><option value="structured">structured（结构化）</option><option value="concise">concise（精简）</option></select></label>' +
        '<label>System Prompt（当前风格）<textarea data-k="sysPrompt" rows="6"></textarea></label>' +
        '<div class="ag-status" data-k="status"></div>' +
        '<div class="ag-row"><button data-act="test">测试连接</button><button data-act="save">保存</button></div>' +
        "</div>";
      var q = function (k) { return modal.querySelector('[data-k="' + k + '"]'); };
      q("protocol").value = s.protocol;
      q("baseUrl").value = s.baseUrl;
      q("apiKey").value = s.apiKey;
      q("model").value = s.model;
      // 预设模型候选（可被「导入」按钮从上游覆盖）
      fillModelOptions(q("modelSelect"), MODEL_PRESETS[s.protocol] || [], s.model);
      q("modelSelect").addEventListener("change", function () {
        if (q("modelSelect").value) q("model").value = q("modelSelect").value;
      });
      q("model").addEventListener("input", function () {
        var v = q("model").value.trim();
        var has = false;
        for (var oi = 0; oi < q("modelSelect").options.length; oi++) {
          if (q("modelSelect").options[oi].value === v) { has = true; break; }
        }
        q("modelSelect").value = has ? v : "";
      });
      q("style").value = s.style;
      q("sysPrompt").value = (s.systemPrompts && s.systemPrompts[s.style]) || DEFAULT_PROMPTS[s.style] || "";
      var statusEl = q("status");

      q("style").addEventListener("change", function () {
        var st = q("style").value;
        q("sysPrompt").value = (s.systemPrompts && s.systemPrompts[st]) || DEFAULT_PROMPTS[st] || "";
      });
      // 点遮罩不再关闭：拖选文本时鼠标滑出卡片会误触。只有 ✕ 或 保存 才关闭。
      modal.querySelector('[data-act="close"]').addEventListener("click", function () { modal.remove(); });
      document.addEventListener("keydown", function escClose(ev) { if (ev.key === "Escape") { modal.remove(); document.removeEventListener("keydown", escClose); } });

      q("protocol").addEventListener("change", function () {
        var p = q("protocol").value;
        if (!q("baseUrl").value.trim() || Object.values(DEFAULT_BASE_URLS).indexOf(q("baseUrl").value.trim()) !== -1) q("baseUrl").value = DEFAULT_BASE_URLS[p];
        if (!q("model").value.trim() || Object.values(DEFAULT_MODELS).indexOf(q("model").value.trim()) !== -1) q("model").value = DEFAULT_MODELS[p];
      });

      modal.querySelector('[data-act="test"]').addEventListener("click", async function () {
        statusEl.textContent = "⏳ 正在测试…（最多 45 秒）";
        try {
          var temp = { protocol: q("protocol").value, baseUrl: q("baseUrl").value.trim(), apiKey: q("apiKey").value.trim(), model: q("model").value.trim() };
          if (!temp.apiKey) throw new Error("请先填写 API Key");
          var resp = await requestOptimize("OK", temp, null, true);
          statusEl.textContent = "✅ 连接成功！返回: " + resp.slice(0, 40);
        } catch (err) {
          statusEl.textContent = "❌ 连接失败: " + (err && err.message ? err.message : String(err));
        }
      });

      modal.querySelector('[data-act="fetch-models"]').addEventListener("click", async function () {
        var btn = modal.querySelector('[data-act="fetch-models"]');
        var cfg = {
          protocol: q("protocol").value,
          baseUrl: q("baseUrl").value.trim(),
          apiKey: q("apiKey").value.trim()
        };
        if (!cfg.baseUrl) { statusEl.textContent = "❌ 请先填写 API Base URL"; return; }
        if (!cfg.apiKey) { statusEl.textContent = "❌ 拉取模型列表需要 API Key"; return; }
        btn.disabled = true;
        var oldLabel = btn.textContent;
        btn.textContent = "⏳ 拉取中";
        statusEl.textContent = "⏳ 正在从 " + modelsEndpoint(cfg.baseUrl, cfg.protocol) + " 拉取模型列表…";
        try {
          var list = await fetchUpstreamModels(cfg);
          if (!list.length) {
            statusEl.textContent = "⚠️ 上游返回了空列表，保留内置候选";
            fillModelOptions(q("modelSelect"), MODEL_PRESETS[cfg.protocol] || [], q("model").value);
          } else {
            fillModelOptions(q("modelSelect"), list, q("model").value);
            statusEl.textContent = "✅ 已导入 " + list.length + " 个模型，可在下拉里选择";
          }
        } catch (err) {
          statusEl.textContent = "❌ 拉取失败：" + (err && err.message ? err.message : String(err));
        } finally {
          btn.disabled = false;
          btn.textContent = oldLabel;
        }
      });

      modal.querySelector('[data-act="save"]').addEventListener("click", function () {
        var next = Object.assign({}, s);
        next.protocol = q("protocol").value;
        next.baseUrl = q("baseUrl").value.trim();
        next.apiKey = q("apiKey").value.trim();
        next.model = q("model").value.trim();
        next.style = q("style").value;
        if (!next.systemPrompts) next.systemPrompts = deepMergePrompts(null);
        next.systemPrompts[next.style] = q("sysPrompt").value.trim() || DEFAULT_PROMPTS[next.style];
        saveSettings(next);
        modal.remove();
        showToast("✅ Prompt Optimize 设置已保存");
      });

      (document.body || document.documentElement).appendChild(modal);
    } catch (_e) {}
  }

  // ---------- 定位核心（每次调用只做一次 geometry epoch） ----------
  function ensureHostAndButton() {
    var input = findChatInput();
    var host = document.querySelector("[" + HOST_ATTR + "]");

    if (!input) {
      if (host) host.style.display = "none";
      return;
    }
    if (!host) {
      installStyles();
      host = document.createElement("div");
      host.setAttribute(HOST_ATTR, "true");
      var st0 = document.getElementById(STYLE_ID);
      void st0;
      // 宿主挂到 body 以免触发 i18n 汉化器的文本改写节点
      (document.body || document.documentElement).appendChild(host);
    }
    host.style.display = "flex";

    var btn = host.querySelector("[" + BTN_ATTR + "]");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute(BTN_ATTR, "true");
      btn.addEventListener("click", onButtonClick);
      btn.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openSettingsModal();
      });
      host.appendChild(btn);
    }
    if (!state.loading && btn.getAttribute("data-state") === null) refreshButton(btn);
    // 每帧顺带检测"内容被清空 = 已发送"，作为 Enter / 点发送按钮之外的兜底
    try { maybeMarkSent(); } catch (_eSent) {}

    var box = findComposerBox(input) || input;
    var boxRect = rectOf(box);
    if (!boxRect) return;

    // 隐藏条件：输入框已滚出视口
    if (boxRect.bottom < 40 || boxRect.top > geo.vh - 4) {
      host.style.display = "none";
      return;
    }

    var anchorRight = boxRect.right - 125;
    var anchorTop = boxRect.bottom - 34;

    var anchorBtn = findRightAnchorButton(box);
    if (anchorBtn) {
      var ar = rectOf(anchorBtn);
      var myH = 26;
      anchorRight = ar.left - 70 - 6;                                   // 插在锚点按钮左侧 6px
      anchorTop = ar.top + (ar.height - myH) / 2;                       // 与该行按钮垂直居中对齐
      if (anchorRight < boxRect.left + 8) anchorRight = boxRect.left + 8;
    }

    var left = Math.round(anchorRight);
    var top = Math.round(anchorTop);
    var prevLeft = host.__agLeft;
    var prevTop = host.__agTop;
    if (prevLeft !== left) { host.style.left = left + "px"; host.__agLeft = left; }
    if (prevTop !== top) { host.style.top = top + "px"; host.__agTop = top; }
  }

  // ---------- 装配 ----------
  function boot() {
    installStyles();
    beginGeoEpoch();
    try { ensureHostAndButton(); } catch (_e) {}

    // 0) 端口无关配置：从 app_storage.json 拉取一次，回填 localStorage 缓存，
    //    让「换端口 / 重新登录」后仍然能读到之前配好的 API Key / 模型 / 风格。
    try {
      void hydrateSettings().then(function (s) {
        if (!s) return;
        try {
          var b = document.querySelector("[" + BTN_ATTR + "]");
          refreshButton(b || undefined);
        } catch (_e) {}
      });
    } catch (_e) {}
    // 跨窗口/跨端口同步：其它标签页或重启后的实例写入了配置，这里同步更新缓存
    try {
      if (hasNativeStorage() && typeof window.nativeStorage.onChanged === "function") {
        window.nativeStorage.onChanged(function (changes) {
          if (!changes || !(NATIVE_STORAGE_KEY in changes)) return;
          var v = changes[NATIVE_STORAGE_KEY];
          if (typeof v === "string" && parseSettingsRaw(v)) {
            nativeCache = v;
            try { window.localStorage.setItem(SETTINGS_KEY, v); } catch (_e) {}
            try {
              var b2 = document.querySelector("[" + BTN_ATTR + "]");
              refreshButton(b2 || undefined);
            } catch (_e2) {}
          }
        });
      }
    } catch (_e) {}

    // 0.5) 发送检测：回车发送（非 Shift）和点击右侧发送按钮，都在捕获阶段监听，
    //      只做"标记发送"，不阻断事件，因此对平台行为零影响。
    try {
      document.addEventListener("keydown", function (ev) {
        if (!ev || ev.key !== "Enter" || ev.shiftKey || ev.isComposing) return;
        var el = findChatInput();
        if (!el) return;
        var t = ev.target;
        if (!t || !(el === t || (el.contains && el.contains(t)))) return;
        setTimeout(function () { maybeMarkSent(); }, 60);
        setTimeout(function () { maybeMarkSent(); }, 600);
      }, true);
    } catch (_eKd) {}

    try {
      document.addEventListener("click", function (ev) {
        if (state.mode !== "optimized") return;
        var t = ev.target;
        if (!t || !t.closest) return;
        var box = findChatInput();
        var composer = box ? (findComposerBox(box) || box) : null;
        if (!composer || !composer.contains(t)) return;
        // 只关心"发送按钮"这一行：位于 composer 底部工具行、且在输入框右侧区域
        var br = t.getBoundingClientRect ? t.getBoundingClientRect() : null;
        if (!br) return;
        var boxRect = composer.getBoundingClientRect();
        if (br.top < boxRect.bottom - 60) return;
        if (br.left < boxRect.left + boxRect.width * 0.6) return;
        if (t.closest("[" + BTN_ATTR + "]") || t.closest("[" + PANEL_ATTR + "]")) return;
        setTimeout(function () { maybeMarkSent(); }, 80);
        setTimeout(function () { maybeMarkSent(); }, 700);
      }, true);
    } catch (_eClk) {}

    // 1) 被动跟随：窗口尺寸变化 / 滚动（全部 passive + rAF 合并）
    window.addEventListener("resize", function () { beginGeoEpoch(); requestEnsure(true); }, { passive: true });
    document.addEventListener("scroll", function () { beginGeoEpoch(); requestEnsure(true); }, { passive: true, capture: true });

    // 2) 只在需要时重新测几何：输入区尺寸变化
    if (typeof ResizeObserver === "function") {
      var ro = new ResizeObserver(function () { beginGeoEpoch(); requestEnsure(true); });
      var watched = null;
      var watchTimer = setInterval(function () {
        var inp = findChatInput();
        if (inp && inp !== watched) {
          watched = inp;
          try { ro.disconnect(); } catch (_e) {}
          try { ro.observe(inp); if (inp.parentElement) ro.observe(inp.parentElement); } catch (_e2) {}
        }
      }, 3000);
      window.addEventListener("beforeunload", function () { clearInterval(watchTimer); try { ro.disconnect(); } catch (_e) {} });
    }

    // 3) 轻量等待：首屏 React 渲染完成后再补齐（只在前 6 秒生效，非永久轮询）
    var bootDeadline = nowMs() + 6000;
    var bootTick = setInterval(function () {
      if (nowMs() > bootDeadline) { clearInterval(bootTick); return; }
      beginGeoEpoch();
      requestEnsure(true);
    }, 800);

    window[INSTANCE_KEY] = {
      ensure: function () { beginGeoEpoch(); ensureHostAndButton(); },
      openSettings: openSettingsModal,
      version: "1.5.0"
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
