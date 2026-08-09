import fs from 'node:fs';
import crypto from 'node:crypto';
import * as anchorNamespace from '@coral-xyz/anchor';
import { DELEGATION_PROGRAM_ID } from '@magicblock-labs/ephemeral-rollups-sdk';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

const anchor = anchorNamespace.default ?? anchorNamespace;
const CONDITION_COUNT = 6;
const EXPECTED = [1, 1, 2, 1, 1, 1];
const BASE_RPC = process.env.REACTOR_M5B_BASE_RPC ?? process.env.REACTOR_M4_ENGINE_BASE_RPC ?? 'http://127.0.0.1:8899';
const BASE_WS = process.env.REACTOR_M5B_BASE_WS ?? process.env.REACTOR_M4_ENGINE_BASE_WS ?? 'ws://127.0.0.1:8900';
const ER_RPC = process.env.REACTOR_M5B_ER_RPC ?? process.env.REACTOR_M4_ENGINE_ER_RPC ?? 'http://127.0.0.1:7799';
const ER_WS = process.env.REACTOR_M5B_ER_WS ?? process.env.REACTOR_M4_ENGINE_ER_WS ?? 'ws://127.0.0.1:7800';
const ER_VALIDATOR = new PublicKey(process.env.REACTOR_M5B_ER_VALIDATOR ?? process.env.REACTOR_M4_ENGINE_ER_VALIDATOR ?? 'mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev');
const OBJECTIVE_COUNT = Number(process.env.REACTOR_M5B_OBJECTIVE_COUNT ?? 10);
const EPISODES = Number(process.env.REACTOR_M5B_EPISODES ?? 1);
const BURST_SPREAD_MS = Number(process.env.REACTOR_M5B_BURST_SPREAD_MS ?? 20);
const FIXTURE_LAMPORTS = Number(process.env.REACTOR_M5B_FIXTURE_LAMPORTS ?? 80_000_000);
const TRANSITION_PAYER_LAMPORTS = Number(process.env.REACTOR_M5B_TRANSITION_PAYER_LAMPORTS ?? 1_000_000);
const TTL_SLOTS = Number(process.env.REACTOR_M5B_TTL_SLOTS ?? 20_000);
const STATUS_TIMEOUT_MS = Number(process.env.REACTOR_M5B_STATUS_TIMEOUT_MS ?? 10_000);
const OUTPUT = process.env.REACTOR_M5B_RESULT_PATH ?? `experiment/results/m5b-concurrent-objectives-${OBJECTIVE_COUNT}-latest.json`;

