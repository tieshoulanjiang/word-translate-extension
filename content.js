// ===== Select Translate Popup - content.js (1.0 base + AI toggle + move settings to header) =====
// Base file: user-provided 1.0 version. :contentReference[oaicite:1]{index=1}

let logoEl, panelEl;
let headerEl, closeBtn, pinBtn;
let navBackBtn, navFwdBtn, navCountEl;

// NEW: AI + Settings in header
let aiToggleBtn, settingsBtn;

let settingsModal;
let inputProvider, inputTargetLang, inputSourceLang, inputGoogleKey, inputLibreEndpoint;

// NEW: AI settings inputs
let inputAiEndpoint, inputAiKey, inputAiModel;

let saveBtn, cancelBtn;

let settingsCache = null;
let pollTimer = null;

// record last pointer position (viewport + page)
let lastPointer = { clientX: 40, clientY: 40, pageX: 40, pageY: 40, ts: 0 };

// panel pin state
let isPinned = false;
let pinnedState = null; // { left, top, width, height } in px

// translation history (only while panel is open)
let history = []; // [{ src, dst, ts, wordMeta? }]
let historyIndex = -1;

// selected collapse state
let selectedExpanded = false;

// cached word meta (for current record)
let currentWordMeta = null; // { ipa, pos, audioUrl }

// ---------- utils ----------
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[m]));
}

function isSingleWord(text) {
  const t = (text || "").trim();
  if (!t) return false;
  if (/\s/.test(t)) return false;
  return /^[A-Za-z][A-Za-z'-]*$/.test(t);
}

function applyLogoHardStyle() {
  if (!logoEl) return;
  logoEl.style.setProperty("width", "28px", "important");
  logoEl.style.setProperty("height", "28px", "important");
  logoEl.style.setProperty("display", "none", "important");
  logoEl.style.setProperty("align-items", "center", "important");
  logoEl.style.setProperty("justify-content", "center", "important");
  logoEl.style.setProperty("border-radius", "999px", "important");
  logoEl.style.setProperty("background", "#111", "important");
  logoEl.style.setProperty("color", "#fff", "important");
  logoEl.style.setProperty("font-size", "14px", "important");
  logoEl.style.setProperty("font-weight", "700", "important");
  logoEl.style.setProperty("box-shadow", "0 6px 18px rgba(0,0,0,.25)", "important");
  logoEl.style.setProperty("cursor", "pointer", "important");
  logoEl.style.setProperty("user-select", "none", "important");
  logoEl.style.setProperty("pointer-events", "auto", "important");
  logoEl.style.setProperty("z-index", "2147483647", "important");
  logoEl.style.setProperty("position", "absolute", "important");
}

function rectFromPointer() {
  const px = lastPointer.pageX || (window.scrollX + (lastPointer.clientX || 40));
  const py = lastPointer.pageY || (window.scrollY + (lastPointer.clientY || 40));
  return {
    right: px - window.scrollX,
    top: py - window.scrollY,
    bottom: py - window.scrollY
  };
}

// CHANGED: return range for context extraction
function getSelectionInfo() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  const text = sel.toString().trim();
  if (!text) return null;

  const range = sel.getRangeAt(0);

  let rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    const rects = range.getClientRects();
    rect = Array.from(rects).find(r => r.width > 0 && r.height > 0) || rect;
  }

  if (!rect || (rect.width === 0 && rect.height === 0)) {
    rect = rectFromPointer();
    return { text, rect, rectFallback: true, range };
  }

  return { text, rect, rectFallback: false, range };
}

function showLogoNear(rect) {
  applyLogoHardStyle();
  const x = window.scrollX + rect.right + 8;
  const y = window.scrollY + rect.top - 8;
  logoEl.style.setProperty("left", `${x}px`, "important");
  logoEl.style.setProperty("top", `${y}px`, "important");
  logoEl.style.setProperty("display", "flex", "important");
  logoEl.style.setProperty("z-index", "2147483647", "important");
}

