#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { installRuntime } from "../src/runtime-installer.js";

const CLI_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(CLI_FILE), "../../..");
const BOOLEAN_OPTIONS = new Set(["headed", "headless", "new-run", "attempts", "force", "help"]);
const CLI_VERSION = "0.2.4";
const API_VERSION = "1";
const MIN_RUNNER_VERSION = "0.2.2";
let runnerCompatibilityChecked = false;

function compareVersions(left, right) {
  const a = String(left).split(".").map(Number);
  const b = String(right).split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function runnerCompatibility(payload) {
  const compatibility = payload?.health?.compatibility;
  if (!compatibility) return { ok: false, issue: "Runner does not expose compatibility metadata. Update AutoPost Runtime." };
  if (compatibility.api_version !== API_VERSION) {
    return { ok: false, issue: `CLI API ${API_VERSION} is incompatible with Runner API ${compatibility.api_version}. Update AutoPost CLI and Runtime.` };
  }
  if (compareVersions(compatibility.runner_version, MIN_RUNNER_VERSION) < 0) {
    return { ok: false, issue: `Runner ${compatibility.runner_version} is older than required ${MIN_RUNNER_VERSION}. Update AutoPost Runtime.` };
  }
  if (compareVersions(CLI_VERSION, compatibility.minimum_cli_version) < 0) {
    return { ok: false, issue: `Runner requires CLI ${compatibility.minimum_cli_version} or newer; current CLI is ${CLI_VERSION}.` };
  }
  return { ok: true, compatibility };
}

function autopostHome() {
  return path.resolve(process.env.AUTOPOST_HOME || path.join(os.homedir(), ".autopost"));
}

function configPath() {
  return path.join(autopostHome(), "runner.json");
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const [key, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) options[key] = inline;
    else if (BOOLEAN_OPTIONS.has(key)) options[key] = true;
    else {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`Missing value for --${key}`);
      options[key] = next;
      index += 1;
    }
  }
  return { positional, options };
}

function output(value, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = exitCode;
}

function openLocalArtifact(artifact) {
  if (artifact?.kind !== "qrcode" || !artifact.path || !fs.existsSync(artifact.path)) return;
  const commands = process.platform === "darwin"
    ? [["open", [artifact.path]]]
    : process.platform === "win32"
      ? [["cmd", ["/c", "start", "", artifact.path]]]
      : [["xdg-open", [artifact.path]]];
  const [command, args] = commands[0];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

function usage(exitCode = 0) {
  output({
    ok: exitCode === 0,
    schema_version: "1",
    usage: "autopost <setup|update|doctor|runner|capabilities|account|post|run> ...",
    commands: {
      setup: "Configure and start the local Runner.",
      update: "Install the latest compatible local Runtime.",
      doctor: "Check CLI, Runner, and SAU health.",
      runner: "Start, stop, or inspect the local Runner.",
      capabilities: "List supported platform capabilities.",
      account: "List, log in, or check local platform accounts.",
      post: "Validate, prepare, or publish a manifest.",
      run: "List, inspect, or retry publication runs.",
    },
  }, exitCode);
}

function commandExists(command) {
  if (command.includes(path.sep)) return fs.existsSync(command);
  return (process.env.PATH || "").split(path.delimiter).some((entry) => fs.existsSync(path.join(entry, command)));
}

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && (candidate.includes(path.sep) ? fs.existsSync(candidate) : commandExists(candidate))) || null;
}

function defaultRunnerEntry() {
  return firstExisting([process.env.AUTOPOST_RUNNER_ENTRY, path.resolve(REPO_ROOT, "../autopost/apps/runner/src/main.mjs")]);
}

function defaultSauBin() {
  return firstExisting([
    process.env.AUTOPOST_SAU_BIN,
    path.resolve(REPO_ROOT, "../autopost-sau/.venv/bin/sau"),
    "sau",
  ]);
}

function sauWorkingDirectory(sauBin) {
  if (!sauBin?.includes(path.sep)) return process.cwd();
  const parent = path.dirname(sauBin);
  return path.basename(parent) === "bin" && path.basename(path.dirname(parent)) === ".venv"
    ? path.resolve(parent, "../..")
    : path.dirname(sauBin);
}

