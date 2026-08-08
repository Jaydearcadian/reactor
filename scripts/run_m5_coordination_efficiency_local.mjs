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

const anchor = anchorNamespace.default ?? anchorNamespace;
const CONDITION_COUNT = 6;
const EXPECTED_SEQUENCES = [1, 1, 2, 1, 1, 1];
const INITIAL_EXPOSURE = 700;
const TARGET_EXPOSURE = 500;
const EXPOSURE_REDUCTION = 200;
const TRANSFER_LAMPORTS = 100_000;
const BASE_RPC = process.env.REACTOR_M5_BASE_RPC ?? process.env.REACTOR_M4_ENGINE_BASE_RPC ?? 'http://127.0.0.1:8899';
const BASE_WS = process.env.REACTOR_M5_BASE_WS ?? process.env.REACTOR_M4_ENGINE_BASE_WS ?? 'ws://127.0.0.1:8900';
const ER_RPC = process.env.REACTOR_M5_ER_RPC ?? process.env.REACTOR_M4_ENGINE_ER_RPC ?? 'http://127.0.0.1:7799';
const ER_WS = process.env.REACTOR_M5_ER_WS ?? process.env.REACTOR_M4_ENGINE_ER_WS ?? 'ws://127.0.0.1:7800';
const ER_VALIDATOR = new PublicKey(process.env.REACTOR_M5_ER_VALIDATOR ?? process.env.REACTOR_M4_ENGINE_ER_VALIDATOR ?? 'mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev');
const OBJECTIVE_COUNTS = (process.env.REACTOR_M5_OBJECTIVE_COUNTS ?? '1,5,10')
  .split(',').map((v) => Number(v.trim())).filter((v) => Number.isInteger(v) && v > 0);
const WINDOW_MS = Number(process.env.REACTOR_M5_WINDOW_MS ?? 100);
const JITTER_STEP_MS = Number(process.env.REACTOR_M5_JITTER_STEP_MS ?? 7);
const SPEC_CADENCE_MS = Number(process.env.REACTOR_M5_SPEC_CADENCE_MS ?? 5);
const PREOPEN_MS = Number(process.env.REACTOR_M5_PREOPEN_MS ?? 25);
const POSTCLOSE_MS = Number(process.env.REACTOR_M5_POSTCLOSE_MS ?? 25);
const CONDITION_TTL_SLOTS = Number(process.env.REACTOR_M5_TTL_SLOTS ?? 20_000);
const FIXTURE_LAMPORTS = Number(process.env.REACTOR_M5_FIXTURE_LAMPORTS ?? 100_000_000);
const ATTEMPT_PAYER_LAMPORTS = Number(process.env.REACTOR_M5_ATTEMPT_PAYER_LAMPORTS ?? 1_000_000);
const SOURCE_PAYER_LAMPORTS = Number(process.env.REACTOR_M5_SOURCE_PAYER_LAMPORTS ?? 1_200_000);
const OUTPUT_PATH = process.env.REACTOR_M5_RESULT_PATH ?? 'experiment/results/m5-coordination-efficiency-local-latest.json';
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
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  let output = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) output += BASE58[digits[i]];
  return output;
}

async function setupSend(builder, signers = []) {
  return (signers.length ? builder.signers(signers) : builder).rpc({ commitment: 'confirmed' });
}

async function fundMany(connection, wallet, recipients) {
  const MAX_TRANSFERS = 8;
  for (let i = 0; i < recipients.length; i += MAX_TRANSFERS) {
    const tx = new Transaction();
    for (const item of recipients.slice(i, i + MAX_TRANSFERS)) {
      tx.add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: item.pubkey, lamports: item.lamports }));
    }
    const latest = await connection.getLatestBlockhash('confirmed');
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = latest.blockhash;
    const signed = await wallet.signTransaction(tx);
    const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
  }
}

async function prepareBuilderWithPayer(builder, connection, payer, signers = []) {
  const tx = await builder.transaction();
  const latest = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = payer.publicKey;
  tx.partialSign(payer, ...signers.filter((signer) => !signer.publicKey.equals(payer.publicKey)));
  assert(tx.signature, 'missing transaction signature');
  return { bytes: tx.serialize(), signature: base58Encode(tx.signature), payer: payer.publicKey.toBase58() };
}

