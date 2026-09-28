#!/usr/bin/env bash
#
# Create services/laya/.venv and install the Laya sidecar.
#
# This script is deliberately NOT run automatically: the install pulls a PyTorch
# wheel plus the transformers stack, and the machine this project is developed on
# is an M1 MacBook Air with 8 GB of unified memory. Run it once, deliberately.
#
#   bash scripts/laya.sh setup
#
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VENV="${SCRIPT_DIR}/.venv"
PY="${VENV}/bin/python"

hr() { printf '%s\n' "------------------------------------------------------------"; }
note() { printf '  %s\n' "$*"; }

if [ -x "${PY}" ]; then
  note "Reusing existing venv at ${VENV}"
else
  hr
  note "Creating virtualenv: ${VENV}"
  hr
  if ! python3 -m venv "${VENV}"; then
    cat >&2 <<'EOF'

`python3 -m venv` failed.

  macOS (system Python):  the venv module is usually present; if this says
      ensurepip is not available
  then install it with:   xcode-select --install
  and retry.

  Debian/Ubuntu:          sudo apt install python3-venv

  If python3 is 3.13 and a dependency later fails to build, Laya's own floor is
  Python 3.10, so the quickest fix is a 3.12 interpreter:
      uv venv --python 3.12 .venv     # `uv` is already on this machine
      .venv/bin/python -m pip install -U pip

EOF
    exit 1
  fi
fi

"${PY}" -m pip install --quiet --upgrade pip

# --- PyTorch, chosen per platform ------------------------------------------
#
# There is no such thing as a "CPU-only macOS build": the single macOS arm64
# wheel ships Metal, which is what MPS needs. So on macOS there is nothing to
# choose — the only real decision is *not* to follow a Linux CUDA index by
# copy-paste, which fails.
#
# On Linux the default index serves a CUDA-linked wheel that is several GB, so
# the CPU build is the right default there; set LAYA_TORCH_INDEX_SUFFIX=cuda (or
# cu124/cu126) to override.
hr
OS="$(uname -s)"
ARCH="$(uname -m)"
note "platform: ${OS}/${ARCH}  python: $("${PY}" -V 2>&1)"

if [ "${OS}" = "Darwin" ] && [ "${ARCH}" = "arm64" ]; then
  note "installing PyTorch from PyPI (macOS arm64 wheel: CPU + Metal/MPS)"
  "${PY}" -m pip install --quiet torch
else
  TORCH_SUFFIX="${LAYA_TORCH_INDEX_SUFFIX:-cpu}"
  TORCH_INDEX="https://download.pytorch.org/whl/${TORCH_SUFFIX}"
  note "installing PyTorch from ${TORCH_INDEX} (override with LAYA_TORCH_INDEX_SUFFIX)"
  "${PY}" -m pip install --quiet --index-url "${TORCH_INDEX}" torch
fi

# --- Laya, with the HTTP server extra --------------------------------------
hr
note 'installing laya[serve]  (adds fastapi + uvicorn + python-multipart)'
"${PY}" -m pip install --quiet "laya[serve]"

# --- Verify, without loading a checkpoint -----------------------------------
# `-I` keeps the current directory off sys.path so a local source copy cannot
# mask a missing install and make this check lie.
hr
"${PY}" -I -c "import laya; print('  laya', laya.__version__)"
"${PY}" -I -c "import laya.serve; print('  laya.serve OK (laya-serve available)')"

hr
cat <<EOF
Done.

Checkpoint weights are NOT downloaded yet (~1.3 GB for laya-multilingual).
They are fetched on the first inference call, so the first request after
\`start\` will be slow and the first \`test\` will block on the download.

Next command:

  bash scripts/laya.sh start

Then, in another shell:

  bash scripts/laya.sh test
EOF
