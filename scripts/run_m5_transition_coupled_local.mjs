import fs from 'node:fs';
import crypto from 'node:crypto';
import * as anchorNamespace from '@coral-xyz/anchor';
import { DELEGATION_PROGRAM_ID } from '@magicblock-labs/ephemeral-rollups-sdk';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

const anchor = anchorNamespace.default ?? anchorNamespace;
const CONDITION_COUNT = 6;
const EXPECTED = [1, 1, 2, 1, 1, 1];
const BASE_RPC = process.env.REACTOR_M4_ENGINE_BASE_RPC ?? 'http://127.0.0.1:8899';
const BASE_WS = process.env.REACTOR_M4_ENGINE_BASE_WS ?? 'ws://127.0.0.1:8900';
const ER_RPC = process.env.REACTOR_M4_ENGINE_ER_RPC ?? 'http://127.0.0.1:7799';
const ER_WS = process.env.REACTOR_M4_ENGINE_ER_WS ?? 'ws://127.0.0.1:7800';
const ER_VALIDATOR = new PublicKey(process.env.REACTOR_M4_ENGINE_ER_VALIDATOR ?? 'mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev');
const TRIALS = Number(process.env.REACTOR_M5_TRANSITION_TRIALS ?? process.env.REACTOR_M4_ENGINE_TRIALS ?? 10);
const FIXTURE_LAMPORTS = 80_000_000;
const TTL_SLOTS = 20_000;
const OUTPUT = process.env.REACTOR_M5_TRANSITION_RESULT_PATH ?? 'experiment/results/m5-transition-coupled-local-latest.json';

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
async function setupSend(builder, signers = []) {
  return (signers.length ? builder.signers(signers) : builder).rpc({ commitment: 'confirmed' });
}
async function waitForDelegated(base, er, pubkey, programId, attempts = 240) {
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
async function fundFixture(provider, wallet, authority) {
  await provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: authority,
    lamports: FIXTURE_LAMPORTS,
  })), []);
}
async function waitForSignature(connection, signature, timeoutMs = 5000) {
  const started = nowMs();
  while (nowMs() - started < timeoutMs) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status) return status;
    await sleep(2);
  }
  throw new Error(`signature status timeout: ${signature}`);
}

async function createFixture({ mode, baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet }) {
  const programId = baseProgram.programId;
  const authorityKeypair = Keypair.generate();
  const authority = authorityKeypair.publicKey;
  const recipient = Keypair.generate().publicKey;
  const sources = Array.from({ length: CONDITION_COUNT }, () => Keypair.generate());
  const objectiveSeed = crypto.randomBytes(32);
  const path = derive(programId, [Buffer.from('path'), authority.toBuffer()]);
  const objective = derive(programId, [Buffer.from('objective'), authority.toBuffer(), objectiveSeed]);
  const vault = derive(programId, [Buffer.from('vault'), objective.toBuffer()]);
  const conditions = Array.from({ length: CONDITION_COUNT }, (_, kind) =>
    derive(programId, [Buffer.from('condition'), objective.toBuffer(), Buffer.from([kind])]),
  );
  const candidate = derive(programId, [Buffer.from('session_candidate'), objective.toBuffer()]);

  await fundFixture(baseProvider, wallet, authority);
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

  return { program, connection, candidate, conditions, sources, coupled };
}

async function runTrial(args) {
  const { mode, index } = args;
  const f = await createFixture(args);
  const builder = f.coupled(2, 2, true).signers([f.sources[2]]);
  const tx = await builder.transaction();
  const latest = await f.connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = args.wallet.publicKey;
  tx.partialSign(f.sources[2]);
  const signed = await args.wallet.signTransaction(tx);

  const t0 = nowMs();
  let signature = null;
  let status = null;
  let failure = null;
  try {
    signature = await f.connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 0 });
    status = await waitForSignature(f.connection, signature);
    if (status.err) failure = `runtime error: ${JSON.stringify(status.err)}`;
  } catch (error) {
    failure = String(error?.message ?? error);
  }
  const elapsed = nowMs() - t0;

  let state = null;
  let exact = false;
  let immutable = false;
  if (!failure) {
    try {
      state = await f.program.account.sessionCandidate.fetch(f.candidate, 'processed');
      exact = state.ready === true && state.frozenSequences.map(Number).join(',') === EXPECTED.join(',');
      if (exact) {
        await setupSend(f.coupled(0, 2, false), [f.sources[0]]);
        const after = await f.program.account.sessionCandidate.fetch(f.candidate, 'processed');
        immutable = after.ready === true && after.frozenSequences.map(Number).join(',') === EXPECTED.join(',');
      }
    } catch (error) {
      failure = String(error?.message ?? error);
    }
  }

  const success = !failure && exact && immutable;
  console.log(`${mode} trial=${index + 1} success=${success} exact=${exact} immutable=${immutable} submitToProcessed=${elapsed.toFixed(3)}ms${failure ? ` failure=${failure}` : ''}`);
  return {
    mode, trial: index + 1, success, exact, immutable, signature,
    processedSlot: status?.slot ?? null,
    submitToProcessedMs: elapsed,
    failure,
  };
}

function summarize(trials) {
  const good = trials.filter((x) => x.success);
  const lat = good.map((x) => x.submitToProcessedMs);
  return {
    trials: trials.length,
    successes: good.length,
    failures: trials.filter((x) => x.failure).length,
    p50Ms: percentile(lat, 0.5),
    p95Ms: percentile(lat, 0.95),
    p99Ms: percentile(lat, 0.99),
    meanMs: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null,
    minMs: lat.length ? Math.min(...lat) : null,
    maxMs: lat.length ? Math.max(...lat) : null,
  };
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

console.log('M5 transition-coupled runtime benchmark');
console.log(`program: ${baseProgram.programId}`);
console.log(`trials/path: ${TRIALS}`);
console.log('primitive: source-authenticated condition update + current-state maybe-seal in one Reactor instruction');
console.log('correctness path: no WebSocket/account-change trigger');

const trials = [];
for (let index = 0; index < TRIALS; index += 1) {
  trials.push(await runTrial({ mode: 'solana', index, baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet }));
  trials.push(await runTrial({ mode: 'magicblock', index, baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet }));
}

const result = {
  benchmark: 'reactor-m5-transition-coupled-local',
  scope: 'same-reactor-transition-semantics-local-solana-vs-local-er',
  generatedAt: new Date().toISOString(),
  configuration: {
    trialsPerPath: TRIALS,
    expectedFrozenSequences: EXPECTED,
    primitive: 'update-condition-and-maybe-seal',
    webSocketInCorrectnessPath: false,
  },
  summary: {
    solana: summarize(trials.filter((x) => x.mode === 'solana')),
    magicblock: summarize(trials.filter((x) => x.mode === 'magicblock')),
  },
  trials,
};
fs.mkdirSync('experiment/results', { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
console.log('\nSummary');
console.log(JSON.stringify(result.summary, null, 2));
console.log(`evidence written: ${OUTPUT}`);
