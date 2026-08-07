import fs from "node:fs";
import crypto from "node:crypto";
import * as anchorNamespace from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

const anchor = anchorNamespace.default ?? anchorNamespace;

const PROOF_ENV = process.env.REACTOR_PROOF_ENV ?? "local";
const IS_PUBLIC_CLUSTER = PROOF_ENV !== "local";
const PACE_MS = Number(process.env.REACTOR_RPC_PACE_MS ?? (IS_PUBLIC_CLUSTER ? 350 : 0));
const EPHEMERAL_AUTHORITY = process.env.REACTOR_EPHEMERAL_AUTHORITY === "1";
const CONDITION_COUNT = 6;
const TRANSFER_LAMPORTS = 100_000;
const INITIAL_EXPOSURE = 700;
const TARGET_EXPOSURE = 500;
const EXPOSURE_REDUCTION = 200;
const AUTHORITY_TEST_BUDGET_LAMPORTS = 100_000_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pace() {
  if (PACE_MS > 0) await sleep(PACE_MS);
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

async function sendRpc(builder, signers = []) {
  try {
    const signedBuilder = signers.length > 0 ? builder.signers(signers) : builder;
    return await signedBuilder.rpc();
  } finally {
    await pace();
  }
}

const idlPath = process.env.REACTOR_IDL ?? "target/idl/reactor.json";
if (!fs.existsSync(idlPath)) {
  throw new Error(`missing ${idlPath}; run 'anchor build', sync the program id, then build again`);
}

const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = new anchor.Program(idl, provider);
const programId = program.programId;
const providerAuthority = provider.wallet.publicKey;
const authorityKeypair = EPHEMERAL_AUTHORITY ? Keypair.generate() : null;
const authority = authorityKeypair?.publicKey ?? providerAuthority;
const authoritySigners = authorityKeypair ? [authorityKeypair] : [];
const recipient = Keypair.generate().publicKey;
const sources = Array.from({ length: CONDITION_COUNT }, () => Keypair.generate());

async function waitForSignatureStatus(signature) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await provider.connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = response.value[0];
    if (status) {
      assert(status.err == null, `settlement transaction failed: ${JSON.stringify(status.err)}`);
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        return status;
      }
    }
    await sleep(IS_PUBLIC_CLUSTER ? 250 : 50);
  }
  throw new Error("confirmed settlement signature status could not be observed");
}

if (authorityKeypair) {
  await provider.sendAndConfirm(
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: providerAuthority,
        toPubkey: authority,
        lamports: AUTHORITY_TEST_BUDGET_LAMPORTS,
      }),
    ),
    [],
  );
  await pace();
}

const runNonce = crypto.randomBytes(16).toString("hex");
const objectiveSeed = crypto
  .createHash("sha256")
  .update(`reactor-m2-market-maker-fixture:${PROOF_ENV}:${runNonce}`)
  .digest();
const pathPda = derive(programId, [Buffer.from("path"), authority.toBuffer()]);
const objectivePda = derive(programId, [Buffer.from("objective"), authority.toBuffer(), objectiveSeed]);
const vaultPda = derive(programId, [Buffer.from("vault"), objectivePda.toBuffer()]);
const conditionPdas = Array.from({ length: CONDITION_COUNT }, (_, kind) =>
  derive(programId, [Buffer.from("condition"), objectivePda.toBuffer(), Buffer.from([kind])]),
);
const lockPda = derive(programId, [Buffer.from("lock"), objectivePda.toBuffer()]);
const receiptPda = derive(programId, [Buffer.from("receipt"), lockPda.toBuffer()]);

async function readSettlementBalances(minContextSlot) {
  const config = minContextSlot == null
    ? { commitment: "confirmed" }
    : { commitment: "confirmed", minContextSlot };
  const response = await provider.connection.getMultipleAccountsInfoAndContext(
    [vaultPda, recipient],
    config,
  );
  const [vaultInfo, recipientInfo] = response.value;
  assert(vaultInfo, "vault account missing during settlement measurement");
  assert(recipientInfo, "recipient account missing during settlement measurement");
  return {
    slot: response.context.slot,
    vaultLamports: vaultInfo.lamports,
    recipientLamports: recipientInfo.lamports,
  };
}

