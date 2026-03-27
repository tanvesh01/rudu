#!/bin/sh

set -eu

RUDU_PACKAGE="${RUDU_PACKAGE:-github:tanvesh01/rudu}"

say() {
  printf '%s\n' "$1"
}

fail() {
  say "$1"
  exit 1
}

if ! command -v git >/dev/null 2>&1; then
  fail "Git is required. Install Git, then rerun this command."
fi

if ! command -v pi >/dev/null 2>&1; then
  fail "Pi CLI is required. Install Pi first, then rerun this command."
fi

PI_MODELS_OUTPUT="$(pi --list-models 2>&1 || true)"

if [ -z "$PI_MODELS_OUTPUT" ]; then
  fail "Pi is installed, but models could not be listed. Open Pi, configure a provider and model, then rerun this command."
fi

PI_MODEL_LINES="$(printf '%s\n' "$PI_MODELS_OUTPUT" | awk '/^[-[:alnum:]_]+[[:space:]]+[^[:space:]]+[[:space:]]+[^[:space:]]+/ { count += 1 } END { print count + 0 }')"

if [ "$PI_MODEL_LINES" -lt 1 ]; then
  fail "Pi is installed, but no models are configured. Run 'pi', log in or add a provider, choose a model, then rerun this command."
fi

if ! command -v bun >/dev/null 2>&1; then
  if ! command -v curl >/dev/null 2>&1; then
    fail "Bun is missing and curl is required to install it. Install curl or Bun manually, then rerun this command."
  fi

  say "Bun not found. Installing Bun..."
  curl -fsSL https://bun.sh/install | sh
fi

if ! command -v bun >/dev/null 2>&1; then
  if [ -x "$HOME/.bun/bin/bun" ]; then
    PATH="$HOME/.bun/bin:$PATH"
    export PATH
  fi
fi

if ! command -v bun >/dev/null 2>&1; then
  fail "Bun installation did not finish on PATH. Add ~/.bun/bin to PATH, then rerun this command."
fi

say "Installing Rudu..."
if ! bun install -g "$RUDU_PACKAGE"; then
  fail "Failed to install '$RUDU_PACKAGE'."
fi

GLOBAL_BIN_DIR="$(bun pm bin -g)"

if ! command -v rudu >/dev/null 2>&1; then
  say "Rudu was installed, but '$GLOBAL_BIN_DIR' is not on your PATH yet."
  say "Add it to your shell profile, then run: rudu"
  exit 0
fi

say "Rudu installed successfully. Run: rudu"
