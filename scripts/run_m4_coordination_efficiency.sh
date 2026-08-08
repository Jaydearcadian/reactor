#!/usr/bin/env bash
set -euo pipefail

CADENCES="${REACTOR_M4_EFFICIENCY_CADENCES_MS:-5,10,20,50,100,250}"
WINDOWS="${REACTOR_M4_EFFICIENCY_WINDOWS_MS:-10,20,50,100,150,250}"
TRIALS="${REACTOR_M4_EFFICIENCY_TRIALS:-2}"
LEAD="${REACTOR_M4_EFFICIENCY_LEAD_MS:-50}"
TAIL="${REACTOR_M4_EFFICIENCY_TAIL_MS:-100}"
OUT_DIR="${REACTOR_M4_EFFICIENCY_OUT_DIR:-experiment/results/m4-coordination-efficiency}"

mkdir -p "$OUT_DIR"

IFS=',' read -r -a cadence_values <<< "$CADENCES"

printf '%s\n' "M4 Coordination Efficiency smoke sweep"
printf '%s\n' "windows:  $WINDOWS ms"
printf '%s\n' "trials:   $TRIALS per band/cadence"
printf '%s\n' "cadences: $CADENCES ms"
printf '%s\n' "lead:     $LEAD ms"
printf '%s\n' "tail:     $TAIL ms"
printf '%s\n' "strategy: same exact-version speculative Solana baseline; only submission cadence changes"

for raw in "${cadence_values[@]}"; do
  cadence="$(printf '%s' "$raw" | xargs)"
  [[ "$cadence" =~ ^[0-9]+([.][0-9]+)?$ ]] || { echo "invalid cadence: $cadence" >&2; exit 1; }
  safe="${cadence//./p}"
  output="$OUT_DIR/solana-spec-cadence-${safe}ms.json"

  echo
  echo "=== speculative Solana cadence ${cadence} ms ==="
  REACTOR_M4_SPEC_WINDOWS_MS="$WINDOWS" \
  REACTOR_M4_SPEC_TRIALS="$TRIALS" \
  REACTOR_M4_SPEC_CADENCE_MS="$cadence" \
  REACTOR_M4_SPEC_LEAD_MS="$LEAD" \
  REACTOR_M4_SPEC_TAIL_MS="$TAIL" \
  REACTOR_M4_SPEC_MAX_ATTEMPTS=256 \
  REACTOR_M4_SPEC_RESULT_PATH="$output" \
    node scripts/run_m4_coordination_speculative_solana.mjs

done

echo
echo "Efficiency sweep raw evidence directory: $OUT_DIR"
