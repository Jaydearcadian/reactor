#!/usr/bin/env bash
set -euo pipefail

command -v anchor >/dev/null 2>&1 || { echo "anchor CLI is required" >&2; exit 1; }
command -v solana >/dev/null 2>&1 || { echo "solana CLI is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }
command -v ps >/dev/null 2>&1 || { echo "ps is required" >&2; exit 1; }

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

if ! ephemeral-validator --help 2>&1 | grep -q -- '--no-tui'; then
  echo "Installed ephemeral-validator does not expose --no-tui." >&2
  echo "Update it before running the headless M4-Engine bootstrap:" >&2
  echo "  npm install -g @magicblock-labs/ephemeral-validator@latest" >&2
  exit 1
fi

WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
BASE_RPC="${REACTOR_M4_ENGINE_BASE_RPC:-http://127.0.0.1:8899}"
BASE_WS="${REACTOR_M4_ENGINE_BASE_WS:-ws://127.0.0.1:8900}"
ER_RPC="${REACTOR_M4_ENGINE_ER_RPC:-http://127.0.0.1:7799}"
ER_WS="${REACTOR_M4_ENGINE_ER_WS:-ws://127.0.0.1:7800}"
ER_VALIDATOR="${REACTOR_M4_ENGINE_ER_VALIDATOR:-mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev}"
ER_FUND_SOL="${REACTOR_M4_ENGINE_ER_FUND_SOL:-10}"
ER_MIN_LAMPORTS="${REACTOR_M4_ENGINE_ER_MIN_LAMPORTS:-5000000000}"
TRIALS="${REACTOR_M4_ENGINE_TRIALS:-10}"
PROGRAM_KEYPAIR="target/deploy/reactor-keypair.json"
PROGRAM_SO="target/deploy/reactor.so"
IDL="${REACTOR_IDL:-target/idl/reactor.json}"
LOG_DIR="experiment/results/m4-engine-logs"
BASE_LOG="$LOG_DIR/mb-test-validator.log"
ER_LOG="$LOG_DIR/ephemeral-validator.log"
PID_DIR="$LOG_DIR/pids"
BASE_PID_FILE="$PID_DIR/mb-test-validator.pid"
ER_PID_FILE="$PID_DIR/ephemeral-validator.pid"

mkdir -p "$LOG_DIR" "$PID_DIR"

if [[ ! -f "$WALLET" ]]; then
  echo "Missing wallet: $WALLET" >&2
  exit 1
fi

BASE_PID=""
ER_PID=""

show_base_log() {
  if [[ -f "$BASE_LOG" ]]; then
    echo >&2
    echo "---- mb-test-validator.log (last 120 lines) ----" >&2
    tail -n 120 "$BASE_LOG" >&2 || true
    echo "---- end mb-test-validator.log ----" >&2
  fi
}

show_er_log() {
  if [[ -f "$ER_LOG" ]]; then
    echo >&2
    echo "---- ephemeral-validator.log (last 120 lines) ----" >&2
    tail -n 120 "$ER_LOG" >&2 || true
    echo "---- end ephemeral-validator.log ----" >&2
  fi
}

listener_pids() {
  local port="$1"
  local output=""

  if command -v lsof >/dev/null 2>&1; then
    output="$(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    output="$(fuser "$port"/tcp 2>/dev/null || true)"
  elif command -v ss >/dev/null 2>&1; then
    output="$(ss -ltnp "sport = :$port" 2>/dev/null \
      | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' \
      | sort -u || true)"
  else
    echo "Need one of lsof, fuser, or ss to perform safe local-port preflight." >&2
    return 2
  fi

  printf '%s\n' "$output" \
    | tr ' ' '\n' \
    | sed '/^[[:space:]]*$/d' \
    | sort -u
}

is_benchmark_local_process() {
  local pid="$1"
  local args
  args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ "$args" =~ (mb-test-validator|solana-test-validator|solana-faucet|ephemeral-validator) ]]
}

terminate_pid_safely() {
  local pid="$1"
  local label="$2"

  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  if ! is_benchmark_local_process "$pid"; then
    local args
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    echo "$label is occupied by unrelated PID $pid." >&2
    echo "Command: $args" >&2
    echo "Refusing to terminate an unrelated process." >&2
    return 1
  fi

  local args
  args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  echo "Cleaning stale benchmark process PID $pid: $args"
  kill "$pid" >/dev/null 2>&1 || true

  for _ in {1..40}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done

  echo "Stale benchmark PID $pid did not exit after SIGTERM; sending SIGKILL."
  kill -9 "$pid" >/dev/null 2>&1 || true
  sleep 0.2
}

clean_port_if_stale() {
  local port="$1"
  local label="$2"
  local pids

  if ! pids="$(listener_pids "$port")"; then
    return 1
  fi

  if [[ -z "$pids" ]]; then
    return 0
  fi

  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    terminate_pid_safely "$pid" "$label (port $port)" || return 1
  done <<< "$pids"

  sleep 0.2
  if [[ -n "$(listener_pids "$port")" ]]; then
    echo "$label port $port is still occupied after stale-process cleanup." >&2
    return 1
  fi
}

clean_pidfile_process() {
  local pidfile="$1"
  local label="$2"
  if [[ ! -f "$pidfile" ]]; then
    return 0
  fi

  local pid
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  rm -f "$pidfile"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" >/dev/null 2>&1; then
    terminate_pid_safely "$pid" "$label" || return 1
  fi
}