function readConfig(required = true) {
  const file = configPath();
  if (!fs.existsSync(file)) {
    if (!required) return null;
    throw new Error("AutoPost is not configured. Run `autopost setup` first.");
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeConfig(config) {
  fs.mkdirSync(autopostHome(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(configPath(), 0o600);
}

function runnerUrl(config) {
  return process.env.AUTOPOST_RUNNER_URL || `http://${config.host || "127.0.0.1"}:${config.port || 47821}`;
}

async function health(config = readConfig(false)) {
  if (!config) return null;
  try {
    const response = await fetch(`${runnerUrl(config)}/v1/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

async function request(route, options = {}) {
  const config = readConfig();
  await ensureRunnerCompatibility(config);
  let response;
  try {
    response = await fetch(`${runnerUrl(config)}${route}`, {
      method: options.method || "GET",
      headers: { authorization: `Bearer ${config.token}`, ...(options.body ? { "content-type": "application/json" } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs || 35 * 60 * 1000),
    });
  } catch (error) {
    throw new Error(`Runner is unavailable: ${error.message}. Run \`autopost runner start\`.`);
  }
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error?.message || `Runner request failed with HTTP ${response.status}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function ensureRunnerCompatibility(config = readConfig()) {
  if (runnerCompatibilityChecked) return;
  const payload = await health(config);
  if (!payload) throw new Error("Runner is not running. Run `autopost runner start`.");
  const result = runnerCompatibility(payload);
  if (!result.ok) {
    process.stderr.write(`[autopost] ${result.issue}\n[autopost] Restarting with the latest configured Runtime.\n`);
    try { await stopRunner(); } catch {}
    await setup({ force: true });
    const updated = await health(config);
    const updatedResult = runnerCompatibility(updated);
    if (!updatedResult.ok) throw new Error(updatedResult.issue);
  }
  runnerCompatibilityChecked = true;
}

async function streamLogin(body) {
  const config = readConfig();
  await ensureRunnerCompatibility(config);
  const response = await fetch(`${runnerUrl(config)}/v1/accounts/login`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) throw new Error(`Runner login request failed with HTTP ${response.status}`);
  const decoder = new TextDecoder();
  let buffer = "";
  let final = null;
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.type === "output") process.stderr.write(event.text);
      if (event.type === "artifact") {
        process.stderr.write(`\nLogin QR code: ${event.artifact.path}\n`);
        openLocalArtifact(event.artifact);
      }
      if (event.type === "result") final = event;
    }
  }
  if (!final) throw new Error("Runner login stream ended without a result");
  if (!final.ok) {
    const error = new Error(final.result?.error?.message || "Platform login failed");
    error.payload = final;
    throw error;
  }
  return final;
}

async function startRunner() {
  const config = readConfig();
  const running = await health(config);
  if (running) {
    const compatibility = runnerCompatibility(running);
    if (!compatibility.ok) throw new Error(compatibility.issue);
    return { already_running: true, health: running };
  }
  const runnerExecutable = config.runner_executable && fs.existsSync(config.runner_executable) ? config.runner_executable : null;
  if (!runnerExecutable && (!config.runner_entry || !fs.existsSync(config.runner_entry))) {
    throw new Error(`Runner executable or entry was not found. Run \`autopost setup\` again.`);
  }
  const logDir = config.log_dir || path.join(autopostHome(), "logs");
  fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
  const stdout = fs.openSync(path.join(logDir, "runner.log"), "a");
  const stderr = fs.openSync(path.join(logDir, "runner-error.log"), "a");
  const command = runnerExecutable && process.platform === "win32" ? "cmd.exe" : runnerExecutable || process.execPath;
  const commandArgs = runnerExecutable
    ? process.platform === "win32" ? ["/d", "/s", "/c", runnerExecutable] : []
    : [config.runner_entry];
  const child = spawn(command, commandArgs, {
    cwd: runnerExecutable ? path.dirname(runnerExecutable) : path.dirname(config.runner_entry),
    env: {
      ...process.env,
      AUTOPOST_HOME: autopostHome(),
      AUTOPOST_RUNTIME_DIR: config.runtime_dir,
      AUTOPOST_ACCOUNT_DIR: config.account_dir,
      AUTOPOST_SAU_BIN: config.sau_bin,
      AUTOPOST_SAU_CWD: config.sau_cwd,
    },
    detached: true,
    stdio: ["ignore", stdout, stderr],
  });
  child.unref();
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const result = await health(config);
    if (result) return { already_running: false, pid: child.pid, health: result };
  }
  throw new Error(`Runner did not become healthy. Inspect ${path.join(logDir, "runner-error.log")}`);
}

async function stopRunner() {
  const pidPath = path.join(autopostHome(), "runner.pid");
  if (!fs.existsSync(pidPath)) return { stopped: false, reason: "Runner PID file not found" };
  const pid = Number(fs.readFileSync(pidPath, "utf8").trim());
  try { process.kill(pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (!(await health(readConfig(false)))) return { stopped: true, pid };
  }
  throw new Error(`Runner process ${pid} did not stop cleanly`);
}

async function setup(options) {
  const existing = readConfig(false) || {};
  const home = autopostHome();
  let runtimeDir = path.resolve(options["runtime-dir"] || existing.runtime_dir || path.join(home, "runtime", "current"));
  const installedExecutable = path.join(runtimeDir, "bin", process.platform === "win32" ? "autopost-runner.cmd" : "autopost-runner");
  let runnerExecutableValue = options["runner-executable"] || existing.runner_executable || (fs.existsSync(installedExecutable) ? installedExecutable : null);
  let runnerEntryValue = options["runner-entry"] || existing.runner_entry || defaultRunnerEntry();
  let sauBin = options["sau-bin"] || existing.sau_bin || defaultSauBin();
  let sauCwd = options["sau-cwd"] || existing.sau_cwd || sauWorkingDirectory(sauBin);
  const hasRunner = Boolean((runnerExecutableValue && fs.existsSync(runnerExecutableValue)) || (runnerEntryValue && fs.existsSync(runnerEntryValue)));
  const hasSau = Boolean(sauBin && commandExists(sauBin));
  const explicitLocalRuntime = Boolean(options["runner-executable"] || options["runner-entry"] || options["sau-bin"]);
  let managedRuntime = Boolean(existing.managed_runtime);
  if (options.force || (!explicitLocalRuntime && managedRuntime) || !hasRunner || !hasSau) {
    const installed = await installRuntime({
      home,
      force: Boolean(options.force),
      manifestUrl: options["manifest-url"],
      progress: (message) => process.stderr.write(`[autopost setup] ${message}\n`),
    });
    runtimeDir = installed.runtimeDir;
    runnerExecutableValue = installed.runnerExecutable;
    runnerEntryValue = installed.runnerEntry;
    sauBin = installed.sauBin;
    sauCwd = installed.sauCwd;
    managedRuntime = true;
  }
  const runnerExecutable = runnerExecutableValue ? path.resolve(runnerExecutableValue) : null;
  const runnerEntry = runnerEntryValue ? path.resolve(runnerEntryValue) : null;
  if (runnerExecutable && !fs.existsSync(runnerExecutable)) throw new Error(`AutoPost Runner executable was not found: ${runnerExecutable}`);
  if (!runnerExecutable && (!runnerEntry || !fs.existsSync(runnerEntry))) {
    throw new Error("AutoPost Runtime or Runner source was not found. Pass --runner-executable or --runner-entry.");
  }
  if (!sauBin || !commandExists(sauBin)) throw new Error("SAU executable was not found. Pass --sau-bin <path>.");
  const config = {
    schema_version: "1",
    host: existing.host || "127.0.0.1",
    port: Number(options.port || existing.port || 47821),
    token: existing.token || randomBytes(32).toString("hex"),
    managed_runtime: managedRuntime,
    runtime_dir: runtimeDir,
    runner_executable: runnerExecutable,
    runner_entry: runnerEntry,
    sau_bin: sauBin,
    sau_cwd: sauCwd,
    database: existing.database || path.join(home, "data", "autopost.db"),
    account_dir: existing.account_dir || path.join(home, "accounts"),
    evidence_dir: existing.evidence_dir || path.join(home, "evidence"),
    log_dir: existing.log_dir || path.join(home, "logs"),
  };
  writeConfig(config);
  const started = await startRunner();
  return { config: { ...config, token: "<redacted>" }, started };
}

function readManifest(filePath) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) throw new Error(`Manifest not found: ${filePath}`);
  const text = fs.readFileSync(absolute, "utf8");
  return { absolute, baseDir: path.dirname(absolute), manifest: absolute.endsWith(".json") ? JSON.parse(text) : YAML.parse(text) };
}

