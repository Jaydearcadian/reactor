import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TrialTelemetry,
  percentile,
  summarizeTrials,
  wilsonInterval95,
  captureRateDifference95,
} from '../src-js/m4-telemetry.mjs';

test('TrialTelemetry records monotonic deltas and exact trial state', () => {
  const trial = new TrialTelemetry({
    scenarioId: 'm4-test',
    path: 'magicblock',
    cluster: 'devnet',
    windowMs: 150,
    seed: 'abc',
    expectedSequences: [1, 1, 2, 1, 1, 1],
  });

  trial.mark('window_open_emitted');
  trial.mark('window_open_acknowledged');
  trial.mark('condition_observed');
  trial.mark('capture_observed');
  trial.set({ capture: true, exactVersionMatch: true });
  const result = trial.finish();

  assert.equal(result.capture, true);
  assert.equal(result.exactVersionMatch, true);
  assert.deepEqual(result.expectedSequences, [1, 1, 2, 1, 1, 1]);
  assert.ok(result.latency.captureMs >= 0);
  assert.ok(result.latency.observationToDecisionMs >= 0);
});

test('percentile interpolates sorted finite samples', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([10], 0.5), 10);
  assert.equal(percentile([10, 20, 30], 0.5), 20);
  assert.equal(percentile([10, 20, 30, 40], 0.5), 25);
});

test('Wilson interval remains bounded and includes observed rate', () => {
  const interval = wilsonInterval95(8, 10);
  assert.ok(interval.lower >= 0);
  assert.ok(interval.upper <= 1);
  assert.ok(interval.lower <= 0.8 && interval.upper >= 0.8);
});

test('capture-rate difference reports treatment minus baseline', () => {
  const result = captureRateDifference95(8, 10, 4, 10);
  assert.ok(Math.abs(result.difference - 0.4) < 1e-12);
  assert.ok(result.lower <= result.difference);
  assert.ok(result.upper >= result.difference);
});

test('summarizeTrials separates capture from verified outcome and false locks', () => {
  const trials = [
    { capture: true, exactVersionMatch: true, verifiedObjective: true, falseLock: false, latency: { captureMs: 10, verifiedMs: 100 } },
    { capture: true, exactVersionMatch: true, verifiedObjective: false, falseLock: false, latency: { captureMs: 20, verifiedMs: null } },
    { capture: false, exactVersionMatch: false, verifiedObjective: false, falseLock: true, latency: { captureMs: null, verifiedMs: null } },
  ];

  const summary = summarizeTrials(trials);
  assert.equal(summary.trials, 3);
  assert.equal(summary.captured, 2);
  assert.equal(summary.verified, 1);
  assert.equal(summary.falseLocks, 1);
  assert.equal(summary.captureRate, 2 / 3);
  assert.equal(summary.verifiedCaptureRate, 1 / 3);
  assert.equal(summary.falseLockRate, 1 / 3);
  assert.ok(summary.captureRate95.lower <= summary.captureRate);
  assert.ok(summary.captureRate95.upper >= summary.captureRate);
});
