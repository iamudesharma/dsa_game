#!/usr/bin/env bash
#
# Control the Laya sidecar: the local System 1 decision classifier.
#
#   bash scripts/laya.sh setup     # one-time install into services/laya/.venv
#   bash scripts/laya.sh start     # run laya-serve on 127.0.0.1:8000
#   bash scripts/laya.sh stop
#   bash scripts/laya.sh status
#   bash scripts/laya.sh test      # in-process smoke test + HTTP contract check
#
# This is the only entry point for Laya. Nothing else in the repo starts it, and
# nothing breaks if it is not running: @dsa/decision-layer falls back to
# deterministic heuristics for every decision.
#
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="${REPO_ROOT}/services/laya"
VENV="${SERVICE_DIR}/.venv"
PY="${VENV}/bin/python"
SERVE="${VENV}/bin/laya-serve"

HOST="${LAYA_HOST:-127.0.0.1}"
PORT="${LAYA_PORT:-8000}"
BASE_URL="http://${HOST}:${PORT}"

# Runtime state (pidfile + log) lives under the repo's gitignored `run/` rather
# than next to the venv, so a running sidecar never leaves untracked files behind.
RUN_DIR="${REPO_ROOT}/run/laya"
PIDFILE="${RUN_DIR}/laya.pid"
LOGFILE="${RUN_DIR}/laya.log"

# --- the knobs, and why ---------------------------------------------------
#
# LAYA_DEVICE=mps
#   Metal Performance Shaders. The M1 has a GPU; using it takes the forward pass
#   from ~200-450 ms to tens of ms and leaves the CPU free for the web app.
#   FALLBACK: if MPS misbehaves (spurious "MPS backend out of memory", a kernel
#   that hangs, or a question shape that segfaults), export LAYA_DEVICE=cpu and
#   re-run `start`. It is slower but it is always correct. `status` shows which
#   device is actually live.
#
# LAYA_MODELS=typed-decisions
#   The checkpoint to preload, and the ONLY one this deployment ever builds.
#   Pinning one also means the lazy router can never decide to build a second
#   checkpoint and grow the resident set.
#
#   We default to `typed-decisions` (ModernBERT-large, 421M) rather than the
#   smaller `multilingual` (mmBERT-base, 322M). Every decision this sidecar is
#   asked for — pick one of N labels, score this, is this true — IS a typed
#   decision, which is precisely what `typed-decisions` was fine-tuned for: it
#   scores 0.766 on the typed-decisions benchmark where `multilingual` scores
#   0.352. That gap is worth the extra ~100M params (~200 MB in bf16) on an
#   8 GB box, especially since this sidecar is opt-in and the deterministic
#   heuristics remain the fallback either way.
#
#   Set LAYA_MODELS=multilingual to trade accuracy for the smallest resident
#   set if memory is tight.
#
# LAYA_PRELOAD=0
#   The upstream default is 1, which builds every model listed in LAYA_MODELS at
#   startup; with an empty LAYA_MODELS it builds ALL THREE. This box has 8 GB of
#   unified memory shared with the Next.js dev server, the Flutter app and
#   (sometimes) a llama.cpp server, so we want the load to be lazy and
#   single-checkpoint. The cost is a slow first request.
#
# LAYA_THREADS=4
#   Caps torch intra-op threads at 4 of the M1's 8 cores. Bounding the pool keeps
#   the sidecar from starving the web app for cores when it falls back to CPU.
#
# LAYA_HOST=127.0.0.1
#   The upstream default is 0.0.0.0, i.e. reachable from the whole LAN. A laptop
#   on cafe wifi has no reason to expose an unauthenticated inference endpoint
#   (LAYA_API_KEY is unset by default). Loopback only.
#
DEVICE="${LAYA_DEVICE:-mps}"
MODEL="${LAYA_MODELS:-typed-decisions}"
THREADS="${LAYA_THREADS:-4}"

log()  { printf '\033[1m[laya]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[laya]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[laya]\033[0m %s\n' "$*" >&2; exit 1; }

ensure_installed() {
  [ -x "${SERVE}" ] || die "not installed. Run: bash scripts/laya.sh setup"
}

# Resident set size in MB, macOS `ps` reports RSS in KB.
rss_mb() {
  local pid="$1"
  local kb
  kb="$(ps -o rss= -p "${pid}" 2>/dev/null | tr -d ' ' || true)"
  [ -n "${kb}" ] || return 1
  echo "$(( kb / 1024 ))"
}

running_pid() {
  [ -f "${PIDFILE}" ] || return 1
  local pid
  pid="$(cat "${PIDFILE}" 2>/dev/null || true)"
  [ -n "${pid}" ] || return 1
  kill -0 "${pid}" 2>/dev/null || return 1
  printf '%s' "${pid}"
}

health_json() {
  curl -fsS --max-time 2 "${BASE_URL}/health" 2>/dev/null || true
}

# ------------------------------------------------------------------ subcommands

cmd_setup() {
  exec bash "${SERVICE_DIR}/setup.sh"
}

