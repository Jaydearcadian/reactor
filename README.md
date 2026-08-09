# Reactor

**Executability coordination for persistent objectives over independently changing onchain state.**

Reactor is an experimental execution-control primitive for objectives whose validity depends on multiple independently changing conditions. It binds actions to exact state versions, captures a jointly executable configuration into an immutable candidate/lock, and separates transaction submission from verified objective completion.

> **Status — experimental research prototype.** The exact-version locking and settlement primitive is demonstrated locally and on Solana devnet. MagicBlock Ephemeral Rollup integration is demonstrated end to end: hot condition state is delegated, exact versions are sealed in the ER, the candidate is committed and undelegated back to Solana, a canonical lock is materialized, bounded value settles, the objective postcondition is verified, and replay is rejected. The latest M4 statistical benchmark completed 300 randomized cycles / 900 strategy observations with zero false locks. Reactive MagicBlock and aggressive speculative Solana both reached **99% exact capture**, while reactive Solana reached **2.33%**. The current evidence therefore supports a coordination-efficiency question, not a claim that Solana fundamentally cannot capture the same state.

## The thesis

Faster execution does not eliminate coordination. As autonomous systems produce more concurrent state transitions, an application may need to act only when several independently controlled conditions are simultaneously valid.

If the actor creating the final state transition can legitimately bundle:

```text
state update
+
condition check
+
execution / seal
```

then ordinary Solana atomicity is often sufficient. Reactor is aimed at the harder class:

> **Objectives whose executability emerges from independently controlled state transitions that cannot or will not be co-bundled into one Reactor-aware transaction.**

Reactor treats that as an executability problem:

```text
persistent Objective
        +
bounded Path / authority
        +
independent changing state
        ↓
exact joint-validity detection
        ↓
immutable candidate / lock
        ↓
bounded execution attempt
        ↓
postcondition verification
        ↓
Receipt
```

Long term, the abstraction is:

> **Retry objectives, not transactions. Bind actions to exact state, not stale observations.**

## Why MagicBlock

Reactor does not use MagicBlock as a substitute settlement chain. It uses an Ephemeral Rollup as the hot coordination substrate while preserving canonical authority and settlement on Solana.

```text
SOLANA
Path / Objective / Vault
        │
        │ delegate hot state only
        ▼
MAGICBLOCK ER
ConditionState × 6
SessionCandidate
        ↓
rapid authenticated updates
        ↓
exact joint-validity evaluation
        ↓
sealed exact-version candidate
        │
        │ commit + undelegate
        ▼
SOLANA
materialize canonical ExecutionLock
        ↓
bounded economic action
        ↓
Receipt / verified postcondition
```

The ER never receives authority to spend the canonical Vault. MagicBlock detects and seals transient executability; Solana authorizes and settles.

## Current proof status

| Proof | Status |
|---|---|
| Deterministic Reactor state-machine fixture | Demonstrated |
| Real Solana `ExecutionLock` | Demonstrated |
| Stale / replay / false-condition rejection | Demonstrated |
| Native SOL value movement + postcondition verification | Demonstrated locally + Solana devnet |
| MagicBlock hot-state delegation | Demonstrated |
| Exact-version candidate sealing in ER | Demonstrated |
| Candidate commit + undelegate back to Solana | Demonstrated |
| Canonical lock materialization + settlement | Demonstrated |
| Local ER runtime latency diagnostic | Demonstrated experimental result |
| Non-co-bundleable coordination smoke | Demonstrated experimental result |
| 300-cycle randomized coordination benchmark | Demonstrated experimental result |
| MagicBlock capture superiority over strongest Solana strategy | **Not demonstrated** |
| Production economics / fee advantage | **Not measured yet** |
| Representative market demand / external DEX reservation | **Not demonstrated** |
| Production security | **Not claimed** |

## M4 — Statistical coordination benchmark

The latest M4 experiment compares three implemented coordination strategies under the same Reactor exact-version semantics.

### Strategies

```text
SR — Solana reactive
source update
    ↓
observer notices executable state
    ↓
coordinator submits exact seal

MR — MagicBlock reactive
source update enters delegated hot state
    ↓
ER observer/coordinator reacts
    ↓
exact candidate sealed

SS — Solana speculative
expected exact vector is known
    ↓
coordinator repeatedly submits unique
exact-version seal attempts at bounded cadence
    ↓
one may land while the target vector exists
```

No benchmark transaction is allowed to combine source mutation with Reactor candidate sealing.

### Configuration

```text
source-emission regimes:       10 ms, 50 ms, 150 ms
trials / regime / strategy:    100
strategies:                    3
randomized cycles:             300
strategy observations:        900
speculative cadence:           50 ms
window jitter:                 ±20%
random seed:                   4082026
update + seal bundling:        disallowed
```

The configured millisecond bands are **source-emission spacing**, not a claim of equal authoritative on-ledger state lifetime. Exact frozen candidate state is the capture ground truth.

### Final results — 2026-08-09

