import fs from 'node:fs';
import crypto from 'node:crypto';
import * as anchorNamespace from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

const anchor = anchorNamespace.default ?? anchorNamespace;

const CONDITION_COUNT = 6;
const EXPECTED_SEQUENCES = [1, 1, 2, 1, 1, 1];
const INITIAL_EXPOSURE = 700;
const TARGET_EXPOSURE = 500;
const EXPOSURE_REDUCTION = 200;
const TRANSFER_LAMPORTS = 100_000;

const BASE_RPC = process.env.REACTOR_M4_ENGINE_BASE_RPC ?? 'http://127.0.0.1:8899';
const BASE_WS = process.env.REACTOR_M4_ENGINE_BASE_WS ?? 'ws://127.0.0.1:8900';
const WINDOWS_MS = (process.env.REACTOR_M4_SPEC_WINDOWS_MS ?? '10,20,50,100,150,250')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
const TRIALS_PER_BAND = Number(process.env.REACTOR_M4_SPEC_TRIALS ?? 2);
const SPEC_CADENCE_MS = Number(process.env.REACTOR_M4_SPEC_CADENCE_MS ?? 10);
const SPEC_LEAD_MS = Number(process.env.REACTOR_M4_SPEC_LEAD_MS ?? 50);
const SPEC_TAIL_MS = Number(process.env.REACTOR_M4_SPEC_TAIL_MS ?? 100);
const MAX_ATTEMPTS = Number(process.env.REACTOR_M4_SPEC_MAX_ATTEMPTS ?? 64);
const ATTEMPT_FEE_PAYER_LAMPORTS = Number(process.env.REACTOR_M4_SPEC_FEE_PAYER_LAMPORTS ?? 2_000_000);
const FIXTURE_LAMPORTS = Number(process.env.REACTOR_M4_SPEC_FIXTURE_LAMPORTS ?? 80_000_000);
const CONDITION_TTL_SLOTS = Number(process.env.REACTOR_M4_SPEC_CONDITION_TTL_SLOTS ?? 20_000);
const SETTLE_WAIT_MS = Number(process.env.REACTOR_M4_SPEC_SETTLE_WAIT_MS ?? 1200);
const OUTPUT_PATH = process.env.REACTOR_M4_SPEC_RESULT_PATH
  ?? 'experiment/results/m4-coordination-speculative-solana-latest.json';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function derive(programId, seeds) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function summarizeNumbers(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (xs.length === 0) return { n: 0, min: null, mean: null, p50: null, p95: null, max: null };
  const percentile = (q) => {
    if (xs.length === 1) return xs[0];
    const pos = (xs.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return xs[lo];
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
  };
  return {
    n: xs.length,
    min: xs[0],
    mean: xs.reduce((sum, value) => sum + value, 0) / xs.length,
    p50: percentile(0.50),
    p95: percentile(0.95),
    max: xs[xs.length - 1],
  };
}

async function setupSend(builder, signers = []) {
  const signed = signers.length > 0 ? builder.signers(signers) : builder;
  return signed.rpc({ commitment: 'confirmed' });
}

async function fundMany(provider, payer, recipients) {
  const CHUNK = 10;
  for (let offset = 0; offset < recipients.length; offset += CHUNK) {
    const tx = new Transaction();
    for (const recipient of recipients.slice(offset, offset + CHUNK)) {
      tx.add(SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: recipient,
        lamports: ATTEMPT_FEE_PAYER_LAMPORTS,
      }));
    }
    await provider.sendAndConfirm(tx, []);
  }
}

