#!/usr/bin/env bash
set -euo pipefail

command -v anchor >/dev/null 2>&1 || { echo "anchor CLI is required" >&2; exit 1; }
command -v solana >/dev/null 2>&1 || { echo "solana CLI is required" >&2; exit 1; }
command -v solana-keygen >/dev/null 2>&1 || { echo "solana-keygen is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }

SOLANA_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
if [[ ! -f "$SOLANA_WALLET" ]]; then
  echo "No local Solana wallet found at $SOLANA_WALLET; creating a test-only keypair."
  mkdir -p "$(dirname "$SOLANA_WALLET")"
  solana-keygen new --no-bip39-passphrase --silent --outfile "$SOLANA_WALLET"
fi

npm install
anchor build
node scripts/sync_m2_program_id.mjs
anchor build
anchor test
