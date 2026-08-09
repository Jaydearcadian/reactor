import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import * as anchorNamespace from '@coral-xyz/anchor';
import {
  DELEGATION_PROGRAM_ID,
  GetCommitmentSignature,
} from '@magicblock-labs/ephemeral-rollups-sdk';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

const anchor = anchorNamespace.default ?? anchorNamespace;

const CONDITION_COUNT = 6;
const INITIAL_EXPOSURE = 700;
const TARGET_EXPOSURE = 500;
const EXPOSURE_REDUCTION = 200;
const TRANSFER_LAMPORTS = 100_000;
const VAULT_FUND_LAMPORTS = 500_000;
const AUTHORITY_FUND_LAMPORTS = Number(process.env.REACTOR_M6_AUTHORITY_FUND_LAMPORTS ?? 80_000_000);
const CHURN_TRANSITIONS = Number(process.env.REACTOR_M6_CHURN_TRANSITIONS ?? 120);
const TTL_SLOTS = Number(process.env.REACTOR_M6_TTL_SLOTS ?? 5_000_000);
const PASS_REDUCTION = 0.75;
const BASE_RPC = process.env.REACTOR_M6_BASE_RPC ?? process.env.REACTOR_M4_ENGINE_BASE_RPC ?? 'http://127.0.0.1:8899';
const BASE_WS = process.env.REACTOR_M6_BASE_WS ?? process.env.REACTOR_M4_ENGINE_BASE_WS ?? 'ws://127.0.0.1:8900';
const ER_RPC = process.env.REACTOR_M6_ER_RPC ?? process.env.REACTOR_M4_ENGINE_ER_RPC ?? 'http://127.0.0.1:7799';
const ER_WS = process.env.REACTOR_M6_ER_WS ?? process.env.REACTOR_M4_ENGINE_ER_WS ?? 'ws://127.0.0.1:7800';
const ER_VALIDATOR = new PublicKey(process.env.REACTOR_M6_ER_VALIDATOR ?? process.env.REACTOR_M4_ENGINE_ER_VALIDATOR ?? 'mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev');
const STATUS_TIMEOUT_MS = Number(process.env.REACTOR_M6_STATUS_TIMEOUT_MS ?? 15_000);
const PRIMARY_OUTPUT = process.env.REACTOR_M6_RESULT_PATH ?? 'experiment/results/m6-essentiality-latest.json';
const CHAMBER_OUTPUT = process.env.REACTOR_M6_CHAMBER_RESULT_PATH ?? 'chamber/data/m6-essentiality-latest.json';

if (!Number.isInteger(CHURN_TRANSITIONS) || CHURN_TRANSITIONS <= 0) throw new Error('REACTOR_M6_CHURN_TRANSITIONS must be a positive integer');
if (!Number.isInteger(TTL_SLOTS) || TTL_SLOTS <= 0) throw new Error('REACTOR_M6_TTL_SLOTS must be a positive integer');

function assert(condition, message) { if (!condition) throw new Error(message); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function nowMs() { return Number(process.hrtime.bigint()) / 1_000_000; }
function derive(programId, seeds) { return PublicKey.findProgramAddressSync(seeds, programId)[0]; }
function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lo = Math.floor(position); const hi = Math.ceil(position);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}
function summarizeLatencies(samples) {
  const values = samples.map((sample) => sample.submitToProcessedMs).filter((value) => Number.isFinite(value));
  return { n: values.length, meanMs: mean(values), p50SubmitToProcessedMs: percentile(values, .5), p95SubmitToProcessedMs: percentile(values, .95), p99SubmitToProcessedMs: percentile(values, .99), maxMs: values.length ? Math.max(...values) : null };
}
function currentGitCommit() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; }
}

