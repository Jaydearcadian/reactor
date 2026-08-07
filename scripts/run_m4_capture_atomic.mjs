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
const FIXTURE_BUDGET_LAMPORTS = Number(
  process.env.REACTOR_M4_FIXTURE_BUDGET_LAMPORTS ?? Math.floor(0.08 * LAMPORTS_PER_SOL),
);
const SETUP_PACE_MS = Number(process.env.REACTOR_M4_SETUP_PACE_MS ?? 250);
const CONDITION_TTL_SLOTS = Number(process.env.REACTOR_M4_CONDITION_TTL_SLOTS ?? 20_000);
const BASE_RPC = process.env.REACTOR_M4_BASE_RPC ?? 'https://api.devnet.solana.com';
const ROUTER_RPC = process.env.REACTOR_ROUTER_RPC ?? 'https://devnet-router.magicblock.app/';
const PATH_MODE = process.env.REACTOR_M4_PATH ?? 'both';
const TRIALS_PER_WINDOW = Number(process.env.REACTOR_M4_TRIALS_PER_WINDOW ?? 1);
const SUBSCRIPTION_WARM_MS = Number(process.env.REACTOR_M4_SUBSCRIPTION_WARM_MS ?? 300);
const OBSERVATION_TIMEOUT_MS = Number(process.env.REACTOR_M4_OBSERVATION_TIMEOUT_MS ?? 5000);
const DURABILITY_TIMEOUT_MS = Number(process.env.REACTOR_M4_DURABILITY_TIMEOUT_MS ?? 12000);
const WINDOW_MS = (process.env.REACTOR_M4_WINDOWS_MS ?? '50,100,150,250,500,1000')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
const OUTPUT_PATH = process.env.REACTOR_M4_RESULT_PATH ?? 'experiment/results/m4-capture-latest.json';
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

function withTimeout(promise, label, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getDelegationStatus',
      params: [pubkey.toBase58()],
    }),
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
      if (!status?.isDelegated || !status.fqdn || !status.delegationRecord) {
        await sleep(250);
        continue;
      }
      const validator = status.delegationRecord.authority;
      if (status.delegationRecord.owner !== programId.toBase58()) {
        throw new Error(`router original owner mismatch for ${pubkey}`);
      }
      if (expectedValidator && validator !== expectedValidator) {
        throw new Error(`validator mismatch ${validator} != ${expectedValidator}`);
      }
      const erConnection = new Connection(status.fqdn, 'confirmed');
      const [baseInfo, erInfo] = await Promise.all([
        baseConnection.getAccountInfo(pubkey, 'confirmed'),
        erConnection.getAccountInfo(pubkey, 'confirmed'),
      ]);
      if (baseInfo?.owner.equals(DELEGATION_PROGRAM_ID) && erInfo?.owner.equals(programId)) {
        return { status, erConnection };
      }
    } catch (error) {
      if (String(error).includes('mismatch')) throw error;
    }
    await sleep(250);
  }
  throw new Error(`delegation did not become healthy: ${pubkey}`);
}

async function fundFixture(baseProvider, providerPayer, authority) {
  await baseProvider.sendAndConfirm(
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: providerPayer,
        toPubkey: authority,
        lamports: FIXTURE_BUDGET_LAMPORTS,
      }),
    ),
    [],
  );
  if (SETUP_PACE_MS > 0) await sleep(SETUP_PACE_MS);
}

async function prepareTransaction(transaction, connection, wallet, extraSigners = []) {
  const latest = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = wallet.publicKey;
  if (extraSigners.length > 0) transaction.partialSign(...extraSigners);
  const signed = await wallet.signTransaction(transaction);
  assert(signed.signature, 'prepared transaction is missing its first signature');
  return {
    bytes: signed.serialize(),
    signature: base58Encode(signed.signature),
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
}

async function prepareBuilder(builder, connection, wallet, extraSigners = []) {
  return prepareTransaction(await builder.transaction(), connection, wallet, extraSigners);
}

async function sendRaw(connection, prepared) {
  const returned = await connection.sendRawTransaction(prepared.bytes, {
    skipPreflight: true,
    maxRetries: 0,
  });
  assert(returned === prepared.signature, `RPC returned unexpected signature ${returned} != ${prepared.signature}`);
  return returned;
}

async function createSignatureWatch(connection, signature, commitment, onSuccess = null) {
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
      if (result.err != null) {
        reject(new Error(`transaction ${signature} failed: ${JSON.stringify(result.err)}`));
        return;
      }
      try {
        if (onSuccess) onSuccess(context);
        resolve({ slot: context.slot, signature, commitment });
      } catch (error) {
        reject(error);
      }
    },
    commitment,
  );

  return {
    promise,
    subscriptionId,
    isSettled: () => settled,
  };
}

