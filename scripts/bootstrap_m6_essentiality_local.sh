#!/usr/bin/env bash
set -euo pipefail

# M6 essentiality benchmark wrapper.
# Reuses the hardened local Solana + MagicBlock validator lifecycle from
# bootstrap_m4_engine_local.sh while substituting the frozen M6 runner.

command -v anchor >/dev/null 2>&1 || { echo "anchor CLI is required" >&2; exit 1; }
command -v solana >/dev/null 2>&1 || { echo "solana CLI is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }

CHURN_TRANSITIONS="${REACTOR_M6_CHURN_TRANSITIONS:-120}"
TTL_SLOTS="${REACTOR_M6_TTL_SLOTS:-5000000}"

if ! [[ "$CHURN_TRANSITIONS" =~ ^[1-9][0-9]*$ ]]; then
  echo "REACTOR_M6_CHURN_TRANSITIONS must be a positive integer." >&2
  exit 1
fi
if ! [[ "$TTL_SLOTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "REACTOR_M6_TTL_SLOTS must be a positive integer." >&2
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
echo "M6 churn transitions: $CHURN_TRANSITIONS"
echo "M6 objective-relevant hot transitions: $((CHURN_TRANSITIONS + 1))"
echo "M6 condition TTL: $TTL_SLOTS slots"
echo "M6 frozen canonical-work reduction gate: 75%"
if (( CHURN_TRANSITIONS < 100 )); then
  echo "M6 run classification: structural smoke (<100 transitions; cannot pass frozen gate)"
else
  echo "M6 run classification: frozen-protocol-sized"
fi

TMP_SCRIPT="$(mktemp)"
TMP_RUNNER="$(mktemp scripts/.run_m6_essentiality_local.XXXXXX.mjs)"
cleanup_tmp() { rm -f "$TMP_SCRIPT" "$TMP_RUNNER"; }
trap cleanup_tmp EXIT

# Instrumentation hotfix: the frozen protocol requires fresh-blockhash fairness,
# not a particular RPC commitment. The original M6 runner fetched a blockhash at
# `processed` while preflighting on a `confirmed` connection. On local Solana,
# preflight can therefore evaluate against a bank that does not yet know the
# newer processed blockhash and intermittently reject otherwise-valid hot-state
# transactions. M5b already uses a confirmed blockhash for the same reason.
# Patch only the transport commitment in a temporary runner; fixture, transition
# schedule, accounting, thresholds, and protocol semantics remain unchanged.
sed \
  -e "s/getLatestBlockhash('processed')/getLatestBlockhash('confirmed')/g" \
  -e "s/{ skipPreflight: false, maxRetries: 0 }/{ skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 }/g" \
  scripts/run_m6_essentiality_local.mjs > "$TMP_RUNNER"

# Keep the mature process cleanup, funding, build/deploy, readiness and teardown
# logic from M4-Engine. Replace only labels, log path, runner and evidence path.
sed \
  -e 's/m4-engine-logs/m6-essentiality-logs/g' \
  -e 's/Preflighting local M4-Engine ports/Preflighting local M6 essentiality ports/' \
  -e 's/Running controlled local M4-Engine benchmark/Running frozen local M6 essentiality benchmark/' \
  -e "s|node scripts/run_m4_engine_local.mjs|node $TMP_RUNNER|" \
  -e 's/M4-Engine runner failed/M6 essentiality runner failed/' \
  -e 's|M4-Engine evidence: experiment/results/m4-engine-local-latest.json|M6 evidence: experiment/results/m6-essentiality-latest.json (Chamber mirror: chamber/data/m6-essentiality-latest.json)|' \
  scripts/bootstrap_m4_engine_local.sh > "$TMP_SCRIPT"

chmod +x "$TMP_SCRIPT"

export REACTOR_M6_CHURN_TRANSITIONS="$CHURN_TRANSITIONS"
export REACTOR_M6_TTL_SLOTS="$TTL_SLOTS"
export REACTOR_M6_BASE_RPC="${REACTOR_M6_BASE_RPC:-http://127.0.0.1:8899}"
export REACTOR_M6_BASE_WS="${REACTOR_M6_BASE_WS:-ws://127.0.0.1:8900}"
export REACTOR_M6_ER_RPC="${REACTOR_M6_ER_RPC:-http://127.0.0.1:7799}"
export REACTOR_M6_ER_WS="${REACTOR_M6_ER_WS:-ws://127.0.0.1:7800}"
export REACTOR_M6_ER_VALIDATOR="${REACTOR_M6_ER_VALIDATOR:-mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev}"
export REACTOR_M6_RESULT_PATH="${REACTOR_M6_RESULT_PATH:-experiment/results/m6-essentiality-latest.json}"
export REACTOR_M6_CHAMBER_RESULT_PATH="${REACTOR_M6_CHAMBER_RESULT_PATH:-chamber/data/m6-essentiality-latest.json}"

# The inherited M4 wrapper prints a trial count but M6 itself is a single
# two-treatment benchmark. Keep that inherited value at one.
export REACTOR_M4_ENGINE_TRIALS=1
# Map M6 endpoint overrides into the reused M4 bootstrap so validator startup,
# readiness checks and the M6 runner all use the same endpoints/validator.
export REACTOR_M4_ENGINE_BASE_RPC="$REACTOR_M6_BASE_RPC"
export REACTOR_M4_ENGINE_BASE_WS="$REACTOR_M6_BASE_WS"
export REACTOR_M4_ENGINE_ER_RPC="$REACTOR_M6_ER_RPC"
export REACTOR_M4_ENGINE_ER_WS="$REACTOR_M6_ER_WS"
export REACTOR_M4_ENGINE_ER_VALIDATOR="$REACTOR_M6_ER_VALIDATOR"

bash "$TMP_SCRIPT"
