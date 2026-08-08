import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const REGIMES = (process.env.REACTOR_M4_STAT_REGIMES_MS ?? '10,50,150')
  .split(',')
  .map((v) => Number(v.trim()))
  .filter((v) => Number.isFinite(v) && v > 0);
const TRIALS_PER_REGIME = Number(process.env.REACTOR_M4_STAT_TRIALS_PER_REGIME ?? 100);
const SPEC_CADENCE_MS = Number(process.env.REACTOR_M4_STAT_SPEC_CADENCE_MS ?? 50);
const SEED = Number(process.env.REACTOR_M4_STAT_SEED ?? 4082026);
const JITTER_FRACTION = Number(process.env.REACTOR_M4_STAT_JITTER_FRACTION ?? 0.20);
const OUTPUT = process.env.REACTOR_M4_STAT_RESULT_PATH
  ?? 'experiment/results/m4-coordination-statistical-latest.json';
const TMP_DIR = process.env.REACTOR_M4_STAT_TMP_DIR
  ?? 'experiment/results/m4-coordination-statistical-runs';

function mulberry32(seed) {
  return function rand() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED >>> 0);

function shuffle(xs) {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function jitteredWindow(regimeMs) {
  const span = regimeMs * JITTER_FRACTION;
  const delta = (rand() * 2 - 1) * span;
  return Math.max(1, Math.round(regimeMs + delta));
}

function runNode(script, env, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${label} failed with exit ${code}\n${stderr}\n${stdout.slice(-4000)}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function safeRead(file) {
  if (!fs.existsSync(file)) throw new Error(`expected result missing: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

fs.mkdirSync(TMP_DIR, { recursive: true });

const schedule = [];
for (const regimeMs of REGIMES) {
  for (let trial = 1; trial <= TRIALS_PER_REGIME; trial += 1) {
    schedule.push({ regimeMs, trial });
  }
}
const randomized = shuffle(schedule);

console.log('M4 Coordination Statistical benchmark');
console.log(`regimes: ${REGIMES.join(', ')} ms`);
console.log(`trials/regime/strategy: ${TRIALS_PER_REGIME}`);
console.log('strategies: solana-reactive, magicblock-reactive, solana-speculative');
console.log(`speculative cadence: ${SPEC_CADENCE_MS} ms`);
console.log(`jitter: ±${(JITTER_FRACTION * 100).toFixed(1)}%`);
console.log(`seed: ${SEED}`);
console.log(`randomized cycles: ${randomized.length}`);

const cycles = [];
for (let index = 0; index < randomized.length; index += 1) {
  const item = randomized[index];
  const actualWindowMs = jitteredWindow(item.regimeMs);
  const prefix = `cycle-${String(index + 1).padStart(4, '0')}-r${item.regimeMs}-w${actualWindowMs}`;
  const observerFile = path.join(TMP_DIR, `${prefix}-observer.json`);
  const speculativeFile = path.join(TMP_DIR, `${prefix}-speculative.json`);

  await runNode('scripts/run_m4_coordination_local.mjs', {
    REACTOR_M4_COORDINATION_WINDOWS_MS: String(actualWindowMs),
    REACTOR_M4_COORDINATION_TRIALS: '1',
    REACTOR_M4_COORDINATION_RESULT_PATH: observerFile,
  }, `${prefix} observer`);

  await runNode('scripts/run_m4_coordination_speculative_solana.mjs', {
    REACTOR_M4_SPEC_WINDOWS_MS: String(actualWindowMs),
    REACTOR_M4_SPEC_TRIALS: '1',
    REACTOR_M4_SPEC_CADENCE_MS: String(SPEC_CADENCE_MS),
    REACTOR_M4_SPEC_RESULT_PATH: speculativeFile,
  }, `${prefix} speculative`);

  const observer = safeRead(observerFile);
  const speculative = safeRead(speculativeFile);
  const solanaReactive = observer.trials.find((t) => t.path === 'solana');
  const magicblockReactive = observer.trials.find((t) => t.path === 'magicblock');
  const solanaSpeculative = speculative.trials?.[0];

  if (!solanaReactive || !magicblockReactive || !solanaSpeculative) {
    throw new Error(`${prefix} did not produce all three strategy records`);
  }

  cycles.push({
    cycle: index + 1,
    regimeMs: item.regimeMs,
    requestedTrial: item.trial,
    actualWindowMs,
    strategies: {
      solanaReactive,
      magicblockReactive,
      solanaSpeculative,
    },
    artifacts: { observerFile, speculativeFile },
  });

  const completed = index + 1;
  const sr = solanaReactive.capture ? '✓' : '×';
  const mr = magicblockReactive.capture ? '✓' : '×';
  const ss = solanaSpeculative.capture ? '✓' : '×';
  console.log(
    `[${completed}/${randomized.length}] regime=${item.regimeMs}ms actual=${actualWindowMs}ms`
    + ` SR=${sr} MR=${mr} SS=${ss}`
    + ` specAttempts=${solanaSpeculative.attempts?.submitted ?? 'n/a'}`,
  );
}

const raw = {
  benchmark: 'reactor-m4-coordination-statistical',
  scope: 'randomized-jittered-three-strategy-local-benchmark',
  generatedAt: new Date().toISOString(),
  configuration: {
    regimesMs: REGIMES,
    trialsPerRegimePerStrategy: TRIALS_PER_REGIME,
    strategies: ['solana-reactive', 'magicblock-reactive', 'solana-speculative'],
    solanaSpeculativeCadenceMs: SPEC_CADENCE_MS,
    jitterFraction: JITTER_FRACTION,
    seed: SEED,
    randomizedCycleCount: randomized.length,
    expectedObservations: randomized.length * 3,
    updateSealBundlingAllowed: false,
  },
  cycles,
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(raw, null, 2)}\n`);
console.log(`raw statistical evidence written: ${OUTPUT}`);
