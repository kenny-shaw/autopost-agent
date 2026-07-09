#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";

const SUPPORTED_PLATFORMS = new Set([
  "douyin",
  "xiaohongshu",
  "kuaishou",
  "bilibili",
]);

function printJson(payload, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = exitCode;
}

function usage(exitCode = 0) {
  printJson(
    {
      ok: exitCode === 0,
      usage: "autopost <plan|check|publish|status> <file-or-run-id>",
      commands: ["plan", "check", "publish", "status"],
    },
    exitCode,
  );
}

function readYamlFile(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(absolutePath, "utf8");
  return {
    absolutePath,
    data: YAML.parse(content),
  };
}

function validatePostManifest(manifest, baseDir) {
  const errors = [];
  const warnings = [];

  if (!manifest || typeof manifest !== "object") {
    errors.push("Manifest must be a YAML object.");
    return { errors, warnings, platforms: [] };
  }

  if (!manifest.title) errors.push("Missing required field: title.");
  if (!manifest.video) errors.push("Missing required field: video.");
  if (!manifest.platforms || typeof manifest.platforms !== "object") {
    errors.push("Missing required field: platforms.");
  }

  if (manifest.video) {
    const videoPath = path.resolve(baseDir, manifest.video);
    if (!fs.existsSync(videoPath)) {
      warnings.push(`Video file does not exist yet: ${manifest.video}`);
    }
  }

  if (manifest.cover) {
    const coverPath = path.resolve(baseDir, manifest.cover);
    if (!fs.existsSync(coverPath)) {
      warnings.push(`Cover file does not exist yet: ${manifest.cover}`);
    }
  }

  const platforms = Object.entries(manifest.platforms || {}).map(
    ([platform, config]) => {
      if (!SUPPORTED_PLATFORMS.has(platform)) {
        warnings.push(`Platform is not in the v0 stable scope: ${platform}`);
      }

      if (!config || typeof config !== "object") {
        errors.push(`Platform config must be an object: ${platform}`);
        return { platform, account: null, ready: false };
      }

      if (!config.account) {
        errors.push(`Missing account for platform: ${platform}`);
      }

      if (platform === "bilibili" && !config.tid) {
        errors.push("Missing Bilibili required field: tid.");
      }

      return {
        platform,
        account: config.account || null,
        ready: Boolean(config.account && (platform !== "bilibili" || config.tid)),
      };
    },
  );

  return { errors, warnings, platforms };
}

function plan(filePath) {
  const { absolutePath, data } = readYamlFile(filePath);
  const result = validatePostManifest(data, path.dirname(absolutePath));

  printJson({
    ok: result.errors.length === 0,
    command: "plan",
    manifest: absolutePath,
    stable_platforms: [...SUPPORTED_PLATFORMS],
    platforms: result.platforms,
    warnings: result.warnings,
    errors: result.errors,
    next: result.errors.length === 0 ? "publish is not wired yet" : "fix manifest errors",
  }, result.errors.length === 0 ? 0 : 1);
}

function check(filePath) {
  const { absolutePath, data } = readYamlFile(filePath);
  printJson({
    ok: true,
    command: "check",
    manifest: absolutePath,
    message: "Account checking is not wired yet.",
    accounts: data,
  });
}

function publish(filePath) {
  const { absolutePath, data } = readYamlFile(filePath);
  const result = validatePostManifest(data, path.dirname(absolutePath));
  printJson({
    ok: false,
    command: "publish",
    manifest: absolutePath,
    warnings: result.warnings,
    errors: result.errors,
    message: "Publishing is not wired yet. Run plan until the private orchestration layer is connected.",
  }, 1);
}

function status(runId) {
  printJson({
    ok: false,
    command: "status",
    run_id: runId,
    message: "Run status storage is not wired yet.",
  }, 1);
}

const [command, argument] = process.argv.slice(2);

try {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage(0);
  } else if (!argument) {
    usage(1);
  } else if (command === "plan") {
    plan(argument);
  } else if (command === "check") {
    check(argument);
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

