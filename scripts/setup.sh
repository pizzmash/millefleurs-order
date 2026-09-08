#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Bootstrap with the existing runtime; do not change the user's global nodenv version.
if command -v nodenv >/dev/null 2>&1; then
  export NODENV_VERSION="$(nodenv global)"
fi
npm install --prefix .runtime --save-exact --no-audit --no-fund "node@$(cat .node-version)" npm@11.19.1
./scripts/npm.sh ci
./scripts/npm.sh run cloud:setup:local
./scripts/npm.sh run build