async function sendRaw(connection, prepared) {
  return connection.sendRawTransaction(prepared.bytes, { skipPreflight: true, maxRetries: 0 });
}

async function waitForDelegated(baseConnection, erConnection, pubkey, programId, attempts = 240) {
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

async function getFeeLamports(connection, prepared) {
  try {
    const tx = Transaction.from(prepared.bytes);
    const fee = await connection.getFeeForMessage(tx.compileMessage(), 'processed');
    return fee?.value ?? null;
  } catch { return null; }
}

async function createObjectiveFixture({ mode, index, baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet, solAttemptCount }) {
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

  await baseProvider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: authority,
    lamports: FIXTURE_LAMPORTS,
  })), []);
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
  const updateBuilder = (kind, sequence, predicateResult) => activeProgram.methods.updateCondition(
    new anchor.BN(sequence), new anchor.BN(100 + kind), predicateResult, new anchor.BN(validUntilSlot),
  ).accounts({ condition: conditionPdas[kind], source: sources[kind].publicKey });
  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
    await setupSend(updateBuilder(kind, 1, kind !== 2), [sources[kind]]);
  }

  const attemptPayers = mode === 'solana' ? Array.from({ length: solAttemptCount }, () => Keypair.generate()) : [];
  await fundMany(baseConnection, wallet, [
    { pubkey: sources[0].publicKey, lamports: SOURCE_PAYER_LAMPORTS },
    { pubkey: sources[2].publicKey, lamports: SOURCE_PAYER_LAMPORTS },
    ...attemptPayers.map((payer) => ({ pubkey: payer.publicKey, lamports: ATTEMPT_PAYER_LAMPORTS })),
  ]);

  const openPrepared = await prepareBuilderWithPayer(updateBuilder(2, 2, true), activeConnection, sources[2], [sources[2]]);
  const closePrepared = await prepareBuilderWithPayer(updateBuilder(0, 2, false), activeConnection, sources[0], [sources[0]]);
  const sealBuilder = activeProgram.methods.evaluateSessionCandidate(EXPECTED_SEQUENCES.map((v) => new anchor.BN(v)))
    .accounts({
      sessionCandidate: candidatePda,
      condition0: conditionPdas[0], condition1: conditionPdas[1], condition2: conditionPdas[2],
      condition3: conditionPdas[3], condition4: conditionPdas[4], condition5: conditionPdas[5],
    });

  let reactiveSealPrepared = null;
  const speculativeAttempts = [];
  if (mode === 'magicblock') {
    const payer = Keypair.generate();
    await fundMany(baseConnection, wallet, [{ pubkey: payer.publicKey, lamports: ATTEMPT_PAYER_LAMPORTS }]);
    reactiveSealPrepared = await prepareBuilderWithPayer(sealBuilder, activeConnection, payer);
  } else {
    for (const payer of attemptPayers) speculativeAttempts.push(await prepareBuilderWithPayer(sealBuilder, activeConnection, payer));
  }

  return {
    index,
    mode,
    activeProgram,
    activeConnection,
    candidatePda,
    blockerPda: conditionPdas[2],
    openPrepared,
    closePrepared,
    reactiveSealPrepared,
    speculativeAttempts,
  };
}

async function observeBlockerAndSeal(fixture, records) {
  let fired = false;
  const subscriptionId = await fixture.activeConnection.onAccountChange(
    fixture.blockerPda,
    async (accountInfo) => {
      if (fired || accountInfo.data.length < 90) return;
      const seq = Number(accountInfo.data.readBigUInt64LE(73));
      const pred = accountInfo.data.readUInt8(89) !== 0;
      if (seq !== 2 || !pred) return;
      fired = true;
      const submittedAt = nowMs();
      let signature = null;
      let submitError = null;
      try { signature = await sendRaw(fixture.activeConnection, fixture.reactiveSealPrepared); }
      catch (error) { submitError = String(error?.message ?? error); }
      records.push({ objective: fixture.index, submittedAt, signature, submitError });
    },
    'processed',
  );
  return subscriptionId;
}

