// ===== background.js (service worker / background) =====

const DEFAULT_SETTINGS = {
  provider: "google_gtx",          // google_gtx | google_cloud | libretranslate
  targetLang: "zh-CN",
  sourceLang: "auto",
  googleCloudApiKey: "",
  libreTranslateEndpoint: "https://libretranslate.com",

  aiEnabled: false,
  aiEndpoint: "",
  aiApiKey: "",
  aiModel: ""                      // optional; used mainly for OpenAI; can be used by gateways/custom too
};

async function getStoredSettings() {
  const data = await chrome.storage.local.get("settings");
  const s = data?.settings || {};
  return { ...DEFAULT_SETTINGS, ...s };
}

async function saveStoredSettings(patch) {
  const cur = await getStoredSettings();
  const next = { ...cur, ...(patch || {}) };
  await chrome.storage.local.set({ settings: next });
  return next;
}

function normalizeLang(lang) {
  const t = (lang || "").trim();
  return t || "auto";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// --------- Normal translate providers ---------

async function translateByGoogleGtx(text, sourceLang, targetLang) {
  const sl = sourceLang === "auto" ? "auto" : sourceLang;
  const tl = targetLang || "zh-CN";
  const url =
    "https://translate.googleapis.com/translate_a/single" +
    `?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}` +
    `&dt=t&q=${encodeURIComponent(text)}`;

  const resp = await fetchWithTimeout(url, { method: "GET" }, 15000);
  if (!resp.ok) throw new Error(`gtx HTTP ${resp.status}`);

  const data = await resp.json();
  const segments = Array.isArray(data?.[0]) ? data[0] : [];
  const translated = segments.map(s => s?.[0]).filter(Boolean).join("");
  return translated || "";
}

async function translateByGoogleCloud(text, sourceLang, targetLang, apiKey) {
  if (!apiKey) throw new Error("Google Cloud API key is empty.");
  const tl = targetLang || "zh-CN";
  const sl = sourceLang === "auto" ? "" : sourceLang;

  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`;

  const body = { q: text, target: tl };
  if (sl) body.source = sl;

  const resp = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    },
    20000
  );

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Google Cloud HTTP ${resp.status}: ${t || "request failed"}`);
  }

  const data = await resp.json();
  return data?.data?.translations?.[0]?.translatedText || "";
}

async function translateByLibreTranslate(text, sourceLang, targetLang, endpoint) {
  const base = (endpoint || "").trim() || DEFAULT_SETTINGS.libreTranslateEndpoint;
  const url = base.replace(/\/+$/, "") + "/translate";

  const sl = sourceLang === "auto" ? "auto" : sourceLang;
  const tl = targetLang || "zh-CN";

  const resp = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: text,
        source: sl,
        target: tl,
        format: "text"
      })
    },
    20000
  );

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`LibreTranslate HTTP ${resp.status}: ${t || "request failed"}`);
  }

  const data = await resp.json();
  return data?.translatedText || "";
}

async function translateNormal(text, sourceLang, targetLang, settings) {
  const provider = settings?.provider || "google_gtx";
  if (provider === "google_cloud") {
    return translateByGoogleCloud(text, sourceLang, targetLang, settings.googleCloudApiKey || "");
  }
  if (provider === "libretranslate") {
    return translateByLibreTranslate(text, sourceLang, targetLang, settings.libreTranslateEndpoint || "");
  }
  return translateByGoogleGtx(text, sourceLang, targetLang);
}

// --------- AI translate (Gemini + OpenAI + Generic) ---------

function isGeminiEndpoint(url) {
  return /generativelanguage\.googleapis\.com/i.test(url);
}

function isOpenAIEndpoint(url) {
  return /api\.openai\.com\/v1\//i.test(url) || /\/v1\/(responses|chat\/completions)\b/i.test(url);
}

function pickGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map(p => (typeof p?.text === "string" ? p.text : "")).join("").trim();
}

function pickOpenAIText(data) {
  // Responses API
  const out = data?.output;
  if (Array.isArray(out)) {
    const chunks = [];
    for (const item of out) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c?.type === "output_text" && typeof c?.text === "string") chunks.push(c.text);
        else if (typeof c?.text === "string") chunks.push(c.text);
        else if (typeof c?.content === "string") chunks.push(c.content);
        else if (typeof c?.output_text === "string") chunks.push(c.output_text);
      }
    }
    const t = chunks.join("").trim();
    if (t) return t;
  }

  // Chat Completions
  const cc = data?.choices?.[0]?.message?.content;
  if (typeof cc === "string" && cc.trim()) return cc.trim();

  // Legacy text
  const txt = data?.choices?.[0]?.text;
  if (typeof txt === "string" && txt.trim()) return txt.trim();

  return "";
}

function pickGenericText(data) {
  if (data == null) return "";
  if (typeof data === "string") return data.trim();
  if (typeof data.translated === "string") return data.translated.trim();
  if (typeof data.translation === "string") return data.translation.trim();
  if (typeof data.result === "string") return data.result.trim();
  if (typeof data.text === "string") return data.text.trim();
  if (typeof data?.data?.translatedText === "string") return data.data.translatedText.trim();
  return "";
}