async function prepareManifest(filePath, command = "prepare") {
  const { absolute, baseDir, manifest } = readManifest(filePath);
  const result = await request("/v1/plans", { method: "POST", body: { manifest, base_dir: baseDir, source_manifest: absolute } });
  return {
    ...result,
    command,
    next_actions: command === "prepare" ? [{ command: `autopost post publish ${result.plan.plan_id} --confirm ${result.plan.plan_hash}` }] : [],
  };
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const [command, action, target] = positional;
  if (!command || command === "help") return usage(0);
  if (command === "setup") return output({ ok: true, schema_version: "1", command: "setup", ...(await setup(options)) });
  if (command === "update") {
    if (await health(readConfig(false))) await stopRunner();
    return output({ ok: true, schema_version: "1", command: "update", ...(await setup({ ...options, force: true })) });
  }
  if (command === "doctor") {
    const config = readConfig(false);
    const runnerHealth = await health(config);
    const compatibility = runnerHealth ? runnerCompatibility(runnerHealth) : null;
    return output({
      ok: Boolean(config && runnerHealth && compatibility?.ok), schema_version: "1", command: "doctor", configured: Boolean(config),
      cli_version: CLI_VERSION,
      runner: runnerHealth?.health || null,
      config: config ? { path: configPath(), managed_runtime: Boolean(config.managed_runtime), runtime_dir: config.runtime_dir, runner_executable: config.runner_executable, runner_entry: config.runner_entry, sau_bin: config.sau_bin, token: "<redacted>" } : null,
      issues: [!config ? "Run autopost setup." : null, config && !runnerHealth ? "Runner is not running." : null, compatibility && !compatibility.ok ? compatibility.issue : null].filter(Boolean),
    }, config && runnerHealth && compatibility?.ok ? 0 : 1);
  }
  if (command === "runner") {
    if (action === "start") return output({ ok: true, command: "runner start", ...(await startRunner()) });
    if (action === "stop") return output({ ok: true, command: "runner stop", ...(await stopRunner()) });
    if (action === "status") {
      const result = await health();
      return output({ ok: Boolean(result), command: "runner status", health: result?.health || null }, result ? 0 : 1);
    }
    return usage(1);
  }
  if (command === "capabilities") return output({ ...(await request("/v1/capabilities")), command });
  if (command === "account") {
    if (action === "list") return output({ ...(await request("/v1/accounts")), command: "account list" });
    if (!["login", "check"].includes(action) || !target || !options.name) throw new Error("Usage: autopost account <login|check> <platform> --name <alias>");
    if (action === "login") return output({ ...(await streamLogin({ platform: target, alias: options.name, headed: !options.headless })), command: "account login" });
    return output({ ...(await request("/v1/accounts/check", { method: "POST", body: { platform: target, alias: options.name } })), command: "account check" });
  }
  if (command === "post") {
    if (!["validate", "prepare", "publish"].includes(action) || !target) return usage(1);
    if (action !== "publish") return output(await prepareManifest(target, action));
    if (!options.confirm) throw new Error("Publishing requires --confirm <plan-hash> from `autopost post prepare`.");
    let planId = target;
    if (fs.existsSync(path.resolve(target))) {
      const prepared = await prepareManifest(target);
      planId = prepared.plan.plan_id;
      if (prepared.plan.plan_hash !== options.confirm) throw new Error("Manifest changed after confirmation. Run prepare again and review the new plan.");
    }
    const body = { plan_id: planId, confirm: options.confirm, idempotency_key: options["idempotency-key"], new_run: Boolean(options["new-run"]) };
    if (options.headed) body.headed = true;
    if (options.headless) body.headed = false;
    return output({ ...(await request("/v1/runs", { method: "POST", body })), command: "post publish" });
  }
  if (command === "run") {
    if (action === "list") return output({ ...(await request(`/v1/runs?limit=${encodeURIComponent(options.limit || 50)}`)), command: "run list" });
    if (action === "get" && target) return output({ ...(await request(`/v1/runs/${encodeURIComponent(target)}?attempts=${Boolean(options.attempts)}`)), command: "run get" });
    if (action === "retry" && target) {
      const body = {};
      if (options.headed) body.headed = true;
      if (options.headless) body.headed = false;
      return output({ ...(await request(`/v1/runs/${encodeURIComponent(target)}/retry`, { method: "POST", body })), command: "run retry" });
    }
    return usage(1);
  }
  usage(1);
}

main().catch((error) => {
  output(error.payload || { ok: false, schema_version: "1", error: { code: "internal_error", message: error.message, retriable: false } }, 1);
});
