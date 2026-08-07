#!/usr/bin/env bash
set -euo pipefail

command -v anchor >/dev/null 2>&1 || { echo "anchor CLI is required" >&2; exit 1; }
command -v solana >/dev/null 2>&1 || { echo "solana CLI is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }

npm install
anchor build
node scripts/sync_m2_program_id.mjs
anchor build
anchor test
