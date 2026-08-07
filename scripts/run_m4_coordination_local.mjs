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
  TrialTelemetry,
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
const WINDOWS_MS = (process.env.REACTOR_M4_COORDINATION_WINDOWS_MS ?? '10,20,50,100,150,250,500')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
const TRIALS_PER_BAND = Number(process.env.REACTOR_M4_COORDINATION_TRIALS ?? 2);
const FIXTURE_LAMPORTS = Number(process.env.REACTOR_M4_COORDINATION_FIXTURE_LAMPORTS ?? 80_000_000);
const CONDITION_TTL_SLOTS = Number(process.env.REACTOR_M4_COORDINATION_CONDITION_TTL_SLOTS ?? 20_000);
const SUBSCRIPTION_WARM_MS = Number(process.env.REACTOR_M4_COORDINATION_SUBSCRIPTION_WARM_MS ?? 100);
const HOT_TIMEOUT_MS = Number(process.env.REACTOR_M4_COORDINATION_HOT_TIMEOUT_MS ?? 3000);
const OUTPUT_PATH = process.env.REACTOR_M4_COORDINATION_RESULT_PATH
  ?? 'experiment/results/m4-coordination-local-latest.json';
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

function withTimeout(promise, label, timeoutMs = HOT_TIMEOUT_MS) {
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
    new Transaction().add(SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: authority,
      lamports: FIXTURE_LAMPORTS,
    })),
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

async function prepareBuilder(builder, connection, wallet, extraSigners = []) {
  return prepareTransaction(await builder.transaction(), connection, wallet, extraSigners);
}

async function sendRaw(connection, prepared) {
  const signature = await connection.sendRawTransaction(prepared.bytes, {
    skipPreflight: true,
    maxRetries: 0,
  });
  assert(signature === prepared.signature, `unexpected signature ${signature}`);
  return signature;
}

async function createSignatureWatch(connection, signature, commitment = 'processed', onSuccess = null) {
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
        return;
      }
      try {
        onSuccess?.(context);
        resolve({ slot: context.slot, signature, commitment });
      } catch (error) {
        reject(error);
      }
    },
    commitment,
  );

  return { promise, subscriptionId, isSettled: () => settled };
}

async function cleanupSignatureWatch(connection, watch) {
  if (!watch || watch.isSettled()) return;
  try {
    await connection.removeSignatureListener(watch.subscriptionId);
  } catch {
    // best effort
  }
}

function decodeConditionFast(data) {
  // Current Reactor ConditionState layout, including Anchor discriminator:
  // kind @72, sequence u64 @73, value i64 @81, predicate_result @89.
  if (!Buffer.isBuffer(data) || data.length < 90) return null;
  return {
    kind: data.readUInt8(72),
    sequence: Number(data.readBigUInt64LE(73)),
    predicateResult: data.readUInt8(89) !== 0,
  };
}

async function createConditionObserver(connection, conditionPda, telemetry, onExecutable) {
  let fired = false;
  let resolveObserved;
  let rejectObserved;
  const observedPromise = new Promise((resolve, reject) => {
    resolveObserved = resolve;
    rejectObserved = reject;
  });
  void observedPromise.catch(() => {});

  const subscriptionId = await connection.onAccountChange(
    conditionPda,
    (accountInfo, context) => {
      try {
        const decoded = decodeConditionFast(accountInfo.data);
        if (!decoded) return;
        if (decoded.sequence !== 2 || decoded.predicateResult !== true) return;
        if (fired) return;
        fired = true;
        telemetry.mark('condition_observed', {
          slot: context.slot,
          sequence: decoded.sequence,
          predicateResult: decoded.predicateResult,
          evidence: 'condition-account-change-processed',
        });
        resolveObserved({ slot: context.slot, decoded });
        void onExecutable(context, decoded);
      } catch (error) {
        rejectObserved(error);
      }
    },
    'processed',
  );

  return {
    observedPromise,
    subscriptionId,
    fired: () => fired,
  };
}

