---
name: autopost
version: 0.2.1
description: Publish local videos from Codex and AI agents to Douyin, Xiaohongshu, Kuaishou, and Bilibili with explicit confirmation and local account sessions.
requires:
  binaries:
    - npx
---

# AutoPost - Multi-Platform Video Publishing

Use AutoPost when the user wants to log in to, validate, prepare, publish, inspect,
or retry local video posts for Douyin, Xiaohongshu, Kuaishou, or Bilibili.

AutoPost runs the browser, account sessions, video files, and publishing Runtime
on the user's computer. Never invoke `sau` directly. Use the public CLI as the
only interface:

```bash
npx --yes @kennyshaw/autopost@latest <command>
```

## First Use And Updates

At the start of the first AutoPost task in a session, run:

```bash
npx --yes @kennyshaw/autopost@latest setup
```

This is idempotent. It checks the stable release manifest, installs or updates
the compatible local Runner and pinned SAU component, prepares managed Python
and Chromium when missing, starts the Runner, and preserves existing accounts
and publishing data.

The first installation can take several minutes because it downloads the local
browser. Report installation progress from stderr. Do not claim setup succeeded
until the final JSON has `ok: true`.

If `npx` is missing, Node.js 18 or newer is required. Ask for permission to
install Node.js using an appropriate trusted system method, then retry setup.
Do not replace the AutoPost installer with direct SAU installation.

Check health when diagnosing an existing installation:

```bash
npx --yes @kennyshaw/autopost@latest doctor
```

## Accounts

Account names are local aliases, not platform usernames or passwords.

```bash
npx --yes @kennyshaw/autopost@latest account list
npx --yes @kennyshaw/autopost@latest account check douyin --name main
npx --yes @kennyshaw/autopost@latest account login douyin --name main
npx --yes @kennyshaw/autopost@latest account login xiaohongshu --name main
npx --yes @kennyshaw/autopost@latest account login kuaishou --name main
npx --yes @kennyshaw/autopost@latest account login bilibili --name main
```

Ask the user to complete QR-code, browser, SMS, or CAPTCHA interaction when the
CLI requests it. The CLI opens generated login QR images locally. Never request,
display, transmit, or edit raw cookies, tokens, or browser storage.

## Create A Manifest

Create a YAML file in a user-writable working directory. Never place secrets in
it. Resolve the video path exactly and include only requested platforms.

```yaml
schema_version: "1"
post_id: "local-video-post"
media:
  video: "/absolute/path/to/video.mp4"
defaults:
  title: "Video title"
  description: ""
  tags: []
publish:
  mode: "now"
platforms:
  douyin:
    account: "main"
  xiaohongshu:
    account: "main"
  kuaishou:
    account: "main"
  bilibili:
    account: "main"
    category_id: 249
```

Remove platforms the user did not request. Xiaohongshu supports at most 10
tags. Bilibili requires a suitable `category_id`; do not silently invent a
specialized category when 249 is inappropriate. Scheduled publishing requires
an ISO 8601 `scheduled_at` and an IANA `timezone`.

## Required Publishing Workflow

1. Confirm the local video exists.
2. Run setup and check the target accounts.
3. Log in only when an account is missing or invalid.
4. Create the manifest.
5. Prepare it:

```bash
npx --yes @kennyshaw/autopost@latest post prepare /absolute/path/to/post.yaml
```

6. Present the resolved video, platforms, account aliases, title, description,
   tags, covers, schedule, warnings, `plan_id`, and exact `plan_hash`.
7. Obtain explicit user confirmation for that exact plan hash.
8. Publish only after confirmation:

```bash
npx --yes @kennyshaw/autopost@latest post publish <plan-id> --confirm <plan-hash> --headed
```

9. Preserve the returned `run_id` and report every delivery separately.

`prepare` never publishes. Do not infer publication consent from requests to
install, log in, validate, edit content, or prepare a plan. If the manifest
changes after confirmation, prepare again and obtain confirmation for the new
hash.

## Results And Recovery

Inspect a run and its sanitized attempts with:

```bash
npx --yes @kennyshaw/autopost@latest run get <run-id> --attempts
npx --yes @kennyshaw/autopost@latest run list
```

Retry only when the Runner permits it:

```bash
npx --yes @kennyshaw/autopost@latest run retry <run-id> --headed
```

Interpret states precisely:

- `submitted`: the platform adapter accepted the submission command; public
  visibility has not been independently proven.
- `published`: a platform post ID, URL, or reliable read-only confirmation is
  available.
- `login_required`: complete login, then retry the existing failed delivery.
- `failed`: inspect the normalized error and user action before retrying.
- `confirmation_unknown`: never retry automatically; inspect the creator
  dashboard and ask the user what appeared.

When a visible browser requests CAPTCHA or security verification, pause and ask
the user to complete it. Do not automate CAPTCHA solving, repeatedly click the
platform Publish button, or create a new run to bypass duplicate protection.

## Safety

- Keep all account credentials and browser sessions local.
- Never include secrets in manifests or responses.
- Never bypass the exact-plan confirmation requirement.
- Never describe `submitted` as independently verified `published`.
- Never automatically retry timeouts or ambiguous post-submission failures.
- Never invoke the internal SAU CLI directly.