async function verifyObjective(fixture) {
  try {
    const state = await fixture.activeProgram.account.sessionCandidate.fetch(fixture.candidatePda, 'processed');
    const frozen = state.frozenSequences.map(Number);
    return { capture: state.ready === true && frozen.join(',') === EXPECTED_SEQUENCES.join(','), falseLock: state.ready === true && frozen.join(',') !== EXPECTED_SEQUENCES.join(','), frozen };
  } catch (error) {
    return { capture: false, falseLock: false, error: String(error?.message ?? error) };
  }
}

async function runEpisode({ mode, objectiveCount, baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet }) {
  const maxOffset = (objectiveCount - 1) * JITTER_STEP_MS;
  const totalEpisodeMs = PREOPEN_MS + maxOffset + WINDOW_MS + POSTCLOSE_MS;
  const solAttemptCount = Math.ceil(totalEpisodeMs / SPEC_CADENCE_MS) + 4;
  const fixtures = [];
  for (let i = 0; i < objectiveCount; i += 1) {
    fixtures.push(await createObjectiveFixture({ mode, index: i, baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet, solAttemptCount }));
  }

  const reactiveRecords = [];
  const subscriptions = [];
  if (mode === 'magicblock') {
    for (const fixture of fixtures) subscriptions.push(await observeBlockerAndSeal(fixture, reactiveRecords));
    await sleep(100);
  }

  const speculativeRecords = [];
  const sourceRecords = [];
  const episodeStart = nowMs();
  const t0 = episodeStart + PREOPEN_MS;
  let nextSpecAt = episodeStart;
  const specIndexes = new Array(objectiveCount).fill(0);
  const opened = new Array(objectiveCount).fill(false);
  const closed = new Array(objectiveCount).fill(false);
  const episodeStop = t0 + maxOffset + WINDOW_MS + POSTCLOSE_MS;

  while (nowMs() <= episodeStop) {
    const now = nowMs();
    for (let i = 0; i < objectiveCount; i += 1) {
      const openAt = t0 + i * JITTER_STEP_MS;
      const closeAt = openAt + WINDOW_MS;
      if (!opened[i] && now >= openAt) {
        opened[i] = true;
        let signature = null;
        let error = null;
        try { signature = await sendRaw(fixtures[i].activeConnection, fixtures[i].openPrepared); }
        catch (e) { error = String(e?.message ?? e); }
        sourceRecords.push({ objective: i, type: 'open', at: nowMs(), signature, error });
      }
      if (!closed[i] && now >= closeAt) {
        closed[i] = true;
        let signature = null;
        let error = null;
        try { signature = await sendRaw(fixtures[i].activeConnection, fixtures[i].closePrepared); }
        catch (e) { error = String(e?.message ?? e); }
        sourceRecords.push({ objective: i, type: 'close', at: nowMs(), signature, error });
      }
    }

    if (mode === 'solana' && now >= nextSpecAt) {
      for (let i = 0; i < objectiveCount; i += 1) {
        const idx = specIndexes[i];
        if (idx >= fixtures[i].speculativeAttempts.length) continue;
        const prepared = fixtures[i].speculativeAttempts[idx];
        let signature = null;
        let error = null;
        try { signature = await sendRaw(fixtures[i].activeConnection, prepared); }
        catch (e) { error = String(e?.message ?? e); }
        speculativeRecords.push({ objective: i, attempt: idx, at: nowMs(), signature, error });
        specIndexes[i] += 1;
      }
      nextSpecAt += SPEC_CADENCE_MS;
    }
    await sleep(1);
  }

  await sleep(mode === 'solana' ? 800 : 200);
  for (let i = 0; i < subscriptions.length; i += 1) {
    try { await fixtures[i].activeConnection.removeAccountChangeListener(subscriptions[i]); } catch {}
  }

  const verifications = [];
  for (const fixture of fixtures) verifications.push(await verifyObjective(fixture));
  const captures = verifications.filter((v) => v.capture).length;
  const falseLocks = verifications.filter((v) => v.falseLock).length;
  const coordinatorSubmitted = mode === 'solana' ? speculativeRecords.length : reactiveRecords.length;
  const coordinatorSubmitErrors = (mode === 'solana' ? speculativeRecords : reactiveRecords).filter((r) => r.error || r.submitError).length;
  const feeSamplePrepared = mode === 'solana'
    ? fixtures.find((f) => f.speculativeAttempts.length)?.speculativeAttempts[0]
    : fixtures.find((f) => f.reactiveSealPrepared)?.reactiveSealPrepared;
  const feePerCoordinatorTx = feeSamplePrepared ? await getFeeLamports(mode === 'solana' ? baseConnection : erConnection, feeSamplePrepared) : null;
  const estimatedCoordinatorFees = feePerCoordinatorTx == null ? null : feePerCoordinatorTx * coordinatorSubmitted;

  const result = {
    mode,
    objectiveCount,
    captures,
    captureRate: captures / objectiveCount,
    falseLocks,
    coordinatorSubmitted,
    coordinatorSubmitErrors,
    sourceSubmitted: sourceRecords.length,
    totalHotSubmitted: coordinatorSubmitted + sourceRecords.length,
    attemptsPerCapture: captures ? coordinatorSubmitted / captures : null,
    wastedCoordinatorAttemptsPerCapture: captures ? Math.max(0, coordinatorSubmitted - captures) / captures : null,
    feePerCoordinatorTx,
    estimatedCoordinatorFees,
    estimatedCoordinatorFeesPerCapture: captures && estimatedCoordinatorFees != null ? estimatedCoordinatorFees / captures : null,
    configuredAttemptsPerSecondPerObjective: mode === 'solana' ? 1000 / SPEC_CADENCE_MS : 0,
    configuredAggregateAttemptsPerSecond: mode === 'solana' ? objectiveCount * (1000 / SPEC_CADENCE_MS) : 0,
    sourceRecords,
    coordinatorRecords: mode === 'solana' ? speculativeRecords : reactiveRecords,
    verifications,
  };
  console.log(`${mode} objectives=${objectiveCount} captures=${captures}/${objectiveCount} falseLocks=${falseLocks} coordinatorTx=${coordinatorSubmitted} txPerCapture=${result.attemptsPerCapture?.toFixed(2) ?? 'n/a'} feePerCapture=${result.estimatedCoordinatorFeesPerCapture ?? 'n/a'}`);
  return result;
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

console.log('M5 Coordination Efficiency local smoke');
console.log(`objective counts: ${OBJECTIVE_COUNTS.join(', ')}`);
console.log(`window/source spacing: ${WINDOW_MS}ms`);
console.log(`solana speculation cadence: ${SPEC_CADENCE_MS}ms/objective`);
console.log('solana strategy: speculative exact-version attempts');
console.log('reactor strategy: reactive ER seal on blocker transition');

const episodes = [];
for (const objectiveCount of OBJECTIVE_COUNTS) {
  episodes.push(await runEpisode({ mode: 'solana', objectiveCount, baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet }));
  episodes.push(await runEpisode({ mode: 'magicblock', objectiveCount, baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet }));
}

const result = {
  benchmark: 'reactor-m5-coordination-efficiency-local-smoke',
  scope: 'local-hot-coordination-efficiency-not-end-to-end-settlement',
  generatedAt: new Date().toISOString(),
  configuration: {
    objectiveCounts: OBJECTIVE_COUNTS,
    windowMs: WINDOW_MS,
    jitterStepMs: JITTER_STEP_MS,
    solanaSpecCadenceMs: SPEC_CADENCE_MS,
    solanaConfiguredAttemptsPerSecondPerObjective: 1000 / SPEC_CADENCE_MS,
    reactorStrategy: 'reactive-processed-blocker-observation-one-seal',
    solanaStrategy: 'continuous-unique-exact-version-speculation',
    expectedSequences: EXPECTED_SEQUENCES,
  },
  episodes,
  gateEvaluated: false,
  nextGate: 'If semantics are clean, increase objective counts and add M5b commit/materialize/settle/Receipt costs before product claims.',
};
fs.mkdirSync('experiment/results', { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
console.log(`evidence written: ${OUTPUT_PATH}`);
