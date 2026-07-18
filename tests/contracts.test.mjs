import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionRoot = path.join(root, "extension");
const read = (relative) => readFile(path.join(extensionRoot, relative), "utf8");

test("manifest remains dormant and least-privileged by default", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(new Set(manifest.permissions), new Set(["activeTab", "scripting", "storage"]));
  assert.deepEqual(manifest.optional_host_permissions, ["*://*/*"]);
  assert.equal(manifest.background.type, "module");
});

test("normal gateway stays event-driven and avoids continuous DOM work", async () => {
  const isolated = await read("content/isolated.js");
  assert.doesNotMatch(isolated, /MutationObserver/);
  assert.doesNotMatch(isolated, /setInterval\s*\(/);
  assert.match(isolated, /performance\.now\(\) < selectionGuardUntil/);
  assert.match(isolated, /event\.stopImmediatePropagation\(\)/);
  assert.match(isolated, /isInteractive\(event\.target\)/);
  assert.match(isolated, /document\.elementsFromPoint/);
});

test("selection highlight uses the USER cascade origin in every frame", async () => {
  const [worker, isolated, selectionCss] = await Promise.all([
    read("service-worker.js"),
    read("content/isolated.js"),
    read("content/selection.css"),
  ]);
  assert.match(worker, /origin:\s*"USER"/);
  assert.match(worker, /frameIds:\s*\[sender\.frameId\]/);
  assert.match(worker, /files:\s*\[SELECTION_STYLESHEET\]/);
  assert.doesNotMatch(isolated, /window\.top\s*===\s*window/);
  assert.match(selectionCss, /\*::selection/);
  assert.match(selectionCss, /background-color:\s*Highlight\s*!important/);
  assert.match(selectionCss, /color:\s*HighlightText\s*!important/);
});

test("MAIN-world patches are scoped and contain no dynamic code execution", async () => {
  const main = await read("content/main.js");
  for (const event of ["contextmenu", "copy", "cut", "paste", "selectstart", "dragstart"]) {
    assert.match(main, new RegExp(`"${event}"`));
  }
  assert.doesNotMatch(main, /\beval\s*\(/);
  assert.doesNotMatch(main, /new\s+Function\b/);
  assert.doesNotMatch(main, /XMLHttpRequest|fetch\s*\(|WebSocket/);
  assert.match(main, /milliseconds <= 1500 && containsDebugger/);
});

test("popup exposes accessible controls and readable profile guidance", async () => {
  const [html, css, script] = await Promise.all([
    read("popup/index.html"),
    read("popup/popup.css"),
    read("popup/popup.js"),
  ]);
  for (const id of ["enabled", "profile", "subdomains", "global", "status-text", "profile-description"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-label="Remove restrictions on this site"/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /color-scheme: dark/);
  assert.match(css, /min-width: 390px/);
  assert.match(css, /overflow: hidden/);
  assert.doesNotMatch(css, /(?:linear|radial)-gradient/);
  assert.match(script, /const PROFILE_UI = Object\.freeze/);
  assert.match(script, /send\(\{ type: "GET_STATE", hostname \}\)/);
  assert.doesNotMatch(html + css + script, /�/);
  assert.doesNotMatch(html + script, /[А-Яа-яЁё]/);
});

test("manifest icon set contains valid PNG assets", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  assert.deepEqual(Object.keys(manifest.icons), ["16", "32", "48", "128"]);
  assert.equal(manifest.action.default_icon["48"], "icons/icon48.png");
  for (const relative of Object.values(manifest.icons)) {
    const bytes = await readFile(path.join(extensionRoot, relative));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
});

test("packaged extension stays small and contains no remote URLs", async () => {
  async function walk(directory) {
    const files = [];
    for (const name of await readdir(directory)) {
      const file = path.join(directory, name);
      const info = await stat(file);
      if (info.isDirectory()) files.push(...await walk(file));
      else files.push(file);
    }
    return files;
  }

  const files = await walk(extensionRoot);
  let bytes = 0;
  for (const file of files) {
    bytes += (await stat(file)).size;
    if (!file.endsWith(".png")) {
      const text = await readFile(file, "utf8");
      assert.doesNotMatch(text, /https?:\/\//, path.relative(extensionRoot, file));
    }
  }
  assert.ok(bytes < 60 * 1024, `extension package is ${bytes} bytes`);
});
