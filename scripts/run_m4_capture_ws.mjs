import fs from 'node:fs';
import crypto from 'node:crypto';
import * as anchorNamespace from '@coral-xyz/anchor';
import { DELEGATION_PROGRAM_ID } from '@magicblock-labs/ephemeral-rollups-sdk';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { TrialTelemetry, summarizeTrials } from '../src-js/m4-telemetry.mjs';

const anchor = anchorNamespace.default ?? anchorNamespace;
const CONDITION_COUNT = 6;
const EXPECTED_SEQUENCES = [1, 1, 2, 1, 1, 1];
const INITIAL_EXPOSURE = 700;
const TARGET_EXPOSURE = 500;
const EXPOSURE_REDUCTION = 200;
const TRANSFER_LAMPORTS = 100_000;
const FIXTURE_BUDGET_LAMPORTS = Number(process.env.REACTOR_M4_FIXTURE_BUDGET_LAMPORTS ?? Math.floor(0.08 * LAMPORTS_PER_SOL));
const SETUP_PACE_MS = Number(process.env.REACTOR_M4_SETUP_PACE_MS ?? 250);
const CONDITION_TTL_SLOTS = Number(process.env.REACTOR_M4_CONDITION_TTL_SLOTS ?? 20_000);
const BASE_RPC = process.env.REACTOR_M4_BASE_RPC ?? 'https://api.devnet.solana.com';
const ROUTER_RPC = process.env.REACTOR_ROUTER_RPC ?? 'https://devnet-router.magicblock.app/';
const PATH_MODE = process.env.REACTOR_M4_PATH ?? 'both';
const TRIALS_PER_WINDOW = Number(process.env.REACTOR_M4_TRIALS_PER_WINDOW ?? 1);
const SUBSCRIPTION_WARM_MS = Number(process.env.REACTOR_M4_SUBSCRIPTION_WARM_MS ?? 300);
const OBSERVATION_TIMEOUT_MS = Number(process.env.REACTOR_M4_OBSERVATION_TIMEOUT_MS ?? 3000);
const CONFIRM_POLL_MS = Number(process.env.REACTOR_M4_CONFIRM_POLL_MS ?? 100);
const CONFIRM_ATTEMPTS = Number(process.env.REACTOR_M4_CONFIRM_ATTEMPTS ?? 200);
const WINDOW_MS = (process.env.REACTOR_M4_WINDOWS_MS ?? '50,100,150,250,500,1000')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
const OUTPUT_PATH = process.env.REACTOR_M4_RESULT_PATH ?? 'experiment/results/m4-capture-latest.json';

function assert(condition, message) { if (!condition) throw new Error(message); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function derive(programId, seeds) { return PublicKey.findProgramAddressSync(seeds, programId)[0]; }
function readU64(buffer, offset) { return Number(Buffer.from(buffer).readBigUInt64LE(offset)); }

function decodeConditionFast(data) {
  const buffer = Buffer.from(data);
  if (buffer.length < 107) throw new Error(`condition account too short: ${buffer.length}`);
  return {
    kind: buffer[72],
    sequence: readU64(buffer, 73),
    predicateResult: buffer[89] !== 0,
  };
}

function decodeExecutionLockFast(data) {
  const buffer = Buffer.from(data);
  if (buffer.length < 282) throw new Error(`execution lock too short: ${buffer.length}`);
  const sequences = Array.from({ length: CONDITION_COUNT }, (_, index) => readU64(buffer, 104 + (index * 8)));
  return { sequences };
}

function decodeSessionCandidateFast(data) {
  const buffer = Buffer.from(data);
  if (buffer.length < 554) throw new Error(`session candidate too short: ${buffer.length}`);
  const frozenSequences = Array.from({ length: CONDITION_COUNT }, (_, index) => readU64(buffer, 400 + (index * 8)));
  return {
    frozenSequences,
    ready: buffer[552] !== 0,
  };
}

async function setupSend(builder, signers = []) {
  const signed = signers.length > 0 ? builder.signers(signers) : builder;
  const signature = await signed.rpc({ commitment: 'confirmed' });
  if (SETUP_PACE_MS > 0) await sleep(SETUP_PACE_MS);
  return signature;
}

async function getDelegationStatus(pubkey) {
  const response = await fetch(ROUTER_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getDelegationStatus', params: [pubkey.toBase58()] }),
  });
  if (!response.ok) throw new Error(`router HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`router error: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

async function waitForHealthyDelegation(baseConnection, pubkey, programId, expectedValidator = null, attempts = 180) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const status = await getDelegationStatus(pubkey);
      if (!status?.isDelegated || !status.fqdn || !status.delegationRecord) { await sleep(250); continue; }
      const validator = status.delegationRecord.authority;
      if (status.delegationRecord.owner !== programId.toBase58()) throw new Error(`router original owner mismatch for ${pubkey}`);
      if (expectedValidator && validator !== expectedValidator) throw new Error(`validator mismatch ${validator} != ${expectedValidator}`);
      const erConnection = new Connection(status.fqdn, 'confirmed');
      const [baseInfo, erInfo] = await Promise.all([
        baseConnection.getAccountInfo(pubkey, 'confirmed'),
        erConnection.getAccountInfo(pubkey, 'confirmed'),
      ]);
      if (baseInfo?.owner.equals(DELEGATION_PROGRAM_ID) && erInfo?.owner.equals(programId)) return { status, erConnection };
    } catch (error) {
      if (String(error).includes('mismatch')) throw error;
    }
    await sleep(250);
  }
  throw new Error(`delegation did not become healthy: ${pubkey}`);
}

