#!/usr/bin/env bash
set -euo pipefail

command -v anchor >/dev/null 2>&1 || { echo "anchor CLI is required" >&2; exit 1; }
command -v solana >/dev/null 2>&1 || { echo "solana CLI is required" >&2; exit 1; }
command -v solana-keygen >/dev/null 2>&1 || { echo "solana-keygen is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }

DEVNET_RPC="${SOLANA_DEVNET_RPC_URL:-https://api.devnet.solana.com}"
SOLANA_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
MIN_BALANCE_SOL="${REACTOR_DEVNET_MIN_BALANCE_SOL:-3}"

if [[ ! -f "$SOLANA_WALLET" ]]; then
  echo "No Solana wallet found at $SOLANA_WALLET; creating a test-only keypair."
  mkdir -p "$(dirname "$SOLANA_WALLET")"
  solana-keygen new --no-bip39-passphrase --silent --outfile "$SOLANA_WALLET"
fi

export ANCHOR_WALLET="$SOLANA_WALLET"
export ANCHOR_PROVIDER_URL="$DEVNET_RPC"

npm install
anchor build
node scripts/sync_m2_program_id.mjs
anchor build

PROGRAM_ID="$(solana address -k target/deploy/reactor-keypair.json)"
PAYER="$(solana address -k "$SOLANA_WALLET")"
BALANCE_SOL="$(solana balance "$PAYER" --url "$DEVNET_RPC" | awk '{print $1}')"

echo "Devnet RPC:  $DEVNET_RPC"
echo "Payer:       $PAYER"
echo "Program ID:  $PROGRAM_ID"
echo "Balance:     $BALANCE_SOL SOL"

balance_ok=$(python3 - "$BALANCE_SOL" "$MIN_BALANCE_SOL" <<'PY'
import sys
balance = float(sys.argv[1])
minimum = float(sys.argv[2])
print("1" if balance >= minimum else "0")
PY
)

if [[ "$balance_ok" != "1" ]]; then
  echo "Payer has less than ${MIN_BALANCE_SOL} SOL on devnet; requesting faucet funds."
  for _ in 1 2 3; do
    solana airdrop 2 "$PAYER" --url "$DEVNET_RPC" || true
    sleep 2
    BALANCE_SOL="$(solana balance "$PAYER" --url "$DEVNET_RPC" | awk '{print $1}')"
    balance_ok=$(python3 - "$BALANCE_SOL" "$MIN_BALANCE_SOL" <<'PY'
import sys
balance = float(sys.argv[1])
minimum = float(sys.argv[2])
print("1" if balance >= minimum else "0")
PY
)
    [[ "$balance_ok" == "1" ]] && break
  done
fi

if [[ "$balance_ok" != "1" ]]; then
  echo "Devnet payer balance is still only ${BALANCE_SOL} SOL." >&2
  echo "Fund $PAYER with devnet SOL, then rerun this script." >&2
  exit 2
fi

echo "Deploying/upgrading Reactor on Solana devnet..."
anchor deploy --provider.cluster "$DEVNET_RPC" --provider.wallet "$SOLANA_WALLET"

echo "Verifying deployed program account..."
solana program show "$PROGRAM_ID" --url "$DEVNET_RPC"

export REACTOR_PROOF_ENV="devnet"
export REACTOR_EPHEMERAL_AUTHORITY="1"
export REACTOR_RPC_PACE_MS="${REACTOR_RPC_PACE_MS:-400}"
export REACTOR_RESULT_PATH="${REACTOR_RESULT_PATH:-experiment/results/m2-devnet-latest.json}"

node scripts/run_m2_proof.mjs

echo
printf 'Devnet proof artifact: %s\n' "$REACTOR_RESULT_PATH"
printf 'Program explorer: https://explorer.solana.com/address/%s?cluster=devnet\n' "$PROGRAM_ID"
