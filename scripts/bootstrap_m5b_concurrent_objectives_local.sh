#!/usr/bin/env bash
set -euo pipefail

# M5b concurrent-objective runtime benchmark wrapper.
#
# Reuse the hardened local Solana + MagicBlock bootstrap from M4-Engine while
# swapping in the M5b transition-coupled load runner. Each invocation starts a
# fresh local base validator and fresh local ER, so one objective-count level is
# one isolated local session.

command -v anchor >/dev/null 2>&1 || { echo "anchor CLI is required" >&2; exit 1; }
command -v solana >/dev/null 2>&1 || { echo "solana CLI is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }

OBJECTIVE_COUNT="${REACTOR_M5B_OBJECTIVE_COUNT:-10}"
EPISODES="${REACTOR_M5B_EPISODES:-1}"
BURST_SPREAD_MS="${REACTOR_M5B_BURST_SPREAD_MS:-20}"

if ! [[ "$OBJECTIVE_COUNT" =~ ^[1-9][0-9]*$ ]]; then
  echo "REACTOR_M5B_OBJECTIVE_COUNT must be a positive integer." >&2
  exit 1
fi
if ! [[ "$EPISODES" =~ ^[1-9][0-9]*$ ]]; then
  echo "REACTOR_M5B_EPISODES must be a positive integer." >&2
  exit 1
fi

PROGRAM_KEYPAIR="target/deploy/reactor-keypair.json"
SOURCE_FILE="programs/reactor/src/lib.rs"
SYNC_SCRIPT="scripts/sync_m2_program_id.mjs"

if [[ ! -f "$PROGRAM_KEYPAIR" ]]; then
  echo "Missing $PROGRAM_KEYPAIR." >&2
  echo "Run 'anchor build' once to create the local Reactor program keypair." >&2
  exit 1
fi

npm install >/dev/null

SYNCED_PROGRAM_ID="$(node "$SYNC_SCRIPT")"
SOURCE_PROGRAM_ID="$(sed -n 's/.*declare_id!("\([1-9A-HJ-NP-Za-km-z]*\)").*/\1/p' "$SOURCE_FILE" | head -n 1)"
if [[ -z "$SYNCED_PROGRAM_ID" || -z "$SOURCE_PROGRAM_ID" || "$SOURCE_PROGRAM_ID" != "$SYNCED_PROGRAM_ID" ]]; then
  echo "Reactor program identity synchronization failed." >&2
  echo "keypair: $SYNCED_PROGRAM_ID" >&2
  echo "source:  $SOURCE_PROGRAM_ID" >&2
  exit 1
fi

echo "Reactor program identity synchronized: $SYNCED_PROGRAM_ID"
echo "M5b objective count: $OBJECTIVE_COUNT"
echo "M5b episodes/path:  $EPISODES"
echo "M5b burst spread:   ${BURST_SPREAD_MS}ms"

TMP_SCRIPT="$(mktemp)"
cleanup_tmp() { rm -f "$TMP_SCRIPT"; }
trap cleanup_tmp EXIT

# The M4-Engine bootstrap already provides safe port cleanup, fresh local
# validators, wallet/validator funding, build/deploy, ID checks, headless ER
# startup, readiness checks and process cleanup. Substitute only the benchmark
# labels, runner and evidence path.
sed \
  -e 's/Preflighting local M4-Engine ports/Preflighting local M5b concurrent-objective ports/' \
  -e 's/Running controlled local M4-Engine benchmark/Running local M5b concurrent-objective benchmark/' \
  -e 's|node scripts/run_m4_engine_local.mjs|node scripts/run_m5b_concurrent_objectives_local.mjs|' \
  -e 's/M4-Engine runner failed/M5b concurrent-objective runner failed/' \
  -e "s|M4-Engine evidence: experiment/results/m4-engine-local-latest.json|M5b evidence: experiment/results/m5b-concurrent-objectives-${OBJECTIVE_COUNT}-latest.json|" \
  scripts/bootstrap_m4_engine_local.sh > "$TMP_SCRIPT"

chmod +x "$TMP_SCRIPT"

export REACTOR_M5B_OBJECTIVE_COUNT="$OBJECTIVE_COUNT"
export REACTOR_M5B_EPISODES="$EPISODES"
export REACTOR_M5B_BURST_SPREAD_MS="$BURST_SPREAD_MS"
export REACTOR_M5B_BASE_RPC="${REACTOR_M5B_BASE_RPC:-http://127.0.0.1:8899}"
export REACTOR_M5B_BASE_WS="${REACTOR_M5B_BASE_WS:-ws://127.0.0.1:8900}"
export REACTOR_M5B_ER_RPC="${REACTOR_M5B_ER_RPC:-http://127.0.0.1:7799}"
export REACTOR_M5B_ER_WS="${REACTOR_M5B_ER_WS:-ws://127.0.0.1:7800}"
export REACTOR_M5B_RESULT_PATH="${REACTOR_M5B_RESULT_PATH:-experiment/results/m5b-concurrent-objectives-${OBJECTIVE_COUNT}-latest.json}"

# M4-Engine bootstrap prints this value but the M5b runner controls its own
# objective/episode counts. Keep the inherited trial value at one to avoid
# misleading output from the reused wrapper.
export REACTOR_M4_ENGINE_TRIALS=1

bash "$TMP_SCRIPT"