async function fundFixture(baseProvider, providerPayer, authority) {
  await baseProvider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({
    fromPubkey: providerPayer,
    toPubkey: authority,
    lamports: FIXTURE_BUDGET_LAMPORTS,
  })), []);
  if (SETUP_PACE_MS > 0) await sleep(SETUP_PACE_MS);
}

async function prepareRaw(builder, connection, wallet, extraSigners = []) {
  const transaction = await builder.transaction();
  const latest = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = wallet.publicKey;
  if (extraSigners.length > 0) transaction.partialSign(...extraSigners);
  const signed = await wallet.signTransaction(transaction);
  return {
    bytes: signed.serialize(),
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
}

async function sendRaw(connection, prepared) {
  return connection.sendRawTransaction(prepared.bytes, { skipPreflight: true, maxRetries: 0 });
}

async function waitForConfirmed(connection, signature, attempts = CONFIRM_ATTEMPTS) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = response.value[0];
    if (status) {
      if (status.err != null) throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return status;
    }
    await sleep(CONFIRM_POLL_MS);
  }
  throw new Error(`transaction ${signature} not observed confirmed`);
}

async function readConditionVector(program, conditionPdas, commitment = 'processed') {
  const states = await program.account.conditionState.fetchMultiple(conditionPdas, commitment);
  return states.map((state, index) => state ? {
    kind: index,
    sequence: Number(state.sequence),
    predicateResult: state.predicateResult,
    observedSlot: Number(state.observedSlot),
    validUntilSlot: Number(state.validUntilSlot),
  } : { kind: index, missing: true });
}

function deferredWithTimeout(label, timeoutMs) {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  return {
    promise,
    resolve: (value) => { clearTimeout(timer); resolve(value); },
    reject: (error) => { clearTimeout(timer); reject(error); },
  };
}