const startSlot = await provider.connection.getSlot("confirmed");
const pathExpiry = new anchor.BN(startSlot + 5_000);
const recipientRentFloor = await provider.connection.getMinimumBalanceForRentExemption(0);
await provider.sendAndConfirm(
  new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: providerAuthority,
      toPubkey: recipient,
      lamports: recipientRentFloor,
    }),
  ),
  [],
);
await pace();

console.log(`proof env: ${PROOF_ENV}`);
console.log(`rpc:       ${provider.connection.rpcEndpoint}`);
console.log(`program:   ${programId}`);
console.log(`payer:     ${providerAuthority}`);
console.log(`authority: ${authority}`);
console.log(`objective: ${objectivePda}`);
console.log(`vault:     ${vaultPda}`);
console.log(`recipient: ${recipient}`);
console.log(`recipient rent floor: ${recipientRentFloor} lamports`);

await sendRpc(
  program.methods
    .initializePath(new anchor.BN(1_000_000), pathExpiry)
    .accounts({ path: pathPda, authority, systemProgram: SystemProgram.programId }),
  authoritySigners,
);

await sendRpc(
  program.methods
    .createObjective(
      [...objectiveSeed],
      new anchor.BN(TARGET_EXPOSURE),
      new anchor.BN(1),
      conditionPdas,
    )
    .accounts({ objective: objectivePda, path: pathPda, authority, systemProgram: SystemProgram.programId }),
  authoritySigners,
);

await sendRpc(
  program.methods
    .initializeVault(new anchor.BN(INITIAL_EXPOSURE))
    .accounts({ vault: vaultPda, objective: objectivePda, authority, systemProgram: SystemProgram.programId }),
  authoritySigners,
);

await sendRpc(
  program.methods
    .fundVault(new anchor.BN(500_000))
    .accounts({ funder: authority, vault: vaultPda, systemProgram: SystemProgram.programId }),
  authoritySigners,
);

for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
  await sendRpc(
    program.methods
      .initializeCondition(kind, sources[kind].publicKey)
      .accounts({
        condition: conditionPdas[kind],
        objective: objectivePda,
        authority,
        systemProgram: SystemProgram.programId,
      }),
    authoritySigners,
  );
}

async function update(kind, sequence, value, predicateResult) {
  const currentSlot = await provider.connection.getSlot("confirmed");
  const result = await sendRpc(
    program.methods
      .updateCondition(
        new anchor.BN(sequence),
        new anchor.BN(value),
        predicateResult,
        new anchor.BN(currentSlot + 100),
      )
      .accounts({ condition: conditionPdas[kind], source: sources[kind].publicKey }),
    [sources[kind]],
  );
  return result;
}

for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
  await update(kind, 1, 100 + kind, true);
}

await update(2, 2, 999, false);

const lockAccounts = {
  payer: authority,
  path: pathPda,
  objective: objectivePda,
  vault: vaultPda,
  recipient,
  condition0: conditionPdas[0],
  condition1: conditionPdas[1],
  condition2: conditionPdas[2],
  condition3: conditionPdas[3],
  condition4: conditionPdas[4],
  condition5: conditionPdas[5],
  executionLock: lockPda,
  systemProgram: SystemProgram.programId,
};

await expectFailure("stale exact sequence", () =>
  sendRpc(
    program.methods
      .evaluateAndLock(
        [1, 1, 1, 1, 1, 1].map((n) => new anchor.BN(n)),
        new anchor.BN(TRANSFER_LAMPORTS),
        new anchor.BN(EXPOSURE_REDUCTION),
      )
      .accounts(lockAccounts),
    authoritySigners,
  ),
);

await expectFailure("false predicate", () =>
  sendRpc(
    program.methods
      .evaluateAndLock(
        [1, 1, 2, 1, 1, 1].map((n) => new anchor.BN(n)),
        new anchor.BN(TRANSFER_LAMPORTS),
        new anchor.BN(EXPOSURE_REDUCTION),
      )
      .accounts(lockAccounts),
    authoritySigners,
  ),
);

await update(2, 3, 102, true);
const expectedSequences = [1, 1, 3, 1, 1, 1];
await sendRpc(
  program.methods
    .evaluateAndLock(
      expectedSequences.map((n) => new anchor.BN(n)),
      new anchor.BN(TRANSFER_LAMPORTS),
      new anchor.BN(EXPOSURE_REDUCTION),
    )
    .accounts(lockAccounts),
  authoritySigners,
);