| Source-emission regime | Solana reactive | MagicBlock reactive | Solana speculative | Speculative attempts / capture | Speculative waste |
|---:|---:|---:|---:|---:|---:|
| ~10 ms | 0 / 100 (0%) | 97 / 100 (97%) | 97 / 100 (97%) | 4.12× | 75.75% |
| ~50 ms | 1 / 100 (1%) | 100 / 100 (100%) | 100 / 100 (100%) | 4.48× | 77.68% |
| ~150 ms | 6 / 100 (6%) | 100 / 100 (100%) | 100 / 100 (100%) | 6.58× | 84.80% |
| **Overall** | **7 / 300 (2.33%)** | **297 / 300 (99%)** | **297 / 300 (99%)** | **5.07×** | **80.28%** |

All 900 observations completed and **zero false locks** were recorded.

Overall Wilson 95% capture intervals:

```text
Solana reactive:      1.13% — 4.74%
MagicBlock reactive: 97.10% — 99.66%
Solana speculative:  97.10% — 99.66%
```

The speculative Solana strategy submitted:

```text
1,506 total exact-version attempts
  297 landed successful captures
1,209 landed failed / stale attempts
```

This corresponds to:

```text
coordination amplification factor = 5.07×
waste ratio                       = 80.28%
```

### What M4 says

The strongest implemented Solana adversary **matched** MagicBlock's 99% exact capture rate. Therefore the statistical result does **not** support the earlier hypothesis that ER coordination would exceed the strongest Solana baseline by ≥20 percentage points in the selected bands.

That falsifies **capture possibility alone** as Reactor's differentiator under this synthetic fixture.

What the benchmark exposes instead is a different systems tradeoff:

> **Reactive low-latency coordination reached the same 99% exact capture reliability that the implemented Solana baseline reproduced through repeated speculative transaction attempts.**

The next question is therefore not merely "can the state be captured?" It is:

> **How much execution amplification, failed work, fee spend, compute, bandwidth and contention are required to maintain a target exact-state capture probability?**

The benchmark currently records speculative attempt amplification and landed-attempt waste. Fee/cost fields are not yet populated, so this repository does **not** claim that the ER path is 5× cheaper.

### Claim boundary

This is a controlled **local** benchmark. It compares three implemented strategies under the same Reactor coordination semantics.

It does **not** prove:

- a fundamental Solana impossibility;
- a production-wide MagicBlock advantage;
- public-network or Jito superiority;
- that 10–150 ms opportunities are economically representative;
- production profitability;
- production fee savings.

## M4-Engine — local runtime diagnostic

Before the coordination benchmark, Reactor measured the same prebuilt atomic transaction on a local Solana base runtime and a local MagicBlock ER.

Both paths produced 10 / 10 exact seals with zero false locks.

| Metric | Local Solana | Local MagicBlock ER |
|---|---:|---:|
| mean submit → processed | 247.487 ms | 5.253 ms |
| p50 | 243.422 ms | 5.087 ms |
| p95 | 282.307 ms | 6.913 ms |
| p99 | 286.717 ms | 7.449 ms |

This is a controlled local runtime signal, **not** a claim that MagicBlock is generically "47× faster than Solana." See `M4_ENGINE.md` for the measurement boundary.

## M2 — Real Executability Lock

The Anchor program in `programs/reactor/` introduces:

- `Path` — standing authority, transfer limit and expiry;
- `Objective` — target postcondition and canonical condition set;
- `ConditionState` — independently authorized, monotonically versioned state;
- `Vault` — Reactor-owned lamports and controlled fixture exposure;
- `SessionCandidate` — hot exact-version candidate used in M3/M4;
- `ExecutionLock` — immutable conditions, recipient, action and predicted postcondition;
- `Receipt` — verified before/after outcome evidence.

### Demonstrated Solana devnet fixture

```text
program                     75ph49gq12tUVV2XAfmDozseGfuu5ZTSZDPB8MPF8oax
stale exact sequence        rejected
false predicate             rejected
frozen sequences            [1,1,3,1,1,1]
later condition update      lock unchanged
vault debit                 100000 lamports
recipient credit            100000 lamports
exposure                    700 -> 500
Receipt                     verified=true
lock                         consumed=true
duplicate execution         rejected
```

See `M2_EXECUTABILITY_LOCK.md` and `M2_DEVNET.md`.

## M3 — MagicBlock → Solana settlement lifecycle

The demonstrated M3 run proved the full architecture boundary:

```text
7 hot accounts               delegated + ownership verified
stale exact sequence         rejected in ER
false predicate              rejected in ER
candidate exact versions     frozen
post-seal mutation           candidate unchanged
candidate commit             observed on Solana
candidate undelegation       observed on Solana
canonical ExecutionLock      materialized
vault debit                  100000 lamports
recipient credit             100000 lamports
exposure                     700 -> 500
Receipt                      verified=true
lock                         consumed=true
duplicate execution          rejected
```

Evidence artifact name: `experiment/results/m3-magicblock-devnet-2026-08-07.json`.

