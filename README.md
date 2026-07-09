# AutoPost Agent

Agent-facing CLI and skill package for AutoPost.

This repository is the public surface for agents such as Codex, Claude Code,
and OpenClaw. It should stay lightweight: command contracts, examples, skill
instructions, and a CLI wrapper. Product internals, paid logic, platform-private
implementation details, and account custody logic belong in the private
`autopost` repository.

## Status

Work in progress, but the local CLI now has the first real execution path:

- `doctor` checks local prerequisites.
- `login` calls `sau <platform> login`.
- `check` calls `sau <platform> check`.
- `schedule` analyzes a post manifest and prints recommended publish times.
- `plan` validates a post manifest and prints the exact `sau` upload commands.
- `publish` runs `sau <platform> upload-video` sequentially and prints JSON
  results.
- `schedule: auto` chooses the next recommended publish window per platform and
  passes it to `sau --schedule`.

The first stable platform scope is Douyin, Xiaohongshu, Kuaishou, and Bilibili.
Tencent/WeChat Channels and YouTube are treated as experimental.

## Quick Start

```bash
npm install
npm run autopost -- doctor
npm run autopost -- schedule examples/post.yaml
npm run autopost -- plan examples/post.yaml --allow-missing-files
```

Future public usage:

```bash
npx autopost plan post.yaml
npx autopost check accounts.yaml
npx autopost publish post.yaml
```

See [docs/local-setup.md](docs/local-setup.md) for the `social-auto-upload`
setup and local login flow.