function hideLogo() {
  if (!logoEl) return;
  logoEl.style.setProperty("display", "none", "important");
}

function showPanelAt(rect) {
  const pad = 12;
  const w = panelEl.offsetWidth || 360;
  const h = panelEl.offsetHeight || 220;

  let left = rect.right + pad;
  let top = rect.bottom + pad;

  left = clamp(left, pad, window.innerWidth - w - pad);
  top = clamp(top, pad, window.innerHeight - h - pad);

  panelEl.style.left = `${left}px`;
  panelEl.style.top = `${top}px`;
  panelEl.style.display = "block";
}

function applyPinnedPanelState() {
  if (!panelEl || !pinnedState) return;
  panelEl.style.left = `${pinnedState.left}px`;
  panelEl.style.top = `${pinnedState.top}px`;
  panelEl.style.width = `${pinnedState.width}px`;
  panelEl.style.height = `${pinnedState.height}px`;
}

function capturePinnedPanelState() {
  if (!panelEl) return;
  const r = panelEl.getBoundingClientRect();
  pinnedState = {
    left: clamp(r.left, 8, Math.max(8, window.innerWidth - 60)),
    top: clamp(r.top, 8, Math.max(8, window.innerHeight - 60)),
    width: clamp(r.width || 360, 260, Math.max(260, window.innerWidth - 16)),
    height: clamp(r.height || 220, 160, Math.max(160, window.innerHeight - 16))
  };
}

function hidePanel() {
  if (!panelEl) return;
  panelEl.style.display = "none";
  if (settingsModal) settingsModal.style.display = "none";

  history = [];
  historyIndex = -1;
  updateNavUI();

  selectedExpanded = false;
  currentWordMeta = null;
  renderWordMeta(null, null);
}

// ---------- history ----------
function canGoBack() {
  return history.length > 1 && historyIndex > 0;
}
function canGoForward() {
  return history.length > 1 && historyIndex < history.length - 1;
}
function setButtonEnabled(btn, enabled) {
  if (!btn) return;
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? "1" : "0.35";
  btn.style.cursor = enabled ? "pointer" : "not-allowed";
}
function updateNavUI() {
  if (!navBackBtn || !navFwdBtn || !navCountEl) return;

  if (history.length <= 1) {
    navBackBtn.style.display = "none";
    navFwdBtn.style.display = "none";
    navCountEl.style.display = "none";
    return;
  }

  navBackBtn.style.display = "inline-flex";
  navFwdBtn.style.display = "inline-flex";
  navCountEl.style.display = "inline-flex";

  setButtonEnabled(navBackBtn, canGoBack());
  setButtonEnabled(navFwdBtn, canGoForward());
  navCountEl.textContent = `${historyIndex + 1}/${history.length}`;
}

function renderHistoryRecord(idx) {
  if (!panelEl) return;
  if (idx < 0 || idx >= history.length) return;

  const rec = history[idx];
  historyIndex = idx;

  selectedExpanded = false;
  applySelectedCollapse();

  const srcBox = panelEl.querySelector("#stp-src");
  const dstBox = panelEl.querySelector("#stp-dst");
  const status = panelEl.querySelector("#stp-status");

  srcBox.textContent = rec.src;
  dstBox.textContent = rec.dst;
  status.textContent = "";

  currentWordMeta = rec.wordMeta || null;
  renderWordMeta(rec.src, currentWordMeta);

  updateNavUI();
}

function pushHistory(src, dst, wordMeta) {
  const rec = { src, dst, ts: Date.now(), wordMeta: wordMeta || null };

  if (historyIndex !== history.length - 1) {
    history = history.slice(0, historyIndex + 1);
  }
  history.push(rec);
  historyIndex = history.length - 1;

  updateNavUI();
}

