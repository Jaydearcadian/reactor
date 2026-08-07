# Reactor

**Transient executability locks for condition-driven onchain execution.**

Reactor observes independently changing execution conditions, determines when they are jointly executable under one bounded objective, freezes the exact compatible state versions into an immutable lock, and separates transaction submission from verified objective completion.

> Status: M1 product hypothesis and deterministic fixture are implemented. M2 has passed both the adversarial local-validator gate and the same lifecycle on Solana devnet. M3a is now demonstrated end to end on MagicBlock + Solana devnet: seven hot accounts were delegated, exact versions were sealed in ER, the candidate was commit-and-undelegated back to Solana, the canonical lock materialized, exactly 100000 lamports settled, exposure moved `700 -> 500`, the Receipt verified, and replay was rejected. M4 measured capture benchmarking is now the active proof. MagicBlock capture advantage, Jito superiority comparison, market demand, arbitrary external DEX reservation and production-security claims remain unproven.

## The thesis

Onchain objectives can depend on several independently changing conditions. Their valid overlap may disappear before a conventional observe-build-submit path captures it. Reactor tests whether a high-frequency delegated state environment can improve verified capture of those overlaps without creating stale or false locks.

The durable product direction is broader:

> Transactions are attempts. Reactor is being built so execution objectives can survive changing conditions and, later, failed attempts.

The current primitive is narrower:

```text
Objective + Path
      ↓
authenticated condition updates
      ↓
joint executability evaluation
      ↓
immutable exact-version lock
      ↓
bounded economic action
      ↓
postcondition verification
      ↓
Receipt
```

## M2 — Real Executability Lock

The Anchor program in `programs/reactor/` introduces real Solana accounts for:

- `Path` — standing authority, transfer limit, expiry;
- `Objective` — target postcondition and canonical condition set;
- `ConditionState` — independently authorized, monotonically versioned state;
- `Vault` — Reactor-owned lamports and fixture exposure;
- `ExecutionLock` — immutable condition versions, values, recipient, action and predicted postcondition;
- `Receipt` — verified before/after outcome evidence.

The first controlled economic fixture uses native SOL rather than SPL tokens or an external DEX. This proves actual value movement while keeping token and venue behavior outside the primitive test.

See `M2_EXECUTABILITY_LOCK.md` for the local acceptance gate and `M2_DEVNET.md` for the public-cluster replay.

### Demonstrated local result — 2026-08-07

```text
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

Evidence: `experiment/results/m2-local-2026-08-07.json`.

### Demonstrated Solana devnet result — 2026-08-07

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

Evidence: `experiment/results/m2-devnet-2026-08-07.json`.

The devnet settlement transaction was observed at slot `481894440`; the balance reads spanning slots `481894437 -> 481894443` showed an exact `100000`-lamport Vault debit and recipient credit.

## M3 — Demonstrated MagicBlock ER integration

M3 preserves the proven M2 settlement primitive and moves only the hot coordination state into a MagicBlock Ephemeral Rollup.

```text
SOLANA
Path / Objective / Vault
        │
        │ delegate hot state
        ▼
MAGICBLOCK ER
ConditionState × 6
SessionCandidate
        ↓
exact joint-validity detection
        ↓
sealed candidate
        │ commit + undelegate
        ▼
SOLANA
materialize canonical ExecutionLock
        ↓
existing execute_locked
        ↓
Receipt
```

### Demonstrated MagicBlock/Solana result — 2026-08-07

```text
program                     75ph49gq12tUVV2XAfmDozseGfuu5ZTSZDPB8MPF8oax
ER                          https://devnet-as.magicblock.app/
validator                   MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57
all seven hot accounts      delegated + ownership verified
stale exact sequence        rejected in ER
false predicate             rejected in ER
frozen sequences            [1,1,3,1,1,1]
post-seal mutation          candidate unchanged
candidate commit            observed on Solana
candidate undelegation      observed on Solana
canonical lock              materialized
vault debit                 100000 lamports
recipient credit            100000 lamports
exposure                    700 -> 500
Receipt                     verified=true
lock                         consumed=true
duplicate execution         rejected
```

Evidence: `experiment/results/m3-magicblock-devnet-2026-08-07.json`.

M3 is an integration-correctness proof, not a latency benchmark. During the passing run, the preferred MagicBlock base RPC was unavailable and the harness used canonical Solana devnet for base-layer operations; MagicBlock router/ER remained the delegation and hot-execution path. The ER candidate never received authority to spend the Vault.

See `M3_MAGICBLOCK.md` for the architecture boundary and `M4_BENCHMARK.md` for the now-active performance falsification gate.

## M4 — Active measured capture benchmark

M4 deliberately excludes build, deployment, account initialization, funding, delegation and router propagation from hot-path timing. It compares the same logical independently authorized condition schedule across warmed paths.

The controlled window opens when condition 2 advances to a valid version and closes when condition 0 advances to a false version. A valid capture must freeze exactly:

```text
[1,1,2,1,1,1]
```

The primary hot-path interval is:

```text
final required source event emitted
        ↓
