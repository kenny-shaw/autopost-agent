#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cmp "$ROOT/SKILL.md" "$ROOT/skills/autopost/SKILL.md"
printf '%s\n' "AutoPost skill copies are in sync."
