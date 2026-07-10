# Local Setup and Platform Testing

## Prerequisites

- Node.js 20
- `uv`
- Python 3.10, 3.11, or 3.12
- Patchright Chromium installed for `social-auto-upload`
- the `autopost`, `autopost-agent`, and clean `autopost-sau` repositories as
  sibling directories during development

Until the fork has its own packaged runtime, install its unmodified source:

```bash
cd ../autopost-sau
uv sync --frozen
PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright \
  .venv/bin/patchright install chromium
cp conf.example.py conf.py
```

Configure and start AutoPost:

```bash
cd ../autopost-agent
npm install
npm link
npm run autopost -- setup \
  --runner-entry ../autopost/apps/runner/src/main.mjs \
  --sau-bin ../autopost-sau/.venv/bin/sau
npm run autopost -- doctor
```

## Test Accounts First

Use non-critical test accounts and unique aliases:

```bash
autopost account login douyin --name test-dy
autopost account login xiaohongshu --name test-xhs
autopost account login kuaishou --name test-ks
autopost account login bilibili --name test-bili

autopost account check douyin --name test-dy
autopost account check xiaohongshu --name test-xhs
autopost account check kuaishou --name test-ks
autopost account check bilibili --name test-bili
```

For Douyin, Xiaohongshu, and Kuaishou, complete login in the visible browser.
For Bilibili, scan the terminal QR code streamed to the CLI.
The Runner selects QR login automatically and the CLI opens the generated image
with the operating system viewer.

## Prepare One Platform at a Time

Four ready-to-edit single-platform manifests are included. In the target file,
set `media.video` to your video, set the account alias to the alias used above,
and choose a unique title. A cover is optional. Confirm Bilibili's
`category_id` is appropriate for the video.

```bash
autopost post prepare examples/douyin.yaml
autopost post prepare examples/xiaohongshu.yaml
autopost post prepare examples/kuaishou.yaml
autopost post prepare examples/bilibili.yaml
```

Review these fields from the JSON response:

- `plan_id`
- `plan_hash`
- `media_sha256`
- platform and account
- resolved title, description, tags, cover, and schedule
- selected adapter

## Publish With a Visible Browser

For the first real attempt on each browser platform, use `--headed`:

```bash
autopost post publish <plan-id> --confirm <plan-hash> --headed
```

Do not manually click Publish unless the CLI explicitly reports that user
intervention is required. If the command fails after submission, inspect the
creator dashboard before retrying.

Test and inspect one platform completely before moving to the next. Do not put
all four into one real run until all four single-platform checks pass.

## Inspect and Retry

```bash
autopost run get <run-id> --attempts
autopost run list
autopost run retry <run-id> --headed
```

Only `failed` and `login_required` deliveries are retried. A timeout during the
upload command is represented as `confirmation_unknown` and requires manual
platform verification.

## Scheduling

Use an ISO 8601 instant and an IANA timezone:

```yaml
publish:
  mode: scheduled
  scheduled_at: "2026-07-12T12:30:00+08:00"
  timezone: "Asia/Shanghai"
```

The Runner converts it into the wall-clock format required by SAU.

## Stop or Restart the Runner

```bash
autopost runner status
autopost runner stop
autopost runner start
```

Diagnostics are stored in `~/.autopost/logs`; new installations store structured
state in `~/.autopost/data/autopost.db`. Existing installations retain the path
already recorded in `runner.json`. Do not share raw credential files or
unreviewed logs.
