import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.REACTOR_M4_EFFICIENCY_OUT_DIR ?? 'experiment/results/m4-coordination-efficiency';
const OUTPUT = process.env.REACTOR_M4_EFFICIENCY_ANALYSIS_PATH ?? 'experiment/results/m4-coordination-efficiency-latest.json';

function mean(xs) {
  const ys = xs.filter(Number.isFinite);
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
}

function cadenceFromName(name) {
  const m = name.match(/cadence-([0-9]+(?:p[0-9]+)?)ms\.json$/);
  return m ? Number(m[1].replace('p', '.')) : null;
}

if (!fs.existsSync(DIR)) throw new Error(`missing efficiency evidence directory: ${DIR}`);

const files = fs.readdirSync(DIR)
  .filter((name) => /^solana-spec-cadence-.*ms\.json$/.test(name))
  .sort((a, b) => cadenceFromName(a) - cadenceFromName(b));

if (!files.length) throw new Error(`no efficiency evidence found in ${DIR}`);

const points = [];
for (const name of files) {
  const cadenceMs = cadenceFromName(name);
  const evidence = JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
  const trials = evidence.trials ?? [];
  const captured = trials.filter((t) => t.capture === true).length;
  const falseLocks = trials.filter((t) => t.falseLock === true).length;
  const attempts = trials.map((t) => t.attempts?.submitted ?? t.attempts?.length ?? null);
  const landedOk = trials.map((t) => t.attempts?.landedSuccessful ?? null);
  const landedFail = trials.map((t) => t.attempts?.landedFailed ?? null);
  const fees = trials.map((t) => t.feeLamportsSpent ?? null);

  points.push({
    cadenceMs,
    trials: trials.length,
    captured,
    captureRate: trials.length ? captured / trials.length : null,
    falseLocks,
    meanAttemptsSubmitted: mean(attempts),
    meanLandedSuccessfulAttempts: mean(landedOk),
    meanLandedFailedAttempts: mean(landedFail),
    meanFeeLamportsSpent: mean(fees),
    byWindow: evidence.summary ?? evidence.byWindow ?? null,
    source: path.join(DIR, name),
  });
}

const analysis = {
  benchmark: 'reactor-m4-coordination-efficiency',
  question: 'How much speculative execution does Solana require to buy the same exact-version capture probability achieved by a reactive low-latency coordinator?',
  claimBoundary: 'Cadence sweep measures the cost/reliability frontier of the existing exact-version speculative Solana strategy. It does not by itself prove a fundamental impossibility on Solana or a production-wide MagicBlock advantage.',
  points,
  interpretationRules: [
    'Do not claim a MagicBlock advantage if sparse Solana speculation preserves comparable exact-capture probability.',
    'If Solana capture probability falls as cadence increases while MagicBlock reactive capture remains high, report the result as a coordination-efficiency frontier, not a capability impossibility.',
    'Treat false locks as correctness failures regardless of capture rate.',
    'Use >=50 randomized trials per selected frontier point before making inferential claims.',
  ],
  nextSteps: [
    'Run the cadence smoke sweep to locate the Solana reliability knee.',
    'Select adjacent cadences around the knee plus the 10 ms aggressive baseline.',
    'Run >=50 randomized/jittered trials at those selected points and the matched MagicBlock reactive baseline.',
    'Compare exact capture probability, attempts, landed failures, fees, and reaction latency.',
  ],
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(analysis, null, 2)}\n`);
console.log(JSON.stringify(analysis, null, 2));
console.log(`analysis written: ${OUTPUT}`);
