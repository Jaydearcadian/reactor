import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const SOURCE = process.env.REACTOR_M6_RESULT_PATH ?? 'experiment/results/m6-essentiality-latest.json';
const CHAMBER_SOURCE = process.env.REACTOR_M6_CHAMBER_RESULT_PATH ?? 'chamber/data/m6-essentiality-latest.json';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function currentGitCommit() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

function stamp(value) {
  const date = value ? new Date(value) : new Date();
  assert(!Number.isNaN(date.getTime()), `invalid generatedAt timestamp: ${value}`);
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

assert(fs.existsSync(SOURCE), `missing ${SOURCE}; run the frozen M6 benchmark first`);
const sourceBytes = fs.readFileSync(SOURCE);
const raw = JSON.parse(sourceBytes.toString('utf8'));

assert(raw.schema === 'reactor.m6-essentiality.v1', `unexpected schema: ${raw.schema}`);
assert(String(raw.verdict).toUpperCase() === 'PASS', `refusing to archive non-PASS M6 evidence: ${raw.verdict}`);
assert(Array.isArray(raw.gates) && raw.gates.length > 0, 'M6 evidence has no gates');
const failed = raw.gates.filter((gate) => gate?.pass !== true);
assert(failed.length === 0, `refusing to archive M6 evidence with failed gates: ${failed.map((gate) => gate.id).join(', ')}`);

const digest = crypto.createHash('sha256').update(sourceBytes).digest('hex');
const shortDigest = digest.slice(0, 12);
const commit = String(raw.provenance?.gitCommit ?? currentGitCommit()).slice(0, 12);
const timestamp = stamp(raw.generatedAt);
const basename = `m6-essentiality-${timestamp}-${commit}-${shortDigest}.json`;

const experimentArchive = path.join('experiment/results/archive', basename);
const chamberArchive = path.join('chamber/data/archive', basename);
for (const destination of [experimentArchive, chamberArchive]) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  assert(!fs.existsSync(destination), `archive already exists: ${destination}`);
  fs.writeFileSync(destination, sourceBytes);
}

if (fs.existsSync(CHAMBER_SOURCE)) {
  const chamberBytes = fs.readFileSync(CHAMBER_SOURCE);
  const chamberDigest = crypto.createHash('sha256').update(chamberBytes).digest('hex');
  assert(chamberDigest === digest, `${CHAMBER_SOURCE} does not match ${SOURCE}`);
}

console.log('M6 PASS evidence archived');
console.log(`sha256:      ${digest}`);
console.log(`experiment:  ${experimentArchive}`);
console.log(`chamber:     ${chamberArchive}`);
console.log('Commit both generated JSON files without editing them.');
