import {
  DEFAULT_SETTINGS,
  PROFILES,
  effectiveProfile,
  normalizeHostname,
  normalizeSettings,
  patternForRule,
  registrationsFor,
} from "./lib/settings.js";

const SETTINGS_KEY = "settingsV1";
const SCRIPT_PREFIX = "unrestrict-v1-";
const SELECTION_STYLESHEET = "content/selection.css";
const PROFILE_BOOTSTRAPS = {
  normal: "content/profile-normal.js",
  strong: "content/profile-strong.js",
  "strong-antidebug": "content/profile-strong-antidebug.js",
};
const BADGES = {
  off: { text: "OFF", color: "#6b7280" },
  normal: { text: "ON", color: "#15803d" },
  strong: { text: "S", color: "#d97706" },
  "strong-antidebug": { text: "AD", color: "#b91c1c" },
  unavailable: { text: "!", color: "#6b7280" },
};

async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY] || DEFAULT_SETTINGS);
}

async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  return normalized;
}

async function setBadge(tabId, profile) {
  if (!Number.isInteger(tabId)) return;
  const badge = BADGES[profile] || BADGES.off;
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: badge.text }),
    chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color }),
    chrome.action.setTitle({
      tabId,
      title: profile === "unavailable" ? "Unrestrict: недоступная страница" : `Unrestrict: ${profile}`,
    }),
  ]);
}

function descriptor(profile, world, matches, excludeMatches = []) {
  const suffix = world.toLowerCase();
  const js = [PROFILE_BOOTSTRAPS[profile], `content/${suffix}.js`];
  const item = {
    id: `${SCRIPT_PREFIX}${profile}-${suffix}`,
    js,
    matches,
    allFrames: true,
    matchOriginAsFallback: true,
    persistAcrossSessions: true,
    runAt: "document_start",
    world,
  };
  if (excludeMatches.length) item.excludeMatches = excludeMatches;
  return item;
}

async function reconcileContentScripts() {
  const settings = await getSettings();
  const model = registrationsFor(settings);
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const ours = existing.filter((script) => script.id.startsWith(SCRIPT_PREFIX)).map((script) => script.id);
  if (ours.length) await chrome.scripting.unregisterContentScripts({ ids: ours });

  const registrations = [];
  for (const [profile, matches] of Object.entries(model.profiles)) {
    if (!matches.length) continue;
    const excludes = settings.globalEnabled && profile === "normal" ? model.excludeFromGlobal : [];
    registrations.push(
      descriptor(profile, "MAIN", matches, excludes),
      descriptor(profile, "ISOLATED", matches, excludes)
    );
  }
  if (registrations.length) await chrome.scripting.registerContentScripts(registrations);
  return settings;
}

async function removeUnusedOrigins(settings) {
  const granted = await chrome.permissions.getAll();
  const origins = granted.origins || [];
  const required = new Set();
  if (settings.globalEnabled) required.add("*://*/*");
  for (const rule of Object.values(settings.sites)) {
    if (rule.profile !== "off") required.add(patternForRule(rule));
  }

  for (const origin of origins) {
    if (!required.has(origin)) {
      await chrome.permissions.remove({ origins: [origin] }).catch(() => false);
    }
  }
}

async function updateSite(message) {
  const settings = await getSettings();
  const hostname = normalizeHostname(message.hostname);
  if (!PROFILES.includes(message.profile)) throw new TypeError("Unknown profile");

  if (message.profile === "off" && !settings.globalEnabled) {
    delete settings.sites[hostname];
  } else {
    settings.sites[hostname] = {
      hostname,
      includeSubdomains: message.includeSubdomains === true,
      profile: message.profile,
    };
  }

  const saved = await saveSettings(settings);
  await reconcileContentScripts();
  await removeUnusedOrigins(saved);
  await setBadge(message.tabId, message.profile);
  if (Number.isInteger(message.tabId)) await chrome.tabs.reload(message.tabId);
  return saved;
}

async function updateGlobal(message) {
  const settings = await getSettings();
  settings.globalEnabled = message.enabled === true;
  const saved = await saveSettings(settings);
  await reconcileContentScripts();
  await removeUnusedOrigins(saved);
  if (Number.isInteger(message.tabId)) await chrome.tabs.reload(message.tabId);
  return saved;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case "GET_STATE": {
        const settings = await getSettings();
        const profile = message.hostname ? effectiveProfile(settings, message.hostname) : "off";
        return {
          settings,
          profile,
          explicitRule: message.hostname ? settings.sites[normalizeHostname(message.hostname)] || null : null,
        };
      }
      case "SET_SITE":
        return { settings: await updateSite(message) };
      case "SET_GLOBAL":
        return { settings: await updateGlobal(message) };
      case "RECONCILE":
        return { settings: await reconcileContentScripts() };
      case "CONTENT_READY":
        if (Number.isInteger(sender.tab?.id) && Number.isInteger(sender.frameId)) {
          await chrome.scripting.insertCSS({
            target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
            files: [SELECTION_STYLESHEET],
            origin: "USER",
          });
        }
        if (sender.frameId === 0) await setBadge(sender.tab?.id, message.profile);
        return { ok: true };
      default:
        throw new TypeError("Unknown message");
    }
  };

  run().then(
    (value) => sendResponse({ ok: true, ...value }),
    (error) => sendResponse({ ok: false, error: error?.message || String(error) })
  );
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  reconcileContentScripts().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  reconcileContentScripts().catch(console.error);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") setBadge(tabId, "off").catch(() => {});
});
