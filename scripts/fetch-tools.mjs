#!/usr/bin/env node
// Downloads the third-party tools YouLoad bundles (yt-dlp, ffmpeg, Deno, zapret),
// verifies them by SHA-256 and lays them out in apps/desktop/src-tauri/resources/tools.
//
//   node scripts/fetch-tools.mjs          download and verify against tools.json
//   node scripts/fetch-tools.mjs --lock   also record hashes for entries that have none yet
//
// Every entry with an upstream checksum file is checked against it. Entries without one
// (the Flowseal zapret bundle) are trusted on first use and pinned by --lock.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "scripts", "tools.json");
const cacheDir = path.join(root, ".cache", "tools");
const outDir = path.join(root, "apps", "desktop", "src-tauri", "resources", "tools");
const lock = process.argv.includes("--lock");

const platformKey = (() => {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const os = { win32: "windows", darwin: "macos", linux: "linux" }[process.platform];
  return `${os}-${arch}`;
})();

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const tools = manifest[platformKey];
if (!tools) {
  console.error(`No tools pinned for ${platformKey} yet.`);
  process.exit(1);
}

const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function download(url, file) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, file);
}

async function upstreamHash(tool) {
  if (!tool.checksums) return null;
  const res = await fetch(tool.checksums, { redirect: "follow" });
  if (!res.ok) throw new Error(`${tool.checksums}: HTTP ${res.status}`);
  const text = await res.text();
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m && path.basename(m[2].trim()) === tool.checksumName) return m[1].toLowerCase();
  }
  // Deno publishes a PowerShell-style block: "Hash : <hex>"
  const ps = text.match(/Hash\s*:\s*([0-9a-fA-F]{64})/);
  if (ps) return ps[1].toLowerCase();
  throw new Error(`${tool.checksumName} not listed in ${tool.checksums}`);
}

// "*" matches within one path segment.
const globToRegex = (glob) =>
  new RegExp("^" + glob.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$");

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join("/")];
  });
}

function extractZip(archive, mapping, name) {
  const tmp = path.join(cacheDir, `x-${name}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  if (process.platform === "linux") execFileSync("unzip", ["-q", archive, "-d", tmp]);
  else if (process.platform === "win32") {
    // bsdtar from System32 reads zip; a GNU tar from Git Bash on PATH would not.
    execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", archive, "-C", tmp]);
  } else execFileSync("tar", ["-xf", archive, "-C", tmp]);
  const files = walk(tmp);
  for (const [glob, dest] of Object.entries(mapping)) {
    const re = globToRegex(glob);
    const hits = files.filter((f) => re.test(f));
    if (!hits.length) throw new Error(`${name}: nothing matches "${glob}"`);
    for (const f of hits) {
      const target = dest.endsWith("/") ? path.join(outDir, dest, path.posix.basename(f)) : path.join(outDir, dest);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(tmp, f), target);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// Pulls the YouTube rule (the one using list-google.txt on TCP 443) out of every
// Flowseal general*.bat and stores it as data, so the app never runs .bat files.
function buildStrategies() {
  const srcDir = path.join(outDir, "zapret", "strategies-src");
  const strategies = [];
  for (const file of fs.readdirSync(srcDir).sort()) {
    const text = fs.readFileSync(path.join(srcDir, file), "utf8").replace(/\^\r?\n/g, " ");
    const cmd = text.split(/\r?\n/).find((l) => l.includes("winws.exe"));
    if (!cmd) continue;
    const segment = cmd.split(/\s--new\s/).find((s) => s.includes("list-google.txt") && /--filter-tcp=443(\s|$)/.test(s));
    if (!segment) continue;
    const tokens = segment.match(/--[\w-]+(=("[^"]*"|\S+))?/g) ?? [];
    const args = tokens
      .filter((t) => !t.startsWith("--filter-tcp") && !t.startsWith("--hostlist") && !t.startsWith("--wf-"))
      .map((t) => t.replace(/"?%BIN%([^"\s]+)"?/g, "{fake}/$1").replace(/"/g, ""));
    if (args.some((a) => a.includes("%"))) continue; // relies on bat variables we do not support
    const label = file.replace(/^general\s*/, "").replace(/\.bat$/, "").replace(/[()]/g, "").trim() || "GENERAL";
    strategies.push({ id: label.toLowerCase().replace(/\s+/g, "-"), name: label, args });
  }
  const order = (s) => (s.id === "alt" ? 0 : s.id === "general" ? 1 : 2);
  strategies.sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id, "en", { numeric: true }));
  fs.writeFileSync(path.join(outDir, "zapret", "strategies.json"), JSON.stringify(strategies, null, 2));
  fs.rmSync(srcDir, { recursive: true, force: true });
  return strategies.length;
}

fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
let manifestChanged = false;

for (const [name, tool] of Object.entries(tools)) {
  const archive = path.join(cacheDir, path.posix.basename(new URL(tool.url).pathname));
  if (!fs.existsSync(archive)) {
    process.stdout.write(`↓ ${name} ${tool.version} … `);
    await download(tool.url, archive);
    console.log("ok");
  }
  const actual = sha256(archive);
  const upstream = await upstreamHash(tool);
  if (upstream && upstream !== actual) throw new Error(`${name}: hash ${actual} differs from upstream ${upstream}`);
  if (tool.sha256 && tool.sha256 !== actual) throw new Error(`${name}: hash ${actual} differs from pinned ${tool.sha256}`);
  if (!tool.sha256) {
    if (!lock) throw new Error(`${name}: no pinned hash. Run with --lock to pin ${actual}`);
    tool.sha256 = actual;
    manifestChanged = true;
  }
  console.log(`✓ ${name} ${tool.version} ${actual.slice(0, 16)}…${upstream ? " (matches upstream)" : ""}`);

  if (tool.kind === "file") {
    fs.copyFileSync(archive, path.join(outDir, tool.dest));
  } else {
    extractZip(archive, tool.extract, name);
  }
}

if (tools.zapret) console.log(`✓ zapret strategies: ${buildStrategies()}`);
fs.writeFileSync(
  path.join(outDir, "versions.json"),
  JSON.stringify(Object.fromEntries(Object.entries(tools).map(([k, t]) => [k, t.version])), null, 2),
);
if (manifestChanged) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log("Pinned new hashes in scripts/tools.json");
}
console.log(`Tools ready in ${path.relative(root, outDir)}`);
