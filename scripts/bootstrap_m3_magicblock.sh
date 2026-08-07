#!/usr/bin/env bash
set -euo pipefail

command -v anchor >/dev/null 2>&1 || { echo "anchor CLI is required" >&2; exit 1; }
command -v solana >/dev/null 2>&1 || { echo "solana CLI is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }

BASE_RPC="${REACTOR_BASE_RPC:-https://api.devnet.solana.com}"
ER_RPC="${REACTOR_ER_RPC:-https://devnet.magicblock.app/}"
ER_WS="${REACTOR_ER_WS:-wss://devnet.magicblock.app/}"
WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"

if [[ ! -f "$WALLET" ]]; then
  echo "Missing Solana wallet: $WALLET" >&2
  exit 1
fi

npm install
anchor build
node scripts/sync_m2_program_id.mjs
anchor build

PROGRAM_ID="$(solana address -k target/deploy/reactor-keypair.json)"
PAYER="$(solana address -k "$WALLET")"
BALANCE="$(solana balance "$PAYER" --url "$BASE_RPC" --lamports | awk '{print $1}')"
TARGET_LAMPORTS=3500000000

echo "Solana devnet: $BASE_RPC"
echo "MagicBlock ER:  $ER_RPC"
echo "Payer:          $PAYER"
echo "Program ID:     $PROGRAM_ID"
echo "Balance:        $BALANCE lamports"

if (( BALANCE < TARGET_LAMPORTS )); then
  echo "Payer has less than 3.5 SOL; attempting devnet faucet top-up."
  for amount in 2 1 1; do
    solana airdrop "$amount" "$PAYER" --url "$BASE_RPC" || true
    sleep 2
    BALANCE="$(solana balance "$PAYER" --url "$BASE_RPC" --lamports | awk '{print $1}')"
    if (( BALANCE >= TARGET_LAMPORTS )); then
      break
    fi
  done
fi

if (( BALANCE < 1000000000 )); then
  echo "Devnet payer balance is too low to safely upgrade and run M3a: $BALANCE lamports." >&2
  echo "Fund $PAYER with devnet SOL and rerun this script." >&2
  exit 1
fi

export ANCHOR_PROVIDER_URL="$BASE_RPC"
export ANCHOR_WALLET="$WALLET"
export REACTOR_BASE_RPC="$BASE_RPC"
export REACTOR_ER_RPC="$ER_RPC"
export REACTOR_ER_WS="$ER_WS"

echo "Deploying/upgrading Reactor M3a on Solana devnet..."
anchor deploy --provider.cluster "$BASE_RPC" --provider.wallet "$WALLET"

echo "Verifying deployed program account..."
solana program show "$PROGRAM_ID" --url "$BASE_RPC"

echo "Running MagicBlock M3a proof..."
node scripts/run_m3_magicblock.mjs

echo
 echo "M3a proof artifact: experiment/results/m3-magicblock-latest.json"
