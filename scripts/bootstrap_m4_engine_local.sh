#!/usr/bin/env bash
set -euo pipefail

command -v anchor >/dev/null 2>&1 || { echo "anchor CLI is required" >&2; exit 1; }
command -v solana >/dev/null 2>&1 || { echo "solana CLI is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }

if ! command -v ephemeral-validator >/dev/null 2>&1; then
  echo "Missing ephemeral-validator." >&2
  echo "Install the MagicBlock local validator CLI:" >&2
  echo "  npm install -g @magicblock-labs/ephemeral-validator@latest" >&2
  exit 1
fi

if ! command -v mb-test-validator >/dev/null 2>&1; then
  echo "Missing mb-test-validator." >&2
  echo "Install/update the MagicBlock ephemeral validator package:" >&2
  echo "  npm install -g @magicblock-labs/ephemeral-validator@latest" >&2
  exit 1
fi

WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
BASE_RPC="${REACTOR_M4_ENGINE_BASE_RPC:-http://127.0.0.1:8899}"
BASE_WS="${REACTOR_M4_ENGINE_BASE_WS:-ws://127.0.0.1:8900}"
ER_RPC="${REACTOR_M4_ENGINE_ER_RPC:-http://127.0.0.1:7799}"
ER_WS="${REACTOR_M4_ENGINE_ER_WS:-ws://127.0.0.1:7800}"
TRIALS="${REACTOR_M4_ENGINE_TRIALS:-10}"
PROGRAM_KEYPAIR="target/deploy/reactor-keypair.json"
PROGRAM_SO="target/deploy/reactor.so"
IDL="${REACTOR_IDL:-target/idl/reactor.json}"
LOG_DIR="experiment/results/m4-engine-logs"
BASE_LOG="$LOG_DIR/mb-test-validator.log"
ER_LOG="$LOG_DIR/ephemeral-validator.log"

mkdir -p "$LOG_DIR"

if [[ ! -f "$WALLET" ]]; then
  echo "Missing wallet: $WALLET" >&2
  exit 1
fi

BASE_PID=""
ER_PID=""

show_er_log() {
  if [[ -f "$ER_LOG" ]]; then
    echo
    echo "---- ephemeral-validator.log (last 120 lines) ----" >&2
    tail -n 120 "$ER_LOG" >&2 || true
    echo "---- end ephemeral-validator.log ----" >&2
  fi
}

cleanup() {
  set +e
  if [[ -n "$ER_PID" ]] && kill -0 "$ER_PID" >/dev/null 2>&1; then
    kill "$ER_PID" >/dev/null 2>&1 || true
    wait "$ER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$BASE_PID" ]] && kill -0 "$BASE_PID" >/dev/null 2>&1; then
    kill "$BASE_PID" >/dev/null 2>&1 || true
    wait "$BASE_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

wait_rpc_stable() {
  local url="$1"
  local label="$2"
  local pid="$3"
  local attempts="${4:-160}"
  local required_successes="${5:-5}"
  local consecutive=0

  for ((i=1; i<=attempts; i++)); do
    if [[ -n "$pid" ]] && ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "$label process exited before becoming stable." >&2
      return 2
    fi

    if solana cluster-version --url "$url" >/dev/null 2>&1; then
      consecutive=$((consecutive + 1))
      if (( consecutive >= required_successes )); then
        echo "$label stable: $url ($required_successes consecutive RPC probes)"
        return 0
      fi
    else
      consecutive=0
    fi

    sleep 0.25
  done

  echo "$label did not become stably reachable: $url" >&2
  return 1
}

echo "Starting fully local MagicBlock base validator..."
mb-test-validator --reset >"$BASE_LOG" 2>&1 &
BASE_PID=$!
if ! wait_rpc_stable "$BASE_RPC" "Local Solana base" "$BASE_PID" 160 4; then
  echo "Local base validator failed readiness." >&2
  tail -n 120 "$BASE_LOG" >&2 || true
  exit 1
fi

PAYER="$(solana address -k "$WALLET")"
solana airdrop 100 "$PAYER" --url "$BASE_RPC" >/dev/null

