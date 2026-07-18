export const PROFILES = Object.freeze([
  "off",
  "normal",
  "strong",
  "strong-antidebug",
]);

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 1,
  globalEnabled: false,
  sites: {},
});

export function normalizeHostname(value) {
  const hostname = String(value || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  const labels = hostname.split(".");
  const validLabels = labels.every((label) =>
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
  if (!hostname || hostname.length > 253 || !validLabels) {
    throw new TypeError("Invalid hostname");
  }
  return hostname;
}

export function patternForRule(rule) {
  const hostname = normalizeHostname(rule.hostname);
  return rule.includeSubdomains
    ? `*://*.${hostname}/*`
    : `*://${hostname}/*`;
}

export function normalizeSettings(value) {
  const input = value && typeof value === "object" ? value : {};
  const settings = {
    schemaVersion: 1,
    globalEnabled: input.globalEnabled === true,
    sites: {},
  };

  if (input.sites && typeof input.sites === "object") {
    for (const candidate of Object.values(input.sites)) {
      try {
        const hostname = normalizeHostname(candidate?.hostname);
        const profile = PROFILES.includes(candidate?.profile) ? candidate.profile : "off";
        settings.sites[hostname] = {
          hostname,
          includeSubdomains: candidate?.includeSubdomains === true,
          profile,
        };
      } catch {
        // Ignore malformed data instead of breaking extension startup.
      }
    }
  }
  return settings;
}

export function matchingRule(settings, hostname) {
  const normalized = normalizeHostname(hostname);
  const exact = settings.sites[normalized];
  if (exact) return exact;

  let best = null;
  for (const rule of Object.values(settings.sites)) {
    if (
      rule.includeSubdomains &&
      normalized.endsWith(`.${rule.hostname}`) &&
      (!best || rule.hostname.length > best.hostname.length)
    ) {
      best = rule;
    }
  }
  return best;
}

export function effectiveProfile(settings, hostname) {
  return matchingRule(settings, hostname)?.profile || (settings.globalEnabled ? "normal" : "off");
}

export function registrationsFor(settings) {
  const explicitPatterns = [];
  const profiles = {
    normal: [],
    strong: [],
    "strong-antidebug": [],
  };

  for (const rule of Object.values(settings.sites)) {
    const pattern = patternForRule(rule);
    explicitPatterns.push(pattern);
    if (rule.profile !== "off") profiles[rule.profile].push(pattern);
  }

  if (settings.globalEnabled) {
    profiles.normal.unshift("*://*/*");
  }

  return {
    excludeFromGlobal: settings.globalEnabled ? [...new Set(explicitPatterns)] : [],
    profiles: Object.fromEntries(
      Object.entries(profiles).map(([profile, patterns]) => [profile, [...new Set(patterns)]])
    ),
  };
}
