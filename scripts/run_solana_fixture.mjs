import { runStandardRpcTransfer, makeTransferFixture } from '../src-js/solana-fixture.mjs';

const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const secretKey = process.env.SOLANA_SECRET_KEY;
const recipient = process.env.REACTOR_RECIPIENT;
const lamports = Number(process.env.REACTOR_LAMPORTS ?? '1000');

if (!secretKey) {
  console.error('Missing SOLANA_SECRET_KEY as a JSON array of 64 bytes.');
  process.exit(2);
}
if (!recipient) {
  console.error('Missing REACTOR_RECIPIENT public key.');
  process.exit(2);
}
if (!Number.isSafeInteger(lamports) || lamports <= 0) {
  console.error('REACTOR_LAMPORTS must be a positive integer.');
  process.exit(2);
}

const fixture = makeTransferFixture({ rpcUrl, secretKey, recipient, lamports });
const result = await runStandardRpcTransfer(fixture);
console.log(JSON.stringify(result, null, 2));
process.exit(result.verified ? 0 : 1);
