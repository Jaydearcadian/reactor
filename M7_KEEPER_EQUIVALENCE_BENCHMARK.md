# M7 — Keeper Equivalence Benchmark

## Status

**Draft protocol. Not frozen.**

M6 established a bounded operating region in which delegated hot state materially reduces canonical coordination transactions while preserving Reactor's canonical Solana authority and verified completion.

M7 attacks the stronger question:

> **Does Reactor provide guarantees that a materially simpler offchain keeper cannot reproduce at lower coordination and implementation cost?**

This is the next essentiality gate. It should not be frozen until the keeper implementation and guarantee matrix are concrete enough that neither treatment is artificially weakened.

---

## Treatments

### K — Offchain keeper + direct Solana

A real keeper implementation observes the same six authenticated sources, maintains whatever offchain state it requires, and submits the minimum canonical transaction set needed to produce the bounded outcome.

The keeper must be allowed to use competent engineering techniques. It must not be intentionally crippled to make Reactor look necessary.

### S — Reactor on Solana

The same Reactor objective and exact-state semantics, with hot state canonical on Solana.

### E — Reactor with MagicBlock hot state

The M6 architecture: six `ConditionState` accounts plus `SessionCandidate` delegated to the ER, canonical authority retained by Solana.

An optional fourth treatment may be added only if independently useful:

### N — ER-native coordination without Reactor semantics

This tests whether the Reactor abstraction itself adds anything beyond using the ER directly.

---

## Guarantee matrix

Every treatment must be scored explicitly rather than treated as semantics-equivalent by assumption.

| Guarantee | Keeper K | Reactor S | Reactor E |
|---|---:|---:|---:|
| independently authenticated source transitions | TBD | yes | yes |
| replayable shared objective state | TBD | yes | yes |
| exact-state authorization | TBD | yes | yes |
| stale-state rejection | TBD | yes | yes |
| bounded execution authority | TBD | yes | yes |
| immutable authorization snapshot | TBD | yes | yes |
| canonical settlement authority | TBD | yes | yes |
| verified outcome receipt | TBD | yes | yes |
| deterministic recovery/audit evidence | TBD | yes | yes |
| objective persistence across executor restarts | TBD | yes | yes |

`TBD` is intentional. The keeper must be implemented before those cells are resolved.

---

## Measurements

### Correctness

- false executions;
- stale executions;
- missed valid alignment;
- exact state captured;
- bounded authority preserved;
- target exposure reached;
- verified Receipt or keeper-equivalent evidence;
- recovery after process restart or observer interruption.

### Canonical work

- setup transactions;
- hot-state canonical transactions;
- final authorization/commit transactions;
- materialization transactions;
- settlement transactions;
- total canonical coordination transactions per verified completion.

### Offchain/operational work

Canonical transaction count alone is insufficient for M7.

Record:

- persistent state the operator must maintain;
- source authentication logic outside the chain;
- replay/recovery complexity;
- number of trusted processes/keys;
- crash-recovery behavior;
- evidence required to audit a completed action;
- lines/modules of treatment-specific coordination code only as a secondary diagnostic, never as a quality proxy.

### Runtime

Latency and throughput remain secondary unless a treatment cannot meet the fixture's timing requirements.

---

## Decision rule

M7 should answer two separate questions.

### 1. Guarantee equivalence

Can the keeper provide the same material guarantees?

If **no**, identify exactly which guarantee is missing and why it matters. Do not collapse this into a transaction-count comparison.

### 2. Cost under equivalent guarantees

If **yes**, compare canonical work and operational complexity under those equivalent guarantees.

If a keeper reproduces Reactor's material guarantees with materially less complexity and no meaningful loss of auditability, bounded authority, persistence, or exact-state safety, the Reactor abstraction thesis weakens.

If the keeper only achieves lower canonical work by moving critical guarantees into an opaque trusted process, that is a different system and should be reported as such rather than declared an equivalent winner.

---

## Anti-cherry-picking rules before freeze

Before M7 becomes frozen:

1. implement the keeper first;
2. publish the exact guarantee matrix;
3. define which guarantees are mandatory for equivalence;
4. freeze objective/source fixture and failure injections;
5. freeze accounting boundaries for onchain and offchain work;
6. define pass/fail language before observing the comparative result.

M7 should be adversarial to Reactor. A competent keeper win is a valid and useful result.