// ---------- pin ----------
function updatePinUI() {
  if (!pinBtn) return;
  if (isPinned) {
    pinBtn.style.background = "#666";
    pinBtn.style.color = "#fff";
    pinBtn.title = "Pinned: panel position & size fixed";
  } else {
    pinBtn.style.background = "#ddd";
    pinBtn.style.color = "#111";
    pinBtn.title = "Pin panel (fix position & size)";
  }
}

// ---------- AI toggle UI ----------
function updateAiUI(aiEnabled) {
  if (!aiToggleBtn) return;
  if (aiEnabled) {
    aiToggleBtn.style.background = "#111";
    aiToggleBtn.style.color = "#fff";
    aiToggleBtn.style.opacity = "1";
    aiToggleBtn.title = "AI mode ON: translate with context";
  } else {
    aiToggleBtn.style.background = "#eee";
    aiToggleBtn.style.color = "#111";
    aiToggleBtn.style.opacity = "0.55";
    aiToggleBtn.title = "AI mode OFF: normal translate";
  }
}

// ---------- selected collapse ----------
function applySelectedCollapse() {
  const srcBox = panelEl?.querySelector("#stp-src");
  if (!srcBox) return;

  if (selectedExpanded) {
    srcBox.style.whiteSpace = "normal";
    srcBox.style.overflow = "auto";
    srcBox.style.textOverflow = "clip";
  } else {
    srcBox.style.whiteSpace = "nowrap";
    srcBox.style.overflow = "hidden";
    srcBox.style.textOverflow = "ellipsis";
  }
}

// ---------- word meta (IPA, POS, audio) ----------
async function fetchWordMeta(word) {
  const w = (word || "").trim().toLowerCase();
  if (!isSingleWord(w)) return null;

  try {
    const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!Array.isArray(data) || !data[0]) return null;

    const entry = data[0];

    let ipa = "";
    if (Array.isArray(entry.phonetics)) {
      const p = entry.phonetics.find(x => x?.text) || entry.phonetics[0];
      ipa = (p?.text || "").trim();
    } else if (entry.phonetic) {
      ipa = String(entry.phonetic).trim();
    }

    let pos = "";
    if (Array.isArray(entry.meanings) && entry.meanings[0]?.partOfSpeech) {
      pos = String(entry.meanings[0].partOfSpeech).trim();
    }

    let audioUrl = "";
    if (Array.isArray(entry.phonetics)) {
      const a = entry.phonetics.find(x => x?.audio) || entry.phonetics[0];
      audioUrl = (a?.audio || "").trim();
    }

    if (!ipa && !pos && !audioUrl) return null;
    return { ipa, pos, audioUrl };
  } catch {
    return null;
  }
}

