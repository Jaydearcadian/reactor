# M5 — Coordination Efficiency

## Status

**Active falsification gate.**

M4 established two important facts:

1. the local MagicBlock ER has a large controlled hot-path runtime latency signal for Reactor's exact-state sealing primitive;
2. ordinary Solana can still capture the same synthetic executable configuration when given an aggressive speculative coordinator.

Therefore Reactor must no longer claim that Solana is intrinsically unable to create or capture an equivalent execution lock.

M5 asks a harder systems question:

> How much continuous work must each architecture perform to keep many objectives executable and capture them reliably as their independently changing conditions align?

The comparison is now **best operational strategy per architecture**:

```text
Solana:     speculative exact-version execution
Reactor ER: reactive hot-state coordination
```

---

## Core hypothesis

For one objective, speculation may be perfectly acceptable.

As the number of simultaneously active objectives grows, the speculative strategy must continuously spend transaction bandwidth and fees on states that are not executable, while Reactor keeps hot state delegated and emits a bounded seal only after the objective actually becomes executable.

M5 tests whether that efficiency difference is large enough to justify Reactor.

---

## M5a — Local concurrency/efficiency smoke

### Objective counts

```text
1
5
10
```

The smoke deliberately starts small. If semantics are clean, later runs extend to:

```text
25
50
100+
```

### Source schedule

Each objective has six conditions and the same exact target vector:

```text
[1,1,2,1,1,1]
```

Initial state:

```text
C0 seq1 true
C1 seq1 true
C2 seq1 false   <- blocker
C3 seq1 true
C4 seq1 true
C5 seq1 true
```

For each objective, independent source writers emit:

```text
T0 + jitter:          C2 -> seq2 true
T0 + jitter + 100ms:  C0 -> seq2 false
```

The jitter staggers objectives inside one load episode so the benchmark measures overlapping live objectives instead of a single synchronized burst.

The configured 100 ms remains a **source-emission spacing**, not a claim of an exact 100 ms authoritative ledger lifetime.

---

## Solana treatment — speculative

The Solana coordinator is armed before the first opening event.

For every active objective it repeatedly submits a unique transaction containing only:

```text
evaluate_session_candidate([1,1,2,1,1,1])
```

Default cadence:

```text
5 ms / objective
~200 attempts/sec/objective
```

Each speculative attempt gets its own funded fee-payer keypair, preserving the corrected M4 V2 baseline:

- unique signatures;
- no shared coordinator payer lock;
- source writers use independent source fee payers;
- no source mutation + seal bundling;
- at most one unique successful seal per candidate.

Speculation continues while objectives are active, including before their opening event.

---

## Reactor treatment — reactive ER

The six condition accounts and `SessionCandidate` for each objective are delegated to the same local MagicBlock ER before measurement.

The coordinator maintains warmed processed account subscriptions for each objective's blocker condition.

When an objective's C2 condition becomes sequence 2 / predicate true, the coordinator submits **one** prebuilt exact-vector seal transaction for that objective.

It does not continuously speculate seals before the opening event.

This represents Reactor's intended architecture:

```text
persistent objective
      +
hot delegated state
      +
reactive evaluation/sealing
      ->
one meaningful candidate
```

M5a measures the hot coordination layer only. Commit/undelegate, canonical lock materialization, settlement and Receipt are added back in M5b after a useful efficiency signal exists.

---

## Ground truth

A successful capture requires:

```text
candidate.ready == true
candidate.frozen_sequences == [1,1,2,1,1,1]
false_lock == false
```

False locks must remain zero.

No result is counted merely because RPC accepted a transaction.

---

## Primary efficiency metrics

Per treatment and objective-count level:

### Correctness

- objectives active;
- exact captures;
- capture rate;
- false locks;
- instrumentation failures.

### Work

- coordinator transactions submitted;
- coordinator transactions processed;
- coordinator successes;
- coordinator failed/wasted transactions;
- source transactions submitted;
- total hot-path transactions submitted.

### Economic cost

- estimated coordinator fees;
- estimated source fees where applicable;
- estimated total hot-path fees;
- fee per successful capture.

Local MagicBlock zero-fee behavior is recorded as observed by `getFeeForMessage`; it is not generalized to every deployment or production commercial model.

### Efficiency ratios

```text
coordinator attempts / successful capture
failed coordinator attempts / successful capture
total hot tx / successful capture
estimated lamports / successful capture
```

### Scheduling/load

- configured speculative attempts/sec/objective;
- total configured speculative attempt rate;
- actual submissions achieved;
- wall-clock episode duration;
- capture degradation as active objective count increases.

---

## What M5a can prove

M5a can demonstrate that, under this local fixture:

- both strategies can or cannot preserve capture reliability as concurrency grows;
- one strategy performs materially more transaction work per successful capture;
- speculative transaction cost grows with active-objective count;
- Reactor's hot-state model does or does not reduce wasted execution work.

It cannot yet prove:

- production economics;
- public-network throughput limits;
- Jito behavior under equivalent load;
- full end-to-end verified settlement advantage;
- real market opportunity value.

---

## Falsification conditions

Reactor's efficiency story weakens materially if any of these hold:

1. a reasonable Solana strategy matches capture reliability with comparable work/cost;
2. Reactor reactive capture degrades faster than speculative Solana as objectives increase;
3. account delegation/maintenance overhead dominates the saved speculative work;
4. Reactor needs frequent base commits that erase its hot-state efficiency;
5. false-lock or stale-state rates become non-zero under concurrency.

If that happens, MagicBlock should become optional rather than architecturally required.

---

## Continuation gate to M5b

Proceed to end-to-end commit/materialize/settle/Receipt load testing only if the local smoke shows:

```text
zero false locks
AND
comparable or better capture reliability
AND
materially lower coordinator work per successful capture
AND
advantage grows or remains meaningful as objective count increases
```

No arbitrary numerical win threshold is frozen before the smoke distribution is observed. The result must be large enough to matter after delegation and commit costs are included.
