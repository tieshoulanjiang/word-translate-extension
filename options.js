const DEFAULTS = {
  provider: "google_gtx",
  targetLang: "zh-CN",
  sourceLang: "auto",
  googleCloudApiKey: "",
  libreTranslateEndpoint: "https://libretranslate.com"
};

async function load() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  document.getElementById("provider").value = s.provider || DEFAULTS.provider;
  document.getElementById("targetLang").value = s.targetLang || DEFAULTS.targetLang;
  document.getElementById("sourceLang").value = s.sourceLang || DEFAULTS.sourceLang;
  document.getElementById("googleCloudApiKey").value = s.googleCloudApiKey || "";
  document.getElementById("libreTranslateEndpoint").value = s.libreTranslateEndpoint || DEFAULTS.libreTranslateEndpoint;
}

async function save() {
  const s = {
    provider: document.getElementById("provider").value,
    targetLang: document.getElementById("targetLang").value.trim() || "zh-CN",
    sourceLang: document.getElementById("sourceLang").value.trim() || "auto",
    googleCloudApiKey: document.getElementById("googleCloudApiKey").value.trim(),
    libreTranslateEndpoint: document.getElementById("libreTranslateEndpoint").value.trim() || "https://libretranslate.com"
  };
  await chrome.storage.sync.set(s);
  alert("Saved");
}

document.getElementById("save").addEventListener("click", save);
load();
