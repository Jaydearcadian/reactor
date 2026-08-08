import fs from 'node:fs';

const INPUT = process.env.REACTOR_M4_STAT_RESULT_PATH
  ?? 'experiment/results/m4-coordination-statistical-latest.json';
const OUTPUT = process.env.REACTOR_M4_STAT_ANALYSIS_PATH
  ?? 'experiment/results/m4-coordination-statistical-analysis-latest.json';

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function quantile(xs, q) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function wilson(successes, n, z = 1.959963984540054) {
  if (!n) return { rate: null, lower: null, upper: null };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = z * Math.sqrt((p * (1 - p) / n) + z2 / (4 * n * n)) / denom;
  return { rate: p, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function num(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function summarize(records, strategy) {
  const n = records.length;
  const captures = records.filter((r) => r.capture === true).length;
  const falseLocks = records.filter((r) => r.falseLock === true).length;
  const attempts = records.map((r) => num(r.attempts?.submitted ?? r.attemptsSubmitted)).filter((v) => v !== null);
  const landedOk = records.map((r) => num(r.attempts?.landedSuccessful ?? r.landedSuccessfulAttempts)).filter((v) => v !== null);
  const landedFail = records.map((r) => num(r.attempts?.landedFailed ?? r.landedFailedAttempts)).filter((v) => v !== null);
  const fees = records.map((r) => num(r.feeLamportsSpent ?? r.fees?.lamportsSpent)).filter((v) => v !== null);
  const totalAttempts = attempts.reduce((a, b) => a + b, 0);
  const totalLandedOk = landedOk.reduce((a, b) => a + b, 0);
  const totalLandedFail = landedFail.reduce((a, b) => a + b, 0);
  const totalLanded = totalLandedOk + totalLandedFail;
  const totalFees = fees.reduce((a, b) => a + b, 0);
  const ci = wilson(captures, n);

  return {
    strategy,
    trials: n,
    captured: captures,
    captureRate: ci.rate,
    captureRateWilson95: { lower: ci.lower, upper: ci.upper },
    falseLocks,
    falseLockRate: n ? falseLocks / n : null,
    meanAttemptsSubmitted: attempts.length ? mean(attempts) : null,
    attemptsP50: attempts.length ? quantile(attempts, 0.50) : null,
    attemptsP95: attempts.length ? quantile(attempts, 0.95) : null,
    totalAttemptsSubmitted: attempts.length ? totalAttempts : null,
    totalLandedSuccessfulAttempts: landedOk.length ? totalLandedOk : null,
    totalLandedFailedAttempts: landedFail.length ? totalLandedFail : null,
    coordinationAmplificationFactor: captures > 0 && attempts.length ? totalAttempts / captures : null,
    wasteRatio: totalLanded > 0 ? totalLandedFail / totalLanded : null,
    totalFeeLamportsSpent: fees.length ? totalFees : null,
    costPerCaptureLamports: captures > 0 && fees.length ? totalFees / captures : null,
  };
}

const raw = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const byRegime = {};
const all = {
  'solana-reactive': [],
  'magicblock-reactive': [],
  'solana-speculative': [],
};

for (const regimeMs of raw.configuration.regimesMs) {
  const cycles = raw.cycles.filter((c) => c.regimeMs === regimeMs);
  const sr = cycles.map((c) => c.strategies.solanaReactive);
  const mr = cycles.map((c) => c.strategies.magicblockReactive);
  const ss = cycles.map((c) => c.strategies.solanaSpeculative);
  all['solana-reactive'].push(...sr);
  all['magicblock-reactive'].push(...mr);
  all['solana-speculative'].push(...ss);
  byRegime[String(regimeMs)] = {
    actualWindowMs: {
      min: Math.min(...cycles.map((c) => c.actualWindowMs)),
      mean: mean(cycles.map((c) => c.actualWindowMs)),
      p50: quantile(cycles.map((c) => c.actualWindowMs), 0.50),
      p95: quantile(cycles.map((c) => c.actualWindowMs), 0.95),
      max: Math.max(...cycles.map((c) => c.actualWindowMs)),
    },
    strategies: {
      solanaReactive: summarize(sr, 'solana-reactive'),
      magicblockReactive: summarize(mr, 'magicblock-reactive'),
      solanaSpeculative: summarize(ss, 'solana-speculative'),
    },
  };
}

const overall = Object.fromEntries(
  Object.entries(all).map(([strategy, records]) => [strategy, summarize(records, strategy)]),
);

const zeroFalseLocks = Object.values(overall).every((s) => s.falseLocks === 0);
const analysis = {
  benchmark: 'reactor-m4-coordination-statistical-analysis',
  generatedAt: new Date().toISOString(),
  source: INPUT,
  researchQuestion: 'How much execution amplification must a speculative Solana strategy spend to reproduce exact-version coordination reliability available to a reactive low-latency coordinator?',
  claimBoundary: 'This local benchmark compares three implemented strategies under the same Reactor coordination semantics. It measures reliability/cost tradeoffs; it does not prove a fundamental Solana impossibility or a production-wide MagicBlock advantage.',
  metricDefinitions: {
    coordinationAmplificationFactor: 'total transaction attempts submitted / successful exact-version captures',
    wasteRatio: 'landed failed-or-stale attempts / all landed attempts',
    costPerCaptureLamports: 'total measured fee lamports / successful exact-version captures',
  },
  configuration: raw.configuration,
  byRegime,
  overall,
  integrity: {
    expectedCycles: raw.configuration.regimesMs.length * raw.configuration.trialsPerRegimePerStrategy,
    observedCycles: raw.cycles.length,
    expectedObservations: raw.configuration.expectedObservations,
    observedObservations: raw.cycles.length * 3,
    zeroFalseLocks,
  },
  publicationGate: {
    minimumTrialsPerRegimePerStrategy: 100,
    sampleSizeSatisfied: Object.values(byRegime).every((r) => Object.values(r.strategies).every((s) => s.trials >= 100)),
    zeroFalseLocksRequired: true,
    zeroFalseLocksSatisfied: zeroFalseLocks,
  },
};

fs.writeFileSync(OUTPUT, `${JSON.stringify(analysis, null, 2)}\n`);
console.log(JSON.stringify(analysis, null, 2));
console.log(`statistical analysis written: ${OUTPUT}`);
