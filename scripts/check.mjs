import { readFile, readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extension = path.join(root, "extension");
const manifest = JSON.parse(await readFile(path.join(extension, "manifest.json"), "utf8"));
const errors = [];

if (manifest.manifest_version !== 3) errors.push("manifest_version must be 3");
for (const forbidden of ["tabs", "debugger", "webRequest", "clipboardRead", "clipboardWrite", "cookies", "downloads"]) {
  if (manifest.permissions?.includes(forbidden)) errors.push(`forbidden permission: ${forbidden}`);
}
if (manifest.host_permissions?.length) errors.push("host permissions must remain optional");

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

const files = await walk(extension);
let bytes = 0;
for (const file of files) {
  bytes += (await stat(file)).size;
  if (file.endsWith(".js")) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) {
      errors.push(`${path.relative(root, file)}: ${result.stderr.trim()}`);
    }
  }
}

const budget = 60 * 1024;
if (bytes > budget) errors.push(`extension is ${bytes} bytes; budget is ${budget}`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Static checks passed (${bytes} bytes, ${files.length} files).`);
}
