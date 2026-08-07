#!/usr/bin/env bash
set -euo pipefail

command -v anchor >/dev/null 2>&1 || { echo "anchor CLI is required" >&2; exit 1; }
command -v solana >/dev/null 2>&1 || { echo "solana CLI is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }
command -v wc >/dev/null 2>&1 || { echo "wc is required" >&2; exit 1; }

BASE_RPC="${REACTOR_BASE_RPC:-https://rpc.magicblock.app/devnet}"
DEPLOY_RPC="${REACTOR_DEPLOY_RPC:-https://api.devnet.solana.com}"
ROUTER_RPC="${REACTOR_ROUTER_RPC:-https://devnet-router.magicblock.app/}"
WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
PROGRAM_SO="target/deploy/reactor.so"
PROGRAM_KEYPAIR="target/deploy/reactor-keypair.json"
PROGRAM_HEADROOM_BYTES="${REACTOR_PROGRAM_HEADROOM_BYTES:-65536}"
PRE_EXTENSION_TARGET_LAMPORTS="${REACTOR_PRE_EXTENSION_TARGET_LAMPORTS:-3500000000}"
DEPLOY_RESERVE_LAMPORTS="${REACTOR_DEPLOY_RESERVE_LAMPORTS:-5500000000}"

if [[ ! -f "$WALLET" ]]; then
  echo "Missing Solana wallet: $WALLET" >&2
  exit 1
fi

read_balance() {
  solana balance "$PAYER" --url "$DEPLOY_RPC" --lamports | awk '{print $1}'
}

try_top_up_to() {
  local target="$1"
  local label="$2"
  local balance
  balance="$(read_balance)"
  if (( balance >= target )); then
    echo "$label balance is sufficient: $balance lamports"
    return 0
  fi

  echo "$label requires at least $target lamports; current balance is $balance."
  echo "Attempting bounded devnet faucet top-up..."
  for amount in 2 2 1 1 1; do
    solana airdrop "$amount" "$PAYER" --url "$DEPLOY_RPC" || true
    sleep 2
    balance="$(read_balance)"
    echo "Balance now: $balance lamports"
    if (( balance >= target )); then
      return 0
    fi
  done

  echo "Devnet faucet did not raise $PAYER to the required balance." >&2
  echo "Current:  $balance lamports" >&2
  echo "Required: $target lamports" >&2
  echo "Fund $PAYER with devnet SOL, then rerun this script." >&2
  return 1
}

npm install
anchor build
node scripts/sync_m2_program_id.mjs
anchor build

PROGRAM_ID="$(solana address -k "$PROGRAM_KEYPAIR")"
PAYER="$(solana address -k "$WALLET")"
BALANCE="$(read_balance)"

BASE_GENESIS="$(solana genesis-hash --url "$BASE_RPC")"
DEPLOY_GENESIS="$(solana genesis-hash --url "$DEPLOY_RPC")"
if [[ "$BASE_GENESIS" != "$DEPLOY_GENESIS" ]]; then
  echo "MagicBlock base RPC and deployment RPC are not the same Solana cluster." >&2
  echo "MagicBlock genesis: $BASE_GENESIS" >&2
  echo "Deploy genesis:     $DEPLOY_GENESIS" >&2
  exit 1
fi

PROGRAM_BYTES="$(wc -c < "$PROGRAM_SO" | tr -d '[:space:]')"
PROGRAM_INFO="$(solana program show "$PROGRAM_ID" --url "$DEPLOY_RPC" 2>/dev/null || true)"
ONCHAIN_DATA_LENGTH="$(printf '%s\n' "$PROGRAM_INFO" | awk '/Data Length:/ {print $3; exit}')"
ONCHAIN_AUTHORITY="$(printf '%s\n' "$PROGRAM_INFO" | awk '/Authority:/ {print $2; exit}')"

printf '%s\n' "MagicBlock base:   $BASE_RPC"
printf '%s\n' "Deployment RPC:    $DEPLOY_RPC"
printf '%s\n' "MagicBlock router: $ROUTER_RPC"
printf '%s\n' "Genesis hash:      $DEPLOY_GENESIS"
printf '%s\n' "Payer:             $PAYER"
printf '%s\n' "Program ID:        $PROGRAM_ID"
printf '%s\n' "Built program:     $PROGRAM_BYTES bytes"
printf '%s\n' "Balance:           $BALANCE lamports"

if [[ -n "$ONCHAIN_DATA_LENGTH" ]]; then
  echo "Onchain capacity:  $ONCHAIN_DATA_LENGTH bytes"
  echo "Upgrade authority: ${ONCHAIN_AUTHORITY:-unknown}"
  if [[ -n "$ONCHAIN_AUTHORITY" && "$ONCHAIN_AUTHORITY" != "$PAYER" ]]; then
    echo "Connected wallet is not the deployed program upgrade authority." >&2
    exit 1
  fi
else
  echo "Onchain program metadata was not found; deployment will be treated as a new deploy."
fi

if [[ -n "$ONCHAIN_DATA_LENGTH" ]]; then
  REQUIRED_CAPACITY=$((PROGRAM_BYTES + PROGRAM_HEADROOM_BYTES))
  if (( ONCHAIN_DATA_LENGTH < REQUIRED_CAPACITY )); then
    try_top_up_to "$PRE_EXTENSION_TARGET_LAMPORTS" "ProgramData extension"
    EXTEND_BY=$((REQUIRED_CAPACITY - ONCHAIN_DATA_LENGTH))
    echo "ProgramData is too small for the M3 binary plus headroom."
    echo "Extending ProgramData by $EXTEND_BY bytes before upgrade..."
    echo "Approximate rent for a $EXTEND_BY-byte account:"
    solana rent "$EXTEND_BY" --url "$DEPLOY_RPC" || true
    solana program extend "$PROGRAM_ID" "$EXTEND_BY" --url "$DEPLOY_RPC" --keypair "$WALLET"
    echo "ProgramData after extension:"
    solana program show "$PROGRAM_ID" --url "$DEPLOY_RPC"
  else
    echo "Existing ProgramData capacity is sufficient for the M3 binary."
  fi
fi

# Loader-v3 upgrades stage the new ELF in a temporary buffer account before the
# Upgrade instruction. A large M3 binary therefore needs a sizeable transient
# rent balance even when ProgramData itself has already been extended. Re-read
# the payer after extension and restore a safe deployment reserve.
try_top_up_to "$DEPLOY_RESERVE_LAMPORTS" "Program upgrade"

echo "Pre-deploy payer balance: $(read_balance) lamports"

export ANCHOR_PROVIDER_URL="$BASE_RPC"
export ANCHOR_WALLET="$WALLET"
export REACTOR_BASE_RPC="$BASE_RPC"
export REACTOR_ROUTER_RPC="$ROUTER_RPC"
unset REACTOR_ER_RPC || true
unset REACTOR_ER_WS || true

echo "Deploying/upgrading Reactor M3a through canonical Solana devnet RPC..."
anchor deploy --provider.cluster "$DEPLOY_RPC" --provider.wallet "$WALLET"

echo "Verifying deployed program account from canonical devnet..."
solana program show "$PROGRAM_ID" --url "$DEPLOY_RPC"

echo "Verifying the same program is visible through MagicBlock base RPC..."
solana program show "$PROGRAM_ID" --url "$BASE_RPC"

echo "Running router-aware MagicBlock M3a proof..."
node scripts/run_m3_magicblock_skill.mjs

echo
echo "M3a proof artifact: experiment/results/m3-magicblock-latest.json"