async function removePendingSignatureWatch(connection, watch) {
  if (!watch || watch.isSettled()) return;
  try {
    await connection.removeSignatureListener(watch.subscriptionId);
  } catch {
    // Best-effort cleanup. One-shot signature watches may already be removed.
  }
}

async function fallbackSignatureStatus(connection, signature) {
  try {
    const response = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    return response.value[0];
  } catch {
    return null;
  }
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

async function createFixture({ baseProgram, baseProvider, baseConnection, providerPayer, mode, scenarioSeed }) {
  const programId = baseProgram.programId;
  const authorityKeypair = Keypair.generate();
  const authority = authorityKeypair.publicKey;
  const recipient = Keypair.generate().publicKey;
  const sources = Array.from({ length: CONDITION_COUNT }, () => Keypair.generate());
  const objectiveSeed = crypto
    .createHash('sha256')
    .update(`reactor-m4-atomic:${scenarioSeed}:${mode}:${crypto.randomBytes(8).toString('hex')}`)
    .digest();

  const pathPda = derive(programId, [Buffer.from('path'), authority.toBuffer()]);
  const objectivePda = derive(programId, [Buffer.from('objective'), authority.toBuffer(), objectiveSeed]);
  const vaultPda = derive(programId, [Buffer.from('vault'), objectivePda.toBuffer()]);
  const conditionPdas = Array.from({ length: CONDITION_COUNT }, (_, kind) =>
    derive(programId, [Buffer.from('condition'), objectivePda.toBuffer(), Buffer.from([kind])]),
  );
  const candidatePda = derive(programId, [Buffer.from('session_candidate'), objectivePda.toBuffer()]);

  await fundFixture(baseProvider, providerPayer, authority);
  const startSlot = await baseConnection.getSlot('confirmed');
  const pathExpiry = new anchor.BN(startSlot + 10_000);

  await setupSend(
    baseProgram.methods.initializePath(new anchor.BN(1_000_000), pathExpiry)
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

  // Both paths use the same SessionCandidate primitive. MagicBlock delegates it;
  // the standard Solana baseline leaves the exact same account on base.
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

  let activeConnection = baseConnection;
  let activeProgram = baseProgram;
  let validator = null;
  let erEndpoint = null;

  if (mode === 'magicblock') {
    await setupSend(
      baseProgram.methods.delegateSessionCandidate()
        .accounts({ payer: authority, objective: objectivePda, sessionCandidate: candidatePda }),
      [authorityKeypair],
    );

    const candidateShape = await waitForHealthyDelegation(baseConnection, candidatePda, programId);
    validator = candidateShape.status.delegationRecord.authority;
    erEndpoint = candidateShape.status.fqdn;
    activeConnection = candidateShape.erConnection;

    const erProvider = new anchor.AnchorProvider(activeConnection, baseProvider.wallet, {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    });
    activeProgram = new anchor.Program(baseProgram.idl, erProvider);

    const validatorRemaining = [{
      pubkey: new PublicKey(validator),
      isSigner: false,
      isWritable: false,
    }];

    for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
      await setupSend(
        baseProgram.methods.delegateCondition(kind)
          .accounts({ payer: authority, objective: objectivePda, condition: conditionPdas[kind] })
          .remainingAccounts(validatorRemaining),
        [authorityKeypair],
      );
      const shape = await waitForHealthyDelegation(
        baseConnection,
        conditionPdas[kind],
        programId,
        validator,
      );
      assert(shape.status.fqdn === erEndpoint, `condition ${kind} routed to different ER`);
    }
  }

  const validityAnchorSlot = await activeConnection.getSlot('confirmed');
  const validityUntilSlot = validityAnchorSlot + CONDITION_TTL_SLOTS;
  const updateBuilder = (kind, sequence, predicateResult) => activeProgram.methods.updateCondition(
    new anchor.BN(sequence),
    new anchor.BN(100 + kind),
    predicateResult,
    new anchor.BN(validityUntilSlot),
  ).accounts({
    condition: conditionPdas[kind],
    source: sources[kind].publicKey,
  });

  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
    await setupSend(updateBuilder(kind, 1, kind !== 2), [sources[kind]]);
  }

  const evaluationAccounts = {
    sessionCandidate: candidatePda,
    condition0: conditionPdas[0],
    condition1: conditionPdas[1],
    condition2: conditionPdas[2],
    condition3: conditionPdas[3],
    condition4: conditionPdas[4],
    condition5: conditionPdas[5],
  };

  const openingInstruction = await updateBuilder(2, 2, true).instruction();
  const sealInstruction = await activeProgram.methods
    .evaluateSessionCandidate(EXPECTED_SEQUENCES.map((number) => new anchor.BN(number)))
    .accounts(evaluationAccounts)
    .instruction();

  const openAndSealTransaction = new Transaction()
    .add(openingInstruction)
    .add(sealInstruction);

  const closeBuilder = updateBuilder(0, 2, false);

  const [openAndSealPrepared, closePrepared] = await Promise.all([
    prepareTransaction(
      openAndSealTransaction,
      activeConnection,
      baseProvider.wallet,
      [sources[2]],
    ),
    prepareBuilder(
      closeBuilder,
      activeConnection,
      baseProvider.wallet,
      [sources[0]],
    ),
  ]);

  return {
    conditionPdas,
    candidatePda,
    activeConnection,
    activeProgram,
    validator,
    erEndpoint,
    openAndSealPrepared,
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
  providerPayer,
}) {
  const seed = `window-${windowMs}-trial-${trialIndex}`;
  const fixture = await createFixture({
    baseProgram,
    baseProvider,
    baseConnection,
    providerPayer,
    mode,
    scenarioSeed: seed,
  });

  const telemetry = new TrialTelemetry({
    scenarioId: `m4-atomic-${mode}-${seed}`,
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
    capturePrimitive: 'single-transaction-update-condition-then-evaluate-session-candidate',
    captureObservation: 'prewarmed-open-and-seal-signature-subscription-processed',
    exactVersionVerification: 'post-capture-session-candidate-read',
    durabilityRequirement: 'open-and-seal-and-close-confirmed',
  });

  let openAndSealSignature = null;
  let closeSignature = null;
  let failure = null;
  let exactVerificationError = null;
  let diagnosticVector = null;
  let captureStateObserved = false;
  let exactVersionMatch = false;
  let fallbackProcessedStatus = null;

  const captureProcessedWatch = await createSignatureWatch(
    fixture.activeConnection,
    fixture.openAndSealPrepared.signature,
    'processed',
    (context) => telemetry.mark('capture_observed', {
      slot: context.slot,
      evidence: 'atomic-open-and-seal-signature-processed',
    }),
  );

  const captureConfirmedWatch = await createSignatureWatch(
    fixture.activeConnection,
    fixture.openAndSealPrepared.signature,
    'confirmed',
  );

  const closeConfirmedWatch = await createSignatureWatch(
    fixture.activeConnection,
    fixture.closePrepared.signature,
    'confirmed',
  );

  await sleep(SUBSCRIPTION_WARM_MS);

  telemetry.mark('window_open_emitted', {
    source: 'condition-2',
    sequence: 2,
    predicateResult: true,
    bundledSeal: true,
  });

  const closePromise = new Promise((resolve) => {
    setTimeout(async () => {
      telemetry.mark('window_close_emitted', {
        source: 'condition-0',
        sequence: 2,
        predicateResult: false,
      });
      try {
        closeSignature = await sendRaw(fixture.activeConnection, fixture.closePrepared);
        telemetry.signature('windowCloseUpdate', closeSignature);
        telemetry.mark('window_close_submitted');
        resolve({ ok: true, signature: closeSignature });
      } catch (error) {
        const message = String(error?.message ?? error);
        telemetry.mark('window_close_failed', { error: message });
        resolve({ ok: false, error: message });
      }
    }, windowMs);
  });

  try {
    openAndSealSignature = await sendRaw(
      fixture.activeConnection,
      fixture.openAndSealPrepared,
    );
    telemetry.signature('openAndSeal', openAndSealSignature);
    telemetry.mark('window_open_submitted');

    try {
      await withTimeout(
        captureProcessedWatch.promise,
        'atomic open-and-seal processed',
        OBSERVATION_TIMEOUT_MS,
      );
      captureStateObserved = true;
    } catch (error) {
      fallbackProcessedStatus = await fallbackSignatureStatus(
        fixture.activeConnection,
        openAndSealSignature,
      );
      if (fallbackProcessedStatus?.err != null) {
        throw new Error(
          `transaction ${openAndSealSignature} failed: ${JSON.stringify(fallbackProcessedStatus.err)}`,
        );
      }
      if (fallbackProcessedStatus && fallbackProcessedStatus.err == null) {
        // This can verify mechanics after a subscription miss, but it cannot recover
        // an honest millisecond capture timestamp. Keep the trial ambiguous.
        captureStateObserved = true;
        exactVerificationError = 'processed signature notification missed; capture timestamp unavailable';
      } else {
        throw error;
      }
    }

    try {
      const candidate = await fixture.activeProgram.account.sessionCandidate.fetch(
        fixture.candidatePda,
        'processed',
      );
      exactVersionMatch = candidate.ready === true
        && candidate.frozenSequences.map(Number).join(',') === EXPECTED_SEQUENCES.join(',');
    } catch (error) {
      exactVerificationError = exactVerificationError
        ?? String(error?.message ?? error);
    }
  } catch (error) {
    failure = String(error?.message ?? error);
    telemetry.mark('decision_failed', { error: failure });
  }

  const closeResult = await closePromise;

  try {
    diagnosticVector = await readConditionVector(
      fixture.activeProgram,
      fixture.conditionPdas,
      'processed',
    );
  } catch (error) {
    diagnosticVector = [{ diagnosticError: String(error?.message ?? error) }];
  }

  const captureMs = telemetry.deltaMs('window_open_emitted', 'capture_observed');
  const withinWindow = captureMs != null && captureMs <= windowMs;

  let captureConfirmed = false;
  let closeConfirmed = false;

  try {
    if (openAndSealSignature) {
      await withTimeout(
        captureConfirmedWatch.promise,
        'atomic open-and-seal confirmed',
        DURABILITY_TIMEOUT_MS,
      );
      captureConfirmed = true;
      telemetry.mark('decision_confirmed');
    }
  } catch (error) {
    if (!failure) failure = String(error?.message ?? error);
    telemetry.mark('decision_confirmation_failed', {
      error: String(error?.message ?? error),
    });
  }

  try {
    if (closeSignature) {
      await withTimeout(
        closeConfirmedWatch.promise,
        'close confirmed',
        DURABILITY_TIMEOUT_MS,
      );
      closeConfirmed = true;
      telemetry.mark('window_close_confirmed');
    }
  } catch (error) {
    telemetry.mark('window_close_confirmation_failed', {
      error: String(error?.message ?? error),
    });
  }

  await Promise.allSettled([
    removePendingSignatureWatch(fixture.activeConnection, captureProcessedWatch),
    removePendingSignatureWatch(fixture.activeConnection, captureConfirmedWatch),
    removePendingSignatureWatch(fixture.activeConnection, closeConfirmedWatch),
  ]);

  const timingAmbiguous = exactVerificationError === 'processed signature notification missed; capture timestamp unavailable';
  const durableCapture = captureStateObserved
    && exactVersionMatch
    && !timingAmbiguous
    && withinWindow
    && captureConfirmed
    && closeConfirmed;

  const ambiguous = Boolean(
    exactVerificationError != null
    || (openAndSealSignature && !captureConfirmed)
    || (closeResult.ok && !closeConfirmed),
  );

  telemetry.set({
    capture: durableCapture,
    captureStateObserved,
    exactVersionMatch,
    staleAttempt: captureStateObserved && exactVersionMatch && !timingAmbiguous && !withinWindow,
    falseLock: captureStateObserved && exactVerificationError == null && !exactVersionMatch,
    ambiguous,
    decisionConfirmed: captureConfirmed,
    closeConfirmed,
    failure,
    exactVerificationError,
    fallbackProcessedStatus,
    diagnosticConditionVector: diagnosticVector,
  });

  return telemetry.finish();
}

