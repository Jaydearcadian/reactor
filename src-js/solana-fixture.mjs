import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmRawTransaction,
} from '@solana/web3.js';

export function parseSecretKey(value) {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length !== 64) {
    throw new Error('SOLANA_SECRET_KEY must be a JSON array with 64 bytes');
  }
  return Uint8Array.from(parsed);
}

export function makeTransferFixture({ rpcUrl, secretKey, recipient, lamports = 1000 }) {
  if (!rpcUrl) throw new Error('rpcUrl is required');
  const connection = new Connection(rpcUrl, 'confirmed');
  const payer = Keypair.fromSecretKey(parseSecretKey(secretKey));
  const recipientKey = new PublicKey(recipient);

  return {
    connection,
    payer,
    recipient: recipientKey,
    lamports,
  };
}

export async function buildSignedTransfer(fixture) {
  const { connection, payer, recipient, lamports } = fixture;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: blockhash,
  }).add(SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: recipient,
    lamports,
  }));
  tx.sign(payer);
  return { tx, blockhash, lastValidBlockHeight };
}

export async function snapshotBalance(connection, account) {
  return connection.getBalance(account, 'confirmed');
}

export async function runStandardRpcTransfer(fixture) {
  const { connection, recipient, lamports } = fixture;
  const before = await snapshotBalance(connection, recipient);
  const { tx, blockhash, lastValidBlockHeight } = await buildSignedTransfer(fixture);
  const raw = tx.serialize();
  const submittedAt = performance.now();
  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  });
  const acknowledgedAt = performance.now();

  await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
  }, 'confirmed');
  const observedAt = performance.now();

  const after = await snapshotBalance(connection, recipient);
  const verifiedAt = performance.now();
  const delta = after - before;

  return {
    path: 'solana-standard-rpc',
    signature,
    recipient: recipient.toBase58(),
    expected_delta_lamports: lamports,
    observed_delta_lamports: delta,
    verified: delta === lamports,
    timings_ms: {
      submit_to_ack: acknowledgedAt - submittedAt,
      ack_to_observed: observedAt - acknowledgedAt,
      observed_to_verified: verifiedAt - observedAt,
      submit_to_verified: verifiedAt - submittedAt,
    },
  };
}

export function lamportsToSol(lamports) {
  return lamports / LAMPORTS_PER_SOL;
}
