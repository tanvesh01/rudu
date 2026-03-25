#!/usr/bin/env bash
set -euo pipefail

command -v bun >/dev/null 2>&1
command -v git >/dev/null 2>&1

if [ ! -d "node_modules" ]; then
  bun install
fi

mkdir -p "${HOME}/.rudu"