See `M3_MAGICBLOCK.md` for architecture and lifecycle details.

## Reproduce the current statistical benchmark

Local requirements:

- Rust / Cargo
- Solana CLI
- Anchor CLI
- Node.js + npm
- MagicBlock `mb-test-validator`
- MagicBlock `ephemeral-validator`

Run:

```bash
bash scripts/bootstrap_m4_coordination_statistical_local.sh
```

The bootstrap resets and starts a local Solana base validator, deploys Reactor, starts a local MagicBlock ER, and runs the randomized statistical suite.

Generated evidence:

```text
experiment/results/m4-coordination-statistical-latest.json
experiment/results/m4-coordination-statistical-analysis-latest.json
experiment/results/m4-coordination-statistical-runs/
experiment/results/m4-coordination-statistical-logs/mb-test-validator.log
experiment/results/m4-coordination-statistical-logs/ephemeral-validator.log
```

For the deterministic Python fixture:

```bash
python -m unittest discover -s tests -v
python scripts/run_experiment.py
```

## Evidence discipline

Reactor distinguishes:

```text
SUBMITTED != ACKNOWLEDGED != OBSERVED != VERIFIED
```

RPC connectivity, a transaction signature, or a bundle acknowledgement is not counted as verified objective completion.

The repository supports these demonstrated claims:

- Reactor deploys and executes on Solana devnet;
- exact condition versions can be bound into immutable locks/candidates;
- stale and replayed sequences are rejected;
- false conditions cannot lock;
- later condition updates cannot substitute themselves into an accepted lock;
- bounded program-owned SOL moves with exact value conservation in the controlled fixture;
- the resulting Receipt verifies the objective postcondition;
- duplicate execution is blocked;
- hot Reactor condition/candidate state can be delegated into a MagicBlock ER;
- exact-version candidate sealing executes in the ER;
- a sealed candidate survives later state mutation unchanged;
- the candidate can be committed and undelegated back to Solana;
- Solana can revalidate that candidate into the canonical lock and reuse the proven settlement path;
- the 300-cycle M4 statistical benchmark completed with zero false locks;
- reactive MagicBlock and speculative Solana both reached 99% exact capture in the tested local fixture;
- the implemented speculative baseline required 1,506 attempts for 297 captures.

The repository does **not** yet support claims of:

- fundamental MagicBlock capture superiority over Solana;
- representative market-maker or autonomous-agent demand;
- material public Solana/Jito miss rates;
- arbitrary external DEX resource reservation;
- end-to-end production economics;
- production security;
- production profitability or prevalence of valuable short-lived windows.

## Repository map

```text
reactor/
├── PRODUCT_TRUTH.md
├── THESIS.md
├── EXPERIMENT_PROTOCOL.md
├── STATE_MACHINE.md
├── M2_EXECUTABILITY_LOCK.md
├── M2_DEVNET.md
├── M3_MAGICBLOCK.md
├── M4_ENGINE.md
├── M4_COORDINATION.md
├── M4_COORDINATION_SMOKE_RESULT.md
├── M4_SPECULATIVE_V2.md
├── M4_BENCHMARK.md
├── LIVE_BENCHMARK.md
├── WHITEPAPER.md
├── Anchor.toml
├── Cargo.toml
├── programs/reactor/
├── src/reactor/
├── src-js/
│   ├── transaction-artifact.mjs
│   └── m4-telemetry.mjs
├── scripts/
│   ├── bootstrap_m2_local.sh
│   ├── bootstrap_m2_devnet.sh
│   ├── bootstrap_m3_magicblock.sh
│   ├── bootstrap_m4_engine_local.sh
│   ├── bootstrap_m4_coordination_local.sh
│   ├── bootstrap_m4_coordination_statistical_local.sh
│   ├── run_m4_coordination_statistical.mjs
│   ├── analyze_m4_coordination_statistical.mjs
│   └── ...
├── tests/
├── tests-js/
└── experiment/results/
```

## Next experiments

The synthetic exact-capture question is no longer enough by itself. The next work should test the coordination model on harder dimensions:

1. **Resource economics** — measure fee spend, compute, bandwidth, contention and cost per successful capture for reactive ER coordination versus speculative base-layer execution.
2. **Sustained concurrency** — run many simultaneous objectives and independent source streams rather than one controlled objective at a time.
3. **Verified end-to-end capture** — continue representative captured candidates through commit, materialization, settlement and `Receipt` verification.
4. **Public strong baseline** — reproduce the relevant workload on public same-cluster infrastructure and include the strongest fair Solana/Jito path available.
5. **Vertical proof** — replace synthetic conditions with an economically meaningful non-co-bundleable workload such as inventory defense, liquidation/deleveraging, multi-venue execution, game state or autonomous service coordination.
6. **Resource preservation** — test capture → reservation / immediate execution so Reactor proves more than evidence that an opportunity once existed.

The product thesis survives only if those later experiments show that exact-state coordination is useful enough to justify a dedicated execution-control layer.
