---
name: autopost
description: Use when an agent needs to prepare, validate, dry-run, or publish social media posts through the AutoPost CLI. This skill is for multi-platform social publishing workflows such as checking accounts, planning a post from a manifest, and eventually publishing to platforms like Douyin, Xiaohongshu, Kuaishou, and Bilibili.
---

# AutoPost

Use the `autopost` CLI as the stable interface. Do not call platform uploaders
directly unless the CLI explicitly reports that a lower-level diagnostic is
needed.

## Current Status

The current CLI is a scaffold. Prefer `plan` for dry-run validation. Do not
claim real publishing support until `autopost publish` is connected to the
private AutoPost orchestration layer.

## Commands

```bash
autopost plan <post.yaml>
autopost check <accounts.yaml>
autopost publish <post.yaml>
autopost status <run-id>
```

## Workflow

1. Ask for or locate a post manifest.
2. Run `autopost plan <post.yaml>` before any publishing attempt.
3. Confirm missing files, accounts, or platform-specific fields.
4. Only run `autopost publish <post.yaml>` when the user explicitly asks to
   publish and the CLI supports publishing.

## Safety

- Do not print account cookies or tokens.
- Treat cloud account custody as unsupported unless the user provides a
  documented AutoPost deployment that supports it.
- Avoid promises about unsupported platforms.