function renderWordMeta(srcText, meta) {
  const wrap = panelEl?.querySelector("#stp-wordmeta");
  if (!wrap) return;

  if (!srcText || !isSingleWord(srcText) || !meta) {
    wrap.style.display = "none";
    wrap.innerHTML = "";
    return;
  }

  const ipa = meta.ipa ? meta.ipa : "";
  const pos = meta.pos ? meta.pos : "";
  const show = ipa || pos;

  const label = [
    ipa ? `<span style="font-family:ui-monospace, SFMono-Regular, Menlo, monospace;">${escapeHtml(ipa)}</span>` : "",
    pos ? `<span style="opacity:.75;">${escapeHtml(pos)}</span>` : ""
  ].filter(Boolean).join(`<span style="opacity:.5;"> · </span>`);

  wrap.style.display = (show || meta.audioUrl) ? "flex" : "none";
  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;min-width:0;">
      <div style="font-size:12px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${label}
      </div>
      <button id="stp-speak" title="Pronounce" style="width:26px;height:26px;border-radius:7px;border:1px solid rgba(0,0,0,.15);background:#eee;cursor:pointer;">🔊</button>
    </div>
  `;

  const speakBtn = wrap.querySelector("#stp-speak");
  speakBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    speakWord(srcText, meta);
  });
}

function speakWord(word, meta) {
  const w = (word || "").trim();
  if (!w) return;

  if (meta?.audioUrl) {
    try {
      const audio = new Audio(meta.audioUrl);
      audio.play().catch(() => speakByTTS(w));
      return;
    } catch {
      // fallback
    }
  }
  speakByTTS(w);
}

function speakByTTS(text) {
  try {
    if (!("speechSynthesis" in window)) return;
    const ut = new SpeechSynthesisUtterance(text);

    const voices = window.speechSynthesis.getVoices?.() || [];
    const gb = voices.find(v => (v.lang || "").toLowerCase().startsWith("en-gb"));
    if (gb) ut.voice = gb;
    ut.lang = gb?.lang || "en-GB";

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(ut);
  } catch {
    // ignore
  }
}

// ---------- background messaging ----------
async function getSettings() {
  if (settingsCache) return settingsCache;
  const res = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  if (res?.ok) {
    settingsCache = res.settings;
    return settingsCache;
  }
  return null;
}

async function saveSettings(newSettings) {
  const res = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: newSettings });
  if (res?.ok) {
    settingsCache = { ...(settingsCache || {}), ...newSettings };
    return true;
  }
  return false;
}

// NEW: context extraction for AI
function extractContextFromRange(range) {
  try {
    if (!range) return "";
    let node = range.commonAncestorContainer;
    if (node && node.nodeType === 3) node = node.parentElement;
    if (!node) return "";

    const block = node.closest?.("p,li,blockquote,td,th,section,article,div") || node;
    let t = (block.innerText || block.textContent || "").replace(/\s+/g, " ").trim();
    if (t.length > 900) t = t.slice(0, 900) + "…";
    return t;
  } catch {
    return "";
  }
}

// CHANGED: translate supports AI mode
async function translate(text, rangeForContext) {
  const s = await getSettings();
  const sourceLang = s?.sourceLang || "auto";
  const targetLang = s?.targetLang || "zh-CN";

  if (s?.aiEnabled) {
    const res = await chrome.runtime.sendMessage({
      type: "AI_TRANSLATE",
      text,
      context: extractContextFromRange(rangeForContext),
      sourceLang,
      targetLang,
      aiEndpoint: (s?.aiEndpoint || "").trim(),
      aiApiKey: (s?.aiApiKey || "").trim(),
      aiModel: (s?.aiModel || "").trim()
    });
    if (!res?.ok) throw new Error(res?.error || "AI translate failed.");
    return res.translated || "";
  }

  const res = await chrome.runtime.sendMessage({
    type: "TRANSLATE",
    text,
    sourceLang,
    targetLang
  });
  if (!res?.ok) throw new Error(res?.error || "Translate failed.");
  return res.translated || "";
}

// ---------- draggable ----------
function makeDraggable(panel, handle) {
  let dragging = false;
  let startX = 0, startY = 0;
  let startLeft = 0, startTop = 0;

  handle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const t = e.target;
    if (t && t.closest && t.closest("button")) return;

    dragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = panel.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;

    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const newLeft = clamp(startLeft + dx, 8, window.innerWidth - panel.offsetWidth - 8);
    const newTop = clamp(startTop + dy, 8, window.innerHeight - panel.offsetHeight - 8);

    panel.style.left = `${newLeft}px`;
    panel.style.top = `${newTop}px`;
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    if (isPinned) capturePinnedPanelState();
  });
}

function attachResizeObserver() {
  if (!panelEl || typeof ResizeObserver === "undefined") return;
  const ro = new ResizeObserver(() => {
    if (isPinned) capturePinnedPanelState();
  });
  ro.observe(panelEl);
}

// ---------- UI init ----------
function initUI() {
  document.querySelectorAll("#stp-logo, #stp-panel").forEach(el => el.remove());

  // Logo
  logoEl = document.createElement("div");
  logoEl.id = "stp-logo";
  logoEl.title = "Translate selection";
  logoEl.textContent = "译";
  document.documentElement.appendChild(logoEl);
  applyLogoHardStyle();

  // Panel
  panelEl = document.createElement("div");
  panelEl.id = "stp-panel";
  panelEl.style.position = "fixed";
  panelEl.style.display = "none";
  panelEl.style.resize = "both";
  panelEl.style.overflow = "auto";
  panelEl.style.minWidth = "260px";
  panelEl.style.minHeight = "160px";
  panelEl.style.zIndex = "2147483647";

  // CHANGED: move AI + Settings into header right, left of Back button
  panelEl.innerHTML = `
    <div id="stp-header" style="display:flex;align-items:center;gap:8px;justify-content:space-between;user-select:none;">
      <div id="stp-title" style="display:flex;align-items:center;gap:8px;flex:1;">
        <span>Translate</span>
        <span id="stp-status" style="opacity:.8;font-size:12px;"></span>
      </div>

      <div id="stp-actions" style="display:flex;align-items:center;gap:6px;">
        <!-- NEW: AI toggle + Settings (right top) -->
        <button id="stp-ai-toggle" title="AI mode"
          style="width:28px;height:24px;border-radius:6px;border:1px solid rgba(0,0,0,.15);background:#eee;">AI</button>

        <button id="stp-settings" title="Settings"
          style="width:28px;height:24px;border-radius:6px;border:1px solid rgba(0,0,0,.15);background:#eee;">⚙</button>

        <!-- Back/Forward -->
        <button id="stp-back" title="Back"
          style="width:24px;height:24px;border-radius:6px;border:1px solid rgba(0,0,0,.15);background:#eee;">←</button>
        <span id="stp-count" style="font-size:12px;opacity:.75;min-width:44px;text-align:center;">1/1</span>
        <button id="stp-forward" title="Forward"
          style="width:24px;height:24px;border-radius:6px;border:1px solid rgba(0,0,0,.15);background:#eee;">→</button>

        <button id="stp-pin" title="Pin panel (fix position & size)"
          style="width:24px;height:24px;border-radius:6px;border:1px solid rgba(0,0,0,.15);background:#ddd;color:#111;">📌</button>

        <button id="stp-close" title="Close"
          style="width:24px;height:24px;border-radius:6px;border:1px solid rgba(0,0,0,.15);background:#eee;">✕</button>
      </div>
    </div>

    <div id="stp-body">
      <div class="stp-row">
        <div class="stp-label">Selected</div>
        <div class="stp-box" id="stp-src" title="Double-click to expand/collapse"></div>
        <div id="stp-wordmeta" style="margin-top:6px;display:none;"></div>
      </div>

      <div class="stp-row">
        <div class="stp-label">Translation</div>
        <div class="stp-box" id="stp-dst">…</div>
      </div>

      <div id="stp-settings-modal">
        <div class="stp-field">
          <label>Provider</label>
          <select id="stp-provider">
            <option value="google_gtx">Google Translate (gtx, unofficial)</option>
            <option value="google_cloud">Google Cloud Translation (official)</option>
            <option value="libretranslate">LibreTranslate</option>
          </select>
        </div>

        <div class="stp-field">
          <label>Target language (e.g., zh-CN, en, pt)</label>
          <input id="stp-target" placeholder="zh-CN" />
        </div>

        <div class="stp-field">
          <label>Source language (auto or e.g., en)</label>
          <input id="stp-source" placeholder="auto" />
        </div>

        <div class="stp-field">
          <label>Google Cloud API Key (only for Google Cloud)</label>
          <input id="stp-gcloudkey" placeholder="AIza..." />
        </div>

        <div class="stp-field">
          <label>LibreTranslate endpoint (only for LibreTranslate)</label>
          <input id="stp-libre" placeholder="https://libretranslate.com" />
        </div>

        <!-- NEW: AI settings -->
        <div class="stp-field">
          <label>AI endpoint (Gemini/OpenAI/custom)</label>
          <input id="stp-ai-endpoint" placeholder="https://..." />
        </div>

        <div class="stp-field">
          <label>AI API Key</label>
          <input id="stp-ai-key" placeholder="key..." />
        </div>

        <div class="stp-field">
          <label>AI model (optional, e.g. gpt-4.1-mini)</label>
          <input id="stp-ai-model" placeholder="leave empty for default" />
        </div>

        <div style="margin-top:10px;">
          <button id="stp-save">Save</button>
          <button id="stp-cancel">Cancel</button>
          <div style="margin-top:8px;font-size:12px;opacity:.7;">
            Tip: 默认 gtx 可能不稳定；稳定方案是 Google Cloud（需要 Key）或自建 LibreTranslate。
          </div>
        </div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(panelEl);

  headerEl = panelEl.querySelector("#stp-header");
  closeBtn = panelEl.querySelector("#stp-close");
  pinBtn = panelEl.querySelector("#stp-pin");

  navBackBtn = panelEl.querySelector("#stp-back");
  navFwdBtn = panelEl.querySelector("#stp-forward");
  navCountEl = panelEl.querySelector("#stp-count");

  // NEW: header buttons
  aiToggleBtn = panelEl.querySelector("#stp-ai-toggle");
  settingsBtn = panelEl.querySelector("#stp-settings");

  settingsModal = panelEl.querySelector("#stp-settings-modal");

  inputProvider = panelEl.querySelector("#stp-provider");
  inputTargetLang = panelEl.querySelector("#stp-target");
  inputSourceLang = panelEl.querySelector("#stp-source");
  inputGoogleKey = panelEl.querySelector("#stp-gcloudkey");
  inputLibreEndpoint = panelEl.querySelector("#stp-libre");

  // NEW: AI inputs
  inputAiEndpoint = panelEl.querySelector("#stp-ai-endpoint");
  inputAiKey = panelEl.querySelector("#stp-ai-key");
  inputAiModel = panelEl.querySelector("#stp-ai-model");

  saveBtn = panelEl.querySelector("#stp-save");
  cancelBtn = panelEl.querySelector("#stp-cancel");

  makeDraggable(panelEl, headerEl);
  attachResizeObserver();

  // Selected box collapse behavior
  const srcBox = panelEl.querySelector("#stp-src");
  srcBox.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    selectedExpanded = !selectedExpanded;
    applySelectedCollapse();
  });
  selectedExpanded = false;
  applySelectedCollapse();

  // Close panel
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hidePanel();
  });

  // Pin toggle (📌)
  pinBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    isPinned = !isPinned;
    updatePinUI();

    if (isPinned && panelEl.style.display !== "none") {
      capturePinnedPanelState();
      applyPinnedPanelState();
    }
  });
  updatePinUI();

  // History nav
  navBackBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!canGoBack()) return;
    renderHistoryRecord(historyIndex - 1);
  });

  navFwdBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!canGoForward()) return;
    renderHistoryRecord(historyIndex + 1);
  });

  // NEW: AI toggle
  aiToggleBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const s = await getSettings();
    if (!s) return;
    const next = !s.aiEnabled;
    const ok = await saveSettings({ aiEnabled: next });
    if (ok) updateAiUI(next);
  });

  // Settings open (now header)
  settingsBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const s = await getSettings();
    if (!s) return;

    inputProvider.value = s.provider || "google_gtx";
    inputTargetLang.value = s.targetLang || "zh-CN";
    inputSourceLang.value = s.sourceLang || "auto";
    inputGoogleKey.value = s.googleCloudApiKey || "";
    inputLibreEndpoint.value = s.libreTranslateEndpoint || "https://libretranslate.com";

    inputAiEndpoint.value = s.aiEndpoint || "";
    inputAiKey.value = s.aiApiKey || "";
    inputAiModel.value = s.aiModel || "";

    settingsModal.style.display = "block";
  });

  cancelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    settingsModal.style.display = "none";
  });

  saveBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const newSettings = {
      provider: inputProvider.value,
      targetLang: (inputTargetLang.value || "zh-CN").trim(),
      sourceLang: (inputSourceLang.value || "auto").trim(),
      googleCloudApiKey: (inputGoogleKey.value || "").trim(),
      libreTranslateEndpoint: (inputLibreEndpoint.value || "https://libretranslate.com").trim(),

      // AI settings
      aiEndpoint: (inputAiEndpoint.value || "").trim(),
      aiApiKey: (inputAiKey.value || "").trim(),
      aiModel: (inputAiModel.value || "").trim()
    };
    const ok = await saveSettings(newSettings);
    if (ok) settingsModal.style.display = "none";
  });

  // Click logo → open panel & translate
  logoEl.addEventListener("click", async (e) => {
    e.stopPropagation();
    hideLogo();

    const info = getSelectionInfo();
    if (!info) return;

    const wasHidden = (panelEl.style.display === "none");
    if (wasHidden) {
      history = [];
      historyIndex = -1;
      updateNavUI();
      selectedExpanded = false;
      applySelectedCollapse();
    }

    if (isPinned && pinnedState) {
      panelEl.style.display = "block";
      applyPinnedPanelState();
    } else {
      showPanelAt(info.rect);
      if (isPinned) {
        capturePinnedPanelState();
        applyPinnedPanelState();
      }
    }

    const srcBox2 = panelEl.querySelector("#stp-src");
    const dstBox = panelEl.querySelector("#stp-dst");
    const status = panelEl.querySelector("#stp-status");

    selectedExpanded = false;
    applySelectedCollapse();
    srcBox2.textContent = info.text;

    currentWordMeta = null;
    renderWordMeta(info.text, null);

    dstBox.textContent = "Translating…";
    status.textContent = "";

    const shouldWordMeta = isSingleWord(info.text);
    const metaPromise = shouldWordMeta ? fetchWordMeta(info.text) : Promise.resolve(null);

    try {
      const translated = await translate(info.text, info.range);
      dstBox.textContent = translated || "";

      const meta = await metaPromise;
      currentWordMeta = meta;
      renderWordMeta(info.text, meta);

      pushHistory(info.text, translated || "", meta);
    } catch (err) {
      const msg = err?.message || String(err);
      status.textContent = "Error";
      dstBox.textContent = msg;

      const meta = await metaPromise;
      currentWordMeta = meta;
      renderWordMeta(info.text, meta);

      pushHistory(info.text, msg, meta);
    }
  });

  // ESC closes panel
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hidePanel();
  });

  updateNavUI();

  // init AI UI from settings
  getSettings().then(s => updateAiUI(!!s?.aiEnabled));
}

// ---------- selection listeners ----------
function bindSelectionListener() {
  let timer = null;

  function apply() {
    const info = getSelectionInfo();
    if (!info) {
      hideLogo();
      return;
    }
    showLogoNear(info.rect);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(apply, 10);
  }

  document.addEventListener("pointerup", (e) => {
    lastPointer = {
      clientX: e.clientX,
      clientY: e.clientY,
      pageX: (window.scrollX + e.clientX),
      pageY: (window.scrollY + e.clientY),
      ts: Date.now()
    };
    schedule();
  }, true);

  document.addEventListener("selectionchange", schedule, true);
  document.addEventListener("mouseup", schedule, true);
  document.addEventListener("keyup", schedule, true);

  window.addEventListener("scroll", () => hideLogo(), true);
  window.addEventListener("resize", () => hideLogo(), true);

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    const t = window.getSelection?.().toString?.().trim?.() || "";
    if (!t) {
      hideLogo();
      return;
    }
    apply();
  }, 150);
}

// ---------- boot ----------
try {
  initUI();
  bindSelectionListener();
} catch (e) {
  console.error("[STP] content.js failed:", e);
}
