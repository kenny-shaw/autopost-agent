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
