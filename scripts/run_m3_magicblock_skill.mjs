import fs from "node:fs";
import crypto from "node:crypto";
import * as anchorNamespace from "@coral-xyz/anchor";
import {
  DELEGATION_PROGRAM_ID,
  GetCommitmentSignature,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

const anchor = anchorNamespace.default ?? anchorNamespace;

const CONDITION_COUNT = 6;
const TRANSFER_LAMPORTS = 100_000;
const INITIAL_EXPOSURE = 700;
const TARGET_EXPOSURE = 500;
const EXPOSURE_REDUCTION = 200;
const AUTHORITY_BUDGET_LAMPORTS = Math.floor(0.5 * LAMPORTS_PER_SOL);
const BASE_RPC = process.env.REACTOR_BASE_RPC ?? "https://rpc.magicblock.app/devnet";
const ROUTER_RPC = process.env.REACTOR_ROUTER_RPC ?? "https://devnet-router.magicblock.app/";
const ER_OVERRIDE = process.env.REACTOR_ER_RPC ?? null;
const RPC_PACE_MS = Number(process.env.REACTOR_RPC_PACE_MS ?? 350);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pace() {
  if (RPC_PACE_MS > 0) await sleep(RPC_PACE_MS);
}

async function expectFailure(label, fn) {
  try {
    await fn();
  } catch (error) {
    console.log(`expected failure: ${label}`);
    return error;
  }
  throw new Error(`expected failure did not occur: ${label}`);
}

function derive(programId, seeds) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

async function send(builder, signers = [], options = {}) {
  try {
    const signed = signers.length > 0 ? builder.signers(signers) : builder;
    return await signed.rpc({ commitment: "confirmed", ...options });
  } finally {
    await pace();
  }
}

async function getDelegationStatus(pubkey) {
  const response = await fetch(ROUTER_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getDelegationStatus",
      params: [pubkey.toBase58()],
    }),
  });
  if (!response.ok) throw new Error(`router HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`router error: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

async function waitForDelegation(pubkey, programId, expectedValidator = null, attempts = 160) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const status = await getDelegationStatus(pubkey);
      if (status?.isDelegated && status.fqdn && status.delegationRecord) {
        const validator = status.delegationRecord.authority;
        const originalOwner = status.delegationRecord.owner;
        if (originalOwner !== programId.toBase58()) {
          throw new Error(`router original owner mismatch for ${pubkey}: ${originalOwner}`);
        }
        if (expectedValidator && validator !== expectedValidator) {
          throw new Error(`delegated validator mismatch for ${pubkey}: ${validator} != ${expectedValidator}`);
        }
        return status;
      }
    } catch (error) {
      if (String(error).includes("mismatch")) throw error;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for router delegation: ${pubkey}`);
}

async function waitForHealthyDelegation(baseConnection, pubkey, programId, expectedValidator = null) {
  const status = await waitForDelegation(pubkey, programId, expectedValidator);
  const fqdn = ER_OVERRIDE ?? status.fqdn;
  const erConnection = new Connection(fqdn, "confirmed");

  for (let attempt = 0; attempt < 160; attempt += 1) {
    const [baseInfo, erInfo] = await Promise.all([
      baseConnection.getAccountInfo(pubkey, "confirmed"),
      erConnection.getAccountInfo(pubkey, "confirmed"),
    ]);
    if (
      baseInfo?.owner.equals(DELEGATION_PROGRAM_ID) &&
      erInfo?.owner.equals(programId)
    ) {
      return { status, fqdn, erConnection };
    }
    await sleep(250);
  }

  throw new Error(`delegation shape never became healthy for ${pubkey}`);
}

async function waitForUndelegated(baseConnection, pubkey, programId, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const [status, info] = await Promise.all([
      getDelegationStatus(pubkey).catch(() => null),
      baseConnection.getAccountInfo(pubkey, "confirmed"),
    ]);
    if (info?.owner.equals(programId) && !status?.isDelegated) return info;
    await sleep(250);
  }
  throw new Error(`timed out waiting for undelegation on base: ${pubkey}`);
}

async function waitForSignature(connection, signature, attempts = 160) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = response.value[0];
    if (status) {
      assert(status.err == null, `transaction failed: ${JSON.stringify(status.err)}`);
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        return status;
      }
    }
    await sleep(250);
  }
  throw new Error(`transaction confirmation not observed: ${signature}`);
}

const idlPath = process.env.REACTOR_IDL ?? "target/idl/reactor.json";
if (!fs.existsSync(idlPath)) throw new Error(`missing ${idlPath}; run anchor build first`);
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

const envProvider = anchor.AnchorProvider.env();
const wallet = envProvider.wallet;
const baseConnection = new Connection(BASE_RPC, "confirmed");
const baseProvider = new anchor.AnchorProvider(baseConnection, wallet, {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});
const baseProgram = new anchor.Program(idl, baseProvider);
const programId = baseProgram.programId;

const providerPayer = wallet.publicKey;
const authorityKeypair = Keypair.generate();
const authority = authorityKeypair.publicKey;
const recipient = Keypair.generate().publicKey;
const sources = Array.from({ length: CONDITION_COUNT }, () => Keypair.generate());

const nonce = crypto.randomBytes(16).toString("hex");
const objectiveSeed = crypto.createHash("sha256").update(`reactor-m3:${nonce}`).digest();
const pathPda = derive(programId, [Buffer.from("path"), authority.toBuffer()]);
const objectivePda = derive(programId, [Buffer.from("objective"), authority.toBuffer(), objectiveSeed]);
const vaultPda = derive(programId, [Buffer.from("vault"), objectivePda.toBuffer()]);
const conditionPdas = Array.from({ length: CONDITION_COUNT }, (_, kind) =>
  derive(programId, [Buffer.from("condition"), objectivePda.toBuffer(), Buffer.from([kind])]),
);
const candidatePda = derive(programId, [Buffer.from("session_candidate"), objectivePda.toBuffer()]);
const lockPda = derive(programId, [Buffer.from("lock"), objectivePda.toBuffer()]);
const receiptPda = derive(programId, [Buffer.from("receipt"), lockPda.toBuffer()]);

const providerBalance = await baseConnection.getBalance(providerPayer, "confirmed");
assert(providerBalance >= AUTHORITY_BUDGET_LAMPORTS, "provider payer lacks enough devnet SOL for M3 fixture");
const recipientRentFloor = await baseConnection.getMinimumBalanceForRentExemption(0);
await baseProvider.sendAndConfirm(
  new Transaction().add(
    SystemProgram.transfer({ fromPubkey: providerPayer, toPubkey: authority, lamports: AUTHORITY_BUDGET_LAMPORTS }),
    SystemProgram.transfer({ fromPubkey: providerPayer, toPubkey: recipient, lamports: recipientRentFloor }),
  ),
  [],
);
await pace();

const startSlot = await baseConnection.getSlot("confirmed");
const pathExpiry = new anchor.BN(startSlot + 5_000);

console.log(`base rpc:   ${BASE_RPC}`);
console.log(`router rpc: ${ROUTER_RPC}`);
console.log(`program:    ${programId}`);
console.log(`payer:      ${providerPayer}`);
console.log(`authority:  ${authority}`);
console.log(`objective:  ${objectivePda}`);
console.log(`vault:      ${vaultPda}`);
console.log(`candidate:  ${candidatePda}`);

await send(baseProgram.methods.initializePath(new anchor.BN(1_000_000), pathExpiry)
  .accounts({ path: pathPda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
await send(baseProgram.methods.createObjective([...objectiveSeed], new anchor.BN(TARGET_EXPOSURE), new anchor.BN(1), conditionPdas)
  .accounts({ objective: objectivePda, path: pathPda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
await send(baseProgram.methods.initializeVault(new anchor.BN(INITIAL_EXPOSURE))
  .accounts({ vault: vaultPda, objective: objectivePda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
await send(baseProgram.methods.fundVault(new anchor.BN(500_000))
  .accounts({ funder: authority, vault: vaultPda, systemProgram: SystemProgram.programId }), [authorityKeypair]);

for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
  await send(baseProgram.methods.initializeCondition(kind, sources[kind].publicKey)
    .accounts({ condition: conditionPdas[kind], objective: objectivePda, authority, systemProgram: SystemProgram.programId }), [authorityKeypair]);
}
await send(baseProgram.methods.initializeSessionCandidate(recipient, new anchor.BN(TRANSFER_LAMPORTS), new anchor.BN(EXPOSURE_REDUCTION))
  .accounts({ sessionCandidate: candidatePda, objective: objectivePda, path: pathPda, authority, vault: vaultPda, systemProgram: SystemProgram.programId }), [authorityKeypair]);

// Delegate the candidate first, discover the router-selected validator, then pin every
// condition to the same validator so the full joint state is executable in one ER.
const candidateDelegationSignature = await send(
  baseProgram.methods.delegateSessionCandidate()
    .accounts({ payer: authority, objective: objectivePda, sessionCandidate: candidatePda }),
  [authorityKeypair],
);
const candidateShape = await waitForHealthyDelegation(baseConnection, candidatePda, programId);
const validator = candidateShape.status.delegationRecord.authority;
const erEndpoint = candidateShape.fqdn;
const erConnection = candidateShape.erConnection;
const erProvider = new anchor.AnchorProvider(erConnection, wallet, {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});
const erProgram = new anchor.Program(idl, erProvider);

console.log(`router ER:   ${erEndpoint}`);
console.log(`validator:   ${validator}`);

const validatorPubkey = new PublicKey(validator);
const validatorRemaining = [{ pubkey: validatorPubkey, isSigner: false, isWritable: false }];
const delegationSignatures = [];
const delegationEvidence = [];

for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
  const signature = await send(
    baseProgram.methods.delegateCondition(kind)
      .accounts({ payer: authority, objective: objectivePda, condition: conditionPdas[kind] })
      .remainingAccounts(validatorRemaining),
    [authorityKeypair],
  );
  delegationSignatures.push(signature);
  const shape = await waitForHealthyDelegation(baseConnection, conditionPdas[kind], programId, validator);
  assert(shape.fqdn === erEndpoint || ER_OVERRIDE, `condition ${kind} routed to different ER: ${shape.fqdn}`);
  delegationEvidence.push({
    account: conditionPdas[kind].toBase58(),
    validator: shape.status.delegationRecord.authority,
    fqdn: shape.status.fqdn,
    delegationSlot: shape.status.delegationRecord.delegationSlot,
    baseOwner: DELEGATION_PROGRAM_ID.toBase58(),
    erOwner: programId.toBase58(),
  });
}

console.log("delegation verified via router + base owner + ER owner");

async function updateEr(kind, sequence, value, predicateResult) {
  const currentSlot = await erConnection.getSlot("confirmed");
  return send(
    erProgram.methods.updateCondition(new anchor.BN(sequence), new anchor.BN(value), predicateResult, new anchor.BN(currentSlot + 100))
      .accounts({ condition: conditionPdas[kind], source: sources[kind].publicKey }),
    [sources[kind]],
  );
}

for (let kind = 0; kind < CONDITION_COUNT; kind += 1) await updateEr(kind, 1, 100 + kind, true);
await updateEr(2, 2, 999, false);

const evaluationAccounts = {
  sessionCandidate: candidatePda,
  condition0: conditionPdas[0], condition1: conditionPdas[1], condition2: conditionPdas[2],
  condition3: conditionPdas[3], condition4: conditionPdas[4], condition5: conditionPdas[5],
};

await expectFailure("ER stale exact sequence", () =>
  send(erProgram.methods.evaluateSessionCandidate([1,1,1,1,1,1].map((n) => new anchor.BN(n))).accounts(evaluationAccounts)));
await expectFailure("ER false predicate", () =>
  send(erProgram.methods.evaluateSessionCandidate([1,1,2,1,1,1].map((n) => new anchor.BN(n))).accounts(evaluationAccounts)));

await updateEr(2, 3, 102, true);
const frozenSequences = [1, 1, 3, 1, 1, 1];
const sealSignature = await send(
  erProgram.methods.evaluateSessionCandidate(frozenSequences.map((n) => new anchor.BN(n))).accounts(evaluationAccounts),
);
const candidateBeforeMutation = await erProgram.account.sessionCandidate.fetch(candidatePda, "confirmed");
assert(candidateBeforeMutation.ready === true, "ER candidate was not sealed ready");
assert(candidateBeforeMutation.frozenSequences.map(Number).join(",") === frozenSequences.join(","), "ER candidate did not freeze exact sequences");
assert(Number(candidateBeforeMutation.exposureBaseline) === INITIAL_EXPOSURE, "wrong candidate exposure baseline");
assert(Number(candidateBeforeMutation.predictedExposure) === TARGET_EXPOSURE, "wrong candidate predicted exposure");

await updateEr(0, 2, 777, false);
const candidateAfterMutation = await erProgram.account.sessionCandidate.fetch(candidatePda, "confirmed");
assert(candidateAfterMutation.frozenSequences.map(Number).join(",") === frozenSequences.join(","), "post-seal condition update mutated candidate");

const erFinalizeSignature = await send(
  erProgram.methods.finalizeSessionCandidate().accounts({ payer: authority, sessionCandidate: candidatePda }),
  [authorityKeypair],
);
await waitForSignature(erConnection, erFinalizeSignature);

// An ER signature only proves the intent was scheduled. Extract the actual Solana
// commitment signature and confirm it independently on the base connection.
const baseCandidateCommitSignature = await GetCommitmentSignature(erFinalizeSignature, erConnection);
assert(baseCandidateCommitSignature, "MagicBlock did not expose a base commitment signature");
const baseCommitStatus = await waitForSignature(baseConnection, baseCandidateCommitSignature);
await waitForUndelegated(baseConnection, candidatePda, programId);

const committedCandidate = await baseProgram.account.sessionCandidate.fetch(candidatePda, "confirmed");
assert(committedCandidate.ready === true, "committed candidate is not ready on Solana");
assert(committedCandidate.frozenSequences.map(Number).join(",") === frozenSequences.join(","), "committed candidate sequence evidence changed");

const materializeSignature = await send(
  baseProgram.methods.materializeLock().accounts({
    payer: authority, path: pathPda, objective: objectivePda, vault: vaultPda,
    sessionCandidate: candidatePda, executionLock: lockPda, systemProgram: SystemProgram.programId,
  }),
  [authorityKeypair],
);
const materializedLock = await baseProgram.account.executionLock.fetch(lockPda, "confirmed");
assert(materializedLock.sequences.map(Number).join(",") === frozenSequences.join(","), "base ExecutionLock does not match ER candidate");
assert(Number(materializedLock.predictedExposure) === TARGET_EXPOSURE, "materialized lock prediction mismatch");

async function readBalances(minContextSlot) {
  const config = minContextSlot == null ? { commitment: "confirmed" } : { commitment: "confirmed", minContextSlot };
  const response = await baseConnection.getMultipleAccountsInfoAndContext([vaultPda, recipient], config);
  const [vaultInfo, recipientInfo] = response.value;
  assert(vaultInfo && recipientInfo, "missing settlement account while measuring balances");
  return { slot: response.context.slot, vaultLamports: vaultInfo.lamports, recipientLamports: recipientInfo.lamports };
}

const balancesBefore = await readBalances();
const settlementSignature = await send(
  baseProgram.methods.executeLocked().accounts({
    path: pathPda, objective: objectivePda, vault: vaultPda, executionLock: lockPda,
    recipient, receipt: receiptPda, payer: authority, systemProgram: SystemProgram.programId,
  }),
  [authorityKeypair],
);
const settlementStatus = await waitForSignature(baseConnection, settlementSignature);
const balancesAfter = await readBalances(settlementStatus.slot);
const vaultDebitLamports = balancesBefore.vaultLamports - balancesAfter.vaultLamports;
const recipientCreditLamports = balancesAfter.recipientLamports - balancesBefore.recipientLamports;
assert(vaultDebitLamports === TRANSFER_LAMPORTS, "wrong Vault debit");
assert(recipientCreditLamports === TRANSFER_LAMPORTS, "wrong recipient credit");
assert(vaultDebitLamports === recipientCreditLamports, "M3 settlement value not conserved");

const receipt = await baseProgram.account.receipt.fetch(receiptPda, "confirmed");
const vault = await baseProgram.account.vault.fetch(vaultPda, "confirmed");
const consumedLock = await baseProgram.account.executionLock.fetch(lockPda, "confirmed");
assert(Number(vault.exposure) === TARGET_EXPOSURE, "M3 settlement did not reach Objective exposure");
assert(receipt.verified === true, "M3 Receipt not verified");
assert(Number(receipt.exposureBefore) === INITIAL_EXPOSURE, "M3 Receipt before exposure mismatch");
assert(Number(receipt.exposureAfter) === TARGET_EXPOSURE, "M3 Receipt after exposure mismatch");
assert(consumedLock.consumed === true, "M3 lock was not consumed");

await expectFailure("duplicate execution", () =>
  send(baseProgram.methods.executeLocked().accounts({
    path: pathPda, objective: objectivePda, vault: vaultPda, executionLock: lockPda,
    recipient, receipt: receiptPda, payer: authority, systemProgram: SystemProgram.programId,
  }), [authorityKeypair]));

const result = {
  proofEnvironment: "magicblock-devnet-m3a",
  baseRpc: BASE_RPC,
  routerRpc: ROUTER_RPC,
  ephemeralRpc: erEndpoint,
  validator,
  programId: programId.toBase58(),
  providerPayer: providerPayer.toBase58(),
  authority: authority.toBase58(),
  objective: objectivePda.toBase58(),
  vault: vaultPda.toBase58(),
  sessionCandidate: candidatePda.toBase58(),
  conditionAccounts: conditionPdas.map((key) => key.toBase58()),
  candidateDelegationSignature,
  delegationSignatures,
  candidateDelegation: {
    validator,
    fqdn: candidateShape.status.fqdn,
    delegationSlot: candidateShape.status.delegationRecord.delegationSlot,
    baseOwner: DELEGATION_PROGRAM_ID.toBase58(),
    erOwner: programId.toBase58(),
  },
  conditionDelegationEvidence: delegationEvidence,
  staleSequenceRejectedInEr: true,
  falsePredicateRejectedInEr: true,
  frozenSequences,
  postSealMutationDidNotChangeCandidate: true,
  erSealSignature: sealSignature,
  erFinalizeSignature,
  baseCandidateCommitSignature,
  baseCandidateCommitSlot: baseCommitStatus.slot,
  candidateObservedUndelegatedOnSolana: true,
  materializeLockSignature: materializeSignature,
  settlementSignature,
  settlementSlot: settlementStatus.slot,
  vaultDebitLamports,
  recipientCreditLamports,
  valueConserved: vaultDebitLamports === recipientCreditLamports,
  exposureBefore: Number(receipt.exposureBefore),
  exposureAfter: Number(receipt.exposureAfter),
  receiptVerified: receipt.verified,
  lockConsumed: consumedLock.consumed,
  duplicateExecutionRejected: true,
};

const outputPath = process.env.REACTOR_M3_RESULT_PATH ?? "experiment/results/m3-magicblock-latest.json";
fs.mkdirSync("experiment/results", { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log("\nM3a MagicBlock proof passed");
console.log(JSON.stringify(result, null, 2));
console.log(`evidence written: ${outputPath}`);
