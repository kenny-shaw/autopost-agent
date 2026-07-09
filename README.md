# AutoPost Agent

Agent-facing CLI and skill package for AutoPost.

This repository is the public surface for agents such as Codex, Claude Code,
and OpenClaw. It should stay lightweight: command contracts, examples, skill
instructions, and a CLI wrapper. Product internals, paid logic, platform-private
implementation details, and account custody logic belong in the private
`autopost` repository.

## Status

Work in progress. The current CLI is a scaffold that supports manifest parsing
and dry-run planning. Real platform publishing will be connected after the
private AutoPost orchestration layer is ready.

## Quick Start

```bash
npm install
npm run autopost -- plan examples/post.yaml
```

Future public usage:

```bash
npx autopost plan post.yaml
npx autopost check accounts.yaml
npx autopost publish post.yaml
```

