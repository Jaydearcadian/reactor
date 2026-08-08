import fs from 'node:fs';
import crypto from 'node:crypto';
import * as anchorNamespace from '@coral-xyz/anchor';
import { DELEGATION_PROGRAM_ID } from '@magicblock-labs/ephemeral-rollups-sdk';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_SLOT_HASHES_PUBKEY,
  Transaction,
} from '@solana/web3.js';
import {
  summarizeTrials,
  captureRateDifference95,
} from '../src-js/m4-telemetry.mjs';

const anchor = anchorNamespace.default ?? anchorNamespace;
const CONDITION_COUNT = 6;
const EXPECTED_SEQUENCES = [1, 1, 2, 1, 1, 1];
const INITIAL_EXPOSURE = 700;
const TARGET_EXPOSURE = 500;
const EXPOSURE_REDUCTION = 200;
const TRANSFER_LAMPORTS = 100_000;
const BASE_RPC = process.env.REACTOR_M4_ENGINE_BASE_RPC ?? 'http://127.0.0.1:8899';
const BASE_WS = process.env.REACTOR_M4_ENGINE_BASE_WS ?? 'ws://127.0.0.1:8900';
const ER_RPC = process.env.REACTOR_M4_ENGINE_ER_RPC ?? 'http://127.0.0.1:7799';
const ER_WS = process.env.REACTOR_M4_ENGINE_ER_WS ?? 'ws://127.0.0.1:7800';
const ER_VALIDATOR = new PublicKey(
  process.env.REACTOR_M4_ENGINE_ER_VALIDATOR ?? 'mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev',
);
const WINDOWS_MS = (process.env.REACTOR_M4_SPEC_WINDOWS_MS ?? '10,20,50,100,150,250')
  .split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0);
const TRIALS_PER_BAND = Number(process.env.REACTOR_M4_SPEC_TRIALS ?? 2);
const CADENCE_MS = Number(process.env.REACTOR_M4_SPEC_CADENCE_MS ?? 5);
const PREOPEN_MS = Number(process.env.REACTOR_M4_SPEC_PREOPEN_MS ?? 25);
const POSTCLOSE_MS = Number(process.env.REACTOR_M4_SPEC_POSTCLOSE_MS ?? 25);
const FIXTURE_LAMPORTS = Number(process.env.REACTOR_M4_SPEC_FIXTURE_LAMPORTS ?? 100_000_000);
const CONDITION_TTL_SLOTS = Number(process.env.REACTOR_M4_SPEC_TTL_SLOTS ?? 20_000);
const OUTPUT_PATH = process.env.REACTOR_M4_SPEC_RESULT_PATH
  ?? 'experiment/results/m4-coordination-speculative-local-latest.json';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const UNIQUENESS_ACCOUNTS = [
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SystemProgram.programId,
];

function assert(x, message) { if (!x) throw new Error(message); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function nowMs() { return Number(process.hrtime.bigint()) / 1_000_000; }
function derive(programId, seeds) { return PublicKey.findProgramAddressSync(seeds, programId)[0]; }

function base58Encode(input) {
  const bytes = Uint8Array.from(input);
  if (bytes.length === 0) return '';
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += BASE58[digits[i]];
  return out;
}

async function setupSend(builder, signers = []) {
  return (signers.length ? builder.signers(signers) : builder).rpc({ commitment: 'confirmed' });
}

async function prepareTx(transaction, connection, wallet, extraSigners = []) {
  const latest = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = wallet.publicKey;
  if (extraSigners.length) transaction.partialSign(...extraSigners);
  const signed = await wallet.signTransaction(transaction);
  assert(signed.signature, 'prepared transaction missing signature');
  return {
    bytes: signed.serialize(),
    signature: base58Encode(signed.signature),
    blockhash: latest.blockhash,
  };
}

async function prepareBuilder(builder, connection, wallet, extraSigners = []) {
  return prepareTx(await builder.transaction(), connection, wallet, extraSigners);
}

async function sendRaw(connection, prepared) {
  return connection.sendRawTransaction(prepared.bytes, { skipPreflight: true, maxRetries: 0 });
}

async function waitForDelegated(baseConnection, erConnection, pubkey, programId, attempts = 200) {
  for (let i = 0; i < attempts; i += 1) {
    const [baseInfo, erInfo] = await Promise.all([
      baseConnection.getAccountInfo(pubkey, 'processed'),
      erConnection.getAccountInfo(pubkey, 'processed'),
    ]);
    if (baseInfo?.owner.equals(DELEGATION_PROGRAM_ID) && erInfo?.owner.equals(programId)) return;
    await sleep(25);
  }
  throw new Error(`delegation timeout: ${pubkey}`);
}

async function fundFixture(provider, payer, authority) {
  await provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: authority,
    lamports: FIXTURE_LAMPORTS,
  })), []);
}

