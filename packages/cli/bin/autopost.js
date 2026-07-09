#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const STABLE_PLATFORMS = new Set(["douyin", "xiaohongshu", "kuaishou", "bilibili"]);
const EXPERIMENTAL_PLATFORMS = new Set(["tencent", "youtube"]);
const SUPPORTED_PLATFORMS = new Set([...STABLE_PLATFORMS, ...EXPERIMENTAL_PLATFORMS]);
const CLI_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(CLI_FILE), "../../..");
const SAU_BIN = resolveSauBin();

function resolveSauBin() {
  if (process.env.AUTOPOST_SAU_BIN) return process.env.AUTOPOST_SAU_BIN;

  const localCandidates = [
    path.resolve(REPO_ROOT, "../social-auto-upload/.venv/bin/sau"),
    path.resolve(process.cwd(), "../social-auto-upload/.venv/bin/sau"),
  ];

  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return "sau";
}

function printJson(payload, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = exitCode;
}

function usage(exitCode = 0) {
  printJson(
    {
      ok: exitCode === 0,
      usage: "autopost <doctor|login|check|plan|publish|status> [file-or-run-id]",
      commands: {
        doctor: "Check local runtime prerequisites.",
        login: "Run sau login for accounts in a manifest.",
        check: "Run sau check for accounts in a manifest.",
        plan: "Validate a post manifest and print sau commands without publishing.",
        publish: "Run sau upload-video commands from a post manifest.",
        status: "Placeholder for future run logs.",
      },
      environment: {
        AUTOPOST_SAU_BIN: "Override the sau executable path.",
      },
    },
    exitCode,
  );
}

function parseArgs(argv) {
  const flags = new Set();
  const values = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      values[rawKey] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      values[rawKey] = argv[index + 1];
      index += 1;
    } else {
      flags.add(rawKey);
    }
  }

  return { positional, flags, values };
}

function commandResult(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio || "pipe",
    env: { ...process.env, ...(options.env || {}) },
  });

  return {
    command,
    args,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? result.error.message : null,
  };
}

function commandExists(command) {
  if (command.includes("/") || command.includes("\\")) {
    return fs.existsSync(command);
  }

  const checker = process.platform === "win32" ? "where" : "which";
  const result = commandResult(checker, [command]);
  return result.status === 0;
}

