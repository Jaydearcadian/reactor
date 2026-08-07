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

wait_rpc() {
  local url="$1"
  local label="$2"
  local attempts="${3:-120}"
  for ((i=1; i<=attempts; i++)); do
    if solana cluster-version --url "$url" >/dev/null 2>&1; then
      echo "$label ready: $url"
      return 0
    fi
    sleep 0.25
  done
  echo "$label did not become ready: $url" >&2
  return 1
}

echo "Starting fully local MagicBlock base validator..."
mb-test-validator --reset >"$BASE_LOG" 2>&1 &
BASE_PID=$!
wait_rpc "$BASE_RPC" "Local Solana base"

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
wait_rpc "$ER_RPC" "Local MagicBlock ER"

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
node scripts/run_m4_engine_local.mjs

echo
echo "M4-Engine evidence: experiment/results/m4-engine-local-latest.json"
echo "Base validator log:  $BASE_LOG"
echo "ER validator log:    $ER_LOG"
