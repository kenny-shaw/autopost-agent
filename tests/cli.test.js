import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(repoRoot, "packages/cli/bin/autopost.js");
const postManifest = path.join(repoRoot, "examples/post.yaml");

function run(args, options = {}) {
  const result = spawnSync("node", [cli, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });

  const stdout = result.stdout.trim();
  return {
    status: result.status,
    stdout,
    stderr: result.stderr.trim(),
    json: stdout ? JSON.parse(stdout) : null,
  };
}

const schedule = run(["schedule", postManifest, "--now", "2026-07-09 19:00"]);
assert.equal(schedule.status, 0);
assert.equal(schedule.json.ok, true);
assert.deepEqual(
  Object.fromEntries(schedule.json.recommendations.map((item) => [item.platform, item.schedule.value])),
  {
    douyin: "2026-07-09 19:30",
    xiaohongshu: "2026-07-09 20:18",
    kuaishou: "2026-07-09 20:56",
    bilibili: "2026-07-09 20:24",
  },
);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopost-test-"));
const scheduledManifestPath = path.join(tempDir, "scheduled.yaml");
const lockedSchedule = run([
  "schedule",
  postManifest,
  "--now",
  "2026-07-09 19:00",
  "--write",
  scheduledManifestPath,
]);
assert.equal(lockedSchedule.status, 0);
assert.equal(lockedSchedule.json.written, scheduledManifestPath);

const scheduledManifest = YAML.parse(fs.readFileSync(scheduledManifestPath, "utf8"));
assert.equal(scheduledManifest.schedule, undefined);
assert.equal(scheduledManifest.platforms.douyin.schedule, "2026-07-09 19:30");
assert.equal(scheduledManifest.platforms.bilibili.schedule, "2026-07-09 20:24");
assert.equal(path.isAbsolute(scheduledManifest.video), true);
assert.equal(path.isAbsolute(scheduledManifest.cover), true);

const plan = run(["plan", scheduledManifestPath, "--allow-missing-files"]);
assert.equal(plan.status, 0);
const planByPlatform = Object.fromEntries(plan.json.plan.map((item) => [item.platform, item]));
assert.equal(planByPlatform.douyin.schedule.source, "manual");
assert.match(planByPlatform.douyin.sau, /--schedule '2026-07-09 19:30'/);
assert.match(planByPlatform.bilibili.sau, /--tid 249/);

const preparedManifestPath = path.join(tempDir, "prepared.yaml");
const prepare = run([
  "prepare",
  postManifest,
  "--now",
  "2026-07-09 19:00",
  "--write",
  preparedManifestPath,
  "--allow-missing-files",
]);
assert.equal(prepare.status, 0);
assert.equal(prepare.json.ok, true);
assert.equal(prepare.json.scheduled_manifest, preparedManifestPath);
assert.match(prepare.json.next.check, /autopost check /);
assert.match(prepare.json.next.publish, /autopost publish /);
const prepareByPlatform = Object.fromEntries(prepare.json.plan.map((item) => [item.platform, item]));
assert.equal(prepareByPlatform.douyin.schedule.value, "2026-07-09 19:30");
assert.equal(prepareByPlatform.douyin.schedule.source, "manual");

const runDir = path.join(tempDir, "runs");
const publish = run(["publish", scheduledManifestPath], {
  env: {
    AUTOPOST_RUN_DIR: runDir,
  },
});
assert.equal(publish.status, 1);
assert.equal(publish.json.ok, false);
assert.ok(publish.json.run_id);
assert.ok(fs.existsSync(publish.json.run_log));
assert.deepEqual(publish.json.results, []);

const status = run(["status", publish.json.run_id], {
  env: {
    AUTOPOST_RUN_DIR: runDir,
  },
});
assert.equal(status.status, 0);
assert.equal(status.json.ok, true);
assert.equal(status.json.run.run_id, publish.json.run_id);
assert.deepEqual(status.json.run.errors, publish.json.errors);

console.log("cli regression tests passed");
