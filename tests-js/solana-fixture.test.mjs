import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { makeTransferFixture, parseSecretKey } from '../src-js/solana-fixture.mjs';

test('parseSecretKey accepts a 64-byte JSON array', () => {
  const keypair = Keypair.generate();
  const encoded = JSON.stringify(Array.from(keypair.secretKey));
  const parsed = parseSecretKey(encoded);
  assert.equal(parsed.length, 64);
});

test('parseSecretKey rejects malformed input', () => {
  assert.throws(() => parseSecretKey('[1,2,3]'));
});

test('makeTransferFixture binds payer recipient and amount', () => {
  const payer = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const fixture = makeTransferFixture({
    rpcUrl: 'https://api.devnet.solana.com',
    secretKey: JSON.stringify(Array.from(payer.secretKey)),
    recipient: recipient.toBase58(),
    lamports: 1234,
  });

  assert.equal(fixture.payer.publicKey.toBase58(), payer.publicKey.toBase58());
  assert.equal(fixture.recipient.toBase58(), recipient.toBase58());
  assert.equal(fixture.lamports, 1234);
});
