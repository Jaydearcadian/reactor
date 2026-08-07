#!/usr/bin/env bash
set -euo pipefail

command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }
command -v solana >/dev/null 2>&1 || { echo "solana CLI is required" >&2; exit 1; }

BASE_RPC="${REACTOR_M4_BASE_RPC:-https://api.devnet.solana.com}"
WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
PROGRAM_KEYPAIR="target/deploy/reactor-keypair.json"
IDL="${REACTOR_IDL:-target/idl/reactor.json}"
PATH_MODE="${REACTOR_M4_PATH:-both}"
WINDOWS="${REACTOR_M4_WINDOWS_MS:-50,100,150,250,500,1000}"
TRIALS_PER_WINDOW="${REACTOR_M4_TRIALS_PER_WINDOW:-1}"
FIXTURE_BUDGET_LAMPORTS="${REACTOR_M4_FIXTURE_BUDGET_LAMPORTS:-80000000}"
PAYER_RESERVE_LAMPORTS="${REACTOR_M4_PAYER_RESERVE_LAMPORTS:-100000000}"

if [[ ! -f "$WALLET" ]]; then
  echo "Missing wallet: $WALLET" >&2
  exit 1
fi
if [[ ! -f "$PROGRAM_KEYPAIR" ]]; then
  echo "Missing $PROGRAM_KEYPAIR. Run the proven M3 bootstrap/build once before M4." >&2
  exit 1
fi
if [[ ! -f "$IDL" ]]; then
  echo "Missing $IDL. Run anchor build once before M4." >&2
  exit 1
fi

npm install
npm run test:m4:telemetry

PROGRAM_ID="$(solana address -k "$PROGRAM_KEYPAIR")"
PAYER="$(solana address -k "$WALLET")"
BALANCE="$(solana balance "$PAYER" --url "$BASE_RPC" --lamports | awk '{print $1}')"
IFS=',' read -r -a WINDOW_ARRAY <<< "$WINDOWS"
WINDOW_COUNT="${#WINDOW_ARRAY[@]}"
if [[ "$PATH_MODE" == "both" ]]; then
  PATH_COUNT=2
else
  PATH_COUNT=1
fi
FIXTURE_COUNT=$((WINDOW_COUNT * TRIALS_PER_WINDOW * PATH_COUNT))
PLANNED_FIXTURE_LAMPORTS=$((FIXTURE_COUNT * FIXTURE_BUDGET_LAMPORTS))
MIN_BALANCE=$((PLANNED_FIXTURE_LAMPORTS + PAYER_RESERVE_LAMPORTS))

printf '%s\n' "M4 does NOT rebuild or redeploy Reactor."
printf '%s\n' "M4 runner:       prebuilt/pre-signed hot path"
printf '%s\n' "Base RPC:        $BASE_RPC"
printf '%s\n' "Program ID:      $PROGRAM_ID"
printf '%s\n' "Payer:           $PAYER"
printf '%s\n' "Balance:         $BALANCE lamports"
printf '%s\n' "Paths:           $PATH_MODE"
printf '%s\n' "Windows:         $WINDOWS ms"
printf '%s\n' "Trials/window:   $TRIALS_PER_WINDOW"
printf '%s\n' "Planned fixtures:$FIXTURE_COUNT"
printf '%s\n' "Fixture budget:  $FIXTURE_BUDGET_LAMPORTS lamports each"
printf '%s\n' "Budget floor:    $MIN_BALANCE lamports including payer reserve"

if (( BALANCE < MIN_BALANCE )); then
  echo "Insufficient payer balance for the planned M4 run." >&2
  echo "Current:  $BALANCE lamports" >&2
  echo "Required: $MIN_BALANCE lamports" >&2
  echo "Reduce REACTOR_M4_WINDOWS_MS / REACTOR_M4_TRIALS_PER_WINDOW, lower the proven-safe fixture budget, or fund $PAYER with devnet SOL." >&2
  exit 1
fi

if ! solana program show "$PROGRAM_ID" --url "$BASE_RPC" >/dev/null 2>&1; then
  echo "Reactor program $PROGRAM_ID is not visible on $BASE_RPC." >&2
  exit 1
fi

export ANCHOR_PROVIDER_URL="$BASE_RPC"
export ANCHOR_WALLET="$WALLET"
export REACTOR_M4_BASE_RPC="$BASE_RPC"
export REACTOR_IDL="$IDL"
export REACTOR_M4_PATH="$PATH_MODE"
export REACTOR_M4_WINDOWS_MS="$WINDOWS"
export REACTOR_M4_TRIALS_PER_WINDOW="$TRIALS_PER_WINDOW"
export REACTOR_M4_FIXTURE_BUDGET_LAMPORTS="$FIXTURE_BUDGET_LAMPORTS"

node scripts/run_m4_capture_hot.mjs
node scripts/analyze_m4_capture.mjs

echo
echo "M4a raw evidence: experiment/results/m4-capture-latest.json"
echo "M4a analysis:     experiment/results/m4-capture-analysis-latest.json"