if (!Number.isInteger(OBJECTIVE_COUNT) || OBJECTIVE_COUNT <= 0) throw new Error('REACTOR_M5B_OBJECTIVE_COUNT must be a positive integer');
if (!Number.isInteger(EPISODES) || EPISODES <= 0) throw new Error('REACTOR_M5B_EPISODES must be a positive integer');
if (!Number.isFinite(BURST_SPREAD_MS) || BURST_SPREAD_MS < 0) throw new Error('REACTOR_M5B_BURST_SPREAD_MS must be >= 0');

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function nowMs() { return Number(process.hrtime.bigint()) / 1_000_000; }
function derive(programId, seeds) { return PublicKey.findProgramAddressSync(seeds, programId)[0]; }
function percentile(values, q) {
  if (!values.length) return null;
  const x = [...values].sort((a, b) => a - b);
  const p = (x.length - 1) * q;
  const lo = Math.floor(p); const hi = Math.ceil(p);
  return lo === hi ? x[lo] : x[lo] + (x[hi] - x[lo]) * (p - lo);
}
function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function scheduleOffset(index, count) {
  if (count <= 1 || BURST_SPREAD_MS === 0) return 0;
  return (index / (count - 1)) * BURST_SPREAD_MS;
}
async function setupSend(builder, signers = []) {
  return (signers.length ? builder.signers(signers) : builder).rpc({ commitment: 'confirmed' });
}
async function waitForDelegated(base, er, pubkey, programId, attempts = 320) {
  for (let i = 0; i < attempts; i += 1) {
    const [b, e] = await Promise.all([
      base.getAccountInfo(pubkey, 'processed'),
      er.getAccountInfo(pubkey, 'processed'),
    ]);
    if (b?.owner.equals(DELEGATION_PROGRAM_ID) && e?.owner.equals(programId)) return;
    await sleep(25);
  }
  throw new Error(`delegation timeout: ${pubkey}`);
}
async function fundMany(connection, wallet, recipients) {
  const BATCH = 8;
  for (let i = 0; i < recipients.length; i += BATCH) {
    const tx = new Transaction();
    for (const item of recipients.slice(i, i + BATCH)) {
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
async function prepare(builder, connection, payer, signers = []) {
  const tx = await builder.transaction();
  const latest = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = payer.publicKey;
  const unique = [payer, ...signers.filter((s) => !s.publicKey.equals(payer.publicKey))];
  tx.partialSign(...unique);
  let feeEstimateLamports = null;
  try { feeEstimateLamports = (await connection.getFeeForMessage(tx.compileMessage(), 'processed')).value; } catch {}
  return { bytes: tx.serialize(), payer: payer.publicKey.toBase58(), feeEstimateLamports };
}
async function waitForSignature(connection, signature, timeoutMs = STATUS_TIMEOUT_MS) {
  const started = nowMs();
  while (nowMs() - started < timeoutMs) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status) return status;
    await sleep(2);
  }
  throw new Error(`signature status timeout: ${signature}`);
}
async function sendMeasured(connection, prepared, scheduledAtMs) {
  const delay = scheduledAtMs - nowMs();
  if (delay > 0) await sleep(delay);
  const submittedAt = nowMs();
  let signature = null;
  let status = null;
  let failure = null;
  try {
    signature = await connection.sendRawTransaction(prepared.bytes, { skipPreflight: false, maxRetries: 0 });
    status = await waitForSignature(connection, signature);
    if (status.err) failure = `runtime error: ${JSON.stringify(status.err)}`;
  } catch (error) {
    failure = String(error?.message ?? error);
  }
  const processedAt = nowMs();
  let feeLamports = null;
  let computeUnitsConsumed = null;
  if (signature && !failure) {
    try {
      const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      feeLamports = tx?.meta?.fee ?? null;
      computeUnitsConsumed = tx?.meta?.computeUnitsConsumed ?? null;
    } catch {}
  }
  return {
    signature,
    failure,
    slot: status?.slot ?? null,
    submittedAtMs: submittedAt,
    processedAtMs: processedAt,
    submitToProcessedMs: processedAt - submittedAt,
    feeEstimateLamports: prepared.feeEstimateLamports,
    feeLamports,
    computeUnitsConsumed,
  };
}

async function createFixture({ mode, index, baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet }) {
  const programId = baseProgram.programId;
  const authorityKeypair = Keypair.generate();
  const authority = authorityKeypair.publicKey;
  const recipient = Keypair.generate().publicKey;
  const sources = Array.from({ length: CONDITION_COUNT }, () => Keypair.generate());
  const openingPayer = Keypair.generate();
  const closingPayer = Keypair.generate();
  const objectiveSeed = crypto.randomBytes(32);
  const path = derive(programId, [Buffer.from('path'), authority.toBuffer()]);
  const objective = derive(programId, [Buffer.from('objective'), authority.toBuffer(), objectiveSeed]);
  const vault = derive(programId, [Buffer.from('vault'), objective.toBuffer()]);
  const conditions = Array.from({ length: CONDITION_COUNT }, (_, kind) =>
    derive(programId, [Buffer.from('condition'), objective.toBuffer(), Buffer.from([kind])]),
  );
  const candidate = derive(programId, [Buffer.from('session_candidate'), objective.toBuffer()]);

  await fundMany(baseConnection, wallet, [
    { pubkey: authority, lamports: FIXTURE_LAMPORTS },
    { pubkey: openingPayer.publicKey, lamports: TRANSITION_PAYER_LAMPORTS },
    { pubkey: closingPayer.publicKey, lamports: TRANSITION_PAYER_LAMPORTS },
  ]);

  const startSlot = await baseConnection.getSlot('confirmed');
  await setupSend(baseProgram.methods.initializePath(new anchor.BN(1_000_000), new anchor.BN(startSlot + 100_000))
    .accounts({ path, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  await setupSend(baseProgram.methods.createObjective([...objectiveSeed], new anchor.BN(500), new anchor.BN(1), conditions)
    .accounts({ objective, path, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  await setupSend(baseProgram.methods.initializeVault(new anchor.BN(700))
    .accounts({ vault, objective, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
    await setupSend(baseProgram.methods.initializeCondition(kind, sources[kind].publicKey)
      .accounts({ condition: conditions[kind], objective, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  }
  await setupSend(baseProgram.methods.initializeSessionCandidate(recipient, new anchor.BN(100_000), new anchor.BN(200))
    .accounts({ sessionCandidate: candidate, objective, path, authority, vault, systemProgram: SystemProgram.programId }), [authorityKeypair]);

  let program = baseProgram;
  let connection = baseConnection;
  if (mode === 'magicblock') {
    const remaining = [{ pubkey: ER_VALIDATOR, isSigner: false, isWritable: false }];
    await setupSend(baseProgram.methods.delegateSessionCandidate()
      .accounts({ payer: authority, objective, sessionCandidate: candidate })
      .remainingAccounts(remaining), [authorityKeypair]);
    await waitForDelegated(baseConnection, erConnection, candidate, programId);
    for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
      await setupSend(baseProgram.methods.delegateCondition(kind)
        .accounts({ payer: authority, objective, condition: conditions[kind] })
        .remainingAccounts(remaining), [authorityKeypair]);
      await waitForDelegated(baseConnection, erConnection, conditions[kind], programId);
    }
    program = erProgram;
    connection = erConnection;
  }

  const validUntil = (await connection.getSlot('confirmed')) + TTL_SLOTS;
  const simpleUpdate = (kind, seq, pred) => program.methods.updateCondition(
    new anchor.BN(seq), new anchor.BN(100 + kind), pred, new anchor.BN(validUntil),
  ).accounts({ condition: conditions[kind], source: sources[kind].publicKey });
  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
    await setupSend(simpleUpdate(kind, 1, kind !== 2), [sources[kind]]);
  }

  const coupled = (kind, seq, pred) => program.methods.updateConditionAndMaybeSeal(
    kind, new anchor.BN(seq), new anchor.BN(100 + kind), pred, new anchor.BN(validUntil),
  ).accounts({
    sessionCandidate: candidate,
    condition0: conditions[0], condition1: conditions[1], condition2: conditions[2],
    condition3: conditions[3], condition4: conditions[4], condition5: conditions[5],
    source: sources[kind].publicKey,
  });

  const opening = await prepare(coupled(2, 2, true), connection, openingPayer, [sources[2]]);
  const closing = await prepare(coupled(0, 2, false), connection, closingPayer, [sources[0]]);
  return { index, mode, program, connection, candidate, opening, closing };
}

async function verifyCandidate(fixture) {
  try {
    const state = await fixture.program.account.sessionCandidate.fetch(fixture.candidate, 'processed');
    const frozen = state.frozenSequences.map(Number);
    const exact = state.ready === true && frozen.join(',') === EXPECTED.join(',');
    const falseLock = state.ready === true && !exact;
    return { ready: state.ready === true, exact, falseLock, frozen };
  } catch (error) {
    return { ready: false, exact: false, falseLock: false, frozen: null, verificationError: String(error?.message ?? error) };
  }
}

async function runEpisode({ mode, episode, fixtures }) {
  const episodeScheduledAt = nowMs() + 100;
  const openResults = await Promise.all(fixtures.map(async (fixture, index) => {
    const scheduledAt = episodeScheduledAt + scheduleOffset(index, fixtures.length);
    const measured = await sendMeasured(fixture.connection, fixture.opening, scheduledAt);
    const verification = await verifyCandidate(fixture);
    return { objective: index, scheduledAtMs: scheduledAt, ...measured, ...verification };
  }));

  const falseLocks = openResults.filter((x) => x.falseLock).length;
  const exactCaptures = openResults.filter((x) => !x.failure && x.exact).length;

  // Post-seal mutation is part of the correctness gate. Use the same concurrent
  // schedule but do not fold this second transition into opening throughput.
  const closeScheduledAt = nowMs() + 100;
  const closeResults = await Promise.all(fixtures.map(async (fixture, index) => {
    const scheduledAt = closeScheduledAt + scheduleOffset(index, fixtures.length);
    const measured = await sendMeasured(fixture.connection, fixture.closing, scheduledAt);
    const verification = await verifyCandidate(fixture);
    return { objective: index, scheduledAtMs: scheduledAt, ...measured, immutable: verification.exact && !verification.falseLock, frozen: verification.frozen };
  }));

  const immutableCount = closeResults.filter((x) => !x.failure && x.immutable).length;
  const successfulOpen = openResults.filter((x) => !x.failure && x.exact);
  const latencies = successfulOpen.map((x) => x.submitToProcessedMs);
  const submitted = openResults.filter((x) => x.submittedAtMs != null);
  const successfulProcessed = successfulOpen.filter((x) => x.processedAtMs != null);
  const firstSubmit = submitted.length ? Math.min(...submitted.map((x) => x.submittedAtMs)) : null;
  const lastSubmit = submitted.length ? Math.max(...submitted.map((x) => x.submittedAtMs)) : null;
  const lastProcessed = successfulProcessed.length ? Math.max(...successfulProcessed.map((x) => x.processedAtMs)) : null;
  const episodeIntervalMs = firstSubmit != null && lastProcessed != null ? lastProcessed - firstSubmit : null;
  const completionTailMs = lastSubmit != null && lastProcessed != null ? Math.max(0, lastProcessed - lastSubmit) : null;
  const capturesPerSecond = episodeIntervalMs && episodeIntervalMs > 0 ? exactCaptures / (episodeIntervalMs / 1000) : null;

  const fees = successfulOpen.map((x) => x.feeLamports).filter((x) => Number.isFinite(x));
  const feeEstimates = openResults.map((x) => x.feeEstimateLamports).filter((x) => Number.isFinite(x));
  const compute = successfulOpen.map((x) => x.computeUnitsConsumed).filter((x) => Number.isFinite(x));

  const summary = {
    mode,
    episode,
    objectives: fixtures.length,
    exactCaptures,
    captureRate: exactCaptures / fixtures.length,
    falseLocks,
    immutableAfterClose: immutableCount,
    openingSubmissionFailures: openResults.filter((x) => x.failure).length,
    closeFailures: closeResults.filter((x) => x.failure).length,
    coordinationAmplification: exactCaptures > 0 ? fixtures.length / exactCaptures : null,
    latencyMs: {
      min: latencies.length ? Math.min(...latencies) : null,
      mean: mean(latencies),
      p50: percentile(latencies, 0.50),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      max: latencies.length ? Math.max(...latencies) : null,
    },
    capacity: {
      episodeIntervalMs,
      completionTailMs,
      exactCapturesPerSecond: capturesPerSecond,
      configuredBurstSpreadMs: BURST_SPREAD_MS,
    },
    diagnostics: {
      observedFeeLamportsTotal: fees.length ? fees.reduce((a, b) => a + b, 0) : null,
      estimatedFeeLamportsTotal: feeEstimates.length ? feeEstimates.reduce((a, b) => a + b, 0) : null,
      computeUnitsTotal: compute.length ? compute.reduce((a, b) => a + b, 0) : null,
    },
  };
  console.log(`${mode} episode=${episode} objectives=${fixtures.length} exact=${exactCaptures}/${fixtures.length} falseLocks=${falseLocks} immutable=${immutableCount}/${fixtures.length} p50=${summary.latencyMs.p50?.toFixed(3) ?? 'null'}ms p95=${summary.latencyMs.p95?.toFixed(3) ?? 'null'}ms cps=${capturesPerSecond?.toFixed(2) ?? 'null'}`);
  return { summary, openResults, closeResults };
}

const idl = JSON.parse(fs.readFileSync(process.env.REACTOR_IDL ?? 'target/idl/reactor.json', 'utf8'));
const envProvider = anchor.AnchorProvider.env();
const wallet = envProvider.wallet;
const baseConnection = new Connection(BASE_RPC, { commitment: 'confirmed', wsEndpoint: BASE_WS });
const erConnection = new Connection(ER_RPC, { commitment: 'confirmed', wsEndpoint: ER_WS });
const baseProvider = new anchor.AnchorProvider(baseConnection, wallet, { commitment: 'confirmed', preflightCommitment: 'confirmed' });
const erProvider = new anchor.AnchorProvider(erConnection, wallet, { commitment: 'confirmed', preflightCommitment: 'confirmed' });
const baseProgram = new anchor.Program(idl, baseProvider);
const erProgram = new anchor.Program(idl, erProvider);

console.log('M5b concurrent objective runtime benchmark');
console.log(`program: ${baseProgram.programId}`);
console.log(`objectives/path: ${OBJECTIVE_COUNT}`);
console.log(`episodes/path: ${EPISODES}`);
console.log(`burst spread: ${BURST_SPREAD_MS}ms`);
console.log('primitive: authenticated state transition + current-state maybe-seal');
console.log('correctness path: no WebSocket callback, no second seal transaction');

const all = [];
for (let episode = 1; episode <= EPISODES; episode += 1) {
  for (const mode of ['solana', 'magicblock']) {
    console.log(`\nPreparing ${mode} episode=${episode} fixtures...`);
    const fixtures = [];
    for (let index = 0; index < OBJECTIVE_COUNT; index += 1) {
      fixtures.push(await createFixture({ mode, index, baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet }));
    }
    all.push(await runEpisode({ mode, episode, fixtures }));
  }
}

const summaries = all.map((x) => x.summary);
const invalid = summaries.some((x) => x.falseLocks !== 0 || x.immutableAfterClose !== x.objectives);
const result = {
  benchmark: 'reactor-m5b-concurrent-objectives-local',
  scope: 'transition-coupled-concurrent-objectives-same-reactor-semantics-local-solana-vs-local-er',
  generatedAt: new Date().toISOString(),
  configuration: {
    objectiveCount: OBJECTIVE_COUNT,
    episodesPerPath: EPISODES,
    burstSpreadMs: BURST_SPREAD_MS,
    expectedFrozenSequences: EXPECTED,
    primitive: 'update-condition-and-maybe-seal',
    webSocketInCorrectnessPath: false,
    distinctMeasuredFeePayerPerObjective: true,
    setupAndDelegationExcludedFromHotInterval: true,
  },
  summaries,
  episodes: all,
  semanticGate: {
    zeroFalseLocks: summaries.every((x) => x.falseLocks === 0),
    allCapturedCandidatesImmutable: summaries.every((x) => x.immutableAfterClose === x.objectives),
    pass: !invalid,
  },
  claimBoundary: {
    supports: [
      'local transition-coupled Reactor correctness under the configured concurrent objective load',
      'local submit-to-processed latency distributions for the same Reactor primitive',
      'local exact-capture throughput and completion-tail diagnostics',
    ],
    doesNotSupport: [
      'production or mainnet latency ratios',
      'production MagicBlock pricing or fee advantage',
      'end-to-end delegation plus commit plus materialization plus settlement economics',
      'representative market demand',
      'arbitrary external resource reservation',
    ],
  },
};

fs.mkdirSync('experiment/results', { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
console.log('\nSummary');
console.log(JSON.stringify({ summaries, semanticGate: result.semanticGate }, null, 2));
console.log(`evidence written: ${OUTPUT}`);
process.exit(result.semanticGate.pass ? 0 : 1);
