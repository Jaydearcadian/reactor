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
const LOCAL_BASE_RPC = process.env.REACTOR_M4_ENGINE_BASE_RPC ?? 'http://127.0.0.1:8899';
const LOCAL_BASE_WS = process.env.REACTOR_M4_ENGINE_BASE_WS ?? 'ws://127.0.0.1:8900';
const LOCAL_ER_RPC = process.env.REACTOR_M4_ENGINE_ER_RPC ?? 'http://127.0.0.1:7799';
const LOCAL_ER_WS = process.env.REACTOR_M4_ENGINE_ER_WS ?? 'ws://127.0.0.1:7800';
const LOCAL_ER_VALIDATOR = new PublicKey(
  process.env.REACTOR_M4_ENGINE_ER_VALIDATOR ?? 'mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev',
);
const TRIALS = Number(process.env.REACTOR_M4_ENGINE_TRIALS ?? 10);
const FIXTURE_LAMPORTS = Number(process.env.REACTOR_M4_ENGINE_FIXTURE_LAMPORTS ?? 20_000_000);
const CONDITION_TTL_SLOTS = Number(process.env.REACTOR_M4_ENGINE_CONDITION_TTL_SLOTS ?? 20_000);
const SUBSCRIPTION_WARM_MS = Number(process.env.REACTOR_M4_ENGINE_SUBSCRIPTION_WARM_MS ?? 100);
const OBSERVATION_TIMEOUT_MS = Number(process.env.REACTOR_M4_ENGINE_OBSERVATION_TIMEOUT_MS ?? 5000);
const OUTPUT_PATH = process.env.REACTOR_M4_ENGINE_RESULT_PATH ?? 'experiment/results/m4-engine-local-latest.json';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function derive(programId, seeds) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function base58Encode(input) {
  const bytes = Uint8Array.from(input);
  if (bytes.length === 0) return '';
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  let output = '1'.repeat(zeroes);
  for (let index = digits.length - 1; index >= 0; index -= 1) output += BASE58[digits[index]];
  return output;
}

function percentile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function summarize(trials) {
  const successes = trials.filter((trial) => trial.success && trial.exactVersionMatch && !trial.falseLock);
  const latencies = successes.map((trial) => trial.submitToProcessedMs);
  const mean = latencies.length > 0
    ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
    : null;
  return {
    trials: trials.length,
    successfulExactSeals: successes.length,
    failedTransactions: trials.filter((trial) => trial.failure).length,
    falseLocks: trials.filter((trial) => trial.falseLock).length,
    latencyMs: {
      min: latencies.length > 0 ? Math.min(...latencies) : null,
      mean,
      p50: percentile(latencies, 0.50),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      max: latencies.length > 0 ? Math.max(...latencies) : null,
    },
  };
}

function withTimeout(promise, label, timeoutMs = OBSERVATION_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function rpcReady(connection, label) {
  try {
    await connection.getVersion();
  } catch (error) {
    throw new Error(`${label} RPC unavailable: ${error?.message ?? error}`);
  }
}

async function setupSend(builder, signers = []) {
  const signed = signers.length > 0 ? builder.signers(signers) : builder;
  return signed.rpc({ commitment: 'confirmed' });
}

async function fundFixture(provider, payer, authority) {
  await provider.sendAndConfirm(
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: authority,
        lamports: FIXTURE_LAMPORTS,
      }),
    ),
    [],
  );
}

async function prepareTransaction(transaction, connection, wallet, extraSigners = []) {
  const latest = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = wallet.publicKey;
  if (extraSigners.length > 0) transaction.partialSign(...extraSigners);
  const signed = await wallet.signTransaction(transaction);
  assert(signed.signature, 'prepared transaction missing signature');
  return {
    bytes: signed.serialize(),
    signature: base58Encode(signed.signature),
  };
}

async function sendRaw(connection, prepared) {
  const signature = await connection.sendRawTransaction(prepared.bytes, {
    skipPreflight: true,
    maxRetries: 0,
  });
  assert(signature === prepared.signature, `unexpected signature ${signature}`);
  return signature;
}

async function createSignatureWatch(connection, signature) {
  let resolve;
  let reject;
  let settled = false;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  void promise.catch(() => {});
  const subscriptionId = await connection.onSignature(
    signature,
    (result, context) => {
      settled = true;
      if (result.err) {
        reject(new Error(`transaction ${signature} failed: ${JSON.stringify(result.err)}`));
      } else {
        resolve({ slot: context.slot });
      }
    },
    'processed',
  );
  return { promise, subscriptionId, isSettled: () => settled };
}

async function cleanupWatch(connection, watch) {
  if (!watch || watch.isSettled()) return;
  try {
    await connection.removeSignatureListener(watch.subscriptionId);
  } catch {
    // best effort
  }
}

async function waitForDelegated(baseConnection, erConnection, pubkey, programId, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const [baseInfo, erInfo] = await Promise.all([
      baseConnection.getAccountInfo(pubkey, 'processed'),
      erConnection.getAccountInfo(pubkey, 'processed'),
    ]);
    if (baseInfo?.owner.equals(DELEGATION_PROGRAM_ID) && erInfo?.owner.equals(programId)) return;
    await sleep(25);
  }
  throw new Error(`account did not delegate to local ER: ${pubkey}`);
}