function summarizeByBand(trials) {
  const output = {};
  for (const path of [...new Set(trials.map((trial) => trial.path))]) {
    output[path] = {};
    const bands = [...new Set(
      trials
        .filter((trial) => trial.path === path)
        .map((trial) => trial.windowMs),
    )].sort((a, b) => a - b);

    for (const band of bands) {
      output[path][band] = summarizeTrials(
        trials.filter((trial) => trial.path === path && trial.windowMs === band),
      );
    }
  }
  return output;
}

const idlPath = process.env.REACTOR_IDL ?? 'target/idl/reactor.json';
if (!fs.existsSync(idlPath)) {
  throw new Error(`missing ${idlPath}; run anchor build once before M4`);
}
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
const envProvider = anchor.AnchorProvider.env();
const wallet = envProvider.wallet;
const baseConnection = new Connection(BASE_RPC, 'confirmed');
const baseProvider = new anchor.AnchorProvider(baseConnection, wallet, {
  commitment: 'confirmed',
  preflightCommitment: 'confirmed',
});
const baseProgram = new anchor.Program(idl, baseProvider);
const providerPayer = wallet.publicKey;
const balance = await baseConnection.getBalance(providerPayer, 'confirmed');
assert(
  balance >= FIXTURE_BUDGET_LAMPORTS,
  `payer ${providerPayer} lacks devnet SOL for M4 fixtures`,
);

