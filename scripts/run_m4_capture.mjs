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
const MAGICBLOCK_BASE_RPC = process.env.REACTOR_BASE_RPC ?? 'https://rpc.magicblock.app/devnet';
const ROUTER_RPC = process.env.REACTOR_ROUTER_RPC ?? 'https://devnet-router.magicblock.app/';
const PATH_MODE = process.env.REACTOR_M4_PATH ?? 'both';
const TRIALS_PER_WINDOW = Number(process.env.REACTOR_M4_TRIALS_PER_WINDOW ?? 1);
const WINDOW_MS = (process.env.REACTOR_M4_WINDOWS_MS ?? '50,100,150,250,500,1000')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
const OUTPUT_PATH = process.env.REACTOR_M4_RESULT_PATH ?? 'experiment/results/m4-capture-latest.json';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function derive(programId, seeds) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

async function setupSend(builder, signers = []) {
  const signed = signers.length > 0 ? builder.signers(signers) : builder;
  const signature = await signed.rpc({ commitment: 'confirmed' });
  if (SETUP_PACE_MS > 0) await sleep(SETUP_PACE_MS);
  return signature;
}

async function measuredSend(builder, signers = []) {
  const signed = signers.length > 0 ? builder.signers(signers) : builder;
  return signed.rpc({ commitment: 'confirmed' });
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

async function createFixture({ baseProgram, baseProvider, baseConnection, providerPayer, mode, scenarioSeed }) {
  const programId = baseProgram.programId;
  const authorityKeypair = Keypair.generate();
  const authority = authorityKeypair.publicKey;
  const recipient = Keypair.generate().publicKey;
  const sources = Array.from({ length: CONDITION_COUNT }, () => Keypair.generate());
  const objectiveSeed = crypto.createHash('sha256').update(`reactor-m4:${scenarioSeed}:${mode}`).digest();
  const pathPda = derive(programId, [Buffer.from('path'), authority.toBuffer()]);
  const objectivePda = derive(programId, [Buffer.from('objective'), authority.toBuffer(), objectiveSeed]);
  const vaultPda = derive(programId, [Buffer.from('vault'), objectivePda.toBuffer()]);
  const conditionPdas = Array.from({ length: CONDITION_COUNT }, (_, kind) =>
    derive(programId, [Buffer.from('condition'), objectivePda.toBuffer(), Buffer.from([kind])]),
  );
  const candidatePda = derive(programId, [Buffer.from('session_candidate'), objectivePda.toBuffer()]);
  const lockPda = derive(programId, [Buffer.from('lock'), objectivePda.toBuffer()]);

  await fundFixture(baseProvider, providerPayer, authority);
  const startSlot = await baseConnection.getSlot('confirmed');
  const pathExpiry = new anchor.BN(startSlot + 10_000);

  await setupSend(baseProgram.methods.initializePath(new anchor.BN(1_000_000), pathExpiry)
    .accounts({ path: pathPda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  await setupSend(baseProgram.methods.createObjective([...objectiveSeed], new anchor.BN(TARGET_EXPOSURE), new anchor.BN(1), conditionPdas)
    .accounts({ objective: objectivePda, path: pathPda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  await setupSend(baseProgram.methods.initializeVault(new anchor.BN(INITIAL_EXPOSURE))
    .accounts({ vault: vaultPda, objective: objectivePda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);

  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
    await setupSend(baseProgram.methods.initializeCondition(kind, sources[kind].publicKey)
      .accounts({ condition: conditionPdas[kind], objective: objectivePda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
  }

  let erConnection = null;
  let erProgram = null;
  let validator = null;
  let erEndpoint = null;

  if (mode === 'magicblock') {
    await setupSend(baseProgram.methods.initializeSessionCandidate(recipient, new anchor.BN(TRANSFER_LAMPORTS), new anchor.BN(EXPOSURE_REDUCTION))
      .accounts({ sessionCandidate: candidatePda, objective: objectivePda, path: pathPda, authority, vault: vaultPda, systemProgram: SystemProgram.programId }), [authorityKeypair]);

    await setupSend(baseProgram.methods.delegateSessionCandidate()
      .accounts({ payer: authority, objective: objectivePda, sessionCandidate: candidatePda }), [authorityKeypair]);
    const candidateShape = await waitForHealthyDelegation(baseConnection, candidatePda, programId);
    validator = candidateShape.status.delegationRecord.authority;
    erEndpoint = candidateShape.status.fqdn;
    erConnection = candidateShape.erConnection;
    const erProvider = new anchor.AnchorProvider(erConnection, baseProvider.wallet, {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    });
    erProgram = new anchor.Program(baseProgram.idl, erProvider);
    const validatorRemaining = [{ pubkey: new PublicKey(validator), isSigner: false, isWritable: false }];

    for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
      await setupSend(baseProgram.methods.delegateCondition(kind)
        .accounts({ payer: authority, objective: objectivePda, condition: conditionPdas[kind] })
        .remainingAccounts(validatorRemaining), [authorityKeypair]);
      const shape = await waitForHealthyDelegation(baseConnection, conditionPdas[kind], programId, validator);
      assert(shape.status.fqdn === erEndpoint, `condition ${kind} routed to a different ER`);
    }
  }

  const activeConnection = mode === 'magicblock' ? erConnection : baseConnection;
  const activeProgram = mode === 'magicblock' ? erProgram : baseProgram;

  async function update(kind, sequence, predicateResult, measured = false) {
    const currentSlot = await activeConnection.getSlot('confirmed');
    const builder = activeProgram.methods.updateCondition(
      new anchor.BN(sequence),
      new anchor.BN(100 + kind),
      predicateResult,
      new anchor.BN(currentSlot + CONDITION_TTL_SLOTS),
    ).accounts({ condition: conditionPdas[kind], source: sources[kind].publicKey });
    return measured ? measuredSend(builder, [sources[kind]]) : setupSend(builder, [sources[kind]]);
  }

  for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
    await update(kind, 1, kind !== 2, false);
  }

  return {
    authorityKeypair,
    authority,
    recipient,
    objectivePda,
    vaultPda,
    conditionPdas,
    candidatePda,
    lockPda,
    activeConnection,
    activeProgram,
    update,
    validator,
    erEndpoint,
  };
}

async function runTrial({ mode, windowMs, trialIndex, baseProgram, baseProvider, baseConnection, providerPayer }) {
  const seed = `window-${windowMs}-trial-${trialIndex}`;
  const scenarioId = `m4-${seed}`;
  const fixture = await createFixture({
    baseProgram,
    baseProvider,
    baseConnection,
    providerPayer,
    mode,
    scenarioSeed: seed,
  });

  const telemetry = new TrialTelemetry({
    scenarioId,
    path: mode,
    cluster: 'solana-devnet',
    windowMs,
    seed,
    expectedSequences: EXPECTED_SEQUENCES,
  });
  telemetry.config({
    programId: baseProgram.programId.toBase58(),
    baseRpc: BASE_RPC,
    magicBlockBaseRpc: MAGICBLOCK_BASE_RPC,
    routerRpc: ROUTER_RPC,
    erEndpoint: fixture.erEndpoint,
    validator: fixture.validator,
    setupExcludedFromTiming: true,
    conditionTtlSlots: CONDITION_TTL_SLOTS,
    authorityModel: 'independent-source-transactions',
  });

  const closePromise = new Promise((resolve) => {
    setTimeout(async () => {
      telemetry.mark('window_close_emitted', { source: 'condition-0', sequence: 2, predicateResult: false });
      try {
        const signature = await fixture.update(0, 2, false, true);
        telemetry.signature('windowCloseUpdate', signature);
        telemetry.mark('window_close_acknowledged');
        resolve({ ok: true, signature });
      } catch (error) {
        telemetry.mark('window_close_failed', { error: String(error?.message ?? error) });
        resolve({ ok: false, error: String(error?.message ?? error) });
      }
    }, windowMs);
  });

  telemetry.mark('window_open_emitted', { source: 'condition-2', sequence: 2, predicateResult: true });
  try {
    const openSignature = await fixture.update(2, 2, true, true);
    telemetry.signature('windowOpenUpdate', openSignature);
    telemetry.mark('window_open_acknowledged');

    const observed = await fixture.activeProgram.account.conditionState.fetch(fixture.conditionPdas[2], 'confirmed');
    assert(Number(observed.sequence) === 2 && observed.predicateResult === true, 'opening condition was not observed as executable');
    telemetry.mark('condition_observed', { sequence: Number(observed.sequence) });

    telemetry.mark('decision_submitted');
    let decisionSignature;
    if (mode === 'magicblock') {
      const evaluationAccounts = {
        sessionCandidate: fixture.candidatePda,
        condition0: fixture.conditionPdas[0],
        condition1: fixture.conditionPdas[1],
        condition2: fixture.conditionPdas[2],
        condition3: fixture.conditionPdas[3],
        condition4: fixture.conditionPdas[4],
        condition5: fixture.conditionPdas[5],
      };
      decisionSignature = await measuredSend(
        fixture.activeProgram.methods.evaluateSessionCandidate(EXPECTED_SEQUENCES.map((n) => new anchor.BN(n))).accounts(evaluationAccounts),
      );
    } else {
      decisionSignature = await measuredSend(
        fixture.activeProgram.methods.evaluateAndLock(
          EXPECTED_SEQUENCES.map((n) => new anchor.BN(n)),
          new anchor.BN(TRANSFER_LAMPORTS),
          new anchor.BN(EXPOSURE_REDUCTION),
        ).accounts({
          payer: fixture.authority,
          path: derive(baseProgram.programId, [Buffer.from('path'), fixture.authority.toBuffer()]),
          objective: fixture.objectivePda,
          vault: fixture.vaultPda,
          recipient: fixture.recipient,
          condition0: fixture.conditionPdas[0],
          condition1: fixture.conditionPdas[1],
          condition2: fixture.conditionPdas[2],
          condition3: fixture.conditionPdas[3],
          condition4: fixture.conditionPdas[4],
          condition5: fixture.conditionPdas[5],
          executionLock: fixture.lockPda,
          systemProgram: SystemProgram.programId,
        }),
        [fixture.authorityKeypair],
      );
    }
    telemetry.signature('decision', decisionSignature);
    telemetry.mark('decision_acknowledged');

    let exactVersionMatch = false;
    if (mode === 'magicblock') {
      const candidate = await fixture.activeProgram.account.sessionCandidate.fetch(fixture.candidatePda, 'confirmed');
      exactVersionMatch = candidate.ready === true && candidate.frozenSequences.map(Number).join(',') === EXPECTED_SEQUENCES.join(',');
    } else {
      const lock = await fixture.activeProgram.account.executionLock.fetch(fixture.lockPda, 'confirmed');
      exactVersionMatch = lock.sequences.map(Number).join(',') === EXPECTED_SEQUENCES.join(',');
    }
    telemetry.mark('capture_observed');
    const captureMs = telemetry.deltaMs('window_open_emitted', 'capture_observed');
    const withinWindow = captureMs != null && captureMs <= windowMs;
    telemetry.set({
      exactVersionMatch,
      capture: exactVersionMatch && withinWindow,
      staleAttempt: exactVersionMatch && !withinWindow,
      falseLock: !exactVersionMatch,
    });
  } catch (error) {
    telemetry.mark('decision_failed', { error: String(error?.message ?? error) });
    telemetry.set({ capture: false });
  }

  await closePromise;
  return telemetry.finish();
}

function summarizeByBand(trials) {
  const result = {};
  for (const path of [...new Set(trials.map((trial) => trial.path))]) {
    result[path] = {};
    for (const windowMs of [...new Set(trials.filter((trial) => trial.path === path).map((trial) => trial.windowMs))].sort((a, b) => a - b)) {
      result[path][windowMs] = summarizeTrials(trials.filter((trial) => trial.path === path && trial.windowMs === windowMs));
    }
  }
  return result;
}

const idlPath = process.env.REACTOR_IDL ?? 'target/idl/reactor.json';
if (!fs.existsSync(idlPath)) throw new Error(`missing ${idlPath}; run anchor build first`);
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
assert(balance >= FIXTURE_BUDGET_LAMPORTS, `payer ${providerPayer} lacks devnet SOL for M4 fixtures`);

const modes = PATH_MODE === 'both' ? ['solana', 'magicblock'] : [PATH_MODE];
for (const mode of modes) assert(mode === 'solana' || mode === 'magicblock', `unsupported REACTOR_M4_PATH=${mode}`);

console.log('M4a capture benchmark');
console.log(`program: ${baseProgram.programId}`);
console.log(`base rpc: ${BASE_RPC}`);
console.log(`paths: ${modes.join(', ')}`);
console.log(`windows: ${WINDOW_MS.join(', ')} ms`);
console.log(`trials/window/path: ${TRIALS_PER_WINDOW}`);
console.log('setup/delegation time is excluded from measured latency');

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
      console.log(`${mode} window=${windowMs}ms capture=${trial.capture} exact=${trial.exactVersionMatch} stale=${trial.staleAttempt} latency=${trial.latency.captureMs?.toFixed(2) ?? 'n/a'}ms`);
    }
  }
}

const output = {
  benchmark: 'reactor-m4a-capture',
  scope: 'warmed-hot-path-capture-mechanics-not-production-performance',
  generatedAt: new Date().toISOString(),
  configuration: {
    baseRpc: BASE_RPC,
    magicBlockBaseRpc: MAGICBLOCK_BASE_RPC,
    routerRpc: ROUTER_RPC,
    windowsMs: WINDOW_MS,
    trialsPerWindowPerPath: TRIALS_PER_WINDOW,
    fixtureBudgetLamports: FIXTURE_BUDGET_LAMPORTS,
    setupPaceMs: SETUP_PACE_MS,
    conditionTtlSlots: CONDITION_TTL_SLOTS,
  },
  summary: summarizeByBand(trials),
  trials,
};

fs.mkdirSync('experiment/results', { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
console.log(`\nM4a evidence written: ${OUTPUT_PATH}`);
console.log(JSON.stringify(output.summary, null, 2));
