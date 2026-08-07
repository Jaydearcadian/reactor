import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTransactionArtifact, sameTransactionArtifact } from '../src-js/transaction-artifact.mjs';

test('transaction artifact fingerprints exact signed bytes', () => {
  const raw = Uint8Array.from([1, 2, 3, 4]);
  const a = makeTransactionArtifact({
    scenarioId: 'scenario-1',
    cluster: 'devnet',
    rawTransaction: raw,
    expectedPostcondition: { recipient_delta_lamports: 1000 },
  });
  const b = makeTransactionArtifact({
    scenarioId: 'scenario-1',
    cluster: 'devnet',
    rawTransaction: raw,
    expectedPostcondition: { recipient_delta_lamports: 1000 },
  });

  assert.equal(a.tx_sha256, b.tx_sha256);
  assert.equal(sameTransactionArtifact(a, b), true);
});

test('different signed bytes cannot be compared as the same transaction', () => {
  const a = makeTransactionArtifact({
    scenarioId: 'scenario-1',
    cluster: 'devnet',
    rawTransaction: Uint8Array.from([1, 2, 3]),
    expectedPostcondition: { x: 1 },
  });
  const b = makeTransactionArtifact({
    scenarioId: 'scenario-1',
    cluster: 'devnet',
    rawTransaction: Uint8Array.from([1, 2, 4]),
    expectedPostcondition: { x: 1 },
  });

  assert.equal(sameTransactionArtifact(a, b), false);
});
