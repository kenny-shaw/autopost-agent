# Local Setup

AutoPost Agent wraps the `sau` CLI from `social-auto-upload`. The first usable
local workflow is:

1. Install `social-auto-upload`.
2. Log in to each platform locally.
3. Run `autopost plan`.
4. Run `autopost check`.
5. Run `autopost publish`.

## Install social-auto-upload

`social-auto-upload` currently installs from GitHub source. It requires Python
`>=3.10,<3.13`.

```bash
git clone https://github.com/dreammis/social-auto-upload.git
cd social-auto-upload
uv venv
source .venv/bin/activate
uv pip install -e .
PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright patchright install chromium
cp conf.example.py conf.py
```

Verify:

```bash
sau --help
sau douyin --help
sau xiaohongshu --help
sau kuaishou --help
sau bilibili --help
```

If `sau` is not on `PATH`, point AutoPost at it:

```bash
AUTOPOST_SAU_BIN=/absolute/path/to/sau npm run autopost -- doctor
```

## Login

Edit `examples/accounts.yaml`, then run:

```bash
npm run autopost -- login examples/accounts.yaml --headed
npm run autopost -- check examples/accounts.yaml
```

Bilibili login is best run in a real local terminal:

```bash
sau bilibili login --account main
```

## Publish

Edit `examples/post.yaml`, then run:

```bash
npm run autopost -- plan examples/post.yaml
npm run autopost -- check examples/post.yaml
npm run autopost -- publish examples/post.yaml
```

`plan` never publishes. `publish` runs platform commands sequentially and prints
a JSON result for each platform.

## Auto Schedule

Set `schedule: auto` in the post manifest to let AutoPost choose a concrete
publish time for every platform:

```yaml
schedule: auto
platforms:
  douyin:
    account: main
  xiaohongshu:
    account: main
  bilibili:
    account: main
    tid: 249
```

AutoPost uses `Asia/Shanghai` by default and picks the next recommended creator
posting window, with a small per-platform stagger so all uploads do not target
the exact same minute. Override the timezone with:

```bash
AUTOPOST_TIMEZONE=Asia/Shanghai npm run autopost -- schedule examples/post.yaml
AUTOPOST_TIMEZONE=Asia/Shanghai npm run autopost -- plan examples/post.yaml
```

For deterministic checks, pass `--now`:

```bash
npm run autopost -- schedule examples/post.yaml --now "2026-07-09 19:00"
```

Lock the recommended times into a new manifest before publishing:

```bash
npm run autopost -- schedule examples/post.yaml --write /tmp/autopost-scheduled.yaml
npm run autopost -- plan /tmp/autopost-scheduled.yaml
npm run autopost -- publish /tmp/autopost-scheduled.yaml
```

This converts a shared `schedule: auto` into per-platform concrete schedules,
so later `plan` and `publish` calls use the same times.

Use an explicit manual schedule when you already know the time:

```yaml
schedule: "2026-07-10 20:00"
```