async function createFixture({ mode, baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet }) {
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

  await setupSend(
    baseProgram.methods.initializePath(new anchor.BN(1_000_000), new anchor.BN(startSlot + 100_000))
      .accounts({ path: pathPda, authority, systemProgram: SystemProgram.programId }),
    [authorityKeypair],
  );
  await setupSend(
    baseProgram.methods.createObjective([...objectiveSeed], new anchor.BN(TARGET_EXPOSURE), new anchor.BN(1), conditionPdas)
      .accounts({ objective: objectivePda, path: pathPda, authority, systemProgram: SystemProgram.programId }),
    [authorityKeypair],
  );
  await setupSend(
    baseProgram.methods.initializeVault(new anchor.BN(INITIAL_EXPOSURE))
      .accounts({ vault: vaultPda, objective: objectivePda, authority, systemProgram: SystemProgram.programId }),
    [authorityKeypair],
  );

  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
    await setupSend(
      baseProgram.methods.initializeCondition(kind, sources[kind].publicKey)
        .accounts({ condition: conditionPdas[kind], objective: objectivePda, authority, systemProgram: SystemProgram.programId }),
      [authorityKeypair],
    );
  }

  await setupSend(
    baseProgram.methods.initializeSessionCandidate(recipient, new anchor.BN(100_000), new anchor.BN(200))
      .accounts({
        sessionCandidate: candidatePda,
        objective: objectivePda,
        path: pathPda,
        authority,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      }),
    [authorityKeypair],
  );

  let activeProgram = baseProgram;
  let activeConnection = baseConnection;

  if (mode === 'magicblock') {
    const validatorRemaining = [{
      pubkey: LOCAL_ER_VALIDATOR,
      isSigner: false,
      isWritable: false,
    }];

    await setupSend(
      baseProgram.methods.delegateSessionCandidate()
        .accounts({ payer: authority, objective: objectivePda, sessionCandidate: candidatePda })
        .remainingAccounts(validatorRemaining),
      [authorityKeypair],
    );
    await waitForDelegated(baseConnection, erConnection, candidatePda, programId);

    for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
      await setupSend(
        baseProgram.methods.delegateCondition(kind)
          .accounts({ payer: authority, objective: objectivePda, condition: conditionPdas[kind] })
          .remainingAccounts(validatorRemaining),
        [authorityKeypair],
      );
      await waitForDelegated(baseConnection, erConnection, conditionPdas[kind], programId);
    }

    activeProgram = erProgram;
    activeConnection = erConnection;
  }

  const validityAnchorSlot = await activeConnection.getSlot('confirmed');
  const validUntilSlot = validityAnchorSlot + CONDITION_TTL_SLOTS;
  const updateBuilder = (kind, sequence, predicateResult) => activeProgram.methods.updateCondition(
    new anchor.BN(sequence),
    new anchor.BN(100 + kind),
    predicateResult,
    new anchor.BN(validUntilSlot),
  ).accounts({ condition: conditionPdas[kind], source: sources[kind].publicKey });

  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
    await setupSend(updateBuilder(kind, 1, kind !== 2), [sources[kind]]);
  }

  const openingInstruction = await updateBuilder(2, 2, true).instruction();
  const sealInstruction = await activeProgram.methods
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

  const atomic = new Transaction().add(openingInstruction).add(sealInstruction);
  const prepared = await prepareTransaction(atomic, activeConnection, wallet, [sources[2]]);

  return {
    activeProgram,
    activeConnection,
    candidatePda,
    conditionPdas,
    sources,
    updateBuilder,
    prepared,
  };
}