async function cleanupConditionObserver(connection, observer) {
  if (!observer) return;
  try {
    await connection.removeAccountChangeListener(observer.subscriptionId);
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

async function readConditionVector(program, conditionPdas) {
  const states = await program.account.conditionState.fetchMultiple(conditionPdas, 'processed');
  return states.map((state, index) => state ? {
    kind: index,
    sequence: Number(state.sequence),
    predicateResult: state.predicateResult,
  } : { kind: index, missing: true });
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
    baseProgram.methods.createObjective(
      [...objectiveSeed],
      new anchor.BN(TARGET_EXPOSURE),
      new anchor.BN(1),
      conditionPdas,
    ).accounts({ objective: objectivePda, path: pathPda, authority, systemProgram: SystemProgram.programId }),
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
    baseProgram.methods.initializeSessionCandidate(
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

  let activeProgram = baseProgram;
  let activeConnection = baseConnection;

  if (mode === 'magicblock') {
    const validatorRemaining = [{
      pubkey: ER_VALIDATOR,
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
  ).accounts({
    condition: conditionPdas[kind],
    source: sources[kind].publicKey,
  });

  // Warm state: C2 is the only blocker.
  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
    await setupSend(updateBuilder(kind, 1, kind !== 2), [sources[kind]]);
  }

  const sealBuilder = activeProgram.methods
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

  const [openPrepared, sealPrepared, closePrepared] = await Promise.all([
    prepareBuilder(updateBuilder(2, 2, true), activeConnection, wallet, [sources[2]]),
    prepareBuilder(sealBuilder, activeConnection, wallet),
    prepareBuilder(updateBuilder(0, 2, false), activeConnection, wallet, [sources[0]]),
  ]);

  return {
    activeProgram,
    activeConnection,
    candidatePda,
    conditionPdas,
    openConditionPda: conditionPdas[2],
    openPrepared,
    sealPrepared,
    closePrepared,
  };
}

async function runTrial({
  mode,
  windowMs,
  trialIndex,
  baseProgram,
  baseProvider,
  baseConnection,
  erProgram,
  erConnection,
  wallet,
}) {
  const fixture = await createFixture({
    mode,
    baseProgram,
    baseProvider,
    baseConnection,
    erProgram,
    erConnection,
    wallet,
  });

  const telemetry = new TrialTelemetry({
    scenarioId: `m4-coordination-${mode}-${windowMs}-${trialIndex}`,
    path: mode,
    cluster: 'local-controlled',
    windowMs,
    seed: `${windowMs}:${trialIndex}`,
    expectedSequences: EXPECTED_SEQUENCES,
  });

  telemetry.config({
    benchmarkStage: 'smoke',
    rolesSeparated: true,
    sourceUpdateAndSealBundling: false,
    observer: 'processed-account-change-on-opening-condition',
    setupExcludedFromTiming: true,
    prebuiltTransactions: true,
    preSignedTransactions: true,
    closeSchedule: 'independent-source-submit-at-t0-plus-window',
  });

  let openSignature = null;
  let sealSignature = null;
  let closeSignature = null;
  let sealSubmitError = null;
  let failure = null;
  let observerFailure = null;

  const openProcessedWatch = await createSignatureWatch(
    fixture.activeConnection,
    fixture.openPrepared.signature,
    'processed',
    (context) => telemetry.mark('window_open_acknowledged', { slot: context.slot }),
  );
  const sealProcessedWatch = await createSignatureWatch(
    fixture.activeConnection,
    fixture.sealPrepared.signature,
    'processed',
    (context) => telemetry.mark('capture_observed', { slot: context.slot }),
  );
  const closeProcessedWatch = await createSignatureWatch(
    fixture.activeConnection,
    fixture.closePrepared.signature,
    'processed',
    (context) => telemetry.mark('window_close_processed', { slot: context.slot }),
  );

  let sealSubmitStarted = false;
  const observer = await createConditionObserver(
    fixture.activeConnection,
    fixture.openConditionPda,
    telemetry,
    async () => {
      if (sealSubmitStarted) return;
      sealSubmitStarted = true;
      telemetry.mark('decision_submitted');
      try {
        sealSignature = await sendRaw(fixture.activeConnection, fixture.sealPrepared);
        telemetry.signature('seal', sealSignature);
      } catch (error) {
        sealSubmitError = String(error?.message ?? error);
      }
    },
  );

  await sleep(SUBSCRIPTION_WARM_MS);

  telemetry.mark('window_open_emitted', {
    source: 'condition-2-writer',
    sequence: 2,
    predicateResult: true,
  });

  const closePromise = new Promise((resolve) => {
    setTimeout(async () => {
      telemetry.mark('window_close_emitted', {
        source: 'condition-0-writer',
        sequence: 2,
        predicateResult: false,
      });
      try {
        closeSignature = await sendRaw(fixture.activeConnection, fixture.closePrepared);
        telemetry.signature('close', closeSignature);
        resolve({ ok: true });
      } catch (error) {
        resolve({ ok: false, error: String(error?.message ?? error) });
      }
    }, windowMs);
  });

  try {
    openSignature = await sendRaw(fixture.activeConnection, fixture.openPrepared);
    telemetry.signature('open', openSignature);
  } catch (error) {
    failure = `open submit failed: ${error?.message ?? error}`;
  }

  if (!failure) {
    try {
      await withTimeout(observer.observedPromise, `${mode} opening condition observation`);
    } catch (error) {
      observerFailure = String(error?.message ?? error);
    }
  }

  if (!failure && !observerFailure) {
    try {
      await withTimeout(sealProcessedWatch.promise, `${mode} seal processed`);
    } catch (error) {
      if (!sealSubmitError) sealSubmitError = String(error?.message ?? error);
    }
  }

  const closeResult = await closePromise;

  try {
    await withTimeout(openProcessedWatch.promise, `${mode} open processed`);
  } catch (error) {
    if (!failure) failure = String(error?.message ?? error);
  }

  try {
    if (closeResult.ok) {
      await withTimeout(closeProcessedWatch.promise, `${mode} close processed`);
    } else if (!failure) {
      failure = `close submit failed: ${closeResult.error}`;
    }
  } catch (error) {
    if (!failure) failure = String(error?.message ?? error);
  }

  let candidate = null;
  let exactVersionMatch = false;
  let falseLock = false;
  let verificationError = null;
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
      && candidate.frozenSequences.join(',') === EXPECTED_SEQUENCES.join(',');
    falseLock = state.ready === true && !exactVersionMatch;
  } catch (error) {
    verificationError = String(error?.message ?? error);
  }

  let diagnosticVector = null;
  try {
    diagnosticVector = await readConditionVector(fixture.activeProgram, fixture.conditionPdas);
  } catch (error) {
    diagnosticVector = [{ error: String(error?.message ?? error) }];
  }

  await Promise.allSettled([
    cleanupConditionObserver(fixture.activeConnection, observer),
    cleanupSignatureWatch(fixture.activeConnection, openProcessedWatch),
    cleanupSignatureWatch(fixture.activeConnection, sealProcessedWatch),
    cleanupSignatureWatch(fixture.activeConnection, closeProcessedWatch),
  ]);

  const sealMarkExists = telemetry.record?.marks?.capture_observed != null;
  const capture = exactVersionMatch && sealMarkExists && !falseLock && !verificationError;
  const staleAttempt = Boolean(
    sealSubmitStarted
    && !capture
    && (sealSubmitError?.includes('6014') || sealSubmitError?.includes('SequenceMismatch')),
  );
  const ambiguous = Boolean(observerFailure || verificationError || (sealSubmitStarted && !sealMarkExists && !sealSubmitError));

  telemetry.set({
    capture,
    exactVersionMatch,
    falseLock,
    staleAttempt,
    ambiguous,
    observerFailure,
    sealSubmitError,
    failure,
    candidate,
    diagnosticConditionVector: diagnosticVector,
  });

  const result = telemetry.finish();
  const vector = diagnosticVector?.map((item) => item.sequence ?? '?').join(',') ?? 'n/a';
  console.log(
    `${mode} window=${windowMs}ms trial=${trialIndex + 1}`
    + ` capture=${result.capture}`
    + ` exact=${result.exactVersionMatch}`
    + ` stale=${result.staleAttempt}`
    + ` falseLock=${result.falseLock}`
    + ` ambiguous=${result.ambiguous}`
    + ` t0->seal=${result.latency.captureMs?.toFixed(3) ?? 'n/a'}ms`
    + ` observe->seal=${result.latency.observationToDecisionMs?.toFixed(3) ?? 'n/a'}ms`
    + ` vector=[${vector}]`
    + (sealSubmitError ? ` sealError=${sealSubmitError}` : '')
    + (observerFailure ? ` observerError=${observerFailure}` : '')
    + (failure ? ` failure=${failure}` : ''),
  );

  return result;
}

function summarizeByBand(trials) {
  const summary = {};
  for (const path of ['solana', 'magicblock']) {
    summary[path] = {};
    for (const windowMs of WINDOWS_MS) {
      summary[path][windowMs] = summarizeTrials(
        trials.filter((trial) => trial.path === path && trial.windowMs === windowMs),
      );
    }
  }
  return summary;
}

function buildComparisons(trials) {
  const comparisons = {};
  for (const windowMs of WINDOWS_MS) {
    const solana = trials.filter((trial) => trial.path === 'solana' && trial.windowMs === windowMs);
    const magicblock = trials.filter((trial) => trial.path === 'magicblock' && trial.windowMs === windowMs);
    const solanaCaptured = solana.filter((trial) => trial.capture && trial.exactVersionMatch).length;
    const magicblockCaptured = magicblock.filter((trial) => trial.capture && trial.exactVersionMatch).length;
    comparisons[windowMs] = {
      solana: {
        captured: solanaCaptured,
        trials: solana.length,
        rate: solana.length ? solanaCaptured / solana.length : null,
      },
      magicblock: {
        captured: magicblockCaptured,
        trials: magicblock.length,
        rate: magicblock.length ? magicblockCaptured / magicblock.length : null,
      },
      magicblockMinusSolana: captureRateDifference95(
        magicblockCaptured,
        magicblock.length,
        solanaCaptured,
        solana.length,
      ),
      falseLocks: {
        solana: solana.filter((trial) => trial.falseLock).length,
        magicblock: magicblock.filter((trial) => trial.falseLock).length,
      },
      ambiguous: {
        solana: solana.filter((trial) => trial.ambiguous).length,
        magicblock: magicblock.filter((trial) => trial.ambiguous).length,
      },
    };
  }
  return comparisons;
}

const idlPath = process.env.REACTOR_IDL ?? 'target/idl/reactor.json';
if (!fs.existsSync(idlPath)) throw new Error(`missing ${idlPath}`);
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
const envProvider = anchor.AnchorProvider.env();
const wallet = envProvider.wallet;

const baseConnection = new Connection(BASE_RPC, {
  commitment: 'confirmed',
  wsEndpoint: BASE_WS,
});
const erConnection = new Connection(ER_RPC, {
  commitment: 'confirmed',
  wsEndpoint: ER_WS,
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

console.log('M4-Coordination local smoke benchmark');
console.log(`program: ${baseProgram.programId}`);
console.log(`base: ${BASE_RPC}`);
console.log(`er:   ${ER_RPC}`);
console.log(`windows: ${WINDOWS_MS.join(', ')} ms`);
console.log(`trials/band/path: ${TRIALS_PER_BAND}`);
console.log('roles: independent source writers; separate observer/coordinator; no update+seal transaction');
console.log('observer: warmed processed account-change subscription on opening condition');
console.log('scope: harness semantics + crossover discovery only; frozen continuation gate is NOT evaluated by this smoke run');

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
  benchmark: 'reactor-m4-coordination-local-smoke',
  scope: 'non-co-bundleable-source-observer-coordinator-smoke-not-frozen-gate',
  generatedAt: new Date().toISOString(),
  configuration: {
    baseRpc: BASE_RPC,
    erRpc: ER_RPC,
    windowsMs: WINDOWS_MS,
    trialsPerBandPerPath: TRIALS_PER_BAND,
    expectedSequences: EXPECTED_SEQUENCES,
    rolesSeparated: true,
    updateSealBundlingAllowed: false,
    observer: 'processed-account-change',
    fixture: {
      initialExposure: INITIAL_EXPOSURE,
      targetExposure: TARGET_EXPOSURE,
      exposureReduction: EXPOSURE_REDUCTION,
      transferLamports: TRANSFER_LAMPORTS,
    },
  },
  summary: summarizeByBand(trials),
  comparisons: buildComparisons(trials),
  frozenContinuationGateEvaluated: false,
  nextRequirement: 'If smoke semantics are clean and a crossover appears, implement strongest honest Solana speculative/observer baselines before >=50-trial gate runs.',
  trials,
};

fs.mkdirSync('experiment/results', { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
console.log('\nM4-Coordination smoke summary');
console.log(JSON.stringify(result.comparisons, null, 2));
console.log(`evidence written: ${OUTPUT_PATH}`);
