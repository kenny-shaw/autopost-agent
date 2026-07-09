---
name: autopost
description: Use when an agent needs to prepare, validate, dry-run, or publish social media posts through the AutoPost CLI. This skill is for multi-platform social publishing workflows such as checking accounts, planning a post from a manifest, and eventually publishing to platforms like Douyin, Xiaohongshu, Kuaishou, and Bilibili.
---

# AutoPost

Use the `autopost` CLI as the stable interface. Do not call platform uploaders
directly unless the CLI explicitly reports that a lower-level diagnostic is
needed.

## Current Status

The CLI wraps the `sau` command from `social-auto-upload`. Use `doctor` first
to check whether `sau`, `uv`, and the expected Python runtime are available.

## Commands

```bash
autopost doctor
autopost login <accounts-or-post.yaml>
autopost schedule <post.yaml>
autopost plan <post.yaml>
autopost check <accounts.yaml>
autopost publish <post.yaml>
autopost status <run-id>
```

## Workflow

1. Ask for or locate a post manifest.
2. Run `autopost doctor` if this is the first publishing task in the session.
3. Use `schedule: auto` when the user asks for the best publish time and has no
   explicit time preference.
4. Run `autopost schedule <post.yaml>` when the user wants the best time
   analysis separately from the upload command plan.
5. Run `autopost plan <post.yaml>` before any publishing attempt.
6. Run `autopost check <post.yaml>` to verify local login state.
7. Only run `autopost publish <post.yaml>` when the user explicitly asks to
   publish.

## Safety

- Do not print account cookies or tokens.
- Treat cloud account custody as unsupported unless the user provides a
  documented AutoPost deployment that supports it.
- Avoid promises about unsupported platforms.
- If `sau` is missing, tell the user to install `social-auto-upload` locally;
  do not invent a fake upload result.