async function runTrial({ mode, index, baseProgram, baseProvider, baseConnection, erProgram, erConnection, wallet }) {
  const fixture = await createFixture({
    mode,
    baseProgram,
    baseProvider,
    baseConnection,
    erProgram,
    erConnection,
    wallet,
  });

  const watch = await createSignatureWatch(fixture.activeConnection, fixture.prepared.signature);
  await sleep(SUBSCRIPTION_WARM_MS);

  const t0 = nowMs();
  let t1 = null;
  let failure = null;
  let slot = null;

  try {
    await sendRaw(fixture.activeConnection, fixture.prepared);
    const processed = await withTimeout(watch.promise, `${mode} processed signature`);
    t1 = nowMs();
    slot = processed.slot;
  } catch (error) {
    failure = String(error?.message ?? error);
  }

  await cleanupWatch(fixture.activeConnection, watch);

  let exactVersionMatch = false;
  let falseLock = false;
  let candidate = null;
  try {
    const state = await fixture.activeProgram.account.sessionCandidate.fetch(
      fixture.candidatePda,
      'processed',
    );
    candidate = {
      ready: state.ready,
      frozenSequences: state.frozenSequences.map(Number),
      sealedSlot: Number(state.sealedSlot),
    };
    exactVersionMatch = state.ready === true
      && state.frozenSequences.map(Number).join(',') === EXPECTED_SEQUENCES.join(',');
    falseLock = state.ready === true && !exactVersionMatch;
  } catch (error) {
    if (!failure) failure = `candidate verification failed: ${error?.message ?? error}`;
  }

  // Mutate a different source after sealing and prove the candidate remains frozen.
  let postSealImmutable = false;
  if (exactVersionMatch) {
    try {
      await setupSend(fixture.updateBuilder(0, 2, false), [fixture.sources[0]]);
      const after = await fixture.activeProgram.account.sessionCandidate.fetch(
        fixture.candidatePda,
        'processed',
      );
      postSealImmutable = after.ready === true
        && after.frozenSequences.map(Number).join(',') === EXPECTED_SEQUENCES.join(',');
    } catch (error) {
      if (!failure) failure = `post-seal mutation check failed: ${error?.message ?? error}`;
    }
  }

  const submitToProcessedMs = t1 == null ? null : t1 - t0;
  const success = failure == null
    && submitToProcessedMs != null
    && exactVersionMatch
    && postSealImmutable
    && !falseLock;

  console.log(
    `${mode} trial=${index + 1} success=${success} exact=${exactVersionMatch}`
    + ` immutable=${postSealImmutable} latency=${submitToProcessedMs?.toFixed(3) ?? 'n/a'}ms`
    + (failure ? ` failure=${failure}` : ''),
  );

  return {
    mode,
    trial: index + 1,
    success,
    signature: fixture.prepared.signature,
    processedSlot: slot,
    submitToProcessedMs,
    exactVersionMatch,
    falseLock,
    postSealImmutable,
    candidate,
    failure,
  };
}

const idlPath = process.env.REACTOR_IDL ?? 'target/idl/reactor.json';
if (!fs.existsSync(idlPath)) throw new Error(`missing ${idlPath}`);
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

const envProvider = anchor.AnchorProvider.env();
const wallet = envProvider.wallet;
const baseConnection = new Connection(LOCAL_BASE_RPC, {
  commitment: 'confirmed',
  wsEndpoint: LOCAL_BASE_WS,
});
const erConnection = new Connection(LOCAL_ER_RPC, {
  commitment: 'confirmed',
  wsEndpoint: LOCAL_ER_WS,
});
await rpcReady(baseConnection, 'local Solana');
await rpcReady(erConnection, 'local MagicBlock ER');

const baseProvider = new anchor.AnchorProvider(baseConnection, wallet, {
  commitment: 'confirmed',
  preflightCommitment: 'confirmed',
});
const erProvider = new anchor.AnchorProvider(erConnection, wallet, {
  commitment: 'confirmed',
  preflightCommitment: 'confirmed',
});
const baseProgram = new anchor.Program(idl, baseProvider);
const erProgram = new anchor.Program(idl, erProvider);

console.log('M4-Engine local benchmark');
console.log(`program: ${baseProgram.programId}`);
console.log(`base:    ${LOCAL_BASE_RPC}`);
console.log(`base ws: ${LOCAL_BASE_WS}`);
console.log(`er:      ${LOCAL_ER_RPC}`);
console.log(`er ws:   ${LOCAL_ER_WS}`);
console.log(`validator: ${LOCAL_ER_VALIDATOR}`);
console.log(`trials/path: ${TRIALS}`);
console.log('measurement: prebuilt atomic update+seal send -> processed signature notification');

const trials = [];
for (let index = 0; index < TRIALS; index += 1) {
  trials.push(await runTrial({
    mode: 'solana',
    index,
    baseProgram,
    baseProvider,
    baseConnection,
    erProgram,
    erConnection,
    wallet,
  }));
  trials.push(await runTrial({
    mode: 'magicblock',
    index,
    baseProgram,
    baseProvider,
    baseConnection,
    erProgram,
    erConnection,
    wallet,
  }));
}

const solanaTrials = trials.filter((trial) => trial.mode === 'solana');
const magicblockTrials = trials.filter((trial) => trial.mode === 'magicblock');
const result = {
  benchmark: 'reactor-m4-engine-local',
  scope: 'controlled-local-runtime-diagnostic-not-product-capture-proof',
  generatedAt: new Date().toISOString(),
  configuration: {
    baseRpc: LOCAL_BASE_RPC,
    baseWs: LOCAL_BASE_WS,
    erRpc: LOCAL_ER_RPC,
    erWs: LOCAL_ER_WS,
    erValidator: LOCAL_ER_VALIDATOR.toBase58(),
    trialsPerPath: TRIALS,
    primitive: 'atomic-update-condition-plus-evaluate-session-candidate',
  },
  summary: {
    solana: summarize(solanaTrials),
    magicblock: summarize(magicblockTrials),
  },
  trials,
};

fs.mkdirSync('experiment/results', { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
console.log('\nM4-Engine summary');
console.log(JSON.stringify(result.summary, null, 2));
console.log(`evidence written: ${OUTPUT_PATH}`);