cmd_start() {
  ensure_installed

  local pid
  if pid="$(running_pid)"; then
    log "already running (pid ${pid}) on ${BASE_URL}"
    return 0
  fi

  if curl -fsS --max-time 1 "${BASE_URL}/health" >/dev/null 2>&1; then
    warn "something is already serving ${BASE_URL} but it is not ours; not starting."
    return 0
  fi

  log "starting laya-serve on ${BASE_URL}"
  log "  device=${DEVICE} model=${MODEL} preload=0 threads=${THREADS}"

  mkdir -p "${RUN_DIR}"

  # A cold checkpoint build is seconds, not milliseconds, and it happens on the
  # first request (preload is off). Uvicorn's log is not a readiness signal.
  LAYA_HOST="${HOST}" \
  LAYA_PORT="${PORT}" \
  LAYA_DEVICE="${DEVICE}" \
  LAYA_MODELS="${MODEL}" \
  LAYA_PRELOAD=0 \
  LAYA_THREADS="${THREADS}" \
  LAYA_LOG_LEVEL="${LAYA_LOG_LEVEL:-info}" \
    nohup "${SERVE}" >>"${LOGFILE}" 2>&1 &

  printf '%s' "$!" >"${PIDFILE}"

  # Wait for the socket, but not forever: a cold start can take a while and we
  # do not want to report success for a process that then dies.
  local waited=0
  while [ "${waited}" -lt 150 ]; do
    if [ -n "$(health_json)" ]; then
      log "up after ~$(( waited / 10 ))s (pid $(cat "${PIDFILE}"))"
      log "log: ${LOGFILE}"
      log "first request will download the ${MODEL} checkpoint (~1.7 GB)."
      return 0
    fi
    if ! kill -0 "$(cat "${PIDFILE}")" 2>/dev/null; then
      rm -f "${PIDFILE}"
      warn "laya-serve exited during startup. Last lines of ${LOGFILE}:"
      tail -n 20 "${LOGFILE}" 2>/dev/null >&2 || true
      die "startup failed"
    fi
    sleep 0.1
    waited=$(( waited + 1 ))
  done

  warn "no health response after 15s; the process is alive but not serving yet."
  warn "check ${LOGFILE} (a first-run checkpoint download can take minutes)."
  return 0
}

cmd_stop() {
  local pid
  if ! pid="$(running_pid)"; then
    rm -f "${PIDFILE}"
    log "not running"
    return 0
  fi

  log "stopping pid ${pid}"
  # SIGTERM so laya-serve can drain its inference pool; escalate only if it
  # ignores us.
  kill -TERM "${pid}" 2>/dev/null || true
  local waited=0
  while [ "${waited}" -lt 50 ] && kill -0 "${pid}" 2>/dev/null; do
    sleep 0.1
    waited=$(( waited + 1 ))
  done
  if kill -0 "${pid}" 2>/dev/null; then
    warn "pid ${pid} ignored SIGTERM; sending SIGKILL"
    kill -KILL "${pid}" 2>/dev/null || true
  fi
  rm -f "${PIDFILE}"
  log "stopped"
}

cmd_status() {
  local pid=""
  pid="$(running_pid 2>/dev/null || true)"

  if [ -z "${pid}" ]; then
    log "not running"
    [ -f "${PIDFILE}" ] && rm -f "${PIDFILE}"
    return 1
  fi

  local rss
  rss="$(rss_mb "${pid}" || echo '?')"
  log "running (pid ${pid})"
  log "  resident: ${rss} MB"
  local health
  health="$(health_json)"
  if [ -n "${health}" ]; then
    log "  health: ${health}"
  else
    warn "  no health response on ${BASE_URL} (cold start, or a request is in flight)"
  fi
  # Anything much above ~1.2 GB means a second checkpoint got built, which
  # LAYA_MODELS is supposed to prevent.
  case "${rss}" in
    ''|'?') ;;
    *) if [ "${rss}" -gt 1200 ]; then
         warn "  RSS is higher than expected for a single 322M checkpoint."
         warn "  Something is holding a second model; check ${LOGFILE}."
       fi ;;
  esac
  return 0
}

cmd_test() {
  ensure_installed

  log "in-process smoke test (imports laya, runs one choice question)"
  # Downloads the checkpoint on first run; this is expected to be slow once.
  if ! "${PY}" "${SERVICE_DIR}/smoke.py"; then
    die "smoke test failed"
  fi

  log
  if [ -z "$(health_json)" ]; then
    log "laya-serve is not running, so skipping the HTTP contract check."
    log "start it with: bash scripts/laya.sh start"
    return 0
  fi

  log "HTTP contract check against ${BASE_URL}/v1/systemone"
  local body
  body="$(
    curl -fsS --max-time 120 "${BASE_URL}/v1/systemone" \
      -H 'content-type: application/json' \
      -d '{
        "state": "I need help debugging why my brackets are unbalanced.",
        "model": "${MODEL}",
        "questions": {
          "department": {
            "type": "choice",
            "instructions": "Which team should handle this?",
            "criteria": {
              "arrays": "sorting, scanning, rearranging numbers",
              "structures": "stacks, queues, linked lists, parentheses"
            }
          }
        }
      }'
  )" || die "the HTTP request failed"

  printf '%s\n' "${body}"

  # The response must name one of the keys we offered. A grep, because
  # depending on a JSON tool being installed is a bad idea for a smoke test.
  case "${body}" in
    *'"choice": "arrays"'*|*'"choice": "structures"'*)
      log "OK: the answer is one of the offered keys" ;;
    *)
      die "the response did not contain a 'choice' of arrays or structures" ;;
  esac
}

usage() {
  cat <<EOF
usage: bash scripts/laya.sh <setup|start|stop|status|test>

  setup   one-time install into services/laya/.venv (multi-GB, run deliberately)
  start   run laya-serve on ${BASE_URL} (device=${DEVICE}, model=${MODEL}, no preload)
  stop    stop it
  status  pid, resident MB, health
  test    in-process smoke test, then the HTTP contract check

env overrides: LAYA_HOST LAYA_PORT LAYA_DEVICE LAYA_MODELS LAYA_THREADS
EOF
}

case "${1:-}" in
  setup)  cmd_setup ;;
  start)  cmd_start ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  test)   cmd_test ;;
  ''|-h|--help|help) usage ;;
  *) usage; die "unknown subcommand: $1" ;;
esac
