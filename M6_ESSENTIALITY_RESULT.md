# M6 — Essentiality Benchmark Result

## Result

**PASS — frozen protocol satisfied on 2026-08-09.**

This document records the observed result of the already-frozen protocol in `M6_ESSENTIALITY_BENCHMARK.md`. The protocol itself remains unchanged so the pass criteria stay visibly precommitted.

Observed environment:

```text
Reactor program      75ph49gq12tUVV2XAfmDozseGfuu5ZTSZDPB8MPF8oax
MagicBlock validator 0.13.19
Fixture              fully local Solana base + local MagicBlock ER
Churn transitions    120
Opening transition   1
Hot transitions      121
Frozen reduction gate >= 75%
```

Observed primary result:

```text
Solana canonical coordination      123 tx
MagicBlock canonical coordination   10 tx
Canonical-work reduction            91.870%
Verdict                              PASS
```

Gate results:

```text
verified_completion_both      PASS  observed=true
false_seals_zero              PASS  observed=0
stale_seals_zero              PASS  observed=0
immutable_after_seal          PASS  observed=true
hot_transitions_at_least_100  PASS  observed=121
correctness_equivalent        PASS  observed=true
canonical_work_reduction      PASS  observed=0.9186991869918699
```

The 123 canonical transactions in the Solana treatment are structurally:

```text
120 churn transitions
+ 1 opening transition
+ 1 ExecutionLock materialization
+ 1 settlement
= 123
```

The 10 canonical transactions in the MagicBlock treatment are structurally:

```text
7 delegation transactions
+ 1 candidate commitment
+ 1 ExecutionLock materialization
+ 1 settlement
= 10
```

Common canonical setup is excluded from the primary comparison in both treatments, exactly as specified by the frozen protocol. MagicBlock's one-time delegation overhead is included.

## Supported claim

This result supports the bounded claim frozen before execution:

> **For a high-coordination-density Reactor objective in this local fixture, an Ephemeral Rollup can absorb authenticated transient state while preserving canonical Solana authority and materially reducing the number of canonical coordination transactions required per verified completion.**

The measured reduction in this run was **91.87%**.

## What this does not prove

This result does not establish:

- production fee savings;
- a public-network throughput advantage;
- that MagicBlock is always lower latency than Solana;
- that every Reactor objective should delegate hot state;
- that Reactor is essential versus a semantics-equivalent offchain keeper;
- market demand;
- external DEX liquidity reservation.

The next essentiality experiment is therefore a keeper-equivalence benchmark rather than another ER-vs-Solana latency test.

## Evidence preservation

The runner writes the live result to:

```text
experiment/results/m6-essentiality-latest.json
chamber/data/m6-essentiality-latest.json
```

Those files are intentionally produced by the benchmark rather than reconstructed from this Markdown record. Run:

```bash
node scripts/archive_m6_pass.mjs
```

to validate the local evidence (`verdict === PASS` and all gates passing) and create immutable timestamped JSON snapshots under `experiment/results/archive/` and `chamber/data/archive/` before committing them.