async function createFixture({ program, provider, connection, wallet, attemptCount }) {
  const programId = program.programId;
  const authorityKeypair = Keypair.generate();
  const authority = authorityKeypair.publicKey;
  const recipient = Keypair.generate().publicKey;
  const sources = Array.from({ length: CONDITION_COUNT }, () => Keypair.generate());
  const objectiveSeed = crypto.randomBytes(32);

  const pathPda = derive(programId, [Buffer.from('path'), authority.toBuffer()]);
  const objectivePda = derive(programId, [Buffer.from('objective'), authority.toBuffer(), objectiveSeed]);
  const vaultPda = derive(programId, [Buffer.from('vault'), objectivePda.toBuffer()]);
  const conditionPdas = Array.from({ length: CONDITION_COUNT }, (_, kind) =>
    derive(programId, [Buffer.from('condition'), objectivePda.toBuffer(), Buffer.from([kind])]),
  );
  const candidatePda = derive(programId, [Buffer.from('session_candidate'), objectivePda.toBuffer()]);

  await provider.sendAndConfirm(
    new Transaction().add(SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: authority,
      lamports: FIXTURE_LAMPORTS,
    })),
    [],
  );

  const startSlot = await connection.getSlot('confirmed');
  await setupSend(
    program.methods.initializePath(new anchor.BN(1_000_000), new anchor.BN(startSlot + 100_000))
      .accounts({ path: pathPda, authority, systemProgram: SystemProgram.programId }),
    [authorityKeypair],
  );
  await setupSend(
    program.methods.createObjective(
      [...objectiveSeed],
      new anchor.BN(TARGET_EXPOSURE),
      new anchor.BN(1),
      conditionPdas,
    ).accounts({ objective: objectivePda, path: pathPda, authority, systemProgram: SystemProgram.programId }),
    [authorityKeypair],
  );
  await setupSend(
    program.methods.initializeVault(new anchor.BN(INITIAL_EXPOSURE))
      .accounts({ vault: vaultPda, objective: objectivePda, authority, systemProgram: SystemProgram.programId }),
    [authorityKeypair],
  );

  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
    await setupSend(
      program.methods.initializeCondition(kind, sources[kind].publicKey)
        .accounts({
          condition: conditionPdas[kind],
          objective: objectivePda,
          authority,
          systemProgram: SystemProgram.programId,
        }),
      [authorityKeypair],
    );
  }

  await setupSend(
    program.methods.initializeSessionCandidate(
      recipient,
      new anchor.BN(TRANSFER_LAMPORTS),
      new anchor.BN(EXPOSURE_REDUCTION),
    ).accounts({
      sessionCandidate: candidatePda,
      objective: objectivePda,
      path: pathPda,
      authority,
      vault: vaultPda,
      systemProgram: SystemProgram.programId,
    }),
    [authorityKeypair],
  );

  const validityAnchorSlot = await connection.getSlot('confirmed');
  const validUntilSlot = validityAnchorSlot + CONDITION_TTL_SLOTS;
  const updateBuilder = (kind, sequence, predicateResult) => program.methods.updateCondition(
    new anchor.BN(sequence),
    new anchor.BN(100 + kind),
    predicateResult,
    new anchor.BN(validUntilSlot),
  ).accounts({
    condition: conditionPdas[kind],
    source: sources[kind].publicKey,
  });

  // Warm state: C2 is the only blocker.
  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
    await setupSend(updateBuilder(kind, 1, kind !== 2), [sources[kind]]);
  }

  const sealInstruction = await program.methods
    .evaluateSessionCandidate(EXPECTED_SEQUENCES.map((value) => new anchor.BN(value)))
    .accounts({
      sessionCandidate: candidatePda,
      condition0: conditionPdas[0],
      condition1: conditionPdas[1],
      condition2: conditionPdas[2],
      condition3: conditionPdas[3],
      condition4: conditionPdas[4],
      condition5: conditionPdas[5],
    })
    .instruction();

  const attemptFeePayers = Array.from({ length: attemptCount }, () => Keypair.generate());
  await fundMany(provider, wallet.publicKey, attemptFeePayers.map((kp) => kp.publicKey));

  const latest = await connection.getLatestBlockhash('confirmed');
  const attemptTransactions = attemptFeePayers.map((feePayer) => {
    const tx = new Transaction({
      feePayer: feePayer.publicKey,
      recentBlockhash: latest.blockhash,
    }).add(sealInstruction);
    tx.sign(feePayer);
    return {
      feePayer: feePayer.publicKey.toBase58(),
      signature: tx.signature.toString('base64'),
      bytes: tx.serialize(),
    };
  });

  const makeSourceTx = async (builder, signer) => {
    const tx = await builder.transaction();
    const bh = await connection.getLatestBlockhash('confirmed');
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = bh.blockhash;
    tx.partialSign(signer);
    const signed = await wallet.signTransaction(tx);
    return signed.serialize();
  };

  const openBytes = await makeSourceTx(updateBuilder(2, 2, true), sources[2]);
  const closeBytes = await makeSourceTx(updateBuilder(0, 2, false), sources[0]);

  return {
    candidatePda,
    attemptTransactions,
    openBytes,
    closeBytes,
  };
}

async function sendRaw(connection, bytes) {
  return connection.sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 0 });
}