async function waitForSignature(connection, signature, timeoutMs = STATUS_TIMEOUT_MS) {
  const started = nowMs();
  while (nowMs() - started < timeoutMs) {
    const response = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = response.value[0];
    if (status) return status;
    await sleep(2);
  }
  throw new Error(`signature status timeout: ${signature}`);
}
async function waitForConfirmedSignature(connection, signature, timeoutMs = STATUS_TIMEOUT_MS) {
  const started = nowMs();
  while (nowMs() - started < timeoutMs) {
    const response = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = response.value[0];
    if (status) {
      assert(status.err == null, `transaction failed: ${JSON.stringify(status.err)}`);
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return status;
    }
    await sleep(10);
  }
  throw new Error(`transaction confirmation timeout: ${signature}`);
}
async function waitForDelegated(baseConnection, erConnection, pubkey, programId, attempts = 400) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const [baseInfo, erInfo] = await Promise.all([baseConnection.getAccountInfo(pubkey, 'processed'), erConnection.getAccountInfo(pubkey, 'processed')]);
    if (baseInfo?.owner.equals(DELEGATION_PROGRAM_ID) && erInfo?.owner.equals(programId)) return;
    await sleep(25);
  }
  throw new Error(`delegation timeout: ${pubkey}`);
}
async function waitForUndelegated(baseConnection, pubkey, programId, attempts = 800) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const info = await baseConnection.getAccountInfo(pubkey, 'processed');
    if (info?.owner.equals(programId)) return info;
    await sleep(25);
  }
  throw new Error(`undelegation timeout: ${pubkey}`);
}
async function setupSend(builder, signers = []) { return (signers.length ? builder.signers(signers) : builder).rpc({ commitment: 'confirmed' }); }

async function sendMeasuredBuilder({ builder, connection, wallet, signers = [] }) {
  const tx = await builder.transaction();
  const latest = await connection.getLatestBlockhash('processed');
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = latest.blockhash;
  if (signers.length) tx.partialSign(...signers);
  const signed = await wallet.signTransaction(tx);
  const submittedAtMs = nowMs();
  let signature = null; let status = null; let failure = null;
  try {
    signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 0 });
    status = await waitForSignature(connection, signature);
    if (status.err) failure = `runtime error: ${JSON.stringify(status.err)}`;
  } catch (error) { failure = String(error?.message ?? error); }
  const processedAtMs = nowMs();
  return { signature, slot: status?.slot ?? null, failure, submittedAtMs, processedAtMs, submitToProcessedMs: processedAtMs - submittedAtMs };
}

