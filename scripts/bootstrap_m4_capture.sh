#!/usr/bin/env bash
set -euo pipefail

command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }
command -v solana >/dev/null 2>&1 || { echo "solana CLI is required" >&2; exit 1; }

BASE_RPC="${REACTOR_M4_BASE_RPC:-https://api.devnet.solana.com}"
WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
PROGRAM_KEYPAIR="target/deploy/reactor-keypair.json"
IDL="${REACTOR_IDL:-target/idl/reactor.json}"

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

printf '%s\n' "M4 does NOT rebuild or redeploy Reactor."
printf '%s\n' "Base RPC:      $BASE_RPC"
printf '%s\n' "Program ID:    $PROGRAM_ID"
printf '%s\n' "Payer:         $PAYER"
printf '%s\n' "Balance:       $BALANCE lamports"
printf '%s\n' "Paths:         ${REACTOR_M4_PATH:-both}"
printf '%s\n' "Windows:       ${REACTOR_M4_WINDOWS_MS:-50,100,150,250,500,1000} ms"
printf '%s\n' "Trials/window: ${REACTOR_M4_TRIALS_PER_WINDOW:-1}"

if ! solana program show "$PROGRAM_ID" --url "$BASE_RPC" >/dev/null 2>&1; then
  echo "Reactor program $PROGRAM_ID is not visible on $BASE_RPC." >&2
  exit 1
fi

export ANCHOR_PROVIDER_URL="$BASE_RPC"
export ANCHOR_WALLET="$WALLET"
export REACTOR_M4_BASE_RPC="$BASE_RPC"
export REACTOR_IDL="$IDL"

node scripts/run_m4_capture.mjs

echo
echo "M4a raw evidence: experiment/results/m4-capture-latest.json"
