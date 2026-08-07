import fs from "node:fs";
import crypto from "node:crypto";
import * as anchorNamespace from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

const anchor = anchorNamespace.default ?? anchorNamespace;

const CONDITION_COUNT = 6;
const TRANSFER_LAMPORTS = 100_000;
const INITIAL_EXPOSURE = 700;
const TARGET_EXPOSURE = 500;
const EXPOSURE_REDUCTION = 200;

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function waitForSignatureStatus(signature) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("confirmed settlement signature status could not be observed");
}

const idlPath = process.env.REACTOR_IDL ?? "target/idl/reactor.json";
if (!fs.existsSync(idlPath)) {
  throw new Error(`missing ${idlPath}; run 'anchor build', 'anchor keys sync', then 'anchor build'`);
}

const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = new anchor.Program(idl, provider);
const programId = program.programId;
const authority = provider.wallet.publicKey;
const recipient = Keypair.generate().publicKey;
const sources = Array.from({ length: CONDITION_COUNT }, () => Keypair.generate());

const objectiveSeed = crypto.createHash("sha256").update("reactor-m2-market-maker-fixture").digest();
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

// The settlement recipient must already be a valid rent-exempt system account.
// This setup transfer is intentionally measured before the settlement baseline,
// so the M2 assertion still isolates only the Reactor value movement.
const recipientRentFloor = await provider.connection.getMinimumBalanceForRentExemption(0);
await provider.sendAndConfirm(
  new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: authority,
      toPubkey: recipient,
      lamports: recipientRentFloor,
    }),
  ),
  [],
);

console.log(`program:   ${programId}`);
console.log(`authority: ${authority}`);
console.log(`objective: ${objectivePda}`);
console.log(`vault:     ${vaultPda}`);
console.log(`recipient: ${recipient}`);
console.log(`recipient rent floor: ${recipientRentFloor} lamports`);

await program.methods
  .initializePath(new anchor.BN(1_000_000), pathExpiry)
  .accounts({ path: pathPda, authority, systemProgram: SystemProgram.programId })
  .rpc();

await program.methods
  .createObjective(
    [...objectiveSeed],
    new anchor.BN(TARGET_EXPOSURE),
    new anchor.BN(1),
    conditionPdas,
  )
  .accounts({ objective: objectivePda, path: pathPda, authority, systemProgram: SystemProgram.programId })
  .rpc();

await program.methods
  .initializeVault(new anchor.BN(INITIAL_EXPOSURE))
  .accounts({ vault: vaultPda, objective: objectivePda, authority, systemProgram: SystemProgram.programId })
  .rpc();

await program.methods
  .fundVault(new anchor.BN(500_000))
  .accounts({ funder: authority, vault: vaultPda, systemProgram: SystemProgram.programId })
  .rpc();

for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
  await program.methods
    .initializeCondition(kind, sources[kind].publicKey)
    .accounts({
      condition: conditionPdas[kind],
      objective: objectivePda,
      authority,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

async function update(kind, sequence, value, predicateResult) {
  const currentSlot = await provider.connection.getSlot("confirmed");
  return program.methods
    .updateCondition(
      new anchor.BN(sequence),
      new anchor.BN(value),
      predicateResult,
      new anchor.BN(currentSlot + 100),
    )
    .accounts({ condition: conditionPdas[kind], source: sources[kind].publicKey })
    .signers([sources[kind]])
    .rpc();
}

for (let kind = 0; kind < CONDITION_COUNT; kind += 1) {
  await update(kind, 1, 100 + kind, true);
}

// Make condition 2 false at a newer sequence. This gives us two adversarial checks:
// exact old sequence must be rejected, and exact current sequence must still be rejected
// because its predicate is false.
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
  program.methods
    .evaluateAndLock(
      [1, 1, 1, 1, 1, 1].map((n) => new anchor.BN(n)),
      new anchor.BN(TRANSFER_LAMPORTS),
      new anchor.BN(EXPOSURE_REDUCTION),
    )
    .accounts(lockAccounts)
    .rpc(),
);

await expectFailure("false predicate", () =>
  program.methods
    .evaluateAndLock(
      [1, 1, 2, 1, 1, 1].map((n) => new anchor.BN(n)),
      new anchor.BN(TRANSFER_LAMPORTS),
      new anchor.BN(EXPOSURE_REDUCTION),
    )
    .accounts(lockAccounts)
    .rpc(),
);

// Repair the condition with a new version and create the one executable lock.
await update(2, 3, 102, true);
const expectedSequences = [1, 1, 3, 1, 1, 1];
await program.methods
  .evaluateAndLock(
    expectedSequences.map((n) => new anchor.BN(n)),
    new anchor.BN(TRANSFER_LAMPORTS),
    new anchor.BN(EXPOSURE_REDUCTION),
  )
  .accounts(lockAccounts)
  .rpc();

const frozenBefore = await program.account.executionLock.fetch(lockPda);
assert(
  frozenBefore.sequences.map((n) => Number(n)).join(",") === expectedSequences.join(","),
  "lock did not freeze exact condition sequences",
);
assert(Number(frozenBefore.predictedExposure) === TARGET_EXPOSURE, "wrong predicted postcondition");

// The world moves after locking. Execution must use the frozen configuration rather than
// silently substituting the newer condition version.
await update(0, 2, 777, false);
const frozenAfterUpdate = await program.account.executionLock.fetch(lockPda);
assert(
  frozenAfterUpdate.sequences.map((n) => Number(n)).join(",") === expectedSequences.join(","),
  "later condition update mutated the lock",
);

const balancesBefore = await readSettlementBalances();
const settlementSignature = await program.methods
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
  })
  .rpc();

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
    })
    .rpc(),
);

console.log("\nM2 local proof passed");
console.log(JSON.stringify({
  staleSequenceRejected: true,
  falsePredicateRejected: true,
  frozenSequences: expectedSequences,
  laterConditionUpdateIgnoredByFrozenLock: true,
  settlementSignature,
  settlementSlot,
  balanceObservationSlots: [balancesBefore.slot, balancesAfter.slot],
  vaultDebitLamports,
  recipientDeltaLamports,
  exposureBefore: Number(receipt.exposureBefore),
  exposureAfter: Number(receipt.exposureAfter),
  receiptVerified: receipt.verified,
  lockConsumed: consumedLock.consumed,
  duplicateExecutionRejected: true,
}, null, 2));