async function runTrial({ program, provider, connection, wallet, windowMs, trialIndex }) {
  const burstDurationMs = SPEC_LEAD_MS + windowMs + SPEC_TAIL_MS;
  const attemptCount = Math.min(
    MAX_ATTEMPTS,
    Math.max(1, Math.ceil(burstDurationMs / SPEC_CADENCE_MS) + 2),
  );

  const fixture = await createFixture({
    program,
    provider,
    connection,
    wallet,
    attemptCount,
  });

  const trialStart = nowMs();
  const openAt = trialStart + SPEC_LEAD_MS;
  const closeAt = openAt + windowMs;
  const stopAt = closeAt + SPEC_TAIL_MS;

  let openSignature = null;
  let closeSignature = null;
  const attempts = [];

  const openPromise = (async () => {
    const wait = openAt - nowMs();
    if (wait > 0) await sleep(wait);
    const emittedAtMs = nowMs();
    try {
      openSignature = await sendRaw(connection, fixture.openBytes);
      return { ok: true, emittedAtMs, signature: openSignature };
    } catch (error) {
      return { ok: false, emittedAtMs, error: String(error?.message ?? error) };
    }
  })();

  const closePromise = (async () => {
    const wait = closeAt - nowMs();
    if (wait > 0) await sleep(wait);
    const emittedAtMs = nowMs();
    try {
      closeSignature = await sendRaw(connection, fixture.closeBytes);
      return { ok: true, emittedAtMs, signature: closeSignature };
    } catch (error) {
      return { ok: false, emittedAtMs, error: String(error?.message ?? error) };
    }
  })();

  for (let index = 0; index < fixture.attemptTransactions.length; index += 1) {
    const targetAt = trialStart + index * SPEC_CADENCE_MS;
    if (targetAt > stopAt) break;
    const wait = targetAt - nowMs();
    if (wait > 0) await sleep(wait);

    const prepared = fixture.attemptTransactions[index];
    const submittedAtMs = nowMs();
    try {
      const signature = await sendRaw(connection, prepared.bytes);
      attempts.push({
        index,
        submittedAtMs,
        relativeToOpenMs: submittedAtMs - openAt,
        feePayer: prepared.feePayer,
        signature,
        submitAccepted: true,
      });
    } catch (error) {
      attempts.push({
        index,
        submittedAtMs,
        relativeToOpenMs: submittedAtMs - openAt,
        feePayer: prepared.feePayer,
        signature: null,
        submitAccepted: false,
        submitError: String(error?.message ?? error),
      });
    }
  }

  const [openResult, closeResult] = await Promise.all([openPromise, closePromise]);
  await sleep(SETTLE_WAIT_MS);

  let candidate = null;
  let exactVersionMatch = false;
  let falseLock = false;
  let verificationError = null;
  try {
    const state = await program.account.sessionCandidate.fetch(fixture.candidatePda, 'processed');
    candidate = {
      ready: state.ready,
      frozenSequences: state.frozenSequences.map(Number),
      sealedSlot: Number(state.sealedSlot),
    };
    exactVersionMatch = state.ready === true
      && candidate.frozenSequences.join(',') === EXPECTED_SEQUENCES.join(',');
    falseLock = state.ready === true && !exactVersionMatch;
  } catch (error) {
    verificationError = String(error?.message ?? error);
  }

  const acceptedSignatures = attempts.filter((attempt) => attempt.submitAccepted && attempt.signature);
  const statuses = acceptedSignatures.length > 0
    ? await connection.getSignatureStatuses(acceptedSignatures.map((attempt) => attempt.signature), {
        searchTransactionHistory: true,
      })
    : { value: [] };

  for (let index = 0; index < acceptedSignatures.length; index += 1) {
    acceptedSignatures[index].status = statuses.value[index] ?? null;
  }

  const landedSuccessfulAttempts = acceptedSignatures.filter((attempt) => attempt.status && attempt.status.err == null);
  const landedFailedAttempts = acceptedSignatures.filter((attempt) => attempt.status && attempt.status.err != null);
  const noStatusAttempts = acceptedSignatures.filter((attempt) => !attempt.status);

  // Estimate direct transaction-fee expenditure from balances consumed by the
  // dedicated attempt fee-payers. Each fee-payer is used exactly once.
  let feeLamportsSpent = 0;
  for (const attempt of attempts) {
    const balance = await connection.getBalance(new PublicKey(attempt.feePayer), 'processed');
    feeLamportsSpent += Math.max(0, ATTEMPT_FEE_PAYER_LAMPORTS - balance);
  }

  const capture = exactVersionMatch && !falseLock && verificationError == null;
  const result = {
    path: 'solana-speculative',
    windowMs,
    trial: trialIndex + 1,
    capture,
    exactVersionMatch,
    falseLock,
    candidate,
    verificationError,
    schedule: {
      cadenceMs: SPEC_CADENCE_MS,
      leadMs: SPEC_LEAD_MS,
      tailMs: SPEC_TAIL_MS,
      configuredOpenToCloseEmissionMs: windowMs,
      actualOpenEmissionMs: openResult.emittedAtMs - trialStart,
      actualCloseEmissionMs: closeResult.emittedAtMs - trialStart,
      actualOpenToCloseEmissionMs: closeResult.emittedAtMs - openResult.emittedAtMs,
    },
    sourceWrites: {
      open: openResult,
      close: closeResult,
    },
    attempts: {
      prepared: fixture.attemptTransactions.length,
      submitted: attempts.length,
      submitAccepted: acceptedSignatures.length,
      landedSuccessful: landedSuccessfulAttempts.length,
      landedFailed: landedFailedAttempts.length,
      noStatus: noStatusAttempts.length,
      feeLamportsSpent,
      details: attempts,
    },
  };

  console.log(
    `solana-spec window=${windowMs}ms trial=${trialIndex + 1}`
    + ` capture=${capture}`
    + ` exact=${exactVersionMatch}`
    + ` falseLock=${falseLock}`
    + ` attempts=${attempts.length}`
    + ` accepted=${acceptedSignatures.length}`
    + ` landedOk=${landedSuccessfulAttempts.length}`
    + ` landedFail=${landedFailedAttempts.length}`
    + ` fees=${feeLamportsSpent}`,
  );

  return result;
}

