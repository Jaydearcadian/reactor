import fs from 'node:fs';
import {
  percentile,
  captureRateDifference95,
} from '../src-js/m4-telemetry.mjs';

const INPUT = process.env.REACTOR_M4_COORDINATION_RESULT_PATH
  ?? 'experiment/results/m4-coordination-local-latest.json';
const OUTPUT = process.env.REACTOR_M4_COORDINATION_ANALYSIS_PATH
  ?? 'experiment/results/m4-coordination-analysis-latest.json';

if (!fs.existsSync(INPUT)) throw new Error(`missing ${INPUT}`);
const input = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const trials = input.trials ?? [];

function delta(trial, start, end) {
  const a = trial?.marks?.[start]?.monotonicMs;
  const b = trial?.marks?.[end]?.monotonicMs;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return b - a;
}

function stats(values) {
  const xs = values.filter(Number.isFinite);
  if (xs.length === 0) {
    return { n: 0, min: null, mean: null, p50: null, p95: null, p99: null, max: null };
  }
  return {
    n: xs.length,
    min: Math.min(...xs),
    mean: xs.reduce((sum, value) => sum + value, 0) / xs.length,
    p50: percentile(xs, 0.50),
    p95: percentile(xs, 0.95),
    p99: percentile(xs, 0.99),
    max: Math.max(...xs),
  };
}

const enriched = trials.map((trial) => {
  const closeSubmissionDelayMs = trial.windowMs;
  const openSubmitToProcessedMs = delta(trial, 'window_open_emitted', 'window_open_acknowledged');
  const closeSubmitToProcessedMs = delta(trial, 'window_close_emitted', 'window_close_processed');
  const observedAuthoritativeWindowMs = delta(trial, 'window_open_acknowledged', 'window_close_processed');
  const openProcessedToSealProcessedMs = delta(trial, 'window_open_acknowledged', 'capture_observed');
  const coordinatorObserveToSealProcessedMs = delta(trial, 'condition_observed', 'capture_observed');
  const emittedOpenToSealProcessedMs = delta(trial, 'window_open_emitted', 'capture_observed');

  return {
    path: trial.path,
    closeSubmissionDelayMs,
    capture: Boolean(trial.capture && trial.exactVersionMatch),
    exactVersionMatch: Boolean(trial.exactVersionMatch),
    staleAttempt: Boolean(trial.staleAttempt),
    falseLock: Boolean(trial.falseLock),
    ambiguous: Boolean(trial.ambiguous),
    openSubmitToProcessedMs,
    closeSubmitToProcessedMs,
    observedAuthoritativeWindowMs,
    openProcessedToSealProcessedMs,
    coordinatorObserveToSealProcessedMs,
    emittedOpenToSealProcessedMs,
    processedSlots: {
      open: trial?.marks?.window_open_acknowledged?.slot ?? null,
      seal: trial?.marks?.capture_observed?.slot ?? null,
      close: trial?.marks?.window_close_processed?.slot ?? null,
    },
    sealSubmitError: trial.sealSubmitError ?? null,
    observerFailure: trial.observerFailure ?? null,
    failure: trial.failure ?? null,
  };
});

const delays = [...new Set(enriched.map((trial) => trial.closeSubmissionDelayMs))].sort((a, b) => a - b);
const byDelay = {};

for (const delay of delays) {
  byDelay[delay] = {};
  for (const path of ['solana', 'magicblock']) {
    const xs = enriched.filter((trial) => trial.path === path && trial.closeSubmissionDelayMs === delay);
    const captured = xs.filter((trial) => trial.capture).length;
    byDelay[delay][path] = {
      trials: xs.length,
      captured,
      captureRate: xs.length ? captured / xs.length : null,
      staleAttempts: xs.filter((trial) => trial.staleAttempt).length,
      falseLocks: xs.filter((trial) => trial.falseLock).length,
      ambiguous: xs.filter((trial) => trial.ambiguous).length,
      observedAuthoritativeWindowMs: stats(xs.map((trial) => trial.observedAuthoritativeWindowMs)),
      openProcessedToSealProcessedMs: stats(xs.map((trial) => trial.openProcessedToSealProcessedMs)),
      coordinatorObserveToSealProcessedMs: stats(xs.map((trial) => trial.coordinatorObserveToSealProcessedMs)),
      openSubmitToProcessedMs: stats(xs.map((trial) => trial.openSubmitToProcessedMs)),
      closeSubmitToProcessedMs: stats(xs.map((trial) => trial.closeSubmitToProcessedMs)),
    };
  }

  const solana = byDelay[delay].solana;
  const magicblock = byDelay[delay].magicblock;
  byDelay[delay].magicblockMinusSolana = captureRateDifference95(
    magicblock.captured,
    magicblock.trials,
    solana.captured,
    solana.trials,
  );
}

const analysis = {
  source: INPUT,
  benchmark: input.benchmark,
  classification: 'coordination-emission-schedule-smoke',
  configuredBandMeaning: 'wall-clock delay from open-source emission at T0 to independent close-source emission; NOT guaranteed authoritative state lifetime',
  authoritativeWindowApproximation: 'processed close notification monotonic time minus processed open notification monotonic time on the same local connection',
  claimBoundary: 'Capture classification is ledger-grounded by exact frozen versions. Millisecond authoritative-window estimates remain observer-side approximations and must be reported separately from the configured emission schedule.',
  frozenContinuationGateEvaluated: false,
  reasonsGateNotEvaluated: [
    'smoke sample is only two trials per configured delay',
    'configured delay is source-emission spacing rather than guaranteed authoritative state lifetime',
    'strongest honest Solana speculative/coordinator baselines are not yet implemented',
  ],
  byCloseSubmissionDelayMs: byDelay,
  trials: enriched,
  nextSteps: [
    'Use this smoke result only to locate likely crossover regions and validate stale/exact/false-lock semantics.',
    'Implement strongest honest Solana coordinator baselines, including speculative pre-submission where structurally valid.',
    'Run >=50 trials per selected delay with randomized ordering/jitter and retain observed authoritative-window estimates.',
    'Only then evaluate the frozen >=20 percentage-point adjacent-band continuation threshold.',
  ],
};

fs.mkdirSync('experiment/results', { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(analysis, null, 2)}\n`);
console.log(JSON.stringify(analysis, null, 2));
console.log(`analysis written: ${OUTPUT}`);
