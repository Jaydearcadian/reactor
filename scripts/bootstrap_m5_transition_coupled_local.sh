#!/usr/bin/env bash
set -euo pipefail

# M5 transition-coupled benchmark wrapper.
#
# Reactor's local/deployed identity is defined by
# target/deploy/reactor-keypair.json. Synchronize declare_id! from that keypair
# before the hardened bootstrap runs `anchor build`, so the generated IDL and
# deploy keypair describe the same program.

echo "Preflighting Reactor program identity..."

PROGRAM_KEYPAIR="target/deploy/reactor-keypair.json"
SOURCE_FILE="programs/reactor/src/lib.rs"
SYNC_SCRIPT="scripts/sync_m2_program_id.mjs"

if [[ ! -f "$PROGRAM_KEYPAIR" ]]; then
  echo "Missing $PROGRAM_KEYPAIR." >&2
  echo "Run 'anchor build' once to create the local Reactor program keypair." >&2
  exit 1
fi

if [[ ! -f "$SYNC_SCRIPT" ]]; then
  echo "Missing $SYNC_SCRIPT." >&2
  exit 1
fi

# The sync helper imports @solana/web3.js.
npm install >/dev/null

SYNCED_PROGRAM_ID="$(node "$SYNC_SCRIPT")"
SOURCE_PROGRAM_ID="$(sed -n 's/.*declare_id!("\([1-9A-HJ-NP-Za-km-z]*\)").*/\1/p' "$SOURCE_FILE" | head -n 1)"

if [[ -z "$SYNCED_PROGRAM_ID" || -z "$SOURCE_PROGRAM_ID" ]]; then
  echo "Could not resolve Reactor program identity during preflight." >&2
  echo "sync helper returned: '$SYNCED_PROGRAM_ID'" >&2
  echo "source declare_id:    '$SOURCE_PROGRAM_ID'" >&2
  exit 1
fi

if [[ "$SOURCE_PROGRAM_ID" != "$SYNCED_PROGRAM_ID" ]]; then
  echo "Program identity synchronization failed." >&2
  echo "keypair: $SYNCED_PROGRAM_ID" >&2
  echo "source:  $SOURCE_PROGRAM_ID" >&2
  exit 1
fi

echo "Reactor program identity synchronized: $SYNCED_PROGRAM_ID"

# Reuse the hardened M4 local stack/bootstrap. Only substitute the benchmark
# runner and evidence labels; validator startup, funding, build/deploy, ID
# checks, delegation environment, and cleanup remain identical.
TMP_SCRIPT="$(mktemp)"
cleanup_tmp() {
  rm -f "$TMP_SCRIPT"
}
trap cleanup_tmp EXIT

sed \
  -e 's/Preflighting local M4-Engine ports/Preflighting local M5 transition-coupled ports/' \
  -e 's/Running controlled local M4-Engine benchmark/Running local M5 transition-coupled benchmark/' \
  -e 's|node scripts/run_m4_engine_local.mjs|node scripts/run_m5_transition_coupled_local.mjs|' \
  -e 's/M4-Engine runner failed/M5 transition-coupled runner failed/' \
  -e 's|M4-Engine evidence: experiment/results/m4-engine-local-latest.json|M5 transition evidence: experiment/results/m5-transition-coupled-local-latest.json|' \
  scripts/bootstrap_m4_engine_local.sh > "$TMP_SCRIPT"

chmod +x "$TMP_SCRIPT"

export REACTOR_M5_TRANSITION_TRIALS="${REACTOR_M5_TRANSITION_TRIALS:-10}"
export REACTOR_M4_ENGINE_TRIALS="$REACTOR_M5_TRANSITION_TRIALS"

bash "$TMP_SCRIPT"
