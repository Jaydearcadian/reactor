#!/usr/bin/env bash
set -euo pipefail

: "${REACTOR_M4_STAT_REGIMES_MS:=10,50,150}"
: "${REACTOR_M4_STAT_TRIALS_PER_REGIME:=100}"
: "${REACTOR_M4_STAT_SPEC_CADENCE_MS:=50}"
: "${REACTOR_M4_STAT_JITTER_FRACTION:=0.20}"
: "${REACTOR_M4_STAT_SEED:=4082026}"

export REACTOR_M4_STAT_REGIMES_MS
export REACTOR_M4_STAT_TRIALS_PER_REGIME
export REACTOR_M4_STAT_SPEC_CADENCE_MS
export REACTOR_M4_STAT_JITTER_FRACTION
export REACTOR_M4_STAT_SEED

echo "M4 Statistical Coordination Benchmark"
echo "regimes:             $REACTOR_M4_STAT_REGIMES_MS ms"
echo "trials/regime/path:  $REACTOR_M4_STAT_TRIALS_PER_REGIME"
echo "spec cadence:        $REACTOR_M4_STAT_SPEC_CADENCE_MS ms"
echo "jitter fraction:     $REACTOR_M4_STAT_JITTER_FRACTION"
echo "random seed:         $REACTOR_M4_STAT_SEED"
echo

node scripts/run_m4_coordination_statistical.mjs
node scripts/analyze_m4_coordination_statistical.mjs

echo
echo "M4 statistical benchmark complete."
echo "Raw:      experiment/results/m4-coordination-statistical-latest.json"
echo "Analysis: experiment/results/m4-coordination-statistical-analysis-latest.json"