function uniquenessRemainingAccounts(index) {
  // Reactor ignores remaining accounts for evaluate_session_candidate. Varying the
  // ordered suffix makes each message/signature unique without changing state.
  const count = 1 + (index % UNIQUENESS_ACCOUNTS.length);
  const rotated = [...UNIQUENESS_ACCOUNTS.slice(index % UNIQUENESS_ACCOUNTS.length),
    ...UNIQUENESS_ACCOUNTS.slice(0, index % UNIQUENESS_ACCOUNTS.length)];
  return rotated.slice(0, count).map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }));
}

async function createFixture({ mode, baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet, attemptCount }) {
  const programId = baseProgram.programId;
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

  await fundFixture(baseProvider, wallet.publicKey, authority);
  const startSlot = await baseConnection.getSlot('confirmed');
  await setupSend(baseProgram.methods.initializePath(new anchor.BN(1_000_000), new anchor.BN(startSlot + 100_000))
    .accounts({ path: pathPda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  await setupSend(baseProgram.methods.createObjective([...objectiveSeed], new anchor.BN(TARGET_EXPOSURE), new anchor.BN(1), conditionPdas)
    .accounts({ objective: objectivePda, path: pathPda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  await setupSend(baseProgram.methods.initializeVault(new anchor.BN(INITIAL_EXPOSURE))
    .accounts({ vault: vaultPda, objective: objectivePda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
    await setupSend(baseProgram.methods.initializeCondition(kind, sources[kind].publicKey)
      .accounts({ condition: conditionPdas[kind], objective: objectivePda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  }
  await setupSend(baseProgram.methods.initializeSessionCandidate(recipient, new anchor.BN(TRANSFER_LAMPORTS), new anchor.BN(EXPOSURE_REDUCTION))
    .accounts({ sessionCandidate: candidatePda, objective: objectivePda, path: pathPda, authority, vault: vaultPda, systemProgram: SystemProgram.programId }), [authorityKeypair]);

  let activeProgram = baseProgram;
  let activeConnection = baseConnection;
  if (mode === 'magicblock') {
    const validatorRemaining = [{ pubkey: ER_VALIDATOR, isSigner: false, isWritable: false }];
    await setupSend(baseProgram.methods.delegateSessionCandidate()
      .accounts({ payer: authority, objective: objectivePda, sessionCandidate: candidatePda })
      .remainingAccounts(validatorRemaining), [authorityKeypair]);
    await waitForDelegated(baseConnection, erConnection, candidatePda, programId);
    for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
      await setupSend(baseProgram.methods.delegateCondition(kind)
        .accounts({ payer: authority, objective: objectivePda, condition: conditionPdas[kind] })
        .remainingAccounts(validatorRemaining), [authorityKeypair]);
      await waitForDelegated(baseConnection, erConnection, conditionPdas[kind], programId);
    }
    activeProgram = erProgram;
    activeConnection = erConnection;
  }

  const anchorSlot = await activeConnection.getSlot('confirmed');
  const validUntilSlot = anchorSlot + CONDITION_TTL_SLOTS;
  const updateBuilder = (kind, seq, pred) => activeProgram.methods.updateCondition(
    new anchor.BN(seq), new anchor.BN(100 + kind), pred, new anchor.BN(validUntilSlot),
  ).accounts({ condition: conditionPdas[kind], source: sources[kind].publicKey });

  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
    await setupSend(updateBuilder(kind, 1, kind !== 2), [sources[kind]]);
  }

  const openPrepared = await prepareBuilder(updateBuilder(2, 2, true), activeConnection, wallet, [sources[2]]);
  const closePrepared = await prepareBuilder(updateBuilder(0, 2, false), activeConnection, wallet, [sources[0]]);

  const attempts = [];
  for (let i = 0; i < attemptCount; i += 1) {
    const builder = activeProgram.methods
      .evaluateSessionCandidate(EXPECTED_SEQUENCES.map((v) => new anchor.BN(v)))
      .accounts({
        sessionCandidate: candidatePda,
        condition0: conditionPdas[0], condition1: conditionPdas[1], condition2: conditionPdas[2],
        condition3: conditionPdas[3], condition4: conditionPdas[4], condition5: conditionPdas[5],
      })
      .remainingAccounts(uniquenessRemainingAccounts(i));
    attempts.push(await prepareBuilder(builder, activeConnection, wallet));
  }

  return { activeProgram, activeConnection, candidatePda, conditionPdas, openPrepared, closePrepared, attempts };
}

async function pollSignature(connection, signature, deadlineMs) {
  while (nowMs() < deadlineMs) {
    const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
    if (status?.value) return status.value;
    await sleep(5);
  }
  return null;
}

async function getFeeLamports(connection, prepared) {
  try {
    const tx = Transaction.from(prepared.bytes);
    const message = tx.compileMessage();
    const fee = await connection.getFeeForMessage(message, 'processed');
    return fee?.value ?? null;
  } catch {
    return null;
  }
}

async function runTrial(args) {
  const { mode, windowMs, trialIndex, wallet } = args;
  const totalSpeculationMs = PREOPEN_MS + windowMs + POSTCLOSE_MS;
  const attemptCount = Math.max(1, Math.ceil(totalSpeculationMs / CADENCE_MS) + 2);
  const fixture = await createFixture({ ...args, attemptCount });

  const trialStart = nowMs();
  const t0 = trialStart + PREOPEN_MS;
  const closeAt = t0 + windowMs;
  const stopAt = closeAt + POSTCLOSE_MS;
  const attemptRecords = [];

  let openSubmittedAt = null;
  let closeSubmittedAt = null;
  let openSig = null;
  let closeSig = null;
  let attemptIndex = 0;
  let nextAttemptAt = trialStart;

  while (nowMs() <= stopAt && attemptIndex < fixture.attempts.length) {
    const now = nowMs();

    if (openSubmittedAt == null && now >= t0) {
      openSubmittedAt = nowMs();
      try { openSig = await sendRaw(fixture.activeConnection, fixture.openPrepared); } catch (error) { openSig = `ERROR:${error?.message ?? error}`; }
    }
    if (closeSubmittedAt == null && now >= closeAt) {
      closeSubmittedAt = nowMs();
      try { closeSig = await sendRaw(fixture.activeConnection, fixture.closePrepared); } catch (error) { closeSig = `ERROR:${error?.message ?? error}`; }
    }

    if (now >= nextAttemptAt) {
      const prepared = fixture.attempts[attemptIndex];
      const submittedAt = nowMs();
      let signature = null;
      let submitError = null;
      try { signature = await sendRaw(fixture.activeConnection, prepared); } catch (error) { submitError = String(error?.message ?? error); }
      attemptRecords.push({ index: attemptIndex, scheduledAtMs: nextAttemptAt, submittedAtMs: submittedAt, relativeToT0Ms: submittedAt - t0, signature, submitError });
      attemptIndex += 1;
      nextAttemptAt += CADENCE_MS;
      continue;
    }

    const waitFor = Math.min(
      openSubmittedAt == null ? Math.max(0, t0 - now) : Infinity,
      closeSubmittedAt == null ? Math.max(0, closeAt - now) : Infinity,
      Math.max(0, nextAttemptAt - now),
      Math.max(0, stopAt - now),
      2,
    );
    await sleep(Math.max(0, Number.isFinite(waitFor) ? waitFor : 1));
  }

  if (openSubmittedAt == null) {
    openSubmittedAt = nowMs();
    try { openSig = await sendRaw(fixture.activeConnection, fixture.openPrepared); } catch (error) { openSig = `ERROR:${error?.message ?? error}`; }
  }
  if (closeSubmittedAt == null) {
    closeSubmittedAt = nowMs();
    try { closeSig = await sendRaw(fixture.activeConnection, fixture.closePrepared); } catch (error) { closeSig = `ERROR:${error?.message ?? error}`; }
  }

  await sleep(mode === 'solana' ? 700 : 100);

  let candidate = null;
  let exact = false;
  let falseLock = false;
  try {
    const state = await fixture.activeProgram.account.sessionCandidate.fetch(fixture.candidatePda, 'processed');
    candidate = { ready: state.ready, frozenSequences: state.frozenSequences.map(Number), sealedSlot: Number(state.sealedSlot) };
    exact = state.ready === true && candidate.frozenSequences.join(',') === EXPECTED_SEQUENCES.join(',');
    falseLock = state.ready === true && !exact;
  } catch (error) {
    candidate = { fetchError: String(error?.message ?? error) };
  }

  const deadline = nowMs() + 1500;
  for (const record of attemptRecords) {
    if (!record.signature || record.signature.startsWith('ERROR:')) continue;
    const status = await pollSignature(fixture.activeConnection, record.signature, deadline);
    record.processed = Boolean(status);
    record.err = status?.err ?? null;
    record.confirmationStatus = status?.confirmationStatus ?? null;
  }

  let openStatus = null;
  let closeStatus = null;
  if (openSig && !openSig.startsWith('ERROR:')) openStatus = await pollSignature(fixture.activeConnection, openSig, nowMs() + 1000);
  if (closeSig && !closeSig.startsWith('ERROR:')) closeStatus = await pollSignature(fixture.activeConnection, closeSig, nowMs() + 1000);

  const processedAttempts = attemptRecords.filter((r) => r.processed).length;
  const successfulAttempts = attemptRecords.filter((r) => r.processed && r.err == null).length;
  const failedAttempts = attemptRecords.filter((r) => r.processed && r.err != null).length;
  const unobservedAttempts = attemptRecords.length - processedAttempts;
  const feePerAttemptLamports = attemptRecords.length ? await getFeeLamports(fixture.activeConnection, fixture.attempts[0]) : null;
  const estimatedSubmittedFeesLamports = feePerAttemptLamports == null ? null : feePerAttemptLamports * attemptRecords.length;

  console.log(
    `${mode} window=${windowMs}ms trial=${trialIndex + 1}`
    + ` capture=${exact} falseLock=${falseLock}`
    + ` attempts=${attemptRecords.length}`
    + ` processed=${processedAttempts}`
    + ` successAttempts=${successfulAttempts}`
    + ` failedAttempts=${failedAttempts}`
    + ` unobserved=${unobservedAttempts}`
    + ` openSlot=${openStatus?.slot ?? 'n/a'} closeSlot=${closeStatus?.slot ?? 'n/a'}`,
  );

  return {
    path: mode,
    windowMs,
    closeSubmissionDelayMs: windowMs,
    trial: trialIndex + 1,
    capture: exact,
    exactVersionMatch: exact,
    falseLock,
    ambiguous: false,
    staleAttempt: !exact && attemptRecords.length > 0,
    candidate,
    source: {
      openSignature: openSig,
      closeSignature: closeSig,
      openSubmittedRelativeToT0Ms: openSubmittedAt - t0,
      closeSubmittedRelativeToT0Ms: closeSubmittedAt - t0,
      openStatus,
      closeStatus,
    },
    speculation: {
      preopenMs: PREOPEN_MS,
      cadenceMs: CADENCE_MS,
      postcloseMs: POSTCLOSE_MS,
      configuredAttemptsPerSecond: 1000 / CADENCE_MS,
      attemptsPlanned: attemptCount,
      attemptsSubmitted: attemptRecords.length,
      attemptsProcessed: processedAttempts,
      successfulSealTransactions: successfulAttempts,
      failedTransactions: failedAttempts,
      unobservedAttempts,
      feePerAttemptLamports,
      estimatedSubmittedFeesLamports,
      attempts: attemptRecords,
    },
    latency: { captureMs: null, verifiedMs: null },
  };
}

function summaryByBand(trials) {
  const out = {};
  for (const windowMs of WINDOWS_MS) {
    const solana = trials.filter((t) => t.path === 'solana' && t.windowMs === windowMs);
    const mb = trials.filter((t) => t.path === 'magicblock' && t.windowMs === windowMs);
    const solCap = solana.filter((t) => t.capture).length;
    const mbCap = mb.filter((t) => t.capture).length;
    out[windowMs] = {
      solana: summarizeTrials(solana),
      magicblock: summarizeTrials(mb),
      magicblockMinusSolana: captureRateDifference95(mbCap, mb.length, solCap, solana.length),
      speculationCost: {
        solanaAttempts: solana.reduce((s, t) => s + t.speculation.attemptsSubmitted, 0),
        magicblockAttempts: mb.reduce((s, t) => s + t.speculation.attemptsSubmitted, 0),
        solanaEstimatedFeesLamports: solana.reduce((s, t) => s + (t.speculation.estimatedSubmittedFeesLamports ?? 0), 0),
        magicblockEstimatedFeesLamports: mb.reduce((s, t) => s + (t.speculation.estimatedSubmittedFeesLamports ?? 0), 0),
      },
    };
  }
  return out;
}

const idlPath = process.env.REACTOR_IDL ?? 'target/idl/reactor.json';
if (!fs.existsSync(idlPath)) throw new Error(`missing ${idlPath}`);
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
const envProvider = anchor.AnchorProvider.env();
const wallet = envProvider.wallet;
const baseConnection = new Connection(BASE_RPC, { commitment: 'confirmed', wsEndpoint: BASE_WS });
const erConnection = new Connection(ER_RPC, { commitment: 'confirmed', wsEndpoint: ER_WS });
await baseConnection.getVersion();
await erConnection.getVersion();
const baseProvider = new anchor.AnchorProvider(baseConnection, wallet, { commitment: 'confirmed', preflightCommitment: 'confirmed' });
const erProvider = new anchor.AnchorProvider(erConnection, wallet, { commitment: 'confirmed', preflightCommitment: 'confirmed' });
const baseProgram = new anchor.Program(idl, baseProvider);
const erProgram = new anchor.Program(idl, erProvider);

console.log('M4-Coordination speculative adversarial baseline');
console.log(`windows: ${WINDOWS_MS.join(', ')} ms`);
console.log(`trials/band/path: ${TRIALS_PER_BAND}`);
console.log(`preopen=${PREOPEN_MS}ms cadence=${CADENCE_MS}ms postclose=${POSTCLOSE_MS}ms (~${(1000 / CADENCE_MS).toFixed(0)} attempts/sec/objective)`);
console.log('source mutation + seal bundling: forbidden');
console.log('capture ground truth: exact frozen candidate state');

const trials = [];
for (const windowMs of WINDOWS_MS) {
  for (let trialIndex = 0; trialIndex < TRIALS_PER_BAND; trialIndex += 1) {
    for (const mode of ['solana', 'magicblock']) {
      trials.push(await runTrial({ mode, windowMs, trialIndex, baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet }));
    }
  }
}

const result = {
  benchmark: 'reactor-m4-coordination-speculative-local-smoke',
  scope: 'adversarial-speculative-baseline-smoke-not-frozen-gate',
  generatedAt: new Date().toISOString(),
  configuration: {
    windowsMs: WINDOWS_MS,
    trialsPerBandPerPath: TRIALS_PER_BAND,
    preopenMs: PREOPEN_MS,
    cadenceMs: CADENCE_MS,
    postcloseMs: POSTCLOSE_MS,
    configuredAttemptsPerSecond: 1000 / CADENCE_MS,
    expectedSequences: EXPECTED_SEQUENCES,
    rolesSeparated: true,
    updateSealBundlingAllowed: false,
    captureGroundTruth: 'exact-candidate-state',
  },
  summary: summaryByBand(trials),
  frozenContinuationGateEvaluated: false,
  trials,
};

fs.mkdirSync('experiment/results', { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
console.log('\nSpeculative smoke summary');
console.log(JSON.stringify(result.summary, null, 2));
console.log(`evidence written: ${OUTPUT_PATH}`);
