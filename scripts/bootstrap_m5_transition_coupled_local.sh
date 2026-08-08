#!/usr/bin/env bash
set -euo pipefail

# Reuse the hardened M4 local stack/bootstrap. Only replace the benchmark runner
# and evidence labels; validator startup, funding, build/deploy, ID checks,
# delegation environment, and cleanup stay identical.
TMP_SCRIPT="$(mktemp)"
cleanup_tmp() { rm -f "$TMP_SCRIPT"; }
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
