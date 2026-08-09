#!/usr/bin/env bash
set -euo pipefail

# Run M5b as a progression, not as one giant load test. Every count receives a
# fresh local Solana validator and fresh MagicBlock ER through the bootstrap.
# The script stops immediately if the runner's semantic gate fails.

COUNTS="${REACTOR_M5B_COUNTS:-1,10,50,100}"
EPISODES="${REACTOR_M5B_EPISODES:-1}"
BURST_SPREAD_MS="${REACTOR_M5B_BURST_SPREAD_MS:-20}"

IFS=',' read -r -a LEVELS <<< "$COUNTS"

for raw in "${LEVELS[@]}"; do
  count="$(printf '%s' "$raw" | xargs)"
  if ! [[ "$count" =~ ^[1-9][0-9]*$ ]]; then
    echo "Invalid objective count in REACTOR_M5B_COUNTS: '$count'" >&2
    exit 1
  fi

  echo
  echo "============================================================"
  echo "M5b concurrency level: $count objectives"
  echo "episodes/path:         $EPISODES"
  echo "burst spread:          ${BURST_SPREAD_MS}ms"
  echo "============================================================"

  REACTOR_M5B_OBJECTIVE_COUNT="$count" \
  REACTOR_M5B_EPISODES="$EPISODES" \
  REACTOR_M5B_BURST_SPREAD_MS="$BURST_SPREAD_MS" \
    bash scripts/bootstrap_m5b_concurrent_objectives_local.sh

done

echo
echo "M5b ladder completed without a semantic-gate failure."
echo "Review each evidence artifact before making a capacity claim:"
for raw in "${LEVELS[@]}"; do
  count="$(printf '%s' "$raw" | xargs)"
  echo "  experiment/results/m5b-concurrent-objectives-${count}-latest.json"
done
