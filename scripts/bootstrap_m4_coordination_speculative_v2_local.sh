#!/usr/bin/env bash
set -euo pipefail

command -v anchor >/dev/null 2>&1 || { echo "anchor CLI is required" >&2; exit 1; }
command -v solana >/dev/null 2>&1 || { echo "solana CLI is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }
command -v ephemeral-validator >/dev/null 2>&1 || { echo "ephemeral-validator is required" >&2; exit 1; }
command -v mb-test-validator >/dev/null 2>&1 || { echo "mb-test-validator is required" >&2; exit 1; }

WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
BASE_RPC="${REACTOR_M4_ENGINE_BASE_RPC:-http://127.0.0.1:8899}"
BASE_WS="${REACTOR_M4_ENGINE_BASE_WS:-ws://127.0.0.1:8900}"
ER_RPC="${REACTOR_M4_ENGINE_ER_RPC:-http://127.0.0.1:7799}"
ER_WS="${REACTOR_M4_ENGINE_ER_WS:-ws://127.0.0.1:7800}"
ER_VALIDATOR="${REACTOR_M4_ENGINE_ER_VALIDATOR:-mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev}"
PROGRAM_KEYPAIR="target/deploy/reactor-keypair.json"
PROGRAM_SO="target/deploy/reactor.so"
IDL="${REACTOR_IDL:-target/idl/reactor.json}"
LOG_DIR="experiment/results/m4-speculative-v2-logs"
BASE_LOG="$LOG_DIR/mb-test-validator.log"
ER_LOG="$LOG_DIR/ephemeral-validator.log"
mkdir -p "$LOG_DIR"

BASE_PID=""
ER_PID=""
cleanup() {
  set +e
  [[ -n "$ER_PID" ]] && kill "$ER_PID" >/dev/null 2>&1 || true
  [[ -n "$BASE_PID" ]] && kill "$BASE_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

port_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser "$port"/tcp 2>/dev/null || true
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u || true
  fi
}

is_local_validator() {
  local pid="$1"
  local args
  args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ "$args" =~ (mb-test-validator|solana-test-validator|solana-faucet|ephemeral-validator) ]]
}

for port in 8899 8900 9900 7799 7800 9000; do
  for pid in $(port_pids "$port"); do
    if is_local_validator "$pid"; then
      echo "Cleaning stale local validator PID $pid on port $port"
      kill "$pid" >/dev/null 2>&1 || true
      sleep 0.2
    else
      echo "Port $port is occupied by unrelated PID $pid; refusing to continue." >&2
      exit 1
    fi
  done
done

wait_rpc() {
  local url="$1"
  local pid="$2"
  local label="$3"
  local consecutive=0
  for _ in {1..200}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "$label exited before readiness." >&2
      return 1
    fi
    if solana cluster-version --url "$url" >/dev/null 2>&1; then
      consecutive=$((consecutive + 1))
      if (( consecutive >= 5 )); then
        echo "$label stable: $url"
        return 0
      fi
    else
      consecutive=0
    fi
    sleep 0.25
  done
  echo "$label failed readiness: $url" >&2
  return 1
}

echo "Starting local Solana base..."
mb-test-validator --reset >"$BASE_LOG" 2>&1 &
BASE_PID=$!
wait_rpc "$BASE_RPC" "$BASE_PID" "Local Solana base"

PAYER="$(solana address -k "$WALLET")"
solana airdrop 250 "$PAYER" --url "$BASE_RPC" >/dev/null
solana airdrop 10 "$ER_VALIDATOR" --url "$BASE_RPC" >/dev/null
ER_BALANCE="$(solana balance "$ER_VALIDATOR" --url "$BASE_RPC" --lamports | awk '{print $1}')"
echo "ER validator base balance: $ER_BALANCE lamports"
if [[ ! "$ER_BALANCE" =~ ^[0-9]+$ ]] || (( ER_BALANCE < 5000000000 )); then
  echo "ER validator funding check failed." >&2
  exit 1
fi

echo "Building and deploying Reactor locally..."
npm install

