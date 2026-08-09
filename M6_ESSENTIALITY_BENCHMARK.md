# M6 — Essentiality Benchmark: Coordination Density Spike

## Status

**Frozen protocol. Not yet a result.**

This experiment exists because M5b falsified the simple assumption that a MagicBlock ER should become faster than local Solana merely as the number of independent objectives increases.

M6 therefore changes the scaling dimension.

It asks whether an ER becomes materially useful when **one persistent objective experiences many authenticated state transitions but produces few canonical economic outcomes**.

---

## Decision to inform

> **Does Reactor have a workload in which an Ephemeral Rollup is a materially useful hot-state substrate rather than decorative infrastructure?**

This benchmark does **not** attempt to prove that Solana needs Reactor or that autonomous systems cannot be implemented with a keeper.

It tests a necessary condition for the stronger Reactor thesis:

> high coordination density should allow Reactor to absorb transient authenticated state in a hot runtime while preserving canonical Solana authority and reducing canonical coordination work per verified objective completion.

---

## Coordination density

Define:

```text
Coordination Density
=
authenticated hot state transitions
/
canonical verified objective outcomes
```

M5b primarily increased horizontal objective count:

```text
50 objectives × ~1 opening transition
```

M6 instead increases temporal density:

```text
1 persistent objective
×
N authenticated transitions
×
1 verified completion
```

Default:

```text
N = 120 churn transitions
+ 1 opening transition
= 121 objective-relevant hot transitions
```

The objective remains non-executable throughout the churn. Only the final source transition makes all conditions jointly valid.

---

## Treatments

### A — Reactor on local Solana

All six `ConditionState` accounts and the `SessionCandidate` remain canonical Solana accounts.

Every authenticated transition executes:

```text
update_condition_and_maybe_seal(...)
```

on the base runtime.

Therefore every hot transition is also a canonical Solana transaction.

### B — Reactor with MagicBlock hot state

`Path`, `Objective` and `Vault` remain canonical on Solana.

The six `ConditionState` accounts and `SessionCandidate` are delegated to the local MagicBlock ER before the measured churn.

All hot transitions execute through the same Reactor instruction inside the ER.

Only when the objective becomes executable does the candidate cross back to Solana, after which the canonical program materializes an `ExecutionLock`, performs bounded settlement and writes a verified `Receipt`.

The ER never receives authority to spend the canonical Vault.

---

## Objective fixture

Canonical objective:

```text
initial exposure       700
objective target       <= 500
exposure reduction     200
bounded transfer       100,000 lamports
condition sources      6 independent keypairs
```

Initial condition state:

```text
C0 seq1 true
C1 seq1 true
C2 seq1 false     <- persistent blocker
C3 seq1 true
C4 seq1 true
C5 seq1 true
```

### Churn phase

The runner cycles across all six independently authenticated sources.

Each churn transition increments the selected source sequence.

For C0, C1, C3, C4 and C5:

```text
predicate = true
```

For C2 during churn:

```text
predicate = false
```

Therefore the objective must remain unsealed throughout all N churn transitions.

### Opening transition

After churn, C2 advances once more with:

```text
predicate = true
```

The exact current sequence vector must be frozen into the candidate.

### Immutability probe

After sealing, C0 advances again with a false predicate.

The candidate must remain byte-semantically equivalent in its frozen sequence vector.

### Verified completion

For the Solana treatment:

```text
candidate
 -> materialize ExecutionLock
 -> execute_locked
 -> verified Receipt
```

For the ER treatment:

```text
candidate in ER
 -> finalize / commit candidate
 -> canonical candidate on Solana
 -> materialize ExecutionLock
 -> execute_locked
 -> verified Receipt
```

---

## Primary metrics

### Safety and correctness

Both treatments must satisfy:

```text
candidate not sealed during churn
final candidate ready == true
frozen sequence vector == exact current vector
post-seal mutation does not alter frozen vector
settlement reaches target exposure
Receipt.verified == true
lock.consumed == true
zero policy / source / sequence violations
```

Any false or stale seal invalidates the experiment.

### Canonical coordination work

The runner records only transactions it itself submits or obtains as the MagicBlock commitment transaction.

It reports:

```text
common canonical setup transactions
ER-only delegation transactions
canonical hot-transition transactions
candidate commitment transactions
materialization transactions
settlement transactions
```

The primary efficiency comparison excludes common setup because both treatments require the same canonical Path / Objective / Vault / initial account construction.

Primary measure:

```text
canonical coordination tx / verified objective completion
```

For ER, one-time delegation overhead is included.

A second steady-state diagnostic excludes the one-time delegation cost, but it may not replace the primary metric.

### Hot-runtime work

- authenticated hot transitions processed;
- wall-clock churn interval;
- transitions / second;
- p50 / p95 / p99 submit-to-processed interval;
- failed hot transitions.

Latency is secondary. M6 does not require the ER to be faster than local Solana to pass the canonical-work hypothesis.

---

## Frozen pass / fail gate

The ER hot-state hypothesis passes this spike only if all are true:

```text
1. both treatments reach one verified objective completion
2. false seals == 0
3. immutable-after-seal == true
4. hot transitions >= 100
5. ER canonical coordination transactions
   are at least 75% lower than Solana
   after common setup, INCLUDING delegation overhead
```

The 75% threshold is frozen before observing results.

The ER hypothesis fails this spike if correctness differs or canonical-work reduction is below 75%.

A slower local ER does not by itself fail this hypothesis; it instead weakens a separate runtime-performance claim.

---

## What a passing result would support

A pass would support only:

> **For a high-coordination-density Reactor objective in this local fixture, an ER can absorb authenticated transient state while preserving canonical Solana authority and materially reducing the number of canonical coordination transactions required per verified completion.**

It would not prove:

- production fee savings;
- public-network throughput advantage;
- that MagicBlock is always faster;
- that every Reactor objective should be delegated;
- that Reactor is essential versus a simple offchain keeper;
- market demand;
- external DEX liquidity reservation.

---

## Keeper null baseline

A simple offchain keeper may observe state offchain and submit only one final transaction.

That can have lower canonical transaction count than either treatment.

It is **not semantics-equivalent** to this benchmark unless it also provides authenticated source transitions, replayable shared objective state, bounded authority, exact-state authorization and verified outcome evidence.

Therefore M6 does not fabricate a numeric keeper comparison.

The next Reactor-essentiality gate must compare against a real keeper implementation with an explicit guarantee matrix.

---

## Why this is the final pre-submission benchmark

If this spike passes, the submission can truthfully show an ER-native reason for the architecture that does not depend on cherry-picking latency:

```text
many hot authenticated transitions
        ↓
Reactor objective remains alive
        ↓
rare executable alignment
        ↓
one bounded canonical outcome
```

If it fails, the submission should describe MagicBlock as a demonstrated integration substrate whose essential operating region remains unproven.

Either result is publishable research evidence.

---

## Run

```bash
REACTOR_M6_CHURN_TRANSITIONS=120 \
bash scripts/bootstrap_m6_essentiality_local.sh
```

Outputs:

```text
experiment/results/m6-essentiality-latest.json
chamber/data/m6-essentiality-latest.json
```
