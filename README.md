# Reactor

**Transient executability locks for condition-driven onchain execution.**

Reactor observes independently changing execution conditions, determines when they are jointly executable under one bounded objective, freezes the exact compatible state versions into an immutable lock, and separates transaction submission from verified objective completion.

> Status: M1 product hypothesis and X1 deterministic local fixture. No MagicBlock, Solana, latency advantage, market demand, or production-security claim is proven by this repository yet.

## The thesis

Onchain objectives can depend on several independently changing conditions. Their valid overlap may disappear before a conventional observe-build-submit path captures it. Reactor tests whether a high-frequency delegated state environment can improve verified capture of those overlaps without creating stale or false locks.

The durable product direction is broader:

> Transactions are attempts. Reactor is being built so execution objectives can survive changing conditions and, later, failed attempts.

The hackathon proof is deliberately narrower:

```text
Objective + Path
      ↓
authenticated condition updates
      ↓
joint executability evaluation
      ↓
immutable version lock
      ↓
attempt → observation → verification
```

## What exists now

- canonical Product Truth;
- falsifiable thesis and null hypothesis;
- controlled experiment protocol;
- lifecycle and state-machine specification;
- deterministic condition/lock engine;
- fair delayed-observer baseline model;
- local scenario runner across multiple overlap durations;
- invariant tests for stale updates, invalidation, immutable locks, duplicate prevention, verification, failure, and Gaia classification;
- evidence-bounded whitepaper skeleton.

## Run the local fixture

Requires Python 3.11+ and no third-party dependencies.

```bash
python -m unittest discover -s tests -v
python scripts/run_experiment.py
```

The experiment runner writes a JSON result to `experiment/results/latest.json`.

## Evidence boundary

The current simulator can show that:

- compatible condition versions can be evaluated deterministically;
- expired, invalid, missing, or stale conditions cannot create a lock;
- an accepted lock remains immutable after later updates;
- duplicate evaluation cannot create duplicate effects;
- `SUBMITTED`, `OBSERVED`, and `VERIFIED` are distinct states;
- a latency-sensitive comparison can be represented reproducibly.

It cannot yet show that:

- representative onchain overlaps are commercially valuable;
- Solana or Jito misses them at a material rate;
- MagicBlock captures them more reliably;
- external protocol state can be safely reserved or carried into settlement;
- Reactor is production-safe.

## Repository map

```text
reactor/
├── PRODUCT_TRUTH.md
├── THESIS.md
├── EXPERIMENT_PROTOCOL.md
├── STATE_MACHINE.md
├── WHITEPAPER.md
├── src/reactor/
├── scripts/run_experiment.py
├── tests/
├── experiment/results/
└── .github/workflows/test.yml
```

## Next proof

Replace the deterministic latency models with three measured paths receiving the same authenticated condition stream:

1. standard Solana submission;
2. optimized/Jito submission;
3. MagicBlock Reactor.

The primary metric is **verified valid-window capture rate**. The non-negotiable safety metric is **zero false locks**.