authoritative condition observed
        ↓
lock / candidate decision
        ↓
exact lock / candidate observed
```

Primary M4a metric:

```text
capture_latency_ms = capture_observed - window_open_emitted
```

Primary M4b product metric:

```text
Verified valid-window capture rate
= verified objectives attributable to valuable windows
  / valuable windows generated
```

Non-negotiable safety metric:

```text
false-lock rate = 0
```

The continuation threshold was frozen before measured results: Reactor needs zero false locks plus at least a 20 percentage-point absolute capture improvement over the strongest same-cluster implemented baseline in two adjacent short-window bands, with a 95% interval excluding zero once sample size is sufficient.

Smoke the M4a harness without rebuilding/redeploying:

```bash
REACTOR_M4_WINDOWS_MS=150,500 \
REACTOR_M4_TRIALS_PER_WINDOW=1 \
bash scripts/bootstrap_m4_capture.sh
```

A normal M4a run writes:

```text
experiment/results/m4-capture-latest.json
experiment/results/m4-capture-analysis-latest.json
```

Jito Block Engine comparison is kept separate until Reactor has same-workload Solana testnet parity; Jito does not provide a same-cluster devnet Block Engine baseline.

## Deterministic experiment fixture

Requires Python 3.11+ and no third-party dependencies.

```bash
python -m unittest discover -s tests -v
python scripts/run_experiment.py
```

The experiment runner writes `experiment/results/latest.json`.

## Live measurement harness

The repository contains:

- monotonic live telemetry;
- strict `SUBMITTED -> ACKNOWLEDGED -> OBSERVED -> VERIFIED` evidence states;
- JSON-RPC connectivity probes;
- a signed standard-Solana transfer fixture;
- a shared signed-transaction artifact format;
- M4 monotonic trial telemetry and percentile aggregation;
- Wilson/Newcombe-style 95% capture-rate comparison intervals;
- the benchmark contracts in `LIVE_BENCHMARK.md` and `M4_BENCHMARK.md`.

Connectivity is not execution evidence. An RPC or bundle acknowledgement must never be counted as verified execution.

## Evidence boundary

The repository now supports these **public-devnet execution claims**:

- the Reactor Anchor program deploys and executes on Solana devnet;
- exact condition versions can be bound into an immutable lock;
- replayed or stale sequences are rejected;
- false conditions cannot lock;
- Objective, Path and Vault relationships are explicitly bound;
- later condition updates do not substitute themselves into an accepted lock;
- bounded program-owned SOL moves through the frozen action with exact value conservation;
- controlled exposure reaches the Objective target;
- the resulting Receipt verifies the postcondition;
- duplicate execution is blocked;
- Reactor hot condition/candidate state can be delegated into a MagicBlock ER;
- authenticated condition updates and exact-version candidate sealing execute in ER;
- a sealed candidate survives later condition mutation unchanged;
- the candidate can be committed and undelegated back to Solana;
- Solana can revalidate that candidate into the canonical lock and reuse the proven settlement path;
- ER, base commitment, materialization and settlement signatures remain separate evidence artifacts.

The repository does **not** yet prove:

- MagicBlock capture superiority over a strong same-cluster baseline;
- representative market-maker or agent demand;
- material Solana/Jito miss rates;
- arbitrary external DEX state reservation;
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
│   ├── bootstrap_m4_capture.sh
│   ├── run_m3_magicblock_skill.mjs
│   ├── run_m4_capture.mjs
│   ├── analyze_m4_capture.mjs
│   └── ...
├── tests/
├── tests-js/
├── experiment/results/
└── .github/workflows/test.yml
```

## Next proof

M3a correctness is demonstrated. The active sequence is now:

1. smoke-test M4a on two bands with one trial per path to validate the live benchmark harness;
2. fix benchmark mechanics only if the smoke run exposes measurement or integration faults;
3. run the controlled M4a window matrix on warmed Solana and MagicBlock paths;
4. inspect capture rate, stale-attempt rate, false-lock rate and capture-latency distributions;
5. only if M4a shows a meaningful signal, run M4b with full commit/materialization/settlement verification;
6. establish Reactor testnet parity before treating Jito as a directly comparable strong baseline;
7. replace synthetic windows with representative traces before making a market claim.
