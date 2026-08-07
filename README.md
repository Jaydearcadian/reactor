# Reactor

**Transient executability locks for condition-driven onchain execution.**

Reactor observes independently changing execution conditions, determines when they are jointly executable under one bounded objective, freezes the exact compatible state versions into an immutable lock, and separates transaction submission from verified objective completion.

> Status: M1 product hypothesis, X1 deterministic local fixture, and X2/X3 measurement harness scaffold. No MagicBlock, Solana, Jito, latency advantage, market demand, or production-security claim is proven by this repository yet.

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
- monotonic live telemetry recorder;
- strict `SUBMITTED → ACKNOWLEDGED → OBSERVED → VERIFIED` evidence states;
- dependency-free JSON-RPC connectivity probe;
- live benchmark contract for standard Solana, Jito, and MagicBlock Reactor;
- evidence-bounded whitepaper skeleton.

## Run the local fixture

Requires Python 3.11+ and no third-party dependencies.

```bash
python -m unittest discover -s tests -v
python scripts/run_experiment.py
```

The experiment runner writes a JSON result to `experiment/results/latest.json`.

## Probe live RPC endpoints

Connectivity is not execution evidence, but it is the first live integration check.

```bash
export SOLANA_RPC_URL="<solana-json-rpc-endpoint>"
export MAGICBLOCK_RPC_URL="<magicblock-json-rpc-endpoint>"
python scripts/probe_live_paths.py
```

The probe writes `experiment/results/live-probe.json` and records monotonic request timing. A successful RPC response must never be counted as a successful execution.

See `LIVE_BENCHMARK.md` for the evidence contract required before an X3 claim is allowed.

## Evidence boundary

The current simulator and measurement harness can show that:

- compatible condition versions can be evaluated deterministically;
- expired, invalid, missing, or stale conditions cannot create a lock;
- an accepted lock remains immutable after later updates;
- duplicate evaluation cannot create duplicate effects;
- `SUBMITTED`, `ACKNOWLEDGED`, `OBSERVED`, and `VERIFIED` are distinct evidence states;
- a latency-sensitive comparison can be represented reproducibly;
- network probes can record transport timing without overstating execution success.

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
├── LIVE_BENCHMARK.md
├── WHITEPAPER.md
├── src/reactor/
│   ├── engine.py
│   ├── experiment.py
│   ├── live_paths.py
│   ├── model.py
│   ├── rpc.py
│   └── telemetry.py
├── scripts/
│   ├── run_experiment.py
│   └── probe_live_paths.py
├── tests/
├── experiment/results/
└── .github/workflows/test.yml
```

## Next proof

Implement signed execution adapters for three measured paths receiving the same authenticated condition stream:

1. standard Solana submission;
2. optimized/Jito submission;
3. MagicBlock Reactor commit + base-layer execution.

The primary metric is **verified valid-window capture rate**. The non-negotiable safety metric is **zero false locks**.
