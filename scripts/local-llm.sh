#!/usr/bin/env bash
#
# Tier 3 of the provider chain: a local llama.cpp server running
# Qwen2.5-0.5B-Instruct. Offline, ~0.5 GB of RAM, no API key.
#
#   ./scripts/local-llm.sh download   fetch the GGUF (resumable)
#   ./scripts/local-llm.sh start      launch llama-server on :8081
#   ./scripts/local-llm.sh stop       kill it via the PID file
#   ./scripts/local-llm.sh status     health check
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
SVC_DIR="${ROOT}/services/local-llm"
MODEL_DIR="${SVC_DIR}/models"
RUN_DIR="${SVC_DIR}/run"
LOG_FILE="${RUN_DIR}/llama-server.log"
PID_FILE="${RUN_DIR}/llama-server.pid"

MODEL_FILE="qwen2.5-0.5b-instruct-q4_k_m.gguf"
# Verified live: HEAD -> 200, range GET -> 206 with the GGUF magic header.
MODEL_URL="https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/${MODEL_FILE}"
MODEL_PATH="${MODEL_DIR}/${MODEL_FILE}"

PORT="${LOCAL_LLM_PORT:-8081}"
HOST="${LOCAL_LLM_HOST:-127.0.0.1}"
CTX="${LOCAL_LLM_CTX:-8192}"
# 6 of 8 performance cores: leaves headroom so the Next.js dev server and the
# API stay responsive while the model decodes.
THREADS="${LOCAL_LLM_THREADS:-6}"
# No -ngl by default. Metal offload on an 8 GB M1 competes with the browser for
# memory and the model is small enough that it buys little. See the README.
GPU_LAYERS="${LOCAL_LLM_NGL:-0}"
# 600 s: a 0.5B model on CPU needs a while to ingest an 8k-token prompt, and a
# cold first request pays the model-load cost too.
TIMEOUT="${LOCAL_LLM_TIMEOUT:-600}"