const modes = PATH_MODE === 'both' ? ['solana', 'magicblock'] : [PATH_MODE];
for (const mode of modes) {
  assert(mode === 'solana' || mode === 'magicblock', `unsupported REACTOR_M4_PATH=${mode}`);
}

console.log('M4a ATOMIC capture benchmark');
console.log(`program: ${baseProgram.programId}`);
console.log(`base rpc: ${BASE_RPC}`);
console.log(`paths: ${modes.join(', ')}`);
console.log(`windows: ${WINDOW_MS.join(', ')} ms`);
console.log(`trials/window/path: ${TRIALS_PER_WINDOW}`);
console.log('build/deploy/setup/delegation/construction/blockhash/signing/subscription warm-up are excluded from T0→capture');
console.log('measured path: one signed transaction performs source-2 update + exact six-condition candidate seal');
console.log('the same SessionCandidate and same two Reactor instructions are used on Solana and MagicBlock');
console.log('independent source-0 invalidation is sent at the configured window deadline');

const trials = [];
for (const windowMs of WINDOW_MS) {
  for (let trialIndex = 0; trialIndex < TRIALS_PER_WINDOW; trialIndex += 1) {
    for (const mode of modes) {
      console.log(`\nsetup ${mode} window=${windowMs}ms trial=${trialIndex + 1}`);
      const trial = await runTrial({
        mode,
        windowMs,
        trialIndex,
        baseProgram,
        baseProvider,
        baseConnection,
        providerPayer,
      });
      trials.push(trial);

      const failureText = trial.failure ? ` failure=${trial.failure}` : '';
      const verificationText = trial.exactVerificationError
        ? ` verifyError=${trial.exactVerificationError}`
        : '';
      const vector = trial.diagnosticConditionVector
        ?.map((item) => item.sequence ?? '?')
        .join(',') ?? 'n/a';

      console.log(
        `${mode} window=${windowMs}ms capture=${trial.capture}`
        + ` exact=${trial.exactVersionMatch}`
        + ` stale=${trial.staleAttempt}`
        + ` falseLock=${trial.falseLock}`
        + ` ambiguous=${trial.ambiguous}`
        + ` latency=${trial.latency.captureMs?.toFixed(2) ?? 'n/a'}ms`
        + ` vector=[${vector}]`
        + failureText
        + verificationText,
      );
    }
  }
}

const output = {
  benchmark: 'reactor-m4a-atomic-capture',
  scope: 'same-transaction-final-update-and-seal-on-base-vs-er-not-production-performance',
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
    capturePrimitive: 'update-condition-plus-evaluate-session-candidate-in-one-transaction',
    captureObservation: 'prewarmed-atomic-transaction-signature-processed',
  },
  summary: summarizeByBand(trials),
  trials,
};

fs.mkdirSync('experiment/results', { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
console.log(`\nM4a evidence written: ${OUTPUT_PATH}`);
console.log(JSON.stringify(output.summary, null, 2));
