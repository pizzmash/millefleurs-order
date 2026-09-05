#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x .runtime/node_modules/node/bin/node || ! -f .runtime/node_modules/npm/bin/npm-cli.js ]]; then
  echo 'Run ./scripts/setup.sh first.' >&2
  exit 1
fi
export PATH="$PWD/.runtime/node_modules/node/bin:$PWD/.runtime/node_modules/.bin:$PATH"
exec .runtime/node_modules/node/bin/node .runtime/node_modules/npm/bin/npm-cli.js "$@"
