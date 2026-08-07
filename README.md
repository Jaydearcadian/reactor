# Reactor

**Transient executability locks for condition-driven onchain execution.**

Reactor observes independently changing execution conditions, determines when they are jointly executable under one bounded objective, freezes the exact compatible state versions into an immutable lock, and separates transaction submission from verified objective completion.

> Status: M1 product hypothesis and deterministic fixture are implemented. M2 has now passed the adversarial local-validator acceptance gate: the Anchor program compiled and executed, stale and false condition states were rejected, one exact-version lock settled 100,000 lamports with value conservation, the controlled exposure moved from 700 to 500, the Receipt verified the Objective, and duplicate execution was rejected. Solana devnet, MagicBlock, Jito, latency advantage, market demand, and production-security claims remain unproven.

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

See `M2_EXECUTABILITY_LOCK.md` for the full acceptance gate.

## M2 adversarial proof

The local runner deliberately attempts to break the lock before accepting the happy path:

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

With Rust, Solana CLI, Anchor 0.32.1+, Node and npm installed:

```bash
bash scripts/bootstrap_m2_local.sh
```

The script keeps deployment key material local. The first Anchor build creates the local program keypair, `sync_m2_program_id.mjs` aligns `declare_id!` with it, the program rebuilds, and `anchor test` runs the adversarial proof.

A passing local-validator run on 2026-08-07 produced:

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

The captured evidence artifact is `experiment/results/m2-local-2026-08-07.json`.

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

The repository now supports these local-validator execution claims:

- the Anchor/Solana M2 program compiles and executes locally;
- exact condition versions can be bound into an immutable lock;
- replayed or stale sequences are rejected;
- false or expired conditions cannot lock;
- Objective, Path and Vault relationships are explicitly bound;
- a lock cannot be created if its predicted postcondition cannot satisfy the Objective;
- later condition updates do not substitute themselves into an accepted lock;
- bounded program-owned SOL moved through the frozen action with exact value conservation;
- the controlled exposure reached the Objective target;
- the resulting Receipt verified the postcondition;
- duplicate execution is blocked;
- `SUBMITTED`, `ACKNOWLEDGED`, `OBSERVED`, and `VERIFIED` remain separate evidence states.

The repository does **not** yet prove:

- Solana devnet M2 execution;
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
│   ├── run_m2_local.mjs
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

M2 local execution is complete. The immediate next proof is:

1. repeat the same M2 lifecycle on Solana devnet;
2. capture raw transaction, account and postcondition evidence;
3. keep the economic action and Objective unchanged;
4. only then delegate the hot `ConditionState` evaluation path into MagicBlock;
5. replay the same condition schedule across standard Solana devnet and MagicBlock devnet;
6. measure verified valid-window capture rate, false-lock rate and end-to-end timing.

The primary later benchmark metric remains **verified valid-window capture rate**. The non-negotiable safety metric remains **zero false locks**.