say()  { printf '\033[36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m  ok\033[0m %s\n' "$*"; }
warn() { printf '\033[33m  !!\033[0m %s\n' "$*"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

ensure_dirs() {
  mkdir -p "${MODEL_DIR}" "${RUN_DIR}"
}

# Locate llama-server, or install llama.cpp via Homebrew.
find_or_install() {
  if command -v llama-server >/dev/null 2>&1; then
    ok "llama-server: $(command -v llama-server)"
    return 0
  fi
  if [[ "$(uname -s)" != "Darwin" ]]; then
    die "llama-server not found. Install it from https://github.com/ggml-org/llama.cpp (macOS is assumed to use Homebrew)."
  fi
  if ! command -v brew >/dev/null 2>&1; then
    die "llama-server not found and Homebrew is not installed. Install Homebrew, then: brew install llama.cpp"
  fi
  say "llama-server missing; running: brew install llama.cpp"
  brew install llama.cpp
  command -v llama-server >/dev/null 2>&1 || die "brew install llama.cpp did not put llama-server on PATH"
  ok "installed llama-server: $(command -v llama-server)"
}

cmd_download() {
  ensure_dirs
  if [[ -f "${MODEL_PATH}" ]]; then
    local size
    size="$(wc -c < "${MODEL_PATH}" | tr -d ' ')"
    ok "model already present: ${MODEL_PATH} (${size} bytes)"
    return 0
  fi
  say "downloading ${MODEL_FILE} (~490 MB, resumable)"
  echo "    ${MODEL_URL}"
  # -C - resumes a partial download; -f fails loudly on an HTTP error instead
  # of writing the 404 page into the .gguf file.
  curl -L --fail --show-error --progress-bar -C - -o "${MODEL_PATH}" "${MODEL_URL}"
  [[ -f "${MODEL_PATH}" ]] || die "download produced no file"
  local magic
  magic="$(head -c 4 "${MODEL_PATH}")"
  [[ "${magic}" == "GGUF" ]] || die "${MODEL_PATH} does not start with the GGUF magic (got '${magic}')"
  ok "downloaded $(wc -c < "${MODEL_PATH}" | tr -d ' ') bytes to ${MODEL_PATH}"
}

running_pid() {
  [[ -f "${PID_FILE}" ]] || return 1
  local pid
  pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  [[ -n "${pid}" ]] || return 1
  kill -0 "${pid}" 2>/dev/null || return 1
  echo "${pid}"
}

cmd_start() {
  ensure_dirs
  find_or_install

  if pid="$(running_pid)"; then
    ok "already running (pid ${pid}) on http://${HOST}:${PORT}"
    return 0
  fi
  [[ -f "${MODEL_PATH}" ]] || die "no model at ${MODEL_PATH} — run: ./scripts/local-llm.sh download"
  rm -f "${PID_FILE}"

  local args=(
    -m "${MODEL_PATH}"
    --host "${HOST}"
    --port "${PORT}"
    -c "${CTX}"
    -t "${THREADS}"
    --timeout "${TIMEOUT}"
  )
  if [[ "${GPU_LAYERS}" != "0" ]]; then
    args+=(-ngl "${GPU_LAYERS}")
  fi

  say "starting llama-server on http://${HOST}:${PORT}"
  echo "    flags: ${args[*]}"
  : > "${LOG_FILE}"
  # nohup + a PID file: `stop` must not depend on this shell still existing.
  nohup llama-server "${args[@]}" >>"${LOG_FILE}" 2>&1 &
  echo $! > "${PID_FILE}"
  local pid
  pid="$(cat "${PID_FILE}")"

  say "waiting for /health (pid ${pid}, log: ${LOG_FILE})"
  for _ in $(seq 1 90); do
    if curl -fsS -m 2 "http://${HOST}:${PORT}/health" >/dev/null 2>&1; then
      ok "healthy at http://${HOST}:${PORT}/health"
      return 0
    fi
    if ! kill -0 "${pid}" 2>/dev/null; then
      warn "llama-server exited during startup; last 20 log lines:"
      tail -n 20 "${LOG_FILE}" >&2 || true
      rm -f "${PID_FILE}"
      die "startup failed"
    fi
    sleep 1
  done
  warn "did not become healthy in 90s; last 20 log lines:"
  tail -n 20 "${LOG_FILE}" >&2 || true
  die "health check timed out"
}

cmd_stop() {
  if ! pid="$(running_pid)"; then
    rm -f "${PID_FILE}"
    warn "not running (no live pid in ${PID_FILE})"
    return 0
  fi
  say "stopping llama-server (pid ${pid})"
  kill "${pid}" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "${pid}" 2>/dev/null || break
    sleep 0.5
  done
  if kill -0 "${pid}" 2>/dev/null; then
    warn "did not exit on SIGTERM; sending SIGKILL"
    kill -9 "${pid}" 2>/dev/null || true
  fi
  rm -f "${PID_FILE}"
  ok "stopped"
}

cmd_status() {
  ensure_dirs
  if pid="$(running_pid)"; then
    ok "process alive (pid ${pid})"
  else
    warn "no live process for ${PID_FILE}"
  fi
  if [[ -f "${MODEL_PATH}" ]]; then
    ok "model: ${MODEL_PATH} ($(wc -c < "${MODEL_PATH}" | tr -d ' ') bytes)"
  else
    warn "model missing: ${MODEL_PATH} (run: ./scripts/local-llm.sh download)"
  fi
  if body="$(curl -fsS -m 3 "http://${HOST}:${PORT}/health" 2>/dev/null)"; then
    ok "health: ${body}"
    if curl -fsS -m 5 "http://${HOST}:${PORT}/v1/models" >/dev/null 2>&1; then
      ok "OpenAI-compatible endpoint: http://${HOST}:${PORT}/v1/chat/completions"
    fi
    return 0
  fi
  warn "no answer from http://${HOST}:${PORT}/health"
  return 1
}

case "${1:-}" in
  start)    cmd_start ;;
  stop)     cmd_stop ;;
  status)   cmd_status ;;
  download) cmd_download ;;
  *)
    cat >&2 <<EOF
usage: $0 {start|stop|status|download}

  start     install llama.cpp if needed, then serve ${MODEL_FILE} on :${PORT}
  stop      terminate the server via ${PID_FILE}
  status    report process, model and /health
  download  fetch the GGUF into ${MODEL_DIR} (resumable)

env overrides: LOCAL_LLM_PORT LOCAL_LLM_HOST LOCAL_LLM_CTX
               LOCAL_LLM_THREADS LOCAL_LLM_NGL LOCAL_LLM_TIMEOUT
EOF
    exit 2
    ;;
esac
