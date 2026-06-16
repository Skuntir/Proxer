#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repo_root/frontend"
if [[ -f package-lock.json ]]; then
  if [[ "${CI:-}" == "true" || ! -d node_modules ]]; then
    npm ci
  fi
else
  if [[ ! -d node_modules ]]; then
    npm install
  fi
fi

cd "$repo_root"
npm --prefix frontend exec tauri -- build --ci "$@"