# V2 uses a fresh zero-data system account as the fee payer for every
# speculative attempt and independent source accounts as the fee payers for the
# open/close writes. A transfer that creates a fresh system account below the
# runtime's rent-exempt floor is rejected during simulation, so derive the floor
# from this exact local validator instead of relying on a hard-coded amount.
RENT_FLOOR_LAMPORTS="$(node -e '
const { Connection } = require("@solana/web3.js");
const rpc = process.argv[1];
new Connection(rpc, "confirmed")
  .getMinimumBalanceForRentExemption(0)
  .then((value) => console.log(value))
  .catch((error) => { console.error(error); process.exit(1); });
' "$BASE_RPC")"

if [[ ! "$RENT_FLOOR_LAMPORTS" =~ ^[0-9]+$ ]]; then
  echo "Could not determine zero-data rent-exempt floor: $RENT_FLOOR_LAMPORTS" >&2
  exit 1
fi

export REACTOR_M4_SPEC_V2_ATTEMPT_PAYER_LAMPORTS="$((RENT_FLOOR_LAMPORTS + 50000))"
export REACTOR_M4_SPEC_V2_SOURCE_PAYER_LAMPORTS="$((RENT_FLOOR_LAMPORTS + 200000))"

echo "Zero-data rent floor:       $RENT_FLOOR_LAMPORTS lamports"
echo "Speculative payer funding:  $REACTOR_M4_SPEC_V2_ATTEMPT_PAYER_LAMPORTS lamports/account"
echo "Source payer funding:       $REACTOR_M4_SPEC_V2_SOURCE_PAYER_LAMPORTS lamports/account"

anchor build
solana program deploy "$PROGRAM_SO" \
  --program-id "$PROGRAM_KEYPAIR" \
  --keypair "$WALLET" \
  --url "$BASE_RPC" >/dev/null

echo "Starting local MagicBlock ER..."
RUST_LOG="${RUST_LOG:-warn}" ephemeral-validator \
  --no-tui \
  --reset \
  --remotes "$BASE_RPC" \
  --remotes "$BASE_WS" \
  -l 7799 \
  --lifecycle ephemeral >"$ER_LOG" 2>&1 &
ER_PID=$!
wait_rpc "$ER_RPC" "$ER_PID" "Local MagicBlock ER"
sleep 1

export ANCHOR_PROVIDER_URL="$BASE_RPC"
export ANCHOR_WALLET="$WALLET"
export REACTOR_IDL="$IDL"
export REACTOR_M4_ENGINE_BASE_RPC="$BASE_RPC"
export REACTOR_M4_ENGINE_BASE_WS="$BASE_WS"
export REACTOR_M4_ENGINE_ER_RPC="$ER_RPC"
export REACTOR_M4_ENGINE_ER_WS="$ER_WS"
export REACTOR_M4_ENGINE_ER_VALIDATOR="$ER_VALIDATOR"

export REACTOR_M4_SPEC_V2_WINDOWS_MS="${REACTOR_M4_SPEC_V2_WINDOWS_MS:-10,20,50,100,150,250}"
export REACTOR_M4_SPEC_V2_TRIALS="${REACTOR_M4_SPEC_V2_TRIALS:-2}"
export REACTOR_M4_SPEC_V2_PREOPEN_MS="${REACTOR_M4_SPEC_V2_PREOPEN_MS:-25}"
export REACTOR_M4_SPEC_V2_CADENCE_MS="${REACTOR_M4_SPEC_V2_CADENCE_MS:-5}"
export REACTOR_M4_SPEC_V2_POSTCLOSE_MS="${REACTOR_M4_SPEC_V2_POSTCLOSE_MS:-25}"

echo
echo "Running corrected M4 speculative baseline V2..."
echo "windows=$REACTOR_M4_SPEC_V2_WINDOWS_MS"
echo "trials/band/path=$REACTOR_M4_SPEC_V2_TRIALS"
echo "preopen=${REACTOR_M4_SPEC_V2_PREOPEN_MS}ms cadence=${REACTOR_M4_SPEC_V2_CADENCE_MS}ms postclose=${REACTOR_M4_SPEC_V2_POSTCLOSE_MS}ms"
node scripts/run_m4_coordination_speculative_v2_local.mjs

echo
echo "Evidence: experiment/results/m4-coordination-speculative-v2-local-latest.json"
echo "Base log: $BASE_LOG"
echo "ER log:   $ER_LOG"