echo "Building Reactor for localnet..."
npm install
anchor build

if [[ ! -f "$PROGRAM_KEYPAIR" || ! -f "$PROGRAM_SO" || ! -f "$IDL" ]]; then
  echo "Missing Reactor build artifacts after anchor build." >&2
  exit 1
fi

PROGRAM_ID="$(solana address -k "$PROGRAM_KEYPAIR")"
IDL_PROGRAM_ID="$(node -e 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(x.address ?? x.metadata?.address ?? "")' "$IDL")"
if [[ -n "$IDL_PROGRAM_ID" && "$IDL_PROGRAM_ID" != "$PROGRAM_ID" ]]; then
  echo "Program ID mismatch before local deploy." >&2
  echo "Keypair: $PROGRAM_ID" >&2
  echo "IDL:     $IDL_PROGRAM_ID" >&2
  echo "Your worktree may contain a stale declare_id!/IDL. Do not benchmark mismatched binaries." >&2
  exit 1
fi

printf '%s\n' "Local payer:      $PAYER"
printf '%s\n' "Reactor program:  $PROGRAM_ID"
printf '%s\n' "Local base RPC:   $BASE_RPC"
printf '%s\n' "Local base WS:    $BASE_WS"
printf '%s\n' "Local ER RPC:     $ER_RPC"
printf '%s\n' "Local ER WS:      $ER_WS"
printf '%s\n' "Trials/path:      $TRIALS"

echo "Deploying Reactor only to the local base validator..."
solana program deploy "$PROGRAM_SO" \
  --program-id "$PROGRAM_KEYPAIR" \
  --keypair "$WALLET" \
  --url "$BASE_RPC" >/dev/null
solana program show "$PROGRAM_ID" --url "$BASE_RPC"

echo "Starting local MagicBlock Ephemeral Rollup..."
RUST_LOG="${RUST_LOG:-warn}" ephemeral-validator \
  --remotes "$BASE_RPC" \
  --remotes "$BASE_WS" \
  -l 7799 \
  --lifecycle ephemeral >"$ER_LOG" 2>&1 &
ER_PID=$!

if ! wait_rpc_stable "$ER_RPC" "Local MagicBlock ER" "$ER_PID" 200 8; then
  echo "Local MagicBlock ER failed stable readiness." >&2
  show_er_log
  exit 1
fi

if ! kill -0 "$ER_PID" >/dev/null 2>&1; then
  echo "Local MagicBlock ER exited immediately after readiness." >&2
  show_er_log
  exit 1
fi

# Give the ER a short stabilization interval after the RPC starts answering.
sleep 2

if ! kill -0 "$ER_PID" >/dev/null 2>&1; then
  echo "Local MagicBlock ER exited during stabilization." >&2
  show_er_log
  exit 1
fi

if ! solana cluster-version --url "$ER_RPC" >/dev/null 2>&1; then
  echo "Local MagicBlock ER RPC disappeared after stabilization." >&2
  show_er_log
  exit 1
fi

export ANCHOR_PROVIDER_URL="$BASE_RPC"
export ANCHOR_WALLET="$WALLET"
export REACTOR_IDL="$IDL"
export REACTOR_M4_ENGINE_BASE_RPC="$BASE_RPC"
export REACTOR_M4_ENGINE_BASE_WS="$BASE_WS"
export REACTOR_M4_ENGINE_ER_RPC="$ER_RPC"
export REACTOR_M4_ENGINE_ER_WS="$ER_WS"
export REACTOR_M4_ENGINE_TRIALS="$TRIALS"

echo
echo "Running controlled local M4-Engine benchmark..."
if ! node scripts/run_m4_engine_local.mjs; then
  STATUS=$?
  echo "M4-Engine runner failed." >&2
  if [[ -n "$ER_PID" ]] && ! kill -0 "$ER_PID" >/dev/null 2>&1; then
    echo "The local ER process is no longer alive." >&2
  fi
  show_er_log
  exit "$STATUS"
fi

echo
echo "M4-Engine evidence: experiment/results/m4-engine-local-latest.json"
echo "Base validator log:  $BASE_LOG"
echo "ER validator log:    $ER_LOG"
