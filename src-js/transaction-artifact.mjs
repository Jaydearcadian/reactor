import { createHash } from 'node:crypto';

export function makeTransactionArtifact({
  scenarioId,
  cluster,
  rawTransaction,
  expectedPostcondition,
  metadata = {},
}) {
  if (!scenarioId) throw new Error('scenarioId is required');
  if (!cluster) throw new Error('cluster is required');
  if (!(rawTransaction instanceof Uint8Array || Buffer.isBuffer(rawTransaction))) {
    throw new Error('rawTransaction must be bytes');
  }
  if (!expectedPostcondition || typeof expectedPostcondition !== 'object') {
    throw new Error('expectedPostcondition is required');
  }

  const bytes = Buffer.from(rawTransaction);
  const digest = createHash('sha256').update(bytes).digest('hex');

  return Object.freeze({
    scenario_id: scenarioId,
    cluster,
    tx_sha256: digest,
    raw_tx_base64: bytes.toString('base64'),
    expected_postcondition: Object.freeze({ ...expectedPostcondition }),
    metadata: Object.freeze({ ...metadata }),
  });
}

export function sameTransactionArtifact(a, b) {
  return Boolean(a && b && a.tx_sha256 === b.tx_sha256 && a.raw_tx_base64 === b.raw_tx_base64);
}