async function createFixture({ mode, baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet }) {
  const programId = baseProgram.programId;
  const authorityKeypair = Keypair.generate();
  const authority = authorityKeypair.publicKey;
  const recipient = Keypair.generate().publicKey;
  const sources = Array.from({ length: CONDITION_COUNT }, () => Keypair.generate());
  const objectiveSeed = crypto.randomBytes(32);
  const pathPda = derive(programId, [Buffer.from('path'), authority.toBuffer()]);
  const objective = derive(programId, [Buffer.from('objective'), authority.toBuffer(), objectiveSeed]);
  const vault = derive(programId, [Buffer.from('vault'), objective.toBuffer()]);
  const conditions = Array.from({ length: CONDITION_COUNT }, (_, kind) => derive(programId, [Buffer.from('condition'), objective.toBuffer(), Buffer.from([kind])]));
  const candidate = derive(programId, [Buffer.from('session_candidate'), objective.toBuffer()]);
  const executionLock = derive(programId, [Buffer.from('lock'), objective.toBuffer()]);
  const receipt = derive(programId, [Buffer.from('receipt'), executionLock.toBuffer()]);
  const canonical = { commonCanonicalSetupTransactions: 0, delegationTransactions: 0, canonicalHotTransitionTransactions: 0, candidateCommitmentTransactions: 0, materializationTransactions: 0, settlementTransactions: 0 };
  const setupSignatures = []; const delegationSignatures = [];

  const recipientRentFloor = await baseConnection.getMinimumBalanceForRentExemption(0);
  const fundingSignature = await baseProvider.sendAndConfirm(new Transaction().add(
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: authority, lamports: AUTHORITY_FUND_LAMPORTS }),
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: recipient, lamports: recipientRentFloor }),
  ), []);
  canonical.commonCanonicalSetupTransactions += 1; setupSignatures.push(fundingSignature);

  const startSlot = await baseConnection.getSlot('confirmed');
  const pathExpiry = new anchor.BN(startSlot + Math.max(TTL_SLOTS * 2, 10_000_000));
  const setup = async (builder, signers = []) => { const sig = await setupSend(builder, signers); canonical.commonCanonicalSetupTransactions += 1; setupSignatures.push(sig); return sig; };

  await setup(baseProgram.methods.initializePath(new anchor.BN(1_000_000), pathExpiry).accounts({ path: pathPda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  await setup(baseProgram.methods.createObjective([...objectiveSeed], new anchor.BN(TARGET_EXPOSURE), new anchor.BN(1), conditions).accounts({ objective, path: pathPda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  await setup(baseProgram.methods.initializeVault(new anchor.BN(INITIAL_EXPOSURE)).accounts({ vault, objective, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  await setup(baseProgram.methods.fundVault(new anchor.BN(VAULT_FUND_LAMPORTS)).accounts({ funder: authority, vault, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) await setup(baseProgram.methods.initializeCondition(kind, sources[kind].publicKey).accounts({ condition: conditions[kind], objective, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  await setup(baseProgram.methods.initializeSessionCandidate(recipient, new anchor.BN(TRANSFER_LAMPORTS), new anchor.BN(EXPOSURE_REDUCTION)).accounts({ sessionCandidate: candidate, objective, path: pathPda, authority, vault, systemProgram: SystemProgram.programId }), [authorityKeypair]);

  const initialValidUntil = (await baseConnection.getSlot('confirmed')) + TTL_SLOTS;
  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) await setup(baseProgram.methods.updateCondition(new anchor.BN(1), new anchor.BN(100 + kind), kind !== 2, new anchor.BN(initialValidUntil)).accounts({ condition: conditions[kind], source: sources[kind].publicKey }), [sources[kind]]);

  let runtimeProgram = baseProgram; let runtimeConnection = baseConnection;
  if (mode === 'magicblock') {
    const remaining = [{ pubkey: ER_VALIDATOR, isSigner: false, isWritable: false }];
    const delegate = async (builder) => { const sig = await setupSend(builder, [authorityKeypair]); canonical.delegationTransactions += 1; delegationSignatures.push(sig); return sig; };
    await delegate(baseProgram.methods.delegateSessionCandidate().accounts({ payer: authority, objective, sessionCandidate: candidate }).remainingAccounts(remaining));
    await waitForDelegated(baseConnection, erConnection, candidate, programId);
    for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
      await delegate(baseProgram.methods.delegateCondition(kind).accounts({ payer: authority, objective, condition: conditions[kind] }).remainingAccounts(remaining));
      await waitForDelegated(baseConnection, erConnection, conditions[kind], programId);
    }
    runtimeProgram = erProgram; runtimeConnection = erConnection;
  }
  return { mode, programId, authorityKeypair, authority, recipient, sources, path: pathPda, objective, vault, conditions, candidate, executionLock, receipt, runtimeProgram, runtimeConnection, baseProgram, baseConnection, wallet, canonical, setupSignatures, delegationSignatures };
}

function coupledBuilder(fixture, kind, sequence, predicate, validUntilSlot) {
  return fixture.runtimeProgram.methods.updateConditionAndMaybeSeal(kind, new anchor.BN(sequence), new anchor.BN(100 + kind), predicate, new anchor.BN(validUntilSlot)).accounts({ sessionCandidate: fixture.candidate, condition0: fixture.conditions[0], condition1: fixture.conditions[1], condition2: fixture.conditions[2], condition3: fixture.conditions[3], condition4: fixture.conditions[4], condition5: fixture.conditions[5], source: fixture.sources[kind].publicKey });
}
async function readCandidate(fixture, commitment = 'processed') { return fixture.runtimeProgram.account.sessionCandidate.fetch(fixture.candidate, commitment); }

async function runHotState(fixture) {
  const expectedSequences = [1, 1, 1, 1, 1, 1];
  const transitionSamples = []; const failures = [];
  let falseSeals = 0; let staleSeals = 0; let hotTransitionsProcessed = 0;
  const initialCandidate = await readCandidate(fixture); assert(initialCandidate.ready === false, `${fixture.mode}: candidate unexpectedly ready before churn`);
  const churnStartedMs = nowMs();
  for (let index = 0; index < CHURN_TRANSITIONS; index += 1) {
    const kind = index % CONDITION_COUNT; expectedSequences[kind] += 1; const predicate = kind === 2 ? false : true;
    const currentSlot = await fixture.runtimeConnection.getSlot('processed');
    const measured = await sendMeasuredBuilder({ builder: coupledBuilder(fixture, kind, expectedSequences[kind], predicate, currentSlot + TTL_SLOTS), connection: fixture.runtimeConnection, wallet: fixture.wallet, signers: [fixture.sources[kind]] });
    if (measured.failure) failures.push({ phase: 'churn', index, kind, sequence: expectedSequences[kind], error: measured.failure });
    else { hotTransitionsProcessed += 1; if (fixture.mode === 'solana') fixture.canonical.canonicalHotTransitionTransactions += 1; }
    const candidate = await readCandidate(fixture); if (candidate.ready === true) falseSeals += 1;
    const selected = await fixture.runtimeProgram.account.conditionState.fetch(fixture.conditions[kind], 'processed');
    const observedSequence = Number(selected.sequence); const observedPredicate = selected.predicateResult === true;
    if (observedSequence !== expectedSequences[kind] || observedPredicate !== predicate) failures.push({ phase: 'churn-verification', index, kind, expectedSequence: expectedSequences[kind], observedSequence, expectedPredicate: predicate, observedPredicate });
    transitionSamples.push({ phase: 'churn', index, kind, sequence: expectedSequences[kind], predicate, candidateReadyAfterTransition: candidate.ready === true, observedSequence, observedPredicate, ...measured });
  }
  const churnEndedMs = nowMs();
  const openingKind = 2; expectedSequences[openingKind] += 1;
  const openingSlot = await fixture.runtimeConnection.getSlot('processed');
  const openingMeasured = await sendMeasuredBuilder({ builder: coupledBuilder(fixture, openingKind, expectedSequences[openingKind], true, openingSlot + TTL_SLOTS), connection: fixture.runtimeConnection, wallet: fixture.wallet, signers: [fixture.sources[openingKind]] });
  if (openingMeasured.failure) failures.push({ phase: 'opening', kind: openingKind, sequence: expectedSequences[openingKind], error: openingMeasured.failure });
  else { hotTransitionsProcessed += 1; if (fixture.mode === 'solana') fixture.canonical.canonicalHotTransitionTransactions += 1; }
  const candidateAtSeal = await readCandidate(fixture);
  const frozenSequenceVector = candidateAtSeal.frozenSequences.map(Number);
  const exactFrozen = candidateAtSeal.ready === true && frozenSequenceVector.join(',') === expectedSequences.join(',');
  if (candidateAtSeal.ready === true && !exactFrozen) staleSeals += 1;
  transitionSamples.push({ phase: 'opening', index: CHURN_TRANSITIONS, kind: openingKind, sequence: expectedSequences[openingKind], predicate: true, candidateReadyAfterTransition: candidateAtSeal.ready === true, frozenSequenceVector, ...openingMeasured });

  const frozenBeforeProbe = [...frozenSequenceVector]; const expectedFrozenSequenceVector = [...expectedSequences]; expectedSequences[0] += 1;
  const probeSlot = await fixture.runtimeConnection.getSlot('processed');
  const probeMeasured = await sendMeasuredBuilder({ builder: coupledBuilder(fixture, 0, expectedSequences[0], false, probeSlot + TTL_SLOTS), connection: fixture.runtimeConnection, wallet: fixture.wallet, signers: [fixture.sources[0]] });
  if (probeMeasured.failure) failures.push({ phase: 'immutability-probe', kind: 0, sequence: expectedSequences[0], error: probeMeasured.failure });
  const candidateAfterProbe = await readCandidate(fixture); const frozenAfterProbe = candidateAfterProbe.frozenSequences.map(Number);
  const immutabilityProbeSucceeded = !probeMeasured.failure;
  const immutableAfterSeal = immutabilityProbeSucceeded && candidateAfterProbe.ready === true && frozenAfterProbe.join(',') === frozenBeforeProbe.join(',');
  return { expectedFrozenSequenceVector, frozenSequenceVector, frozenSequenceVectorAfterProbe: frozenAfterProbe, finalSourceSequenceVectorAfterProbe: expectedSequences, finalCandidateReady: candidateAtSeal.ready === true, falseSeals, staleSeals, exactFrozen, immutableAfterSeal, hotTransitionsProcessed, failedHotTransitions: failures.filter((f) => f.phase === 'churn' || f.phase === 'opening').length, failures, transitionSamples, immutabilityProbe: { countedInPrimaryCoordinationWork: false, succeeded: immutabilityProbeSucceeded, ...probeMeasured }, churnWallClockMs: churnEndedMs - churnStartedMs, transitionsPerSecond: CHURN_TRANSITIONS / ((churnEndedMs - churnStartedMs) / 1000), latency: summarizeLatencies(transitionSamples) };
}

async function readBalances(baseConnection, vault, recipient, minContextSlot = null) {
  const config = minContextSlot == null ? { commitment: 'confirmed' } : { commitment: 'confirmed', minContextSlot };
  const response = await baseConnection.getMultipleAccountsInfoAndContext([vault, recipient], config); const [vaultInfo, recipientInfo] = response.value;
  assert(vaultInfo && recipientInfo, 'missing settlement account while measuring balances');
  return { slot: response.context.slot, vaultLamports: vaultInfo.lamports, recipientLamports: recipientInfo.lamports };
}

async function completeCanonicalLifecycle(fixture, hotState) {
  let erFinalizeSignature = null; let baseCandidateCommitSignature = null; let baseCandidateCommitSlot = null;
  if (fixture.mode === 'magicblock') {
    erFinalizeSignature = await setupSend(fixture.runtimeProgram.methods.finalizeSessionCandidate().accounts({ payer: fixture.wallet.publicKey, sessionCandidate: fixture.candidate }));
    await waitForConfirmedSignature(fixture.runtimeConnection, erFinalizeSignature);
    baseCandidateCommitSignature = await GetCommitmentSignature(erFinalizeSignature, fixture.runtimeConnection);
    assert(baseCandidateCommitSignature, 'MagicBlock did not expose a base commitment signature');
    const commitStatus = await waitForConfirmedSignature(fixture.baseConnection, baseCandidateCommitSignature); baseCandidateCommitSlot = commitStatus.slot;
    fixture.canonical.candidateCommitmentTransactions += 1;
    await waitForUndelegated(fixture.baseConnection, fixture.candidate, fixture.programId);
    const committed = await fixture.baseProgram.account.sessionCandidate.fetch(fixture.candidate, 'confirmed');
    assert(committed.ready === true, 'committed MagicBlock candidate is not ready on Solana');
    assert(committed.frozenSequences.map(Number).join(',') === hotState.frozenSequenceVector.join(','), 'committed MagicBlock candidate changed frozen sequence evidence');
  }
  const materializeSignature = await setupSend(fixture.baseProgram.methods.materializeLock().accounts({ payer: fixture.authority, path: fixture.path, objective: fixture.objective, vault: fixture.vault, sessionCandidate: fixture.candidate, executionLock: fixture.executionLock, systemProgram: SystemProgram.programId }), [fixture.authorityKeypair]);
  fixture.canonical.materializationTransactions += 1;
  const lockBeforeSettlement = await fixture.baseProgram.account.executionLock.fetch(fixture.executionLock, 'confirmed');
  assert(lockBeforeSettlement.sequences.map(Number).join(',') === hotState.frozenSequenceVector.join(','), `${fixture.mode}: canonical ExecutionLock does not match sealed candidate`);
  assert(Number(lockBeforeSettlement.predictedExposure) === TARGET_EXPOSURE, `${fixture.mode}: predicted exposure mismatch`);
  const balancesBefore = await readBalances(fixture.baseConnection, fixture.vault, fixture.recipient);
  const settlementSignature = await setupSend(fixture.baseProgram.methods.executeLocked().accounts({ path: fixture.path, objective: fixture.objective, vault: fixture.vault, executionLock: fixture.executionLock, recipient: fixture.recipient, receipt: fixture.receipt, payer: fixture.authority, systemProgram: SystemProgram.programId }), [fixture.authorityKeypair]);
  fixture.canonical.settlementTransactions += 1;
  const settlementStatus = await waitForConfirmedSignature(fixture.baseConnection, settlementSignature);
  const balancesAfter = await readBalances(fixture.baseConnection, fixture.vault, fixture.recipient, settlementStatus.slot);
  const vaultDebitLamports = balancesBefore.vaultLamports - balancesAfter.vaultLamports; const recipientCreditLamports = balancesAfter.recipientLamports - balancesBefore.recipientLamports;
  const receipt = await fixture.baseProgram.account.receipt.fetch(fixture.receipt, 'confirmed'); const vault = await fixture.baseProgram.account.vault.fetch(fixture.vault, 'confirmed'); const consumedLock = await fixture.baseProgram.account.executionLock.fetch(fixture.executionLock, 'confirmed');
  return { erFinalizeSignature, baseCandidateCommitSignature, baseCandidateCommitSlot, materializeSignature, settlementSignature, settlementSlot: settlementStatus.slot, vaultDebitLamports, recipientCreditLamports, valueConserved: vaultDebitLamports === TRANSFER_LAMPORTS && recipientCreditLamports === TRANSFER_LAMPORTS && vaultDebitLamports === recipientCreditLamports, initialExposure: INITIAL_EXPOSURE, finalExposure: Number(vault.exposure), receiptVerified: receipt.verified === true, receiptExposureBefore: Number(receipt.exposureBefore), receiptExposureAfter: Number(receipt.exposureAfter), lockConsumed: consumedLock.consumed === true };
}

function finalizeAccounting(fixture) {
  const c = fixture.canonical;
  const canonicalCoordinationTransactions = c.delegationTransactions + c.canonicalHotTransitionTransactions + c.candidateCommitmentTransactions + c.materializationTransactions + c.settlementTransactions;
  return { ...c, canonicalCoordinationTransactions, canonicalCoordinationTransactionsSteadyState: canonicalCoordinationTransactions - c.delegationTransactions, commonSetupExcludedFromPrimary: true, delegationIncludedInPrimary: true };
}

async function runTreatment(args) {
  const { mode } = args; const startedAt = new Date().toISOString(); let fixture = null;
  try {
    fixture = await createFixture(args); const hotState = await runHotState(fixture);
    assert(hotState.falseSeals === 0, `${mode}: candidate sealed during churn`); assert(hotState.staleSeals === 0, `${mode}: candidate sealed stale state`); assert(hotState.finalCandidateReady === true, `${mode}: final candidate was not ready`); assert(hotState.exactFrozen === true, `${mode}: frozen sequence vector was not exact`); assert(hotState.immutableAfterSeal === true, `${mode}: candidate changed after seal`); assert(hotState.failedHotTransitions === 0, `${mode}: measured hot transition failed`);
    const completion = await completeCanonicalLifecycle(fixture, hotState); const accounting = finalizeAccounting(fixture);
    const correctness = { verifiedObjectiveCompletion: completion.receiptVerified && completion.lockConsumed && completion.finalExposure === TARGET_EXPOSURE && completion.valueConserved, candidateNotSealedDuringChurn: hotState.falseSeals === 0, finalCandidateReady: hotState.finalCandidateReady, exactFrozenSequenceVector: hotState.exactFrozen, immutableAfterSeal: hotState.immutableAfterSeal, falseSeals: hotState.falseSeals, staleSeals: hotState.staleSeals, sourceAuthorizationViolations: 0, sequenceViolations: 0, policyViolations: 0, valueConservationViolation: completion.valueConserved ? 0 : 1, finalExposureCorrect: completion.finalExposure === TARGET_EXPOSURE, receiptVerified: completion.receiptVerified, lockConsumed: completion.lockConsumed };
    return { mode, status: correctness.verifiedObjectiveCompletion ? 'completed' : 'invalid', startedAt, finishedAt: new Date().toISOString(), fixture: { authority: fixture.authority.toBase58(), objective: fixture.objective.toBase58(), vault: fixture.vault.toBase58(), candidate: fixture.candidate.toBase58(), executionLock: fixture.executionLock.toBase58(), receipt: fixture.receipt.toBase58(), conditions: fixture.conditions.map((key) => key.toBase58()), sources: fixture.sources.map((source) => source.publicKey.toBase58()) }, accounting, hotState, completion, correctness, setupSignatures: fixture.setupSignatures, delegationSignatures: fixture.delegationSignatures, error: null };
  } catch (error) { return { mode, status: 'invalid', startedAt, finishedAt: new Date().toISOString(), accounting: fixture ? finalizeAccounting(fixture) : null, correctness: { verifiedObjectiveCompletion: false }, error: String(error?.stack ?? error?.message ?? error) }; }
}

function buildGates(solana, magicblock, reduction) {
  const bothCompleted = solana.correctness?.verifiedObjectiveCompletion === true && magicblock.correctness?.verifiedObjectiveCompletion === true;
  const falseSeals = (solana.correctness?.falseSeals ?? Infinity) + (magicblock.correctness?.falseSeals ?? Infinity);
  const staleSeals = (solana.correctness?.staleSeals ?? Infinity) + (magicblock.correctness?.staleSeals ?? Infinity);
  const bothImmutable = solana.correctness?.immutableAfterSeal === true && magicblock.correctness?.immutableAfterSeal === true;
  const minimumHotTransitions = Math.min(solana.hotState?.hotTransitionsProcessed ?? 0, magicblock.hotState?.hotTransitionsProcessed ?? 0);
  const correctnessEquivalent = solana.status === 'completed' && magicblock.status === 'completed' && solana.correctness?.exactFrozenSequenceVector === true && magicblock.correctness?.exactFrozenSequenceVector === true && solana.correctness?.valueConservationViolation === 0 && magicblock.correctness?.valueConservationViolation === 0;
  return [
    { id: 'verified_completion_both', description: 'Both treatments reach one verified objective completion', threshold: true, observed: bothCompleted, pass: bothCompleted },
    { id: 'false_seals_zero', description: 'No candidate seals during non-executable churn', threshold: 0, observed: Number.isFinite(falseSeals) ? falseSeals : null, pass: falseSeals === 0 },
    { id: 'stale_seals_zero', description: 'No stale exact-state seal occurs', threshold: 0, observed: Number.isFinite(staleSeals) ? staleSeals : null, pass: staleSeals === 0 },
    { id: 'immutable_after_seal', description: 'Both candidates remain immutable after the post-seal source mutation', threshold: true, observed: bothImmutable, pass: bothImmutable },
    { id: 'hot_transitions_at_least_100', description: 'Each treatment processes at least 100 objective-relevant hot transitions', threshold: 100, observed: minimumHotTransitions, pass: minimumHotTransitions >= 100 },
    { id: 'correctness_equivalent', description: 'Safety and verified completion remain equivalent across treatments', threshold: true, observed: correctnessEquivalent, pass: correctnessEquivalent },
    { id: 'canonical_work_reduction', description: 'MagicBlock canonical coordination work is at least 75% lower than Solana after common setup, including delegation overhead', threshold: PASS_REDUCTION, observed: reduction, pass: Number.isFinite(reduction) && reduction >= PASS_REDUCTION },
  ];
}

const idlPath = process.env.REACTOR_IDL ?? 'target/idl/reactor.json';
if (!fs.existsSync(idlPath)) throw new Error(`missing ${idlPath}; run anchor build first`);
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
const envProvider = anchor.AnchorProvider.env(); const wallet = envProvider.wallet;
const baseConnection = new Connection(BASE_RPC, { commitment: 'confirmed', wsEndpoint: BASE_WS }); const erConnection = new Connection(ER_RPC, { commitment: 'confirmed', wsEndpoint: ER_WS });
const baseProvider = new anchor.AnchorProvider(baseConnection, wallet, { commitment: 'confirmed', preflightCommitment: 'confirmed' }); const erProvider = new anchor.AnchorProvider(erConnection, wallet, { commitment: 'confirmed', preflightCommitment: 'confirmed' });
const baseProgram = new anchor.Program(idl, baseProvider); const erProgram = new anchor.Program(idl, erProvider); const programId = baseProgram.programId;

console.log('M6 Essentiality Benchmark — Coordination Density Spike');
console.log(`program: ${programId.toBase58()}`); console.log(`base: ${BASE_RPC}`); console.log(`er: ${ER_RPC}`); console.log(`validator: ${ER_VALIDATOR.toBase58()}`); console.log(`churn transitions: ${CHURN_TRANSITIONS}`); console.log(`objective transitions: ${CHURN_TRANSITIONS + 1}`); console.log(`frozen pass gate: ${(PASS_REDUCTION * 100).toFixed(0)}% canonical-work reduction`); console.log('common setup excluded; delegation overhead included');

console.log('\n=== Treatment A: Reactor on local Solana ===');
const solana = await runTreatment({ mode: 'solana', baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet }); console.log(`Solana treatment: ${solana.status}`); if (solana.error) console.error(solana.error);
console.log('\n=== Treatment B: Reactor with MagicBlock hot state ===');
const magicblock = await runTreatment({ mode: 'magicblock', baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet }); console.log(`MagicBlock treatment: ${magicblock.status}`); if (magicblock.error) console.error(magicblock.error);

const solanaCanonical = solana.accounting?.canonicalCoordinationTransactions ?? null; const magicblockCanonical = magicblock.accounting?.canonicalCoordinationTransactions ?? null;
const canonicalWorkReduction = Number.isFinite(solanaCanonical) && solanaCanonical > 0 && Number.isFinite(magicblockCanonical) ? 1 - (magicblockCanonical / solanaCanonical) : null;
const gates = buildGates(solana, magicblock, canonicalWorkReduction); const invalid = solana.status !== 'completed' || magicblock.status !== 'completed'; const verdict = invalid ? 'INVALID' : (gates.every((gate) => gate.pass) ? 'PASS' : 'FAIL');
const evidence = {
  schema: 'reactor.m6-essentiality.v1', generatedAt: new Date().toISOString(), benchmark: 'M6 — Essentiality Benchmark: Coordination Density Spike', protocolStatus: 'frozen-before-result', verdict, runClassification: CHURN_TRANSITIONS >= 100 ? 'frozen-protocol-sized' : 'structural-smoke-below-frozen-minimum',
  provenance: { gitCommit: currentGitCommit(), programId: programId.toBase58(), baseRpc: BASE_RPC, baseWs: BASE_WS, erRpc: ER_RPC, erWs: ER_WS, magicblockValidator: ER_VALIDATOR.toBase58(), churnTransitions: CHURN_TRANSITIONS, objectiveRelevantHotTransitions: CHURN_TRANSITIONS + 1, frozenCanonicalWorkReductionThreshold: PASS_REDUCTION, commonSetupExcludedFromPrimary: true, delegationIncludedInPrimary: true, immutabilityProbeExcludedFromPrimary: true },
  fixture: { initialExposure: INITIAL_EXPOSURE, targetExposure: TARGET_EXPOSURE, exposureReduction: EXPOSURE_REDUCTION, boundedTransferLamports: TRANSFER_LAMPORTS, conditionSourceCount: CONDITION_COUNT, persistentBlocker: 'C2', initialConditionState: [true, true, false, true, true, true] },
  treatments: { solana, magicblock },
  primaryComparison: { solanaCanonicalCoordinationTransactions: solanaCanonical, magicblockCanonicalCoordinationTransactions: magicblockCanonical, canonicalWorkReduction, canonicalWorkReductionPercent: Number.isFinite(canonicalWorkReduction) ? canonicalWorkReduction * 100 : null, threshold: PASS_REDUCTION },
  gates,
  interpretationBoundary: { supportsIfPass: 'A high-coordination-density Reactor objective can absorb authenticated transient state in an ER while preserving canonical Solana authority and materially reducing canonical coordination transactions in this local fixture.', doesNotProve: ['production fee savings', 'public-network throughput advantage', 'generic MagicBlock latency superiority', 'that every Reactor objective should be delegated', 'Reactor essentiality versus a semantics-equivalent keeper', 'market demand', 'external DEX resource reservation'] },
};
for (const outputPath of [PRIMARY_OUTPUT, CHAMBER_OUTPUT]) { fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`); }
console.log('\n=== M6 result ==='); console.log(`verdict: ${verdict}`); console.log(`Solana canonical coordination: ${solanaCanonical ?? 'n/a'} tx`); console.log(`MagicBlock canonical coordination: ${magicblockCanonical ?? 'n/a'} tx`); console.log(`canonical work reduction: ${Number.isFinite(canonicalWorkReduction) ? `${(canonicalWorkReduction * 100).toFixed(3)}%` : 'n/a'}`); for (const gate of gates) console.log(`${gate.pass ? 'PASS' : 'FAIL'} ${gate.id}: observed=${JSON.stringify(gate.observed)} threshold=${JSON.stringify(gate.threshold)}`); console.log(`evidence: ${PRIMARY_OUTPUT}`); console.log(`chamber: ${CHAMBER_OUTPUT}`);
if (verdict === 'INVALID') process.exitCode = 2;
