#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repo_root/frontend"
if [[ -f package-lock.json ]]; then
  if [[ ! -d node_modules ]]; then
    npm ci
  fi
else
  if [[ ! -d node_modules ]]; then
    npm install
  fi
fi

npm run build

cd "$repo_root/src-tauri"
cargo tauri build
