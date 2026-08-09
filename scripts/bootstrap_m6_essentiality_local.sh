#!/usr/bin/env bash
set -euo pipefail

# M6 essentiality benchmark wrapper.
# Reuses the hardened local Solana + MagicBlock validator lifecycle from
# bootstrap_m4_engine_local.sh while substituting the frozen M6 runner.

command -v anchor >/dev/null 2>&1 || { echo "anchor CLI is required" >&2; exit 1; }
command -v solana >/dev/null 2>&1 || { echo "solana CLI is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }

CHURN_TRANSITIONS="${REACTOR_M6_CHURN_TRANSITIONS:-120}"
TTL_SLOTS="${REACTOR_M6_TTL_SLOTS:-5000000}"

if ! [[ "$CHURN_TRANSITIONS" =~ ^[1-9][0-9]*$ ]]; then
  echo "REACTOR_M6_CHURN_TRANSITIONS must be a positive integer." >&2
  exit 1
fi
if ! [[ "$TTL_SLOTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "REACTOR_M6_TTL_SLOTS must be a positive integer." >&2
  exit 1
fi

PROGRAM_KEYPAIR="target/deploy/reactor-keypair.json"
SOURCE_FILE="programs/reactor/src/lib.rs"
SYNC_SCRIPT="scripts/sync_m2_program_id.mjs"

if [[ ! -f "$PROGRAM_KEYPAIR" ]]; then
  echo "Missing $PROGRAM_KEYPAIR." >&2
  echo "Run 'anchor build' once to create the local Reactor program keypair." >&2
  exit 1
fi

npm install >/dev/null
SYNCED_PROGRAM_ID="$(node "$SYNC_SCRIPT")"
SOURCE_PROGRAM_ID="$(sed -n 's/.*declare_id!("\([1-9A-HJ-NP-Za-km-z]*\)").*/\1/p' "$SOURCE_FILE" | head -n 1)"
if [[ -z "$SYNCED_PROGRAM_ID" || -z "$SOURCE_PROGRAM_ID" || "$SOURCE_PROGRAM_ID" != "$SYNCED_PROGRAM_ID" ]]; then
  echo "Reactor program identity synchronization failed." >&2
  echo "keypair: $SYNCED_PROGRAM_ID" >&2
  echo "source:  $SOURCE_PROGRAM_ID" >&2
  exit 1
fi

echo "Reactor program identity synchronized: $SYNCED_PROGRAM_ID"
echo "M6 churn transitions: $CHURN_TRANSITIONS"
echo "M6 objective-relevant hot transitions: $((CHURN_TRANSITIONS + 1))"
echo "M6 condition TTL: $TTL_SLOTS slots"
echo "M6 frozen canonical-work reduction gate: 75%"
if (( CHURN_TRANSITIONS < 100 )); then
  echo "M6 run classification: structural smoke (<100 transitions; cannot pass frozen gate)"
else
  echo "M6 run classification: frozen-protocol-sized"
fi

TMP_SCRIPT="$(mktemp)"
TMP_RUNNER="$(mktemp scripts/.run_m6_essentiality_local.XXXXXX.mjs)"
cleanup_tmp() { rm -f "$TMP_SCRIPT" "$TMP_RUNNER"; }
trap cleanup_tmp EXIT

# Instrumentation-only runtime patch. The frozen M6 protocol defines the state
# schedule, treatment boundary, correctness gates, and canonical accounting; it
# does not require the large Anchor provider wallet to be the hot-state fee
# payer. Two local-runtime issues are normalized here without changing the
# experiment:
#   1. use a confirmed blockhash with confirmed preflight, matching M5b;
#   2. use a small dedicated per-treatment transition payer for measured ER/base
#      hot-state transactions and ER finalization.
#
# The dedicated payer is funded inside the existing common setup transaction,
# so no primary canonical-coordination transaction is added. This also avoids
# asking the MagicBlock account cloner to mirror the ~500 SOL local test wallet
# into the ER just to pay zero-base-fee runtime transactions.
node --input-type=module - "$TMP_RUNNER" <<'NODE'
import fs from 'node:fs';

const output = process.argv[2];
let source = fs.readFileSync('scripts/run_m6_essentiality_local.mjs', 'utf8');

function replaceOnce(from, to, label) {
  if (!source.includes(from)) throw new Error(`M6 instrumentation patch mismatch: ${label}`);
  source = source.replace(from, to);
}

replaceOnce(
  "const AUTHORITY_FUND_LAMPORTS = Number(process.env.REACTOR_M6_AUTHORITY_FUND_LAMPORTS ?? 80_000_000);\n",
  "const AUTHORITY_FUND_LAMPORTS = Number(process.env.REACTOR_M6_AUTHORITY_FUND_LAMPORTS ?? 80_000_000);\nconst TRANSITION_PAYER_LAMPORTS = Number(process.env.REACTOR_M6_TRANSITION_PAYER_LAMPORTS ?? 5_000_000);\n",
  'transition payer constant',
);

replaceOnce(
`async function sendMeasuredBuilder({ builder, connection, wallet, signers = [] }) {
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
    if (status.err) failure = \`runtime error: \${JSON.stringify(status.err)}\`;
  } catch (error) { failure = String(error?.message ?? error); }
  const processedAtMs = nowMs();
  return { signature, slot: status?.slot ?? null, failure, submittedAtMs, processedAtMs, submitToProcessedMs: processedAtMs - submittedAtMs };
}`,
`async function sendMeasuredBuilder({ builder, connection, payer, signers = [] }) {
  const tx = await builder.transaction();
  const latest = await connection.getLatestBlockhash('confirmed');
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = latest.blockhash;
  const uniqueSigners = [payer, ...signers.filter((signer) => !signer.publicKey.equals(payer.publicKey))];
  tx.partialSign(...uniqueSigners);
  const submittedAtMs = nowMs();
  let signature = null; let status = null; let failure = null;
  try {
    signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 });
    status = await waitForSignature(connection, signature);
    if (status.err) failure = \`runtime error: \${JSON.stringify(status.err)}\`;
  } catch (error) { failure = String(error?.message ?? error); }
  const processedAtMs = nowMs();
  return { signature, slot: status?.slot ?? null, failure, submittedAtMs, processedAtMs, submitToProcessedMs: processedAtMs - submittedAtMs };
}`,
  'measured sender',
);

replaceOnce(
  "  const sources = Array.from({ length: CONDITION_COUNT }, () => Keypair.generate());\n",
  "  const sources = Array.from({ length: CONDITION_COUNT }, () => Keypair.generate());\n  const transitionPayer = Keypair.generate();\n",
  'transition payer fixture',
);

replaceOnce(
`  const fundingSignature = await baseProvider.sendAndConfirm(new Transaction().add(
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: authority, lamports: AUTHORITY_FUND_LAMPORTS }),
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: recipient, lamports: recipientRentFloor }),
  ), []);`,
`  const fundingSignature = await baseProvider.sendAndConfirm(new Transaction().add(
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: authority, lamports: AUTHORITY_FUND_LAMPORTS }),
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: recipient, lamports: recipientRentFloor }),
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: transitionPayer.publicKey, lamports: TRANSITION_PAYER_LAMPORTS }),
  ), []);`,
  'transition payer funding',
);

replaceOnce(
  "baseProgram, baseConnection, wallet, canonical, setupSignatures, delegationSignatures }",
  "baseProgram, baseConnection, wallet, transitionPayer, canonical, setupSignatures, delegationSignatures }",
  'transition payer return',
);

const measuredWalletCall = "connection: fixture.runtimeConnection, wallet: fixture.wallet, signers:";
if (!source.includes(measuredWalletCall)) throw new Error('M6 instrumentation patch mismatch: measured call sites');
source = source.replaceAll(measuredWalletCall, "connection: fixture.runtimeConnection, payer: fixture.transitionPayer, signers:");

replaceOnce(
`    erFinalizeSignature = await setupSend(fixture.runtimeProgram.methods.finalizeSessionCandidate().accounts({ payer: fixture.wallet.publicKey, sessionCandidate: fixture.candidate }));
    await waitForConfirmedSignature(fixture.runtimeConnection, erFinalizeSignature);`,
`    const finalizeMeasured = await sendMeasuredBuilder({
      builder: fixture.runtimeProgram.methods.finalizeSessionCandidate().accounts({ payer: fixture.transitionPayer.publicKey, sessionCandidate: fixture.candidate }),
      connection: fixture.runtimeConnection,
      payer: fixture.transitionPayer,
    });
    assert(!finalizeMeasured.failure && finalizeMeasured.signature, \`magicblock: ER finalize failed: \${finalizeMeasured.failure ?? 'missing signature'}\`);
    erFinalizeSignature = finalizeMeasured.signature;
    await waitForConfirmedSignature(fixture.runtimeConnection, erFinalizeSignature);`,
  'ER finalize payer',
);

fs.writeFileSync(output, source);
NODE

# Keep the mature process cleanup, funding, build/deploy, readiness and teardown
# logic from M4-Engine. Replace only labels, log path, runner and evidence path.
sed \
  -e 's/m4-engine-logs/m6-essentiality-logs/g' \
  -e 's/Preflighting local M4-Engine ports/Preflighting local M6 essentiality ports/' \
  -e 's/Running controlled local M4-Engine benchmark/Running frozen local M6 essentiality benchmark/' \
  -e "s|node scripts/run_m4_engine_local.mjs|node $TMP_RUNNER|" \
  -e 's/M4-Engine runner failed/M6 essentiality runner failed/' \
  -e 's|M4-Engine evidence: experiment/results/m4-engine-local-latest.json|M6 evidence: experiment/results/m6-essentiality-latest.json (Chamber mirror: chamber/data/m6-essentiality-latest.json)|' \
  scripts/bootstrap_m4_engine_local.sh > "$TMP_SCRIPT"

chmod +x "$TMP_SCRIPT"

export REACTOR_M6_CHURN_TRANSITIONS="$CHURN_TRANSITIONS"
export REACTOR_M6_TTL_SLOTS="$TTL_SLOTS"
export REACTOR_M6_BASE_RPC="${REACTOR_M6_BASE_RPC:-http://127.0.0.1:8899}"
export REACTOR_M6_BASE_WS="${REACTOR_M6_BASE_WS:-ws://127.0.0.1:8900}"
export REACTOR_M6_ER_RPC="${REACTOR_M6_ER_RPC:-http://127.0.0.1:7799}"
export REACTOR_M6_ER_WS="${REACTOR_M6_ER_WS:-ws://127.0.0.1:7800}"
export REACTOR_M6_ER_VALIDATOR="${REACTOR_M6_ER_VALIDATOR:-mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev}"
export REACTOR_M6_RESULT_PATH="${REACTOR_M6_RESULT_PATH:-experiment/results/m6-essentiality-latest.json}"
export REACTOR_M6_CHAMBER_RESULT_PATH="${REACTOR_M6_CHAMBER_RESULT_PATH:-chamber/data/m6-essentiality-latest.json}"

# The inherited M4 wrapper prints a trial count but M6 itself is a single
# two-treatment benchmark. Keep that inherited value at one.
export REACTOR_M4_ENGINE_TRIALS=1
# Map M6 endpoint overrides into the reused M4 bootstrap so validator startup,
# readiness checks and the M6 runner all use the same endpoints/validator.
export REACTOR_M4_ENGINE_BASE_RPC="$REACTOR_M6_BASE_RPC"
export REACTOR_M4_ENGINE_BASE_WS="$REACTOR_M6_BASE_WS"
export REACTOR_M4_ENGINE_ER_RPC="$REACTOR_M6_ER_RPC"
export REACTOR_M4_ENGINE_ER_WS="$REACTOR_M6_ER_WS"
export REACTOR_M4_ENGINE_ER_VALIDATOR="$REACTOR_M6_ER_VALIDATOR"

bash "$TMP_SCRIPT"