const idlPath = process.env.REACTOR_IDL ?? 'target/idl/reactor.json';
if (!fs.existsSync(idlPath)) throw new Error(`missing ${idlPath}`);
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
const envProvider = anchor.AnchorProvider.env();
const wallet = envProvider.wallet;
const connection = new Connection(BASE_RPC, { commitment: 'confirmed', wsEndpoint: BASE_WS });
await connection.getVersion();
const provider = new anchor.AnchorProvider(connection, wallet, {
  commitment: 'confirmed',
  preflightCommitment: 'confirmed',
});
const program = new anchor.Program(idl, provider);

console.log('M4-Coordination speculative Solana baseline');
console.log(`program: ${program.programId}`);
console.log(`base: ${BASE_RPC}`);
console.log(`windows: ${WINDOWS_MS.join(', ')} ms`);
console.log(`trials/band: ${TRIALS_PER_BAND}`);
console.log(`cadence: ${SPEC_CADENCE_MS} ms; lead: ${SPEC_LEAD_MS} ms; tail: ${SPEC_TAIL_MS} ms`);
console.log('strategy: unique exact-version seal attempts; independent source writes; no source+seal bundling');

const trials = [];
for (const windowMs of WINDOWS_MS) {
  for (let trialIndex = 0; trialIndex < TRIALS_PER_BAND; trialIndex += 1) {
    trials.push(await runTrial({ program, provider, connection, wallet, windowMs, trialIndex }));
  }
}

const byWindow = {};
for (const windowMs of WINDOWS_MS) {
  const xs = trials.filter((trial) => trial.windowMs === windowMs);
  byWindow[windowMs] = {
    trials: xs.length,
    captured: xs.filter((trial) => trial.capture).length,
    captureRate: xs.length ? xs.filter((trial) => trial.capture).length / xs.length : null,
    falseLocks: xs.filter((trial) => trial.falseLock).length,
    attemptsSubmitted: summarizeNumbers(xs.map((trial) => trial.attempts.submitted)),
    landedSuccessfulAttempts: summarizeNumbers(xs.map((trial) => trial.attempts.landedSuccessful)),
    landedFailedAttempts: summarizeNumbers(xs.map((trial) => trial.attempts.landedFailed)),
    feeLamportsSpent: summarizeNumbers(xs.map((trial) => trial.attempts.feeLamportsSpent)),
    actualOpenToCloseEmissionMs: summarizeNumbers(xs.map((trial) => trial.schedule.actualOpenToCloseEmissionMs)),
  };
}

const output = {
  benchmark: 'reactor-m4-coordination-speculative-solana-smoke',
  scope: 'strong-honest-solana-adversarial-baseline-not-frozen-gate',
  generatedAt: new Date().toISOString(),
  configuration: {
    windowsMs: WINDOWS_MS,
    trialsPerBand: TRIALS_PER_BAND,
    expectedSequences: EXPECTED_SEQUENCES,
    cadenceMs: SPEC_CADENCE_MS,
    leadMs: SPEC_LEAD_MS,
    tailMs: SPEC_TAIL_MS,
    maxAttempts: MAX_ATTEMPTS,
    attemptFeePayerLamports: ATTEMPT_FEE_PAYER_LAMPORTS,
    sourceUpdateSealBundlingAllowed: false,
    strategy: 'continuous-unique-exact-version-seal-attempts',
  },
  summary: byWindow,
  frozenContinuationGateEvaluated: false,
  trials,
};

fs.mkdirSync('experiment/results', { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
console.log('\nSpeculative Solana summary');
console.log(JSON.stringify(byWindow, null, 2));
console.log(`evidence written: ${OUTPUT_PATH}`);
