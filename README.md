# AutoPost Agent

Public CLI and agent Skill for the local-first AutoPost publishing product.

## Quick Start

Install the Skill from GitHub:

```bash
npx skills add kenny-shaw/autopost-agent --skill autopost
```

The Skill uses the latest public CLI and performs an idempotent local setup:

```bash
npx --yes @kennyshaw/autopost@latest setup
```

On a new Apple Silicon Mac, setup downloads the compatible local Runtime,
verifies its SHA-256 checksum, installs pinned SAU/Python dependencies and the
managed Chromium browser, and starts the local Runner. Platform credentials and
video files remain on the user's machine.

The CLI is intentionally thin. It reads manifests, talks to the local AutoPost
Runner, and prints stable JSON. Platform browser logic, credentials, plans,
idempotency, run state, and retries belong to the private `autopost` product
repository. The Runner uses the pinned `sau` CLI from the maintained public
`autopost-sau` fork as its browser execution engine.

## Supported Video Platforms

- Douyin
- Xiaohongshu
- Kuaishou
- Bilibili

All four have passed controlled real-account submission tests and remain
experimental while post-publication confirmation is being hardened.

## Development Setup

```bash
npm install
npm link
npm run autopost -- setup \
  --runner-entry ../autopost/apps/runner/src/main.mjs \
  --sau-bin ../autopost-sau/.venv/bin/sau
npm run autopost -- doctor
```

The Runner configuration, token, SQLite database, logs, and evidence directory
live under `~/.autopost` by default. Override the location with `AUTOPOST_HOME`
for isolated testing.

## Account Workflow

```bash
npm run autopost -- account login douyin --name main
npm run autopost -- account check douyin --name main
npm run autopost -- account list
```

Douyin, Xiaohongshu, and Kuaishou open a visible Chromium window by default.
Bilibili runs in a local pseudo-terminal and streams its terminal QR code
through the Runner to the CLI.

## Safe Publishing Workflow

```bash
npm run autopost -- post prepare examples/post.yaml
autopost post publish <plan-id> --confirm <plan-hash> --headed
autopost run get <run-id> --attempts
```

`prepare` never publishes. `publish` requires the exact immutable plan hash.
The same plan is idempotent by default. Only deliveries in a safely retryable
state can be retried:

```bash
autopost run retry <run-id> --headed
```

`confirmation_unknown` is never retried automatically.

Start with the single-platform manifests in `examples/douyin.yaml`,
`examples/xiaohongshu.yaml`, `examples/kuaishou.yaml`, and
`examples/bilibili.yaml`. See [docs/local-setup.md](docs/local-setup.md) for the
complete platform-by-platform test sequence.