function readYamlFile(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  return {
    absolutePath,
    data: YAML.parse(fs.readFileSync(absolutePath, "utf8")),
  };
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function tagsString(tags) {
  return asArray(tags)
    .map((tag) => String(tag).trim().replace(/^#/, ""))
    .filter(Boolean)
    .join(",");
}

function resolveMaybeFile(baseDir, value) {
  if (!value) return null;
  return path.resolve(baseDir, String(value));
}

function platformEntries(manifest) {
  return Object.entries(manifest.platforms || {}).map(([platform, config]) => [
    platform,
    config && typeof config === "object" ? config : {},
  ]);
}

function mergePlatform(manifest, platformConfig) {
  return {
    account: platformConfig.account,
    title: platformConfig.title || manifest.title,
    description: platformConfig.description || platformConfig.desc || manifest.description || "",
    tags: platformConfig.tags || manifest.tags || [],
    video: platformConfig.video || manifest.video,
    cover: platformConfig.cover || platformConfig.thumbnail || manifest.cover || manifest.thumbnail,
    thumbnailLandscape:
      platformConfig.thumbnailLandscape ||
      platformConfig.thumbnail_landscape ||
      manifest.thumbnailLandscape ||
      manifest.thumbnail_landscape,
    thumbnailPortrait:
      platformConfig.thumbnailPortrait ||
      platformConfig.thumbnail_portrait ||
      manifest.thumbnailPortrait ||
      manifest.thumbnail_portrait,
    schedule: platformConfig.schedule || manifest.schedule,
    tid: platformConfig.tid || manifest.tid,
    productLink: platformConfig.productLink || platformConfig.product_link || manifest.productLink || manifest.product_link,
    productTitle: platformConfig.productTitle || platformConfig.product_title || manifest.productTitle || manifest.product_title,
    playlist: platformConfig.playlist || manifest.playlist,
    visibility: platformConfig.visibility || manifest.visibility,
    headless: platformConfig.headless ?? manifest.headless,
    debug: platformConfig.debug ?? manifest.debug,
  };
}

function validatePostManifest(manifest, baseDir, options = {}) {
  const errors = [];
  const warnings = [];

  if (!manifest || typeof manifest !== "object") {
    return {
      errors: ["Manifest must be a YAML object."],
      warnings,
      plan: [],
    };
  }

  if (!manifest.title) errors.push("Missing required field: title.");
  if (!manifest.video) errors.push("Missing required field: video.");
  if (!manifest.platforms || typeof manifest.platforms !== "object") {
    errors.push("Missing required field: platforms.");
  }

  const videoPath = resolveMaybeFile(baseDir, manifest.video);
  if (videoPath && !fs.existsSync(videoPath)) {
    const message = `Video file does not exist: ${manifest.video}`;
    if (options.allowMissingFiles) warnings.push(message);
    else errors.push(message);
  }

  const coverPath = resolveMaybeFile(baseDir, manifest.cover || manifest.thumbnail);
  if (coverPath && !fs.existsSync(coverPath)) {
    warnings.push(`Cover file does not exist: ${manifest.cover || manifest.thumbnail}`);
  }

  const plan = [];
  for (const [platform, config] of platformEntries(manifest)) {
    if (!SUPPORTED_PLATFORMS.has(platform)) {
      errors.push(`Unsupported platform: ${platform}`);
      continue;
    }

    if (!STABLE_PLATFORMS.has(platform)) {
      warnings.push(`Platform is experimental in AutoPost: ${platform}`);
    }

    const merged = mergePlatform(manifest, config);
    if (!merged.account) errors.push(`Missing account for platform: ${platform}`);
    if (!merged.title) errors.push(`Missing title for platform: ${platform}`);
    if (platform === "bilibili" && !merged.tid) {
      errors.push("Missing Bilibili required field: tid.");
    }
    if (platform === "xiaohongshu" && asArray(merged.tags).length > 10) {
      errors.push("Xiaohongshu supports at most 10 tags.");
    }

    plan.push({
      platform,
      account: merged.account || null,
      stable: STABLE_PLATFORMS.has(platform),
      command: buildSauUploadCommand(platform, merged, baseDir),
    });
  }

  return { errors, warnings, plan };
}

function validateAccountsManifest(manifest) {
  const errors = [];
  const warnings = [];
  const accounts = [];
  const root = manifest.accounts || manifest.platforms || manifest;

  if (!root || typeof root !== "object") {
    return {
      errors: ["Accounts manifest must be a YAML object."],
      warnings,
      accounts,
    };
  }

  for (const [platform, platformAccounts] of Object.entries(root)) {
    if (!SUPPORTED_PLATFORMS.has(platform)) {
      warnings.push(`Skipping unsupported platform in accounts manifest: ${platform}`);
      continue;
    }

    if (typeof platformAccounts === "string") {
      accounts.push({ platform, account: platformAccounts });
      continue;
    }

    if (!platformAccounts || typeof platformAccounts !== "object") {
      errors.push(`Accounts for ${platform} must be an object or string.`);
      continue;
    }

    for (const account of Object.keys(platformAccounts)) {
      accounts.push({ platform, account });
    }
  }

  return { errors, warnings, accounts };
}

function buildSauUploadCommand(platform, config, baseDir) {
  const args = [
    platform,
    "upload-video",
    "--account",
    String(config.account || ""),
    "--file",
    resolveMaybeFile(baseDir, config.video) || "",
    "--title",
    String(config.title || ""),
    "--desc",
    String(config.description || ""),
  ];

  const tags = tagsString(config.tags);
  if (tags) args.push("--tags", tags);
  if (config.schedule) args.push("--schedule", String(config.schedule));
  if (config.debug) args.push("--debug");
  if (config.headless === false) args.push("--headed");
  if (config.headless === true) args.push("--headless");

  if (platform === "bilibili") {
    args.push("--tid", String(config.tid || ""));
  }

  if (platform === "douyin") {
    if (config.cover) args.push("--thumbnail", resolveMaybeFile(baseDir, config.cover));
    if (config.thumbnailLandscape) {
      args.push("--thumbnail-landscape", resolveMaybeFile(baseDir, config.thumbnailLandscape));
    }
    if (config.thumbnailPortrait) {
      args.push("--thumbnail-portrait", resolveMaybeFile(baseDir, config.thumbnailPortrait));
    }
    if (config.productLink) args.push("--product-link", String(config.productLink));
    if (config.productTitle) args.push("--product-title", String(config.productTitle));
  }

  if (platform === "kuaishou" || platform === "xiaohongshu" || platform === "youtube") {
    if (config.cover) args.push("--thumbnail", resolveMaybeFile(baseDir, config.cover));
  }

  if (platform === "youtube") {
    if (config.playlist) args.push("--playlist", String(config.playlist));
    if (config.visibility) args.push("--visibility", String(config.visibility));
  }

  return {
    bin: SAU_BIN,
    args: args.filter((item) => item !== null && item !== undefined && item !== ""),
  };
}

function accountCommands(accounts, action, headed) {
  return accounts.map(({ platform, account }) => {
    const args = [platform, action, "--account", account];
    if (action === "login" && platform !== "bilibili") {
      args.push(headed ? "--headed" : "--headless");
    }
    return { platform, account, command: { bin: SAU_BIN, args } };
  });
}

function runSauCommand(command, passthrough = false) {
  const result = commandResult(command.bin, command.args, {
    stdio: passthrough ? "inherit" : "pipe",
  });

  return {
    ok: result.status === 0,
    exit_code: result.status,
    signal: result.signal,
    command: `${command.bin} ${command.args.map(shellQuote).join(" ")}`,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    error: result.error,
  };
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function doctor() {
  const node = commandResult("node", ["--version"]);
  const npm = commandResult("npm", ["--version"]);
  const uvInstalled = commandExists("uv");
  const sauInstalled = commandExists(SAU_BIN);
  const python = commandResult("python3", ["--version"]);
  const pythonVersion = (python.stdout || python.stderr).trim();
  const sauHelp = sauInstalled ? commandResult(SAU_BIN, ["--help"]) : null;

  const issues = [];
  if (!uvInstalled) issues.push("uv is not installed or not on PATH.");
  if (!sauInstalled) issues.push(`${SAU_BIN} is not installed or not on PATH.`);
  if (!sauInstalled && !/^Python 3\.(10|11|12)\./.test(pythonVersion)) {
    issues.push("social-auto-upload requires Python >=3.10,<3.13 for setup.");
  }

  printJson({
    ok: issues.length === 0,
    command: "doctor",
    platform: os.platform(),
    tools: {
      node: node.stdout.trim() || node.stderr.trim(),
      npm: npm.stdout.trim() || npm.stderr.trim(),
      python3: pythonVersion,
      uv: uvInstalled,
      sau: sauInstalled,
      sau_bin: SAU_BIN,
      sau_help: sauHelp ? sauHelp.stdout.split("\n")[0] : null,
    },
    install_hint: [
      "git clone https://github.com/dreammis/social-auto-upload.git",
      "cd social-auto-upload",
      "uv venv",
      "source .venv/bin/activate",
      "uv pip install -e .",
      "PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright patchright install chromium",
      "cp conf.example.py conf.py",
    ],
    issues,
  }, issues.length === 0 ? 0 : 1);
}

function plan(filePath, options = {}) {
  const { absolutePath, data } = readYamlFile(filePath);
  const result = validatePostManifest(data, path.dirname(absolutePath), {
    allowMissingFiles: options.flags?.has("allow-missing-files"),
  });

  printJson({
    ok: result.errors.length === 0,
    command: "plan",
    manifest: absolutePath,
    stable_platforms: [...STABLE_PLATFORMS],
    experimental_platforms: [...EXPERIMENTAL_PLATFORMS],
    plan: result.plan.map((item) => ({
      platform: item.platform,
      account: item.account,
      stable: item.stable,
      sau: `${item.command.bin} ${item.command.args.map(shellQuote).join(" ")}`,
    })),
    warnings: result.warnings,
    errors: result.errors,
  }, result.errors.length === 0 ? 0 : 1);
}

function check(filePath) {
  const { absolutePath, data } = readYamlFile(filePath);
  const parsed = data.platforms ? validatePostManifest(data, path.dirname(absolutePath)) : validateAccountsManifest(data);

  if (parsed.errors.length > 0) {
    printJson({
      ok: false,
      command: "check",
      manifest: absolutePath,
      warnings: parsed.warnings,
      errors: parsed.errors,
    }, 1);
    return;
  }

  const accounts = parsed.accounts || parsed.plan.map((item) => ({
    platform: item.platform,
    account: item.account,
  }));

  if (!commandExists(SAU_BIN)) {
    printJson({
      ok: false,
      command: "check",
      manifest: absolutePath,
      errors: [`${SAU_BIN} is not installed or not on PATH. Run autopost doctor for setup hints.`],
    }, 1);
    return;
  }

  const results = accountCommands(accounts, "check").map((entry) => ({
    platform: entry.platform,
    account: entry.account,
    ...runSauCommand(entry.command),
  }));

  printJson({
    ok: results.every((result) => result.ok),
    command: "check",
    manifest: absolutePath,
    results,
  }, results.every((result) => result.ok) ? 0 : 1);
}

function login(filePath, options) {
  const { absolutePath, data } = readYamlFile(filePath);
  const parsed = data.platforms ? validatePostManifest(data, path.dirname(absolutePath)) : validateAccountsManifest(data);
  const accounts = parsed.accounts || parsed.plan.map((item) => ({
    platform: item.platform,
    account: item.account,
  }));

  if (!commandExists(SAU_BIN)) {
    printJson({
      ok: false,
      command: "login",
      manifest: absolutePath,
      errors: [`${SAU_BIN} is not installed or not on PATH. Run autopost doctor for setup hints.`],
    }, 1);
    return;
  }

  const commands = accountCommands(accounts, "login", options.flags.has("headed"));
  const results = [];
  for (const entry of commands) {
    const result = runSauCommand(entry.command, true);
    results.push({
      platform: entry.platform,
      account: entry.account,
      ok: result.ok,
      exit_code: result.exit_code,
      command: result.command,
    });
  }

  printJson({
    ok: results.every((result) => result.ok),
    command: "login",
    manifest: absolutePath,
    results,
  }, results.every((result) => result.ok) ? 0 : 1);
}

function publish(filePath) {
  const { absolutePath, data } = readYamlFile(filePath);
  const result = validatePostManifest(data, path.dirname(absolutePath));
  if (result.errors.length > 0) {
    printJson({
      ok: false,
      command: "publish",
      manifest: absolutePath,
      warnings: result.warnings,
      errors: result.errors,
    }, 1);
    return;
  }

  if (!commandExists(SAU_BIN)) {
    printJson({
      ok: false,
      command: "publish",
      manifest: absolutePath,
      errors: [`${SAU_BIN} is not installed or not on PATH. Run autopost doctor for setup hints.`],
    }, 1);
    return;
  }

  const results = [];
  for (const item of result.plan) {
    const upload = runSauCommand(item.command);
    results.push({
      platform: item.platform,
      account: item.account,
      ...upload,
    });
  }

  printJson({
    ok: results.every((entry) => entry.ok),
    command: "publish",
    manifest: absolutePath,
    warnings: result.warnings,
    results,
  }, results.every((entry) => entry.ok) ? 0 : 1);
}

function status(runId) {
  printJson({
    ok: false,
    command: "status",
    run_id: runId,
    message: "Run status storage is not implemented yet. Current publish results are printed synchronously.",
  }, 1);
}

const args = parseArgs(process.argv.slice(2));
const [command, argument] = args.positional;

try {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage(0);
  } else if (command === "doctor") {
    doctor();
  } else if (!argument) {
    usage(1);
  } else if (command === "plan") {
    plan(argument, args);
  } else if (command === "check") {
    check(argument);
  } else if (command === "login") {
    login(argument, args);
  } else if (command === "publish") {
    publish(argument);
  } else if (command === "status") {
    status(argument);
  } else {
    usage(1);
  }
} catch (error) {
  printJson(
    {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    },
    1,
  );
}