function buildTranslationPrompt({ text, context, sourceLang, targetLang }) {
  return [
    "You are a translation engine.",
    "Return ONLY the translation. No explanations. No quotes.",
    `Target language: ${targetLang || "zh-CN"}.`,
    sourceLang && sourceLang !== "auto" ? `Source language: ${sourceLang}.` : "Source language: auto-detect.",
    context ? `Context: ${context}` : "",
    `Text: ${text}`
  ].filter(Boolean).join("\n");
}

async function translateByAI({ text, context, sourceLang, targetLang, aiEndpoint, aiApiKey, aiModel }) {
  const endpoint = (aiEndpoint || "").trim();
  if (!endpoint) throw new Error("AI endpoint is empty.");

  const key = (aiApiKey || "").trim();
  if (!key) throw new Error("AI API key is empty.");

  const prompt = buildTranslationPrompt({ text, context, sourceLang, targetLang });
  const model = (aiModel || "").trim(); // optional

  // ---- Gemini adapter ----
  if (isGeminiEndpoint(endpoint)) {
    const headers = {
      "Content-Type": "application/json",
      "X-goog-api-key": key
    };

    const payload = {
      contents: [{ parts: [{ text: prompt }] }]
    };

    const resp = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    }, 30000);

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`Gemini HTTP ${resp.status}: ${t || "request failed"}`);
    }

    const data = await resp.json();
    const translated = pickGeminiText(data);
    if (!translated) throw new Error("Gemini response has no text.");
    return translated;
  }

  // ---- OpenAI adapter ----
  if (isOpenAIEndpoint(endpoint)) {
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`
    };

    const isResponses = /\/v1\/responses\b/i.test(endpoint);
    const isChatCompletions = /\/v1\/chat\/completions\b/i.test(endpoint);

    const fallbackModel = "gpt-4.1-mini";
    const useModel = model || fallbackModel;

    let payload;
    if (isResponses) {
      payload = { model: useModel, input: prompt };
    } else if (isChatCompletions) {
      payload = {
        model: useModel,
        messages: [
          { role: "system", content: "Return ONLY the translation." },
          { role: "user", content: prompt }
        ],
        temperature: 0.2
      };
    } else {
      // Unknown OpenAI-like gateway: try Responses shape
      payload = { model: useModel, input: prompt };
    }

    const resp = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    }, 30000);

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`OpenAI HTTP ${resp.status}: ${t || "request failed"}`);
    }

    const data = await resp.json();
    const translated = pickOpenAIText(data) || pickGenericText(data);
    if (!translated) throw new Error("OpenAI response has no text.");
    return translated;
  }

  // ---- Generic JSON adapter (custom server) ----
  {
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`
    };

    const payload = {
      text,
      context: context || "",
      sourceLang,
      targetLang,
      prompt,
      model: model || undefined
    };

    const resp = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    }, 30000);

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`AI HTTP ${resp.status}: ${t || "request failed"}`);
    }

    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      const data = await resp.json();
      const translated = pickGenericText(data);
      if (!translated) throw new Error("AI response JSON has no translated field.");
      return translated;
    }

    const t = (await resp.text()).trim();
    if (!t) throw new Error("AI response is empty.");
    return t;
  }
}

// --------- message routing ---------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || typeof msg.type !== "string") {
        sendResponse({ ok: false, error: "Invalid message." });
        return;
      }

      if (msg.type === "GET_SETTINGS") {
        const settings = await getStoredSettings();
        sendResponse({ ok: true, settings });
        return;
      }

      if (msg.type === "SAVE_SETTINGS") {
        const patch = msg.settings || {};
        const settings = await saveStoredSettings(patch);
        sendResponse({ ok: true, settings });
        return;
      }

      if (msg.type === "TRANSLATE") {
        const settings = await getStoredSettings();
        const text = String(msg.text || "");
        const sourceLang = normalizeLang(msg.sourceLang || settings.sourceLang);
        const targetLang = normalizeLang(msg.targetLang || settings.targetLang);

        if (!text.trim()) {
          sendResponse({ ok: true, translated: "" });
          return;
        }

        const translated = await translateNormal(text, sourceLang, targetLang, settings);
        sendResponse({ ok: true, translated });
        return;
      }

      if (msg.type === "AI_TRANSLATE") {
        const text = String(msg.text || "");
        if (!text.trim()) {
          sendResponse({ ok: true, translated: "" });
          return;
        }

        const translated = await translateByAI({
          text,
          context: String(msg.context || ""),
          sourceLang: normalizeLang(msg.sourceLang),
          targetLang: normalizeLang(msg.targetLang),
          aiEndpoint: String(msg.aiEndpoint || ""),
          aiApiKey: String(msg.aiApiKey || ""),
          aiModel: String(msg.aiModel || "")
        });

        sendResponse({ ok: true, translated });
        return;
      }

      sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();

  return true;
});
