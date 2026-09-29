#!/usr/bin/env bash
#
# Start / stop / check the API and web client as DETACHED daemons.
#
# WHY THIS EXISTS ALONGSIDE scripts/dev.sh
# ----------------------------------------
# `dev.sh` is a foreground supervisor: it starts both children, `wait`s on them,
# and has `trap cleanup INT TERM` so that Ctrl-C takes them down together. That
# is the right behaviour for a human at a terminal.
#
# It is the wrong behaviour for an automated agent session, where the launching
# shell gets SIGTERM'd and the trap fires. The ports then keep answering for a
# while because the orphaned node children survive, which is worse than a clean
# stop: there is no parent left to rebuild, so hot reload silently does nothing
# and a stale bundle keeps serving. We hit exactly that twice — the API reported
# "Exited with code 143" while `curl` still returned 200.
#
# So this script detaches: `nohup` makes the children ignore SIGHUP, they are
# reparented to launchd, and PIDs are recorded in `.dev/` so `stop` can find
# them again. There is no shared process group to tear down by accident.
#
# Usage:
#   bash scripts/dev-daemon.sh start|stop|restart|status|logs [api|web]
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.dev"
API_PORT=8787
WEB_PORT=3000

mkdir -p "$RUN_DIR"

# `lsof` is the authority on "is something serving this", not the PID file: a
# process we did not start (an old `tsx watch`, a stray `next dev`) will hold the
# port with nothing in .dev/, and reporting that as "up" would be a lie.
port_pid() { lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1; }
port_busy() { [ -n "$(port_pid "$1")" ]; }

pid_of() {
  local name="$1" file="$RUN_DIR/$name.pid"
  [ -f "$file" ] || return 1
  local pid; pid="$(cat "$file" 2>/dev/null)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  echo "$pid"
}

start_one() {
  local name="$1" port="$2" workdir="$3" cmd="$4"
  local existing; existing="$(port_pid "$port")"
  if [ -n "$existing" ]; then
    printf '  %-4s :%s already served by pid %s (left alone)\n' "$name" "$port" "$existing"
    return 0
  fi
  # `nohup` + a subshell: the subshell exits immediately, so the child is
  # reparented to launchd and no TERM sent to this script can reach it.
  ( cd "$workdir" && nohup bash -c "$cmd" >"$RUN_DIR/$name.log" 2>&1 & ) || true
  # Poll until the port binds rather than sampling once. `next dev` needs ~2s
  # and tsx ~1s before either is listening, and a single early sample reports
  # "FAILED to bind" for a server that is merely still starting.
  local pid="" waited=0
  while [ "$waited" -lt 40 ]; do
    pid="$(port_pid "$port")"
    [ -n "$pid" ] && break
    sleep 0.5
    waited=$((waited + 1))
  done
  if [ -n "$pid" ]; then
    echo "$pid" > "$RUN_DIR/$name.pid"
    printf '  %-4s :%s started (pid %s)  log: .dev/%s.log\n' "$name" "$port" "$pid" "$name"
  else
    printf '  %-4s :%s FAILED to bind after %ss; see .dev/%s.log\n' "$name" "$port" "$((waited / 2))" "$name"
    tail -8 "$RUN_DIR/$name.log" 2>/dev/null | sed 's/^/        /'
    return 1
  fi
}

stop_one() {
  local name="$1" port="$2"
  local pid; pid="$(pid_of "$name")"
  if [ -z "$pid" ]; then
    pid="$(port_pid "$port")"
    if [ -z "$pid" ]; then
      printf '  %-4s :%s not running\n' "$name" "$port"
      rm -f "$RUN_DIR/$name.pid"
      return 0
    fi
  fi
  kill "$pid" 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.3
  done
  kill -9 "$pid" 2>/dev/null
  rm -f "$RUN_DIR/$name.pid"
  printf '  %-4s :%s stopped (pid %s)\n' "$name" "$port" "$pid"
}

start_all() {
  echo "starting detached"
  start_one api "$API_PORT" "$ROOT/services/api" \
    'exec node --env-file-if-exists=../../.env --import=tsx src/index.ts'
  start_one web "$WEB_PORT" "$ROOT/apps/web" \
    'exec pnpm dev'
}

stop_all() {
  echo "stopping"
  stop_one api "$API_PORT"
  stop_one web "$WEB_PORT"
}

status_all() {
  local bad=0
  printf '  %-4s %-6s %-8s %s\n' NAME PORT PID STATE
  for pair in "api:$API_PORT" "web:$WEB_PORT"; do
    local name="${pair%%:*}" port="${pair##*:}" pid state
    pid="$(port_pid "$port")"
    if [ -n "$pid" ]; then state="up"; else state="DOWN"; bad=1; fi
    printf '  %-4s %-6s %-8s %s\n' "$name" ":$port" "${pid:--}" "$state"
  done
  if [ "$bad" -eq 0 ] && command -v curl >/dev/null 2>&1; then
    printf '  api  /api/health -> %s\n' \
      "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$API_PORT/api/health" || echo err)"
    printf '  web  /           -> %s\n' \
      "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$WEB_PORT/" || echo err)"
  fi
  return "$bad"
}

cmd="${1:-start}"
which="${2:-all}"

case "$cmd" in
  start)   start_all ;;
  stop)    stop_all ;;
  restart) stop_all; sleep 1; start_all ;;
  status)  status_all ;;
  logs)    tail -n 40 "$RUN_DIR/${which}.log" 2>/dev/null || echo "no .dev/$which.log" ;;
  *)       echo "usage: $0 start|stop|restart|status|logs [api|web]" >&2; exit 2 ;;
esac
