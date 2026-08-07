import { performance } from 'node:perf_hooks';

export class TrialTelemetry {
  constructor({ scenarioId, path, cluster, windowMs, seed, expectedSequences }) {
    this.record = {
      scenarioId,
      path,
      cluster,
      windowMs,
      seed,
      expectedSequences: [...expectedSequences],
      marks: {},
      signatures: {},
      capture: false,
      exactVersionMatch: false,
      falseLock: false,
      staleAttempt: false,
      duplicateEffect: false,
      ambiguous: false,
      verifiedObjective: false,
      config: {},
    };
  }

  mark(name, metadata = {}) {
    if (this.record.marks[name]) throw new Error(`duplicate mark: ${name}`);
    const monotonicMs = performance.now();
    const wallTime = new Date().toISOString();
    const mark = { monotonicMs, wallTime, ...metadata };
    this.record.marks[name] = mark;
    return mark;
  }

  signature(name, signature) {
    this.record.signatures[name] = signature;
  }

  config(values) {
    Object.assign(this.record.config, values);
  }

  set(values) {
    Object.assign(this.record, values);
  }

  deltaMs(start, end) {
    const a = this.record.marks[start]?.monotonicMs;
    const b = this.record.marks[end]?.monotonicMs;
    if (a == null || b == null) return null;
    return b - a;
  }

  finish() {
    return {
      ...this.record,
      latency: {
        captureMs: this.deltaMs('window_open_emitted', 'capture_observed'),
        observationToDecisionMs: this.deltaMs('condition_observed', 'capture_observed'),
        windowOpenAckMs: this.deltaMs('window_open_emitted', 'window_open_acknowledged'),
        commitMs: this.deltaMs('capture_observed', 'base_commit_observed'),
        materializeMs: this.deltaMs('base_commit_observed', 'lock_materialized'),
        verifiedMs: this.deltaMs('window_open_emitted', 'objective_verified'),
      },
    };
  }
}

export function percentile(values, p) {
  const xs = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const index = (xs.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return xs[lower];
  const weight = index - lower;
  return xs[lower] * (1 - weight) + xs[upper] * weight;
}

export function wilsonInterval95(successes, trials) {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) || successes < 0 || trials < 0 || successes > trials) {
    throw new Error('invalid binomial counts');
  }
  if (trials === 0) return null;
  const z = 1.959963984540054;
  const z2 = z * z;
  const p = successes / trials;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) / trials) + (z2 / (4 * trials * trials)))) / denominator;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

export function captureRateDifference95(treatmentSuccesses, treatmentTrials, baselineSuccesses, baselineTrials) {
  if (treatmentTrials === 0 || baselineTrials === 0) return null;
  const treatmentRate = treatmentSuccesses / treatmentTrials;
  const baselineRate = baselineSuccesses / baselineTrials;
  const treatmentInterval = wilsonInterval95(treatmentSuccesses, treatmentTrials);
  const baselineInterval = wilsonInterval95(baselineSuccesses, baselineTrials);
  return {
    difference: treatmentRate - baselineRate,
    lower: treatmentInterval.lower - baselineInterval.upper,
    upper: treatmentInterval.upper - baselineInterval.lower,
    method: 'newcombe-wilson-conservative',
  };
}

export function summarizeTrials(trials) {
  const captureLatencies = trials.map((trial) => trial.latency?.captureMs).filter(Number.isFinite);
  const verifiedLatencies = trials.map((trial) => trial.latency?.verifiedMs).filter(Number.isFinite);
  const total = trials.length;
  const captured = trials.filter((trial) => trial.capture && trial.exactVersionMatch).length;
  const verified = trials.filter((trial) => trial.verifiedObjective).length;
  const falseLocks = trials.filter((trial) => trial.falseLock).length;

  return {
    trials: total,
    captured,
    captureRate: total === 0 ? null : captured / total,
    captureRate95: wilsonInterval95(captured, total),
    verified,
    verifiedCaptureRate: total === 0 ? null : verified / total,
    verifiedCaptureRate95: wilsonInterval95(verified, total),
    falseLocks,
    falseLockRate: total === 0 ? null : falseLocks / total,
    falseLockRate95: wilsonInterval95(falseLocks, total),
    captureLatencyMs: {
      p50: percentile(captureLatencies, 0.50),
      p95: percentile(captureLatencies, 0.95),
      p99: percentile(captureLatencies, 0.99),
    },
    verifiedLatencyMs: {
      p50: percentile(verifiedLatencies, 0.50),
      p95: percentile(verifiedLatencies, 0.95),
      p99: percentile(verifiedLatencies, 0.99),
    },
  };
}
