# Reactor

**Transient executability locks for condition-driven onchain execution.**

Reactor observes independently changing execution conditions, determines when they are jointly executable under one bounded objective, freezes the exact compatible state versions into an immutable lock, and separates transaction submission from verified objective completion.

> Status: M1 product hypothesis and deterministic fixture are implemented. M2 has passed both the adversarial local-validator gate and the same lifecycle on Solana devnet. On devnet, stale and false states were rejected, one exact-version lock conserved a 100,000-lamport settlement, controlled exposure moved from 700 to 500, the Receipt verified the Objective, and duplicate execution was rejected. M3 MagicBlock integration is now the active build step. MagicBlock capture advantage, Jito comparison, market demand, arbitrary external DEX reservation and production-security claims remain unproven.

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

## M2 adversarial proof

The runner deliberately attempts to break the lock before accepting the happy path:

```text
six conditions valid
→ one condition advances to a false version
→ stale-version lock attempt must fail
→ exact false-predicate lock attempt must fail
→ source publishes a new valid version
→ exact versions lock
→ another condition changes after the lock
→ frozen lock remains unchanged
→ SOL moves from Vault to frozen recipient
→ exposure reaches Objective target
→ Receipt verifies postcondition
→ duplicate execution fails
```

Local validator:

```bash
bash scripts/bootstrap_m2_local.sh
```

Solana devnet:

```bash
bash scripts/bootstrap_m2_devnet.sh
```

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

The devnet settlement transaction was observed at slot `481894440`; the balance reads spanning slots `481894437 → 481894443` showed an exact `100000`-lamport Vault debit and recipient credit.

## M3 — MagicBlock ER integration

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
        │ commit
        ▼
SOLANA
materialize canonical ExecutionLock
        ↓
existing execute_locked
        ↓
Receipt
```

The ER candidate cannot spend the Vault. Solana must revalidate the committed candidate against the current Path, Objective and Vault before creating the canonical `ExecutionLock`.

See `M3_MAGICBLOCK.md` for the architecture boundary, acceptance gate and failure conditions.

## Deterministic experiment fixture

Requires Python 3.11+ and no third-party dependencies.

```bash
python -m unittest discover -s tests -v
python scripts/run_experiment.py
```

The experiment runner writes `experiment/results/latest.json`.

## Live measurement harness

The repository also contains:

- monotonic live telemetry;
- strict `SUBMITTED → ACKNOWLEDGED → OBSERVED → VERIFIED` evidence states;
- JSON-RPC connectivity probes;
- a signed standard-Solana transfer fixture;
- a shared signed-transaction artifact format;
- the benchmark contract in `LIVE_BENCHMARK.md`.

Probe endpoints with:

```bash
export SOLANA_RPC_URL="<solana-json-rpc-endpoint>"
export MAGICBLOCK_RPC_URL="<magicblock-json-rpc-endpoint>"
python scripts/probe_live_paths.py
```

Connectivity is not execution evidence. An RPC or bundle acknowledgement must never be counted as verified execution.

## Evidence boundary

The repository now supports these **public-testnet execution claims**:

- the Reactor Anchor program deploys and executes on Solana devnet;
- exact condition versions can be bound into an immutable lock;
- replayed or stale sequences are rejected;
- false conditions cannot lock;
- Objective, Path and Vault relationships are explicitly bound;
- a lock cannot be created if its predicted postcondition cannot satisfy the Objective;
- later condition updates do not substitute themselves into an accepted lock;
- bounded program-owned SOL moved through the frozen action with exact value conservation;
- the controlled exposure reached the Objective target;
- the resulting Receipt verified the postcondition;
- duplicate execution is blocked;
- `SUBMITTED`, `ACKNOWLEDGED`, `OBSERVED`, and `VERIFIED` remain separate evidence states.

The repository does **not** yet prove:

- MagicBlock ER execution of the Reactor hot path;
- representative market-maker demand;
- material Solana/Jito miss rates;
- MagicBlock capture superiority;
- arbitrary external DEX state reservation;
- production security.

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
├── LIVE_BENCHMARK.md
├── WHITEPAPER.md
├── Anchor.toml
├── Cargo.toml
├── programs/reactor/
│   ├── Cargo.toml
│   └── src/lib.rs
├── src/reactor/
├── scripts/
│   ├── bootstrap_m2_local.sh
│   ├── bootstrap_m2_devnet.sh
│   ├── run_m2_local.mjs
│   ├── run_m2_proof.mjs
│   ├── sync_m2_program_id.mjs
│   ├── run_experiment.py
│   ├── run_solana_fixture.mjs
│   └── probe_live_paths.py
├── tests/
├── tests-js/
├── experiment/results/
└── .github/workflows/test.yml
```

## Next proof

M2 correctness is now demonstrated locally and on Solana devnet. The active sequence is:

1. add `SessionCandidate` and MagicBlock delegation hooks without changing the proven settlement path;
2. delegate six `ConditionState` accounts plus the candidate to a MagicBlock devnet validator;
3. execute authenticated hot updates and joint-validity evaluation in ER;
4. commit the sealed candidate back to Solana;
5. materialize the canonical `ExecutionLock` on Solana with full Path/Objective/Vault revalidation;
6. reuse `execute_locked` and prove the same exact settlement/Receipt outcome;
7. only after M3 passes, replay one condition schedule across Solana-only and ER paths for M4.

The primary M4 metric remains **verified valid-window capture rate**. The non-negotiable safety metric remains **zero false locks**.
