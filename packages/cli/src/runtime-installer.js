import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const DEFAULT_RELEASE_MANIFEST_URL = "https://pub-2ad7ea477e7d42d39847b6376c82e059.r2.dev/stable.json";

function platformKey() {
  return `${process.platform}-${process.arch}`;
}

function executable(root, relative) {
  return path.join(root, ...relative.split("/"));
}

function commandExists(command) {
  if (!command) return false;
  if (command.includes(path.sep)) return fs.existsSync(command);
  return (process.env.PATH || "").split(path.delimiter).some((entry) => fs.existsSync(path.join(entry, command)));
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "user-agent": "autopost-cli" } });
  if (!response.ok) throw new Error(`Unable to fetch AutoPost release manifest: HTTP ${response.status}`);
  return response.json();
}

async function download(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000), headers: { "user-agent": "autopost-cli" } });
  if (!response.ok || !response.body) throw new Error(`Unable to download AutoPost Runtime: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination, { mode: 0o600 }));
}

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function installUv(home, progress) {
  const candidates = [
    process.env.AUTOPOST_UV_BIN,
    path.join(home, "tools", "bin", "uv"),
    path.join(os.homedir(), ".local", "bin", "uv"),
    "uv",
  ].filter(Boolean);
  const existing = candidates.find(commandExists);
  if (existing) return existing;
  if (process.platform !== "darwin") throw new Error("Automatic uv installation currently supports Apple Silicon macOS only.");

  progress("Installing uv and managed Python support");
  const toolsBin = path.join(home, "tools", "bin");
  fs.mkdirSync(toolsBin, { recursive: true, mode: 0o700 });
  const installer = path.join(home, "downloads", "uv-install.sh");
  execFileSync("curl", ["-LsSf", "https://astral.sh/uv/install.sh", "-o", installer], { stdio: "inherit" });
  execFileSync("/bin/sh", [installer], {
    env: { ...process.env, UV_INSTALL_DIR: toolsBin, UV_NO_MODIFY_PATH: "1" },
    stdio: "inherit",
  });
  const installed = path.join(toolsBin, "uv");
  if (!fs.existsSync(installed)) throw new Error("uv installer completed without creating the expected executable.");
  return installed;
}

function installSau(runtimeDir, home, progress) {
  const sauDir = path.join(runtimeDir, "components", "sau");
  const sauBin = path.join(sauDir, ".venv", "bin", "sau");
  if (fs.existsSync(sauBin)) return { sauBin, sauDir };
  if (!fs.existsSync(path.join(sauDir, "uv.lock"))) throw new Error("Runtime does not contain the pinned SAU component.");

  const uv = installUv(home, progress);
  progress("Installing pinned SAU and Python dependencies");
  execFileSync(uv, ["sync", "--frozen", "--python", "3.12"], { cwd: sauDir, stdio: "inherit" });
  const patchright = path.join(sauDir, ".venv", "bin", "patchright");
  if (!fs.existsSync(patchright)) throw new Error("SAU installation did not create Patchright.");
  progress("Installing the managed Chromium browser");
  execFileSync(patchright, ["install", "chromium"], { cwd: sauDir, stdio: "inherit" });
  if (!fs.existsSync(sauBin)) throw new Error("SAU installation completed without creating its CLI.");
  return { sauBin, sauDir };
}

export async function installRuntime(options = {}) {
  const home = path.resolve(options.home);
  const progress = options.progress || (() => {});
  const manifestUrl = options.manifestUrl || process.env.AUTOPOST_RELEASE_MANIFEST_URL || DEFAULT_RELEASE_MANIFEST_URL;
  fs.mkdirSync(path.join(home, "downloads"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(home, "runtime"), { recursive: true, mode: 0o700 });

  progress(`Reading release manifest from ${manifestUrl}`);
  const release = await fetchJson(manifestUrl);
  const selected = release.platforms?.[platformKey()];
  if (!selected) throw new Error(`AutoPost Runtime does not support ${platformKey()} in the selected release.`);
  if (selected.archive !== "tar.gz") throw new Error(`Unsupported Runtime archive: ${selected.archive}`);

  const versionDir = path.join(home, "runtime", selected.runtime_version);
  const runtimeManifest = path.join(versionDir, "runtime.json");
  if (!fs.existsSync(runtimeManifest) || options.force) {
    const archivePath = path.join(home, "downloads", `runtime-${selected.runtime_version}-${platformKey()}.tar.gz`);
    const staging = path.join(home, "runtime", `.install-${selected.runtime_version}-${process.pid}`);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
    progress(`Downloading AutoPost Runtime ${selected.runtime_version}`);
    await download(selected.url, archivePath);
    const actualHash = sha256(archivePath);
    if (actualHash !== selected.sha256) {
      throw new Error(`Runtime checksum mismatch. Expected ${selected.sha256}, received ${actualHash}.`);
    }
    execFileSync("tar", ["-xzf", archivePath, "--strip-components=1", "-C", staging], { stdio: "inherit" });
    if (!fs.existsSync(path.join(staging, "runtime.json"))) throw new Error("Downloaded Runtime archive is missing runtime.json.");
    fs.rmSync(versionDir, { recursive: true, force: true });
    fs.renameSync(staging, versionDir);
  }

  const current = path.join(home, "runtime", "current");
  fs.rmSync(current, { recursive: true, force: true });
  fs.symlinkSync(versionDir, current, "dir");
  const component = installSau(versionDir, home, progress);
  const runnerExecutable = executable(versionDir, process.platform === "win32" ? "bin/autopost-runner.cmd" : "bin/autopost-runner");
  const runnerEntry = path.join(versionDir, "runner", "src", "main.mjs");
  return {
    release,
    runtimeDir: versionDir,
    runnerExecutable: fs.existsSync(runnerExecutable) ? runnerExecutable : null,
    runnerEntry,
    sauBin: component.sauBin,
    sauCwd: component.sauDir,
  };
}
