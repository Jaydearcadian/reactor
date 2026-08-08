import fs from 'node:fs';
import crypto from 'node:crypto';
import * as anchorNamespace from '@coral-xyz/anchor';
import { DELEGATION_PROGRAM_ID } from '@magicblock-labs/ephemeral-rollups-sdk';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
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
const WINDOWS_MS = (process.env.REACTOR_M4_SPEC_V2_WINDOWS_MS ?? '10,20,50,100,150,250')
  .split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value > 0);
const TRIALS_PER_BAND = Number(process.env.REACTOR_M4_SPEC_V2_TRIALS ?? 2);
const CADENCE_MS = Number(process.env.REACTOR_M4_SPEC_V2_CADENCE_MS ?? 5);
const PREOPEN_MS = Number(process.env.REACTOR_M4_SPEC_V2_PREOPEN_MS ?? 25);
const POSTCLOSE_MS = Number(process.env.REACTOR_M4_SPEC_V2_POSTCLOSE_MS ?? 25);
const FIXTURE_LAMPORTS = Number(process.env.REACTOR_M4_SPEC_V2_FIXTURE_LAMPORTS ?? 100_000_000);
const ATTEMPT_PAYER_LAMPORTS = Number(process.env.REACTOR_M4_SPEC_V2_ATTEMPT_PAYER_LAMPORTS ?? 20_000);
const SOURCE_PAYER_LAMPORTS = Number(process.env.REACTOR_M4_SPEC_V2_SOURCE_PAYER_LAMPORTS ?? 100_000);
const CONDITION_TTL_SLOTS = Number(process.env.REACTOR_M4_SPEC_V2_TTL_SLOTS ?? 20_000);
const OUTPUT_PATH = process.env.REACTOR_M4_SPEC_V2_RESULT_PATH
  ?? 'experiment/results/m4-coordination-speculative-v2-local-latest.json';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function assert(value, message) { if (!value) throw new Error(message); }
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
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  let output = '1'.repeat(zeroes);
  for (let i = digits.length - 1; i >= 0; i -= 1) output += BASE58[digits[i]];
  return output;
}

async function setupSend(builder, signers = []) {
  return (signers.length ? builder.signers(signers) : builder).rpc({ commitment: 'confirmed' });
}

async function fundMany(connection, wallet, recipients) {
  const MAX_TRANSFERS = 12;
  for (let i = 0; i < recipients.length; i += MAX_TRANSFERS) {
    const tx = new Transaction();
    for (const item of recipients.slice(i, i + MAX_TRANSFERS)) {
      tx.add(SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: item.pubkey,
        lamports: item.lamports,
      }));
    }
    const latest = await connection.getLatestBlockhash('confirmed');
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = latest.blockhash;
    const signed = await wallet.signTransaction(tx);
    const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
  }
}

async function prepareWithPayer(transaction, connection, payer) {
  const latest = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = payer.publicKey;
  transaction.sign(payer);
  assert(transaction.signature, 'prepared transaction missing signature');
  return {
    bytes: transaction.serialize(),
    signature: base58Encode(transaction.signature),
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    payer: payer.publicKey.toBase58(),
  };
}

async function prepareBuilderWithPayer(builder, connection, payer, signers = []) {
  const transaction = await builder.transaction();
  const latest = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = payer.publicKey;
  transaction.partialSign(payer, ...signers);
  assert(transaction.signature, 'prepared builder transaction missing signature');
  return {
    bytes: transaction.serialize(),
    signature: base58Encode(transaction.signature),
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    payer: payer.publicKey.toBase58(),
  };
}

async function sendRaw(connection, prepared) {
  const signature = await connection.sendRawTransaction(prepared.bytes, {
    skipPreflight: true,
    maxRetries: 0,
  });
  assert(signature === prepared.signature, `signature mismatch: ${signature} != ${prepared.signature}`);
  return signature;
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

async function pollSignature(connection, signature, deadlineMs) {
  while (nowMs() < deadlineMs) {
    const response = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
    if (response?.value) return response.value;
    await sleep(5);
  }
  return null;
}

async function fetchBlockIndex(connection, slot, signature) {
  if (!Number.isInteger(slot) || !signature) return null;
  try {
    const block = await connection.getBlock(slot, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
      transactionDetails: 'full',
      rewards: false,
    });
    if (!block?.transactions) return null;
    const index = block.transactions.findIndex((entry) => entry.transaction.signatures?.[0] === signature);
    return index >= 0 ? index : null;
  } catch {
    return null;
  }
}

