#!/usr/bin/env bash
# Start/stop the whole local stack for development.
#
# Memory note: this machine is an 8 GB M1 MacBook Air. Running the web app, the
# API, the Laya sidecar AND llama.cpp at once will thrash. `dev.sh` therefore
# starts the API + web by default and leaves the two local model sidecars
# alone unless you ask for them:
#
#   bash scripts/dev.sh              # api + web
#   bash scripts/dev.sh --with-laya  # + laya sidecar
#   bash scripts/dev.sh --with-llm   # + local qwen sidecar
#   bash scripts/dev.sh --all        # everything (not recommended on 8 GB)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_LAYA=0
WITH_LLM=0

for arg in "$@"; do
  case "$arg" in
    --with-laya) WITH_LAYA=1 ;;
    --with-llm)  WITH_LLM=1 ;;
    --all)       WITH_LAYA=1; WITH_LLM=1 ;;
    -h|--help)   sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p run

if [[ ! -f .env.local && -f .env.example ]]; then
  cp .env.example .env.example.bak
  echo "note: create .env.local from .env.example before starting"
fi

# `opencode serve` prints a Basic-auth password on startup, and it rotates, so it
# is not the value sitting in ~/.config/opencode/service.json. Scrape the most
# recent one out of the serve log when the environment does not already set it,
# otherwise tier 1 fails with a bare 401 that looks like a missing server.
if [[ -z "${OPENCODE_PASSWORD:-}" ]]; then
  for log in /tmp/opencode-serve.log run/opencode-serve.log; do
    if [[ -r "$log" ]]; then
      found="$(grep -oE 'password [A-Za-z0-9_-]+' "$log" 2>/dev/null | tail -1 | cut -d' ' -f2 || true)"
      if [[ -n "${found:-}" ]]; then
        export OPENCODE_PASSWORD="$found"
        echo "discovered OPENCODE_PASSWORD from $log"
        break
      fi
    fi
  done
fi

PIDS=()

cleanup() {
  echo
  echo "stopping ${#PIDS[@]} process(es)..."
  for pid in "${PIDS[@]:-}"; do
    [[ -n "${pid:-}" ]] && kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

if [[ "$WITH_LAYA" == "1" ]]; then
  echo "starting laya sidecar..."
  bash scripts/laya.sh start
fi

if [[ "$WITH_LLM" == "1" ]]; then
  echo "starting local llm sidecar..."
  bash scripts/local-llm.sh start
fi

echo "starting api (tsx watch)..."
pnpm --filter @dsa/api dev &
PIDS+=($!)

sleep 1
echo "starting web (next dev)..."
pnpm --filter @dsa/web dev &
PIDS+=($!)

cat <<EOF

  api  http://127.0.0.1:8787/api/health
  web  http://127.0.0.1:3000

  press ctrl-c to stop everything.
EOF

wait
