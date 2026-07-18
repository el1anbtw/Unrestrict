const elements = {
  enabled: document.querySelector("#enabled"),
  global: document.querySelector("#global"),
  hostname: document.querySelector("#hostname"),
  notice: document.querySelector("#notice"),
  profile: document.querySelector("#profile"),
  profileDescription: document.querySelector("#profile-description"),
  status: document.querySelector("#status-pill"),
  statusText: document.querySelector("#status-text"),
  subdomains: document.querySelector("#subdomains"),
};

let activeTab = null;
let hostname = "";
let currentProfile = "off";
let currentSettings = null;
let busy = false;

const PROFILE_UI = Object.freeze({
  off: {
    label: "Off",
    description: "The extension does not inject code into this site.",
  },
  normal: {
    label: "On",
    description: "Removes targeted restrictions while preserving page behavior.",
  },
  strong: {
    label: "Strong",
    description: "More strictly isolates blocking events and protects selection.",
  },
  "strong-antidebug": {
    label: "Anti-debug",
    description: "Also protects DevTools shortcuts and recurring debugger traps.",
  },
});

function showNotice(message) {
  elements.notice.textContent = message;
  elements.notice.hidden = !message;
}

function setBusy(value) {
  busy = value;
  for (const element of [elements.enabled, elements.global, elements.profile, elements.subdomains]) {
    element.disabled = value || !hostname || (element === elements.profile && !elements.enabled.checked);
  }
}

function render(state) {
  const explicit = state.explicitRule;
  currentSettings = state.settings;
  currentProfile = state.profile;
  elements.enabled.checked = state.profile !== "off";
  elements.profile.value = state.profile === "off" ? "normal" : state.profile;
  elements.profile.disabled = state.profile === "off";
  elements.subdomains.checked = explicit?.includeSubdomains === true;
  elements.global.checked = state.settings.globalEnabled === true;
  elements.status.className = `status-pill ${state.profile}`;
  elements.statusText.textContent = PROFILE_UI[state.profile].label;
  elements.profileDescription.textContent = PROFILE_UI[state.profile].description;
  elements.hostname.title = elements.hostname.textContent;

  if (state.profile === "strong" || state.profile === "strong-antidebug") {
    showNotice("Strong mode may disable custom menus or some web editor behavior.");
  } else {
    showNotice("");
  }
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Unknown extension error");
  return response;
}

async function requestSiteAccess(includeSubdomains) {
  const pattern = includeSubdomains ? `*://*.${hostname}/*` : `*://${hostname}/*`;
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) throw new Error("Chrome did not grant access to this site");
}

async function setSite(profile, includeSubdomains = elements.subdomains.checked) {
  if (profile !== "off") await requestSiteAccess(includeSubdomains);
  await send({
    type: "SET_SITE",
    hostname,
    profile,
    includeSubdomains,
    tabId: activeTab.id,
  });
}

async function handle(action) {
  if (busy) return;
  setBusy(true);
  showNotice("");
  try {
    await action();
    window.close();
  } catch (error) {
    const message = error?.message || String(error);
    if (hostname) {
      try {
        const response = await send({ type: "GET_STATE", hostname });
        render(response);
      } catch {
        // Keep the current UI if state recovery itself is unavailable.
      }
    }
    showNotice(message);
    setBusy(false);
  }
}

elements.enabled.addEventListener("change", () => handle(async () => {
  const profile = elements.enabled.checked ? elements.profile.value : "off";
  await setSite(profile);
}));

elements.profile.addEventListener("change", () => handle(async () => {
  await setSite(elements.profile.value);
}));

elements.subdomains.addEventListener("change", () => handle(async () => {
  const profile = currentProfile === "off" ? "normal" : currentProfile;
  await setSite(profile, elements.subdomains.checked);
}));

elements.global.addEventListener("change", () => handle(async () => {
  const enabled = elements.global.checked;
  if (enabled) {
    const confirmed = window.confirm(
      "Global mode gives the extension access to all HTTP(S) pages. Continue?"
    );
    if (!confirmed) throw new Error("Global mode was not enabled");
    const granted = await chrome.permissions.request({ origins: ["*://*/*"] });
    if (!granted) throw new Error("Chrome did not grant global access");
  } else {
    // Preserve explicit site access before dropping the umbrella permission.
    const requiredOrigins = Object.values(currentSettings?.sites || {})
      .filter((rule) => rule.profile !== "off")
      .map((rule) => rule.includeSubdomains
        ? `*://*.${rule.hostname}/*`
        : `*://${rule.hostname}/*`);
    if (requiredOrigins.length) {
      const granted = await chrome.permissions.request({ origins: [...new Set(requiredOrigins)] });
      if (!granted) throw new Error("Could not preserve access for selected sites");
    }
  }
  await send({ type: "SET_GLOBAL", enabled, tabId: activeTab.id });
}));

async function initialize() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url;
  try {
    url = new URL(activeTab?.url || "");
  } catch {
    url = null;
  }

  if (!url || !["http:", "https:"].includes(url.protocol)) {
    elements.hostname.textContent = "Extensions cannot access this page";
    elements.status.className = "status-pill off";
    elements.statusText.textContent = "Unavailable";
    elements.profileDescription.textContent = PROFILE_UI.off.description;
    showNotice("Chrome blocks extension injection on internal and protected pages.");
    setBusy(true);
    await chrome.action.setBadgeText({ tabId: activeTab?.id, text: "!" }).catch(() => {});
    return;
  }

  hostname = url.hostname.toLowerCase();
  elements.hostname.textContent = hostname;
  elements.hostname.title = hostname;
  const response = await send({ type: "GET_STATE", hostname });
  render(response);
  setBusy(false);
}

initialize().catch((error) => {
  showNotice(error?.message || String(error));
  setBusy(true);
});