async function getFeeLamports(connection, prepared) {
  try {
    const tx = Transaction.from(prepared.bytes);
    const fee = await connection.getFeeForMessage(tx.compileMessage(), 'processed');
    return fee?.value ?? null;
  } catch {
    return null;
  }
}

async function createFixture({
  mode,
  attemptCount,
  baseProgram,
  baseProvider,
  baseConnection,
  erProgram,
  erConnection,
  wallet,
}) {
  const programId = baseProgram.programId;
  const authorityKeypair = Keypair.generate();
  const authority = authorityKeypair.publicKey;
  const recipient = Keypair.generate().publicKey;
  const sources = Array.from({ length: CONDITION_COUNT }, () => Keypair.generate());
  const attemptPayers = Array.from({ length: attemptCount }, () => Keypair.generate());
  const objectiveSeed = crypto.randomBytes(32);

  const pathPda = derive(programId, [Buffer.from('path'), authority.toBuffer()]);
  const objectivePda = derive(programId, [Buffer.from('objective'), authority.toBuffer(), objectiveSeed]);
  const vaultPda = derive(programId, [Buffer.from('vault'), objectivePda.toBuffer()]);
  const conditionPdas = Array.from({ length: CONDITION_COUNT }, (_, kind) =>
    derive(programId, [Buffer.from('condition'), objectivePda.toBuffer(), Buffer.from([kind])]),
  );
  const candidatePda = derive(programId, [Buffer.from('session_candidate'), objectivePda.toBuffer()]);

  await fundMany(baseConnection, wallet, [
    { pubkey: authority, lamports: FIXTURE_LAMPORTS },
  ]);

  const startSlot = await baseConnection.getSlot('confirmed');
  await setupSend(baseProgram.methods.initializePath(new anchor.BN(1_000_000), new anchor.BN(startSlot + 100_000))
    .accounts({ path: pathPda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  await setupSend(baseProgram.methods.createObjective(
    [...objectiveSeed], new anchor.BN(TARGET_EXPOSURE), new anchor.BN(1), conditionPdas,
  ).accounts({ objective: objectivePda, path: pathPda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  await setupSend(baseProgram.methods.initializeVault(new anchor.BN(INITIAL_EXPOSURE))
    .accounts({ vault: vaultPda, objective: objectivePda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
    await setupSend(baseProgram.methods.initializeCondition(kind, sources[kind].publicKey)
      .accounts({ condition: conditionPdas[kind], objective: objectivePda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  }
  await setupSend(baseProgram.methods.initializeSessionCandidate(
    recipient, new anchor.BN(TRANSFER_LAMPORTS), new anchor.BN(EXPOSURE_REDUCTION),
  ).accounts({
    sessionCandidate: candidatePda,
    objective: objectivePda,
    path: pathPda,
    authority,
    vault: vaultPda,
    systemProgram: SystemProgram.programId,
  }), [authorityKeypair]);

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

  // Fund source writers and speculative payers on the active runtime. For ER,
  // normal system accounts are cloned lazily from base, so fund on base first.
  await fundMany(baseConnection, wallet, [
    { pubkey: sources[0].publicKey, lamports: SOURCE_PAYER_LAMPORTS },
    { pubkey: sources[2].publicKey, lamports: SOURCE_PAYER_LAMPORTS },
    ...attemptPayers.map((payer) => ({ pubkey: payer.publicKey, lamports: ATTEMPT_PAYER_LAMPORTS })),
  ]);

  const anchorSlot = await activeConnection.getSlot('confirmed');
  const validUntilSlot = anchorSlot + CONDITION_TTL_SLOTS;
  const updateBuilder = (kind, sequence, predicateResult) => activeProgram.methods.updateCondition(
    new anchor.BN(sequence),
    new anchor.BN(100 + kind),
    predicateResult,
    new anchor.BN(validUntilSlot),
  ).accounts({ condition: conditionPdas[kind], source: sources[kind].publicKey });

  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
    await setupSend(updateBuilder(kind, 1, kind !== 2), [sources[kind]]);
  }

  const openPrepared = await prepareBuilderWithPayer(
    updateBuilder(2, 2, true), activeConnection, sources[2], [sources[2]],
  );
  const closePrepared = await prepareBuilderWithPayer(
    updateBuilder(0, 2, false), activeConnection, sources[0], [sources[0]],
  );

  const attempts = [];
  for (let i = 0; i < attemptCount; i += 1) {
    const builder = activeProgram.methods
      .evaluateSessionCandidate(EXPECTED_SEQUENCES.map((value) => new anchor.BN(value)))
      .accounts({
        sessionCandidate: candidatePda,
        condition0: conditionPdas[0],
        condition1: conditionPdas[1],
        condition2: conditionPdas[2],
        condition3: conditionPdas[3],
        condition4: conditionPdas[4],
        condition5: conditionPdas[5],
      });
    attempts.push(await prepareBuilderWithPayer(builder, activeConnection, attemptPayers[i]));
  }

  const signatures = attempts.map((attempt) => attempt.signature);
  assert(new Set(signatures).size === signatures.length, 'instrumentation invalid: speculative signatures are not unique');
  assert(new Set(attempts.map((attempt) => attempt.payer)).size === attempts.length,
    'instrumentation invalid: speculative fee payers are not unique');
  assert(!attempts.some((attempt) => attempt.payer === openPrepared.payer || attempt.payer === closePrepared.payer),
    'instrumentation invalid: source writer shares coordinator fee payer');

  return {
    activeProgram,
    activeConnection,
    candidatePda,
    openPrepared,
    closePrepared,
    attempts,
  };
}

async function runTrial(args) {
  const { mode, windowMs, trialIndex } = args;
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
  let openSignature = null;
  let closeSignature = null;
  let attemptIndex = 0;
  let nextAttemptAt = trialStart;

  while (nowMs() <= stopAt && attemptIndex < fixture.attempts.length) {
    const now = nowMs();

    if (openSubmittedAt == null && now >= t0) {
      openSubmittedAt = nowMs();
      try { openSignature = await sendRaw(fixture.activeConnection, fixture.openPrepared); }
      catch (error) { openSignature = `ERROR:${error?.message ?? error}`; }
    }

    if (closeSubmittedAt == null && now >= closeAt) {
      closeSubmittedAt = nowMs();
      try { closeSignature = await sendRaw(fixture.activeConnection, fixture.closePrepared); }
      catch (error) { closeSignature = `ERROR:${error?.message ?? error}`; }
    }

    if (now >= nextAttemptAt) {
      const prepared = fixture.attempts[attemptIndex];
      const submittedAt = nowMs();
      let signature = null;
      let submitError = null;
      try { signature = await sendRaw(fixture.activeConnection, prepared); }
      catch (error) { submitError = String(error?.message ?? error); }
      attemptRecords.push({
        index: attemptIndex,
        payer: prepared.payer,
        signature,
        submitError,
        scheduledRelativeToT0Ms: nextAttemptAt - t0,
        submittedRelativeToT0Ms: submittedAt - t0,
      });
      attemptIndex += 1;
      nextAttemptAt += CADENCE_MS;
      continue;
    }

    const waits = [2, Math.max(0, nextAttemptAt - now), Math.max(0, stopAt - now)];
    if (openSubmittedAt == null) waits.push(Math.max(0, t0 - now));
    if (closeSubmittedAt == null) waits.push(Math.max(0, closeAt - now));
    await sleep(Math.max(0, Math.min(...waits.filter(Number.isFinite))));
  }

  if (openSubmittedAt == null) {
    openSubmittedAt = nowMs();
    try { openSignature = await sendRaw(fixture.activeConnection, fixture.openPrepared); }
    catch (error) { openSignature = `ERROR:${error?.message ?? error}`; }
  }
  if (closeSubmittedAt == null) {
    closeSubmittedAt = nowMs();
    try { closeSignature = await sendRaw(fixture.activeConnection, fixture.closePrepared); }
    catch (error) { closeSignature = `ERROR:${error?.message ?? error}`; }
  }

  await sleep(mode === 'solana' ? 750 : 150);

  let candidate = null;
  let exact = false;
  let falseLock = false;
  try {
    const state = await fixture.activeProgram.account.sessionCandidate.fetch(fixture.candidatePda, 'processed');
    candidate = {
      ready: state.ready,
      frozenSequences: state.frozenSequences.map(Number),
      sealedSlot: Number(state.sealedSlot),
    };
    exact = state.ready === true && candidate.frozenSequences.join(',') === EXPECTED_SEQUENCES.join(',');
    falseLock = state.ready === true && !exact;
  } catch (error) {
    candidate = { fetchError: String(error?.message ?? error) };
  }

  const statusDeadline = nowMs() + 2500;
  const seen = new Set();
  for (const record of attemptRecords) {
    if (!record.signature || record.signature.startsWith('ERROR:')) continue;
    assert(!seen.has(record.signature), `instrumentation invalid: duplicate submitted signature ${record.signature}`);
    seen.add(record.signature);
    const status = await pollSignature(fixture.activeConnection, record.signature, statusDeadline);
    record.processed = Boolean(status);
    record.err = status?.err ?? null;
    record.slot = status?.slot ?? null;
    record.confirmationStatus = status?.confirmationStatus ?? null;
  }

  const openStatus = openSignature && !openSignature.startsWith('ERROR:')
    ? await pollSignature(fixture.activeConnection, openSignature, nowMs() + 1500) : null;
  const closeStatus = closeSignature && !closeSignature.startsWith('ERROR:')
    ? await pollSignature(fixture.activeConnection, closeSignature, nowMs() + 1500) : null;

  const successful = attemptRecords.filter((record) => record.processed && record.err == null);
  const processedAttempts = attemptRecords.filter((record) => record.processed).length;
  const failedAttempts = attemptRecords.filter((record) => record.processed && record.err != null).length;
  const unobservedAttempts = attemptRecords.length - processedAttempts;
  const instrumentationValid = successful.length <= 1;

  let ordering = null;
  if (instrumentationValid && exact && successful.length === 1) {
    const seal = successful[0];
    const openSlot = openStatus?.slot ?? null;
    const sealSlot = seal.slot ?? null;
    const closeSlot = closeStatus?.slot ?? null;
    ordering = {
      openSlot,
      sealSlot,
      closeSlot,
      openIndex: null,
      sealIndex: null,
      closeIndex: null,
    };
    const relevantSlots = new Set([openSlot, sealSlot, closeSlot].filter(Number.isInteger));
    for (const slot of relevantSlots) {
      if (slot === openSlot) ordering.openIndex = await fetchBlockIndex(fixture.activeConnection, slot, openSignature);
      if (slot === sealSlot) ordering.sealIndex = await fetchBlockIndex(fixture.activeConnection, slot, seal.signature);
      if (slot === closeSlot) ordering.closeIndex = await fetchBlockIndex(fixture.activeConnection, slot, closeSignature);
    }
  }

  const feePerAttemptLamports = fixture.attempts.length
    ? await getFeeLamports(fixture.activeConnection, fixture.attempts[0]) : null;
  const estimatedSubmittedFeesLamports = feePerAttemptLamports == null
    ? null : feePerAttemptLamports * attemptRecords.length;

  const capture = instrumentationValid && exact && !falseLock;
  console.log(
    `${mode} window=${windowMs}ms trial=${trialIndex + 1}`
    + ` capture=${capture} falseLock=${falseLock}`
    + ` attempts=${attemptRecords.length}`
    + ` processed=${processedAttempts}`
    + ` uniqueSuccess=${successful.length}`
    + ` failed=${failedAttempts}`
    + ` unobserved=${unobservedAttempts}`
    + ` instrumentationValid=${instrumentationValid}`
    + ` openSlot=${openStatus?.slot ?? 'n/a'}`
    + ` sealSlot=${successful[0]?.slot ?? 'n/a'}`
    + ` closeSlot=${closeStatus?.slot ?? 'n/a'}`,
  );

  return {
    path: mode,
    windowMs,
    closeSubmissionDelayMs: windowMs,
    trial: trialIndex + 1,
    capture,
    exactVersionMatch: exact,
    falseLock,
    ambiguous: !instrumentationValid,
    staleAttempt: !capture && instrumentationValid,
    instrumentationValid,
    candidate,
    ordering,
    source: {
      openSignature,
      closeSignature,
      openSubmittedRelativeToT0Ms: openSubmittedAt - t0,
      closeSubmittedRelativeToT0Ms: closeSubmittedAt - t0,
      openStatus,
      closeStatus,
      openPayer: fixture.openPrepared.payer,
      closePayer: fixture.closePrepared.payer,
    },
    speculation: {
      preopenMs: PREOPEN_MS,
      cadenceMs: CADENCE_MS,
      postcloseMs: POSTCLOSE_MS,
      configuredAttemptsPerSecond: 1000 / CADENCE_MS,
      attemptsPlanned: attemptCount,
      attemptsSubmitted: attemptRecords.length,
      attemptsProcessed: processedAttempts,
      uniqueSuccessfulSealTransactions: successful.length,
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
  const output = {};
  for (const windowMs of WINDOWS_MS) {
    const solana = trials.filter((trial) => trial.path === 'solana' && trial.windowMs === windowMs);
    const magicblock = trials.filter((trial) => trial.path === 'magicblock' && trial.windowMs === windowMs);
    const solanaCaptured = solana.filter((trial) => trial.capture).length;
    const magicblockCaptured = magicblock.filter((trial) => trial.capture).length;
    output[windowMs] = {
      solana: summarizeTrials(solana),
      magicblock: summarizeTrials(magicblock),
      magicblockMinusSolana: captureRateDifference95(
        magicblockCaptured, magicblock.length, solanaCaptured, solana.length,
      ),
      instrumentationInvalid: {
        solana: solana.filter((trial) => !trial.instrumentationValid).length,
        magicblock: magicblock.filter((trial) => !trial.instrumentationValid).length,
      },
      speculationCost: {
        solanaAttempts: solana.reduce((sum, trial) => sum + trial.speculation.attemptsSubmitted, 0),
        magicblockAttempts: magicblock.reduce((sum, trial) => sum + trial.speculation.attemptsSubmitted, 0),
        solanaEstimatedFeesLamports: solana.reduce(
          (sum, trial) => sum + (trial.speculation.estimatedSubmittedFeesLamports ?? 0), 0,
        ),
        magicblockEstimatedFeesLamports: magicblock.reduce(
          (sum, trial) => sum + (trial.speculation.estimatedSubmittedFeesLamports ?? 0), 0,
        ),
      },
    };
  }
  return output;
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
const baseProvider = new anchor.AnchorProvider(baseConnection, wallet, {
  commitment: 'confirmed', preflightCommitment: 'confirmed',
});
const erProvider = new anchor.AnchorProvider(erConnection, wallet, {
  commitment: 'confirmed', preflightCommitment: 'confirmed',
});
const baseProgram = new anchor.Program(idl, baseProvider);
const erProgram = new anchor.Program(idl, erProvider);

console.log('M4-Coordination speculative baseline V2');
console.log(`windows: ${WINDOWS_MS.join(', ')} ms`);
console.log(`trials/band/path: ${TRIALS_PER_BAND}`);
console.log(`preopen=${PREOPEN_MS}ms cadence=${CADENCE_MS}ms postclose=${POSTCLOSE_MS}ms (~${(1000 / CADENCE_MS).toFixed(0)} attempts/sec/objective)`);
console.log('uniqueness: one funded coordinator fee payer per speculative attempt');
console.log('source fee payers: independent source keys');
console.log('source mutation + seal bundling: forbidden');
console.log('invariant: <=1 unique successful seal transaction per candidate');

const trials = [];
for (const windowMs of WINDOWS_MS) {
  for (let trialIndex = 0; trialIndex < TRIALS_PER_BAND; trialIndex += 1) {
    for (const mode of ['solana', 'magicblock']) {
      trials.push(await runTrial({
        mode,
        windowMs,
        trialIndex,
        baseProgram,
        baseProvider,
        baseConnection,
        erProgram,
        erConnection,
        wallet,
      }));
    }
  }
}

const result = {
  benchmark: 'reactor-m4-coordination-speculative-v2-local-smoke',
  scope: 'corrected-adversarial-speculative-baseline-smoke-not-frozen-gate',
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
    uniqueCoordinatorFeePayerPerAttempt: true,
    sourceKeysPayOwnHotTransactions: true,
    captureGroundTruth: 'exact-candidate-state',
  },
  summary: summaryByBand(trials),
  frozenContinuationGateEvaluated: false,
  trials,
};

fs.mkdirSync('experiment/results', { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
console.log('\nSpeculative V2 smoke summary');
console.log(JSON.stringify(result.summary, null, 2));
console.log(`evidence written: ${OUTPUT_PATH}`);
