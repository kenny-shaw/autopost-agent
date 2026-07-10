import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(repoRoot, "packages/cli/bin/autopost.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopost-agent-test-"));
const token = "test-runner-token";
const plan = { plan_id: "plan-1", plan_hash: "hash-1", deliveries: [{ platform: "douyin", account_alias: "main" }] };
const requests = [];
let minimumCliVersion = "0.2.1";

const server = http.createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const payload = body ? JSON.parse(body) : null;
  requests.push({ method: request.method, url: request.url, payload, authorization: request.headers.authorization });
  response.setHeader("content-type", "application/json");

  if (request.url === "/v1/health") return response.end(JSON.stringify({
    ok: true,
    health: {
      ok: true,
      compatibility: { api_version: "1", runner_version: "0.2.1", runtime_version: "0.2.1", minimum_cli_version: minimumCliVersion },
    },
  }));
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.statusCode = 401;
    return response.end(JSON.stringify({ ok: false, error: { message: "unauthorized" } }));
  }
  if (request.url === "/v1/capabilities") return response.end(JSON.stringify({ ok: true, platforms: ["douyin", "xiaohongshu", "kuaishou", "bilibili"] }));
  if (request.url === "/v1/accounts/login") {
    response.setHeader("content-type", "application/x-ndjson");
    response.write(`${JSON.stringify({ type: "output", text: "scan QR now\n" })}\n`);
    return response.end(`${JSON.stringify({ type: "result", ok: true, result: { platform: payload.platform, alias: payload.alias, status: "authenticated" } })}\n`);
  }
  if (request.url === "/v1/accounts/check") return response.end(JSON.stringify({ ok: true, account: { platform: payload.platform, alias: payload.alias, status: "authenticated" } }));
  if (request.url === "/v1/accounts") return response.end(JSON.stringify({ ok: true, accounts: [{ platform: "douyin", alias: "main" }] }));
  if (request.url === "/v1/plans") return response.end(JSON.stringify({ ok: true, plan }));
  if (request.url === "/v1/runs" && request.method === "POST") return response.end(JSON.stringify({ ok: true, run: { run_id: "run-1", status: "submitted" } }));
  if (request.url?.startsWith("/v1/runs?")) return response.end(JSON.stringify({ ok: true, runs: [{ run_id: "run-1" }] }));
  if (request.url === "/v1/runs/run-1?attempts=true") return response.end(JSON.stringify({ ok: true, run: { run_id: "run-1" }, attempts: [] }));
  if (request.url === "/v1/runs/run-1/retry") return response.end(JSON.stringify({ ok: true, run: { run_id: "run-1", status: "submitted" } }));
  response.statusCode = 404;
  response.end(JSON.stringify({ ok: false, error: { message: "not found" } }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
fs.writeFileSync(path.join(tempDir, "runner.json"), `${JSON.stringify({ token, host: "127.0.0.1", port: address.port })}\n`);

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: repoRoot,
      env: { ...process.env, AUTOPOST_HOME: tempDir },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr, json: stdout ? JSON.parse(stdout) : null }));
  });
}

try {
  const doctor = await run(["doctor"]);
  assert.equal(doctor.status, 0);
  assert.equal(doctor.json.runner.ok, true);
  assert.equal(doctor.json.cli_version, "0.2.1");
  assert.equal(doctor.json.config.token, "<redacted>");

  const capabilities = await run(["capabilities"]);
  assert.deepEqual(capabilities.json.platforms, ["douyin", "xiaohongshu", "kuaishou", "bilibili"]);

  const login = await run(["account", "login", "douyin", "--name", "main"]);
  assert.equal(login.status, 0);
  assert.match(login.stderr, /scan QR now/);
  assert.equal(login.json.result.status, "authenticated");

  const accountCheck = await run(["account", "check", "douyin", "--name", "main"]);
  assert.equal(accountCheck.json.account.status, "authenticated");
  assert.equal(requests.at(-1).payload.alias, "main");

  const prepared = await run(["post", "prepare", path.join(repoRoot, "examples/post.yaml")]);
  assert.equal(prepared.status, 0);
  assert.equal(prepared.json.plan.plan_hash, "hash-1");
  assert.match(prepared.json.next_actions[0].command, /--confirm hash-1/);
  const planRequest = requests.find((item) => item.url === "/v1/plans");
  assert.equal(planRequest.payload.manifest.schema_version, "1");
  assert.equal(planRequest.payload.base_dir, path.join(repoRoot, "examples"));

  const missingConfirmation = await run(["post", "publish", "plan-1"]);
  assert.equal(missingConfirmation.status, 1);
  assert.match(missingConfirmation.json.error.message, /requires --confirm/);

  const published = await run(["post", "publish", "plan-1", "--confirm", "hash-1", "--headed"]);
  assert.equal(published.status, 0);
  assert.equal(published.json.run.run_id, "run-1");
  const publishRequest = requests.find((item) => item.url === "/v1/runs" && item.method === "POST");
  assert.deepEqual(publishRequest.payload, { plan_id: "plan-1", confirm: "hash-1", new_run: false, headed: true });

  const runs = await run(["run", "list", "--limit", "10"]);
  assert.equal(runs.json.runs[0].run_id, "run-1");
  const runDetails = await run(["run", "get", "run-1", "--attempts"]);
  assert.deepEqual(runDetails.json.attempts, []);
  const retry = await run(["run", "retry", "run-1", "--headless"]);
  assert.equal(retry.json.run.status, "submitted");
  assert.deepEqual(requests.at(-1).payload, { headed: false });

  minimumCliVersion = "9.0.0";
  const incompatible = await run(["doctor"]);
  assert.equal(incompatible.status, 1);
  assert.match(incompatible.json.issues[0], /requires CLI 9\.0\.0/);
  minimumCliVersion = "0.2.1";

  assert.ok(requests.filter((item) => item.url !== "/v1/health").every((item) => item.authorization === `Bearer ${token}`));
  console.log("agent CLI contract tests passed");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
}
