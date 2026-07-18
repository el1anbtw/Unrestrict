import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  effectiveProfile,
  normalizeHostname,
  normalizeSettings,
  patternForRule,
  registrationsFor,
} from "../extension/lib/settings.js";

test("invalid persisted rules are discarded", () => {
  const settings = normalizeSettings({
    globalEnabled: "yes",
    sites: {
      valid: { hostname: "Example.COM", profile: "strong", includeSubdomains: true },
      invalid: { hostname: "https://bad.example/path", profile: "normal" },
    },
  });
  assert.equal(settings.globalEnabled, false);
  assert.deepEqual(settings.sites["example.com"], {
    hostname: "example.com",
    includeSubdomains: true,
    profile: "strong",
  });
  assert.equal(Object.keys(settings.sites).length, 1);
});

test("the most specific matching subdomain rule wins", () => {
  const settings = normalizeSettings({
    sites: {
      root: { hostname: "example.com", includeSubdomains: true, profile: "normal" },
      docs: { hostname: "docs.example.com", includeSubdomains: true, profile: "strong" },
    },
  });
  assert.equal(effectiveProfile(settings, "deep.docs.example.com"), "strong");
  assert.equal(effectiveProfile(settings, "blog.example.com"), "normal");
  assert.equal(effectiveProfile(settings, "unrelated.test"), "off");
});

test("explicit off overrides global normal mode", () => {
  const settings = normalizeSettings({
    globalEnabled: true,
    sites: { blocked: { hostname: "private.example", profile: "off" } },
  });
  assert.equal(effectiveProfile(settings, "public.example"), "normal");
  assert.equal(effectiveProfile(settings, "private.example"), "off");
});

test("registration model excludes explicit rules from the global script", () => {
  const settings = normalizeSettings({
    globalEnabled: true,
    sites: {
      strong: { hostname: "strong.example", profile: "strong" },
      off: { hostname: "off.example", profile: "off" },
    },
  });
  const model = registrationsFor(settings);
  assert.deepEqual(model.profiles.normal, ["*://*/*"]);
  assert.deepEqual(model.profiles.strong, ["*://strong.example/*"]);
  assert.deepEqual(
    new Set(model.excludeFromGlobal),
    new Set(["*://strong.example/*", "*://off.example/*"])
  );
});

test("patterns are exact unless subdomains are explicitly enabled", () => {
  assert.equal(patternForRule({ hostname: "example.com" }), "*://example.com/*");
  assert.equal(
    patternForRule({ hostname: "example.com", includeSubdomains: true }),
    "*://*.example.com/*"
  );
  assert.equal(DEFAULT_SETTINGS.globalEnabled, false);
});

test("hostnames are normalized and unsafe match-pattern input is rejected", () => {
  assert.equal(normalizeHostname(".Docs.Example.COM."), "docs.example.com");
  assert.equal(normalizeHostname("127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeHostname("localhost"), "localhost");
  for (const invalid of ["bad host", "https://example.com", "-bad.example", "bad-.example", "a..b"] ) {
    assert.throws(() => normalizeHostname(invalid), /Invalid hostname/);
  }
});

test("normalization creates a detached settings object", () => {
  const source = {
    globalEnabled: true,
    sites: { one: { hostname: "example.com", profile: "normal" } },
  };
  const normalized = normalizeSettings(source);
  source.sites.one.profile = "strong";
  assert.equal(normalized.sites["example.com"].profile, "normal");
});