const frozenBefore = await program.account.executionLock.fetch(lockPda);
assert(
  frozenBefore.sequences.map((n) => Number(n)).join(",") === expectedSequences.join(","),
  "lock did not freeze exact condition sequences",
);
assert(Number(frozenBefore.predictedExposure) === TARGET_EXPOSURE, "wrong predicted postcondition");

await update(0, 2, 777, false);
const frozenAfterUpdate = await program.account.executionLock.fetch(lockPda);
assert(
  frozenAfterUpdate.sequences.map((n) => Number(n)).join(",") === expectedSequences.join(","),
  "later condition update mutated the lock",
);

const balancesBefore = await readSettlementBalances();
const settlementSignature = await sendRpc(
  program.methods
    .executeLocked()
    .accounts({
      path: pathPda,
      objective: objectivePda,
      vault: vaultPda,
      executionLock: lockPda,
      recipient,
      receipt: receiptPda,
      payer: authority,
      systemProgram: SystemProgram.programId,
    }),
  authoritySigners,
);

const settlementStatus = await waitForSignatureStatus(settlementSignature);
const settlementSlot = settlementStatus.slot;
const balancesAfter = await readSettlementBalances(settlementSlot);
const recipientDeltaLamports = balancesAfter.recipientLamports - balancesBefore.recipientLamports;
const vaultDebitLamports = balancesBefore.vaultLamports - balancesAfter.vaultLamports;

console.log(`settlement signature: ${settlementSignature}`);
console.log(`settlement slot: ${settlementSlot}`);
console.log(`balance read slots: ${balancesBefore.slot} -> ${balancesAfter.slot}`);
console.log(`vault debit: ${vaultDebitLamports} lamports`);
console.log(`recipient credit: ${recipientDeltaLamports} lamports`);

const receipt = await program.account.receipt.fetch(receiptPda);
const vault = await program.account.vault.fetch(vaultPda);
const consumedLock = await program.account.executionLock.fetch(lockPda);

assert(vaultDebitLamports === TRANSFER_LAMPORTS, "vault value debit is wrong");
assert(recipientDeltaLamports === TRANSFER_LAMPORTS, "recipient value credit is wrong");
assert(vaultDebitLamports === recipientDeltaLamports, "settlement value was not conserved");
assert(Number(vault.exposure) === TARGET_EXPOSURE, "vault exposure did not reach objective");
assert(receipt.verified === true, "receipt is not verified");
assert(Number(receipt.exposureBefore) === INITIAL_EXPOSURE, "receipt before-state is wrong");
assert(Number(receipt.exposureAfter) === TARGET_EXPOSURE, "receipt postcondition is wrong");
assert(consumedLock.consumed === true, "lock was not marked consumed");

await expectFailure("duplicate execution", () =>
  sendRpc(
    program.methods
      .executeLocked()
      .accounts({
        path: pathPda,
        objective: objectivePda,
        vault: vaultPda,
        executionLock: lockPda,
        recipient,
        receipt: receiptPda,
        payer: authority,
        systemProgram: SystemProgram.programId,
      }),
    authoritySigners,
  ),
);

const result = {
  proofEnvironment: PROOF_ENV,
  rpcEndpoint: provider.connection.rpcEndpoint,
  programId: programId.toBase58(),
  providerPayer: providerAuthority.toBase58(),
  authority: authority.toBase58(),
  objective: objectivePda.toBase58(),
  vault: vaultPda.toBase58(),
  staleSequenceRejected: true,
  falsePredicateRejected: true,
  frozenSequences: expectedSequences,
  laterConditionUpdateIgnoredByFrozenLock: true,
  deploySignature: process.env.REACTOR_DEPLOY_SIGNATURE ?? null,
  settlementSignature,
  settlementSlot,
  balanceObservationSlots: [balancesBefore.slot, balancesAfter.slot],
  vaultDebitLamports,
  recipientDeltaLamports,
  valueConserved: vaultDebitLamports === recipientDeltaLamports,
  exposureBefore: Number(receipt.exposureBefore),
  exposureAfter: Number(receipt.exposureAfter),
  receiptVerified: receipt.verified,
  lockConsumed: consumedLock.consumed,
  duplicateExecutionRejected: true,
};

const outputPath = process.env.REACTOR_RESULT_PATH ?? `experiment/results/m2-${PROOF_ENV}-latest.json`;
fs.mkdirSync("experiment/results", { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);

console.log(`\nM2 ${PROOF_ENV} proof passed`);
console.log(JSON.stringify(result, null, 2));
console.log(`evidence written: ${outputPath}`);