async function createFixture({ baseProgram, baseProvider, baseConnection, providerPayer, mode, scenarioSeed }) {
  const programId = baseProgram.programId;
  const authorityKeypair = Keypair.generate();
  const authority = authorityKeypair.publicKey;
  const recipient = Keypair.generate().publicKey;
  const sources = Array.from({ length: CONDITION_COUNT }, () => Keypair.generate());
  const objectiveSeed = crypto.createHash('sha256').update(`reactor-m4-ws:${scenarioSeed}:${mode}:${crypto.randomBytes(8).toString('hex')}`).digest();
  const pathPda = derive(programId, [Buffer.from('path'), authority.toBuffer()]);
  const objectivePda = derive(programId, [Buffer.from('objective'), authority.toBuffer(), objectiveSeed]);
  const vaultPda = derive(programId, [Buffer.from('vault'), objectivePda.toBuffer()]);
  const conditionPdas = Array.from({ length: CONDITION_COUNT }, (_, kind) => derive(programId, [Buffer.from('condition'), objectivePda.toBuffer(), Buffer.from([kind])]));
  const candidatePda = derive(programId, [Buffer.from('session_candidate'), objectivePda.toBuffer()]);
  const lockPda = derive(programId, [Buffer.from('lock'), objectivePda.toBuffer()]);

  await fundFixture(baseProvider, providerPayer, authority);
  const startSlot = await baseConnection.getSlot('confirmed');
  const pathExpiry = new anchor.BN(startSlot + 10_000);
  await setupSend(baseProgram.methods.initializePath(new anchor.BN(1_000_000), pathExpiry).accounts({ path: pathPda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  await setupSend(baseProgram.methods.createObjective([...objectiveSeed], new anchor.BN(TARGET_EXPOSURE), new anchor.BN(1), conditionPdas).accounts({ objective: objectivePda, path: pathPda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  await setupSend(baseProgram.methods.initializeVault(new anchor.BN(INITIAL_EXPOSURE)).accounts({ vault: vaultPda, objective: objectivePda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
    await setupSend(baseProgram.methods.initializeCondition(kind, sources[kind].publicKey).accounts({ condition: conditionPdas[kind], objective: objectivePda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  }

  let activeConnection = baseConnection;
  let activeProgram = baseProgram;
  let validator = null;
  let erEndpoint = null;
  if (mode === 'magicblock') {
    await setupSend(baseProgram.methods.initializeSessionCandidate(recipient, new anchor.BN(TRANSFER_LAMPORTS), new anchor.BN(EXPOSURE_REDUCTION)).accounts({ sessionCandidate: candidatePda, objective: objectivePda, path: pathPda, authority, vault: vaultPda, systemProgram: SystemProgram.programId }), [authorityKeypair]);
    await setupSend(baseProgram.methods.delegateSessionCandidate().accounts({ payer: authority, objective: objectivePda, sessionCandidate: candidatePda }), [authorityKeypair]);
    const candidateShape = await waitForHealthyDelegation(baseConnection, candidatePda, programId);
    validator = candidateShape.status.delegationRecord.authority;
    erEndpoint = candidateShape.status.fqdn;
    activeConnection = candidateShape.erConnection;
    const erProvider = new anchor.AnchorProvider(activeConnection, baseProvider.wallet, { commitment: 'confirmed', preflightCommitment: 'confirmed' });
    activeProgram = new anchor.Program(baseProgram.idl, erProvider);
    const validatorRemaining = [{ pubkey: new PublicKey(validator), isSigner: false, isWritable: false }];
    for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
      await setupSend(baseProgram.methods.delegateCondition(kind).accounts({ payer: authority, objective: objectivePda, condition: conditionPdas[kind] }).remainingAccounts(validatorRemaining), [authorityKeypair]);
      const shape = await waitForHealthyDelegation(baseConnection, conditionPdas[kind], programId, validator);
      assert(shape.status.fqdn === erEndpoint, `condition ${kind} routed to different ER`);
    }
  }

  const validityAnchorSlot = await activeConnection.getSlot('confirmed');
  const validityUntilSlot = validityAnchorSlot + CONDITION_TTL_SLOTS;
  const updateBuilder = (kind, sequence, predicateResult) => activeProgram.methods.updateCondition(
    new anchor.BN(sequence), new anchor.BN(100 + kind), predicateResult, new anchor.BN(validityUntilSlot),
  ).accounts({ condition: conditionPdas[kind], source: sources[kind].publicKey });
  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) await setupSend(updateBuilder(kind, 1, kind !== 2), [sources[kind]]);

  const decisionBuilder = mode === 'magicblock'
    ? activeProgram.methods.evaluateSessionCandidate(EXPECTED_SEQUENCES.map((n) => new anchor.BN(n))).accounts({
        sessionCandidate: candidatePda,
        condition0: conditionPdas[0], condition1: conditionPdas[1], condition2: conditionPdas[2],
        condition3: conditionPdas[3], condition4: conditionPdas[4], condition5: conditionPdas[5],
      })
    : activeProgram.methods.evaluateAndLock(
        EXPECTED_SEQUENCES.map((n) => new anchor.BN(n)), new anchor.BN(TRANSFER_LAMPORTS), new anchor.BN(EXPOSURE_REDUCTION),
      ).accounts({
        payer: authority, path: pathPda, objective: objectivePda, vault: vaultPda, recipient,
        condition0: conditionPdas[0], condition1: conditionPdas[1], condition2: conditionPdas[2],
        condition3: conditionPdas[3], condition4: conditionPdas[4], condition5: conditionPdas[5],
        executionLock: lockPda, systemProgram: SystemProgram.programId,
      });

  const [openPrepared, closePrepared, decisionPrepared] = await Promise.all([
    prepareRaw(updateBuilder(2, 2, true), activeConnection, baseProvider.wallet, [sources[2]]),
    prepareRaw(updateBuilder(0, 2, false), activeConnection, baseProvider.wallet, [sources[0]]),
    prepareRaw(decisionBuilder, activeConnection, baseProvider.wallet, mode === 'solana' ? [authorityKeypair] : []),
  ]);

  return {
    authority, conditionPdas, candidatePda, lockPda,
    activeConnection, activeProgram, validator, erEndpoint,
    openPrepared, closePrepared, decisionPrepared,
  };
}

async function runTrial({ mode, windowMs, trialIndex, baseProgram, baseProvider, baseConnection, providerPayer }) {
  const seed = `window-${windowMs}-trial-${trialIndex}`;
  const fixture = await createFixture({ baseProgram, baseProvider, baseConnection, providerPayer, mode, scenarioSeed: seed });
  const telemetry = new TrialTelemetry({
    scenarioId: `m4-ws-${mode}-${seed}`,
    path: mode,
    cluster: 'solana-devnet',
    windowMs,
    seed,
    expectedSequences: EXPECTED_SEQUENCES,
  });
  telemetry.config({
    programId: baseProgram.programId.toBase58(),
    baseRpc: BASE_RPC,
    routerRpc: ROUTER_RPC,
    erEndpoint: fixture.erEndpoint,
    validator: fixture.validator,
    setupExcludedFromTiming: true,
    constructionExcludedFromTiming: true,
    blockhashLookupExcludedFromTiming: true,
    signingExcludedFromTiming: true,
    subscriptionWarmupExcludedFromTiming: true,
    sourceAuthorityModel: 'independent-source-signed-transactions',
    captureObservation: 'warmed-account-subscriptions-at-processed',
    durabilityRequirement: 'open-decision-close-signatures-confirmed-after-capture',
  });

  let openSignature = null;
  let closeSignature = null;
  let decisionSignature = null;
  let decisionError = null;
  let diagnosticVector = null;
  let exactVersionMatch = false;
  let captureStateObserved = false;

  const openingObserved = deferredWithTimeout('opening condition subscription', OBSERVATION_TIMEOUT_MS);
  const captureObserved = deferredWithTimeout('capture account subscription', OBSERVATION_TIMEOUT_MS);
  let openingResolved = false;
  let captureResolved = false;

  const openingSubscription = await fixture.activeConnection.onAccountChange(
    fixture.conditionPdas[2],
    (accountInfo, context) => {
      if (openingResolved) return;
      try {
        const state = decodeConditionFast(accountInfo.data);
        if (state.sequence === 2 && state.predicateResult === true) {
          openingResolved = true;
          telemetry.mark('condition_observed', { slot: context.slot, sequence: state.sequence, evidence: 'account-subscription' });
          openingObserved.resolve({ state, slot: context.slot });
        }
      } catch (error) {
        openingObserved.reject(error);
      }
    },
    'processed',
  );

  const capturePubkey = mode === 'magicblock' ? fixture.candidatePda : fixture.lockPda;
  const captureSubscription = await fixture.activeConnection.onAccountChange(
    capturePubkey,
    (accountInfo, context) => {
      if (captureResolved) return;
      try {
        const state = mode === 'magicblock'
          ? decodeSessionCandidateFast(accountInfo.data)
          : decodeExecutionLockFast(accountInfo.data);
        const sequences = mode === 'magicblock' ? state.frozenSequences : state.sequences;
        const exists = mode === 'magicblock' ? state.ready === true : true;
        if (exists) {
          captureResolved = true;
          captureStateObserved = true;
          exactVersionMatch = sequences.join(',') === EXPECTED_SEQUENCES.join(',');
          telemetry.mark('capture_observed', {
            slot: context.slot,
            sequences,
            exactVersionMatch,
            evidence: 'account-subscription',
          });
          captureObserved.resolve({ state, sequences, slot: context.slot });
        }
      } catch (error) {
        captureObserved.reject(error);
      }
    },
    'processed',
  );

  // Give both subscriptions time to become active before T0. This is session warm-up,
  // analogous to keeping market/event subscriptions alive in the product.
  await sleep(SUBSCRIPTION_WARM_MS);

  telemetry.mark('window_open_emitted', { source: 'condition-2', sequence: 2, predicateResult: true });
  const closePromise = new Promise((resolve) => {
    setTimeout(async () => {
      telemetry.mark('window_close_emitted', { source: 'condition-0', sequence: 2, predicateResult: false });
      try {
        closeSignature = await sendRaw(fixture.activeConnection, fixture.closePrepared);
        telemetry.signature('windowCloseUpdate', closeSignature);
        telemetry.mark('window_close_submitted');
        resolve({ ok: true, signature: closeSignature });
      } catch (error) {
        telemetry.mark('window_close_failed', { error: String(error?.message ?? error) });
        resolve({ ok: false, error: String(error?.message ?? error) });
      }
    }, windowMs);
  });

  try {
    openSignature = await sendRaw(fixture.activeConnection, fixture.openPrepared);
    telemetry.signature('windowOpenUpdate', openSignature);
    telemetry.mark('window_open_submitted');

    await openingObserved.promise;
    telemetry.mark('decision_submitted');
    decisionSignature = await sendRaw(fixture.activeConnection, fixture.decisionPrepared);
    telemetry.signature('decision', decisionSignature);

    await captureObserved.promise;
  } catch (error) {
    decisionError = String(error?.message ?? error);
    telemetry.mark('decision_failed', { error: decisionError });
  }

  const closeResult = await closePromise;
  try {
    diagnosticVector = await readConditionVector(fixture.activeProgram, fixture.conditionPdas, 'processed');
  } catch (error) {
    diagnosticVector = [{ diagnosticError: String(error?.message ?? error) }];
  }

  const captureMs = telemetry.deltaMs('window_open_emitted', 'capture_observed');
  const withinWindow = captureMs != null && captureMs <= windowMs;

  let openConfirmed = false;
  let decisionConfirmed = false;
  let closeConfirmed = false;
  try { if (openSignature) { await waitForConfirmed(fixture.activeConnection, openSignature); openConfirmed = true; telemetry.mark('window_open_confirmed'); } } catch (error) { telemetry.mark('window_open_confirmation_failed', { error: String(error?.message ?? error) }); if (!decisionError) decisionError = String(error?.message ?? error); }
  try { if (decisionSignature) { await waitForConfirmed(fixture.activeConnection, decisionSignature); decisionConfirmed = true; telemetry.mark('decision_confirmed'); } } catch (error) { telemetry.mark('decision_confirmation_failed', { error: String(error?.message ?? error) }); if (!decisionError) decisionError = String(error?.message ?? error); }
  try { if (closeSignature) { await waitForConfirmed(fixture.activeConnection, closeSignature); closeConfirmed = true; telemetry.mark('window_close_confirmed'); } } catch (error) { telemetry.mark('window_close_confirmation_failed', { error: String(error?.message ?? error) }); }

  await Promise.allSettled([
    fixture.activeConnection.removeAccountChangeListener(openingSubscription),
    fixture.activeConnection.removeAccountChangeListener(captureSubscription),
  ]);

  const durableCapture = captureStateObserved && exactVersionMatch && withinWindow && openConfirmed && decisionConfirmed && closeConfirmed;
  const ambiguous = Boolean(
    (openSignature && !openConfirmed) ||
    (decisionSignature && !decisionConfirmed) ||
    (closeResult.ok && !closeConfirmed),
  );

  telemetry.set({
    capture: durableCapture,
    captureStateObserved,
    exactVersionMatch,
    staleAttempt: captureStateObserved && exactVersionMatch && !withinWindow,
    falseLock: captureStateObserved && !exactVersionMatch,
    ambiguous,
    openConfirmed,
    decisionConfirmed,
    closeConfirmed,
    failure: decisionError,
    diagnosticConditionVector: diagnosticVector,
  });
  return telemetry.finish();
}

function summarizeByBand(trials) {
  const output = {};
  for (const path of [...new Set(trials.map((trial) => trial.path))]) {
    output[path] = {};
    const bands = [...new Set(trials.filter((trial) => trial.path === path).map((trial) => trial.windowMs))].sort((a, b) => a - b);
    for (const band of bands) output[path][band] = summarizeTrials(trials.filter((trial) => trial.path === path && trial.windowMs === band));
  }
  return output;
}

const idlPath = process.env.REACTOR_IDL ?? 'target/idl/reactor.json';
if (!fs.existsSync(idlPath)) throw new Error(`missing ${idlPath}; run anchor build first`);
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
const envProvider = anchor.AnchorProvider.env();
const wallet = envProvider.wallet;
const baseConnection = new Connection(BASE_RPC, 'confirmed');
const baseProvider = new anchor.AnchorProvider(baseConnection, wallet, { commitment: 'confirmed', preflightCommitment: 'confirmed' });
const baseProgram = new anchor.Program(idl, baseProvider);
const providerPayer = wallet.publicKey;
const balance = await baseConnection.getBalance(providerPayer, 'confirmed');
assert(balance >= FIXTURE_BUDGET_LAMPORTS, `payer ${providerPayer} lacks devnet SOL for M4 fixtures`);
const modes = PATH_MODE === 'both' ? ['solana', 'magicblock'] : [PATH_MODE];
for (const mode of modes) assert(mode === 'solana' || mode === 'magicblock', `unsupported REACTOR_M4_PATH=${mode}`);

console.log('M4a SUBSCRIPTION capture benchmark');
console.log(`program: ${baseProgram.programId}`);
console.log(`base rpc: ${BASE_RPC}`);
console.log(`paths: ${modes.join(', ')}`);
console.log(`windows: ${WINDOW_MS.join(', ')} ms`);
console.log(`trials/window/path: ${TRIALS_PER_WINDOW}`);
console.log('build/deploy/setup/delegation/construction/blockhash/signing/subscription warm-up are excluded from T0→capture');
console.log('measured path: send signed open → account subscription observes seq2=true → send signed decision → capture-account subscription observes exact lock/candidate');
console.log('confirmation/status polling occurs only after capture and cannot inflate capture latency');

const trials = [];
for (const windowMs of WINDOW_MS) {
  for (let trialIndex = 0; trialIndex < TRIALS_PER_WINDOW; trialIndex += 1) {
    for (const mode of modes) {
      console.log(`\nsetup ${mode} window=${windowMs}ms trial=${trialIndex + 1}`);
      const trial = await runTrial({ mode, windowMs, trialIndex, baseProgram, baseProvider, baseConnection, providerPayer });
      trials.push(trial);
      const failure = trial.failure ? ` failure=${trial.failure}` : '';
      const vector = trial.diagnosticConditionVector?.map((item) => item.sequence ?? '?').join(',') ?? 'n/a';
      console.log(`${mode} window=${windowMs}ms capture=${trial.capture} exact=${trial.exactVersionMatch} stale=${trial.staleAttempt} falseLock=${trial.falseLock} ambiguous=${trial.ambiguous} latency=${trial.latency.captureMs?.toFixed(2) ?? 'n/a'}ms vector=[${vector}]${failure}`);
    }
  }
}

const output = {
  benchmark: 'reactor-m4a-subscription-capture',
  scope: 'prebuilt-warmed-subscription-hot-path-capture-mechanics-not-production-performance',
  generatedAt: new Date().toISOString(),
  configuration: {
    baseRpc: BASE_RPC,
    routerRpc: ROUTER_RPC,
    windowsMs: WINDOW_MS,
    trialsPerWindowPerPath: TRIALS_PER_WINDOW,
    fixtureBudgetLamports: FIXTURE_BUDGET_LAMPORTS,
    setupPaceMs: SETUP_PACE_MS,
    conditionTtlSlots: CONDITION_TTL_SLOTS,
    prebuiltTransactions: true,
    skipPreflight: true,
    subscriptionWarmMs: SUBSCRIPTION_WARM_MS,
    captureObservation: 'account-subscription-processed',
  },
  summary: summarizeByBand(trials),
  trials,
};
fs.mkdirSync('experiment/results', { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
console.log(`\nM4a evidence written: ${OUTPUT_PATH}`);
console.log(JSON.stringify(output.summary, null, 2));
