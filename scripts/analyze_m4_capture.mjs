import fs from 'node:fs';
import { captureRateDifference95 } from '../src-js/m4-telemetry.mjs';

const inputPath = process.env.REACTOR_M4_RESULT_PATH ?? 'experiment/results/m4-capture-latest.json';
if (!fs.existsSync(inputPath)) throw new Error(`missing ${inputPath}`);
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const trials = input.trials ?? [];
const windows = [...new Set(trials.map((trial) => trial.windowMs))].sort((a, b) => a - b);

const isAtomicRaceDiagnostic = input.benchmark === 'reactor-m4a-atomic-capture';

function observedLatency(trial) {
  const value = trial?.latency?.captureMs;
  return Number.isFinite(value) ? value : null;
}

function atomicLedgerCapture(trial) {
  // For the atomic benchmark, update_condition(seq2=true) and
  // evaluate_session_candidate([1,1,2,1,1,1]) execute in one transaction.
  // If the exact candidate exists and both the capture transaction and the later
  // invalidating transaction confirm, then the capture transaction necessarily
  // executed before condition-0 advanced to seq2. Client notification latency is
  // observability latency, not authoritative execution ordering.
  return Boolean(
    trial.captureStateObserved
    && trial.exactVersionMatch
    && trial.decisionConfirmed
    && trial.closeConfirmed
    && !trial.failure,
  );
}

if (isAtomicRaceDiagnostic) {
  const comparisons = {};
  for (const windowMs of windows) {
    const solana = trials.filter((trial) => trial.path === 'solana' && trial.windowMs === windowMs);
    const magicblock = trials.filter((trial) => trial.path === 'magicblock' && trial.windowMs === windowMs);
    if (solana.length === 0 || magicblock.length === 0) continue;

    const summarizeAtomic = (pathTrials) => {
      const ledgerCaptured = pathTrials.filter(atomicLedgerCapture).length;
      const observerLatencies = pathTrials
        .map(observedLatency)
        .filter((value) => value != null);
      return {
        trials: pathTrials.length,
        ledgerCaptured,
        ledgerCaptureRate: ledgerCaptured / pathTrials.length,
        exactCandidates: pathTrials.filter((trial) => trial.exactVersionMatch).length,
        falseLocks: pathTrials.filter((trial) => trial.falseLock).length,
        observerLatencyMs: observerLatencies,
        observerMetConfiguredDeadline: pathTrials.filter((trial) => {
          const latency = observedLatency(trial);
          return latency != null && latency <= trial.windowMs;
        }).length,
      };
    };

    comparisons[windowMs] = {
      solana: summarizeAtomic(solana),
      magicblock: summarizeAtomic(magicblock),
    };
  }

  const analysis = {
    source: inputPath,
    benchmark: input.benchmark,
    classification: 'atomic-race-diagnostic',
    comparisons,
    frozenContinuationGateEvaluated: false,
    frozenContinuationGateSatisfied: false,
    reason: 'The atomic benchmark proves authoritative ordering/candidate sealing, but configured wall-clock delay is the client submission delay for the invalidating transaction, not a measured authoritative-state lifetime. Processed-signature callback time is observer latency and must not be used as the execution deadline.',
    interpretation: 'ledgerCaptured=true means the exact candidate was sealed before the later condition-0 seq2 invalidation became authoritative. observerLatencyMs measures how long the client waited to learn about processing; it is not proof of validator execution latency.',
    nextGate: 'Measure engine/runtime latency in a controlled local Solana + local MagicBlock ER setup, then measure public-path latency with region/RPC transport separated from execution ordering before returning to the frozen verified-capture gate.',
  };

  console.log(JSON.stringify(analysis, null, 2));
  const outputPath = process.env.REACTOR_M4_ANALYSIS_PATH ?? 'experiment/results/m4-capture-analysis-latest.json';
  fs.writeFileSync(outputPath, `${JSON.stringify(analysis, null, 2)}\n`);
  console.log(`analysis written: ${outputPath}`);
  process.exit(0);
}

const comparisons = {};
for (const windowMs of windows) {
  const solana = trials.filter((trial) => trial.path === 'solana' && trial.windowMs === windowMs);
  const magicblock = trials.filter((trial) => trial.path === 'magicblock' && trial.windowMs === windowMs);
  if (solana.length === 0 || magicblock.length === 0) continue;

  const solanaCaptured = solana.filter((trial) => trial.capture && trial.exactVersionMatch).length;
  const magicblockCaptured = magicblock.filter((trial) => trial.capture && trial.exactVersionMatch).length;
  const interval = captureRateDifference95(
    magicblockCaptured,
    magicblock.length,
    solanaCaptured,
    solana.length,
  );

  comparisons[windowMs] = {
    solana: { captured: solanaCaptured, trials: solana.length, rate: solanaCaptured / solana.length },
    magicblock: { captured: magicblockCaptured, trials: magicblock.length, rate: magicblockCaptured / magicblock.length },
    magicblockMinusSolana: interval,
    passesFrozen20PointThreshold: interval != null && interval.difference >= 0.20,
    intervalExcludesZero: interval != null && interval.lower > 0,
    falseLocks: {
      solana: solana.filter((trial) => trial.falseLock).length,
      magicblock: magicblock.filter((trial) => trial.falseLock).length,
    },
  };
}

const adjacentPassingBands = [];
const comparedWindows = Object.keys(comparisons).map(Number).sort((a, b) => a - b);
for (let i = 0; i < comparedWindows.length - 1; i += 1) {
  const a = comparisons[comparedWindows[i]];
  const b = comparisons[comparedWindows[i + 1]];
  if (
    a.passesFrozen20PointThreshold && a.intervalExcludesZero &&
    b.passesFrozen20PointThreshold && b.intervalExcludesZero &&
    a.falseLocks.magicblock === 0 && b.falseLocks.magicblock === 0
  ) {
    adjacentPassingBands.push([comparedWindows[i], comparedWindows[i + 1]]);
  }
}

const analysis = {
  source: inputPath,
  method: 'MagicBlock capture rate minus Solana capture rate; conservative Newcombe/Wilson 95% interval',
  comparisons,
  adjacentPassingBands,
  frozenContinuationGateEvaluated: true,
  frozenContinuationGateSatisfied: adjacentPassingBands.length > 0,
  note: 'Small smoke samples are expected to have wide intervals; do not interpret a one-trial-per-band run as evidence for or against the product.',
};

console.log(JSON.stringify(analysis, null, 2));
const outputPath = process.env.REACTOR_M4_ANALYSIS_PATH ?? 'experiment/results/m4-capture-analysis-latest.json';
fs.writeFileSync(outputPath, `${JSON.stringify(analysis, null, 2)}\n`);
console.log(`analysis written: ${outputPath}`);
