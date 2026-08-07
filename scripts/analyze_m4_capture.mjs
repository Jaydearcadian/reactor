import fs from 'node:fs';
import { captureRateDifference95 } from '../src-js/m4-telemetry.mjs';

const inputPath = process.env.REACTOR_M4_RESULT_PATH ?? 'experiment/results/m4-capture-latest.json';
if (!fs.existsSync(inputPath)) throw new Error(`missing ${inputPath}`);
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const trials = input.trials ?? [];
const windows = [...new Set(trials.map((trial) => trial.windowMs))].sort((a, b) => a - b);

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
  frozenContinuationGateSatisfied: adjacentPassingBands.length > 0,
  note: 'Small smoke samples are expected to have wide intervals; do not interpret a one-trial-per-band run as evidence for or against the product.',
};

console.log(JSON.stringify(analysis, null, 2));
const outputPath = process.env.REACTOR_M4_ANALYSIS_PATH ?? 'experiment/results/m4-capture-analysis-latest.json';
fs.writeFileSync(outputPath, `${JSON.stringify(analysis, null, 2)}\n`);
console.log(`analysis written: ${outputPath}`);