cleanup_current_process() {
  local pid="$1"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  if command -v pgrep >/dev/null 2>&1; then
    local children
    children="$(pgrep -P "$pid" 2>/dev/null || true)"
    while IFS= read -r child; do
      [[ -n "$child" ]] || continue
      if is_benchmark_local_process "$child"; then
        kill "$child" >/dev/null 2>&1 || true
      fi
    done <<< "$children"
  fi

  kill "$pid" >/dev/null 2>&1 || true
  for _ in {1..30}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  kill -9 "$pid" >/dev/null 2>&1 || true
}

cleanup() {
  set +e
  cleanup_current_process "$ER_PID"
  cleanup_current_process "$BASE_PID"
  rm -f "$ER_PID_FILE" "$BASE_PID_FILE"
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

echo "Preflighting local M4-Engine ports..."
clean_pidfile_process "$ER_PID_FILE" "stale local ER PID file process"
clean_pidfile_process "$BASE_PID_FILE" "stale local base PID file process"

# MagicBlock's local defaults use base RPC/WS 8899/8900, the Solana faucet on
# 9900, local ER RPC/WS 7799/7800, and an ER metrics listener on 9000.
# Only known validator/faucet processes are terminated. Unrelated listeners are
# reported and left untouched.
for spec in \
  "8899:Local Solana RPC" \
  "8900:Local Solana WebSocket" \
  "9900:Local Solana faucet" \
  "7799:Local MagicBlock ER RPC" \
  "7800:Local MagicBlock ER WebSocket" \
  "9000:Local MagicBlock ER metrics"
do
  port="${spec%%:*}"
  label="${spec#*:}"
  clean_port_if_stale "$port" "$label"
done

echo "Local benchmark ports are clear."

echo "Starting fully local MagicBlock base validator..."
mb-test-validator --reset >"$BASE_LOG" 2>&1 &
BASE_PID=$!
printf '%s\n' "$BASE_PID" > "$BASE_PID_FILE"
if ! wait_rpc_stable "$BASE_RPC" "Local Solana base" "$BASE_PID" 160 4; then
  echo "Local base validator failed readiness." >&2
  show_base_log
  exit 1
fi

PAYER="$(solana address -k "$WALLET")"
solana airdrop 100 "$PAYER" --url "$BASE_RPC" >/dev/null

echo "Funding local MagicBlock validator identity on the base chain..."
solana airdrop "$ER_FUND_SOL" "$ER_VALIDATOR" --url "$BASE_RPC" >/dev/null
ER_BALANCE_LAMPORTS="$(solana balance "$ER_VALIDATOR" --url "$BASE_RPC" --lamports | awk '{print $1}')"
if [[ ! "$ER_BALANCE_LAMPORTS" =~ ^[0-9]+$ ]]; then
  echo "Could not parse local ER validator balance." >&2
  exit 1
fi
if (( ER_BALANCE_LAMPORTS < ER_MIN_LAMPORTS )); then
  echo "Local ER validator is underfunded after airdrop." >&2
  echo "Validator: $ER_VALIDATOR" >&2
  echo "Balance:   $ER_BALANCE_LAMPORTS lamports" >&2
  echo "Required:  $ER_MIN_LAMPORTS lamports" >&2
  exit 1
fi
printf '%s\n' "ER validator:     $ER_VALIDATOR"
printf '%s\n' "ER base balance:  $ER_BALANCE_LAMPORTS lamports"

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
printf '%s\n' "ER binary:        $(ephemeral-validator --version 2>/dev/null || echo unknown)"
printf '%s\n' "ER mode:          headless, reset local ledger"

echo "Deploying Reactor only to the local base validator..."
solana program deploy "$PROGRAM_SO" \
  --program-id "$PROGRAM_KEYPAIR" \
  --keypair "$WALLET" \
  --url "$BASE_RPC" >/dev/null
solana program show "$PROGRAM_ID" --url "$BASE_RPC"

echo "Starting local MagicBlock Ephemeral Rollup in headless mode..."
RUST_LOG="${RUST_LOG:-info}" ephemeral-validator \
  --no-tui \
  --reset \
  --remotes "$BASE_RPC" \
  --remotes "$BASE_WS" \
  -l 7799 \
  --lifecycle ephemeral >"$ER_LOG" 2>&1 &
ER_PID=$!
printf '%s\n' "$ER_PID" > "$ER_PID_FILE"

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
export REACTOR_M4_ENGINE_ER_VALIDATOR="$ER_VALIDATOR"
export REACTOR_M4_ENGINE_TRIALS="$TRIALS"

echo
echo "Running controlled local M4-Engine benchmark..."
set +e
node scripts/run_m4_engine_local.mjs
STATUS=$?
set -e
if (( STATUS != 0 )); then
  echo "M4-Engine runner failed with exit code $STATUS." >&2
  if [[ -n "$ER_PID" ]] && ! kill -0 "$ER_PID" >/dev/null 2>&1; then
    echo "The local ER process is no longer alive." >&2
  fi
  show_base_log
  show_er_log
  exit "$STATUS"
fi

echo
echo "M4-Engine evidence: experiment/results/m4-engine-local-latest.json"
echo "Base validator log:  $BASE_LOG"
echo "ER validator log:    $ER_LOG"
