# M3 — MagicBlock Ephemeral Rollup Integration

## Status

**Demonstrated end to end on 2026-08-07.**

M3 preserves the proven M2 Solana settlement primitive and moves only Reactor's hot condition/evaluation state into a MagicBlock Ephemeral Rollup (ER).

The demonstrated lifecycle is:

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
authenticated updates
        ↓
exact-version evaluation
        ↓
sealed candidate
        │
        │ commit + undelegate candidate
        ▼
SOLANA
materialize canonical ExecutionLock
        ↓
execute_locked
        ↓
Receipt
```

M3 is an **integration-correctness proof**, not a latency or market-value benchmark.

## Architecture boundary

Reactor does not delegate canonical economic authority into the ER.

### Canonical on Solana

- `Path`
- `Objective`
- `Vault`
- canonical `ExecutionLock`
- settlement
- `Receipt`

### Delegated for hot coordination

- six `ConditionState` accounts;
- one `SessionCandidate`.

The ER candidate can describe a bounded executable configuration, but it cannot spend the Vault.

## `SessionCandidate`

The candidate is a one-way handoff object that freezes the exact state used to make the execution decision.

It binds:

```text
authority
path
objective
vault
recipient
condition_keys[6]
minimum_remaining_slots
transfer_lamports
exposure_baseline
exposure_reduction
predicted_exposure
frozen_sequences[6]
frozen_values[6]
frozen_valid_until_slots[6]
sealed_slot
ready
```

A candidate transitions once:

```text
OPEN -> READY
```

Later condition changes must not rewrite its frozen state.

## Base-layer revalidation

`materialize_lock` does not blindly trust an ER candidate. Solana revalidates the candidate against canonical authority and economic state before creating an `ExecutionLock`.

The materialization path checks that:

1. the candidate is ready;
2. candidate authority matches the materializing signer;
3. the candidate binds the supplied `Path`, `Objective` and `Vault`;
4. `Objective.path == Path`;
5. `Vault.objective == Objective`;
6. the candidate condition set still equals the Objective condition set;
7. the Path remains valid;
8. the transfer remains within the Path limit;
9. current Vault exposure still equals the candidate's sealed exposure baseline;
10. recomputed post-execution exposure equals the candidate prediction;
11. the predicted exposure still satisfies the Objective target;
12. recipient, exact condition versions and action parameters are copied unchanged into the canonical lock.

If canonical state drifts incompatibly, materialization fails rather than adapting the accepted candidate.

## Demonstrated M3a result

The passing MagicBlock/Solana devnet run demonstrated:

```text
Reactor program              75ph49gq12tUVV2XAfmDozseGfuu5ZTSZDPB8MPF8oax
hot accounts                 6 conditions + 1 candidate
all seven hot accounts       delegated + ownership verified
stale exact sequence         rejected in ER
false predicate              rejected in ER
candidate                    sealed at exact current versions
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

Evidence:

```text
experiment/results/m3-magicblock-devnet-2026-08-07.json
```

During that passing run, the preferred MagicBlock base RPC was unavailable, so the harness used canonical Solana devnet for base-layer operations. MagicBlock remained the delegation and hot ER execution path. This is recorded in the evidence artifact and does not change the authority boundary above.

## Reproduce

```bash
bash scripts/bootstrap_m3_magicblock.sh
```

The harness initializes a fresh Reactor fixture, delegates the hot state, exercises stale/false/exact candidate behavior in the ER, commits and undelegates the candidate, materializes the canonical lock on Solana, executes the bounded action, verifies value conservation and the postcondition, and rejects replay.

## What M3 proves

M3 supports these claims:

- Reactor hot condition/candidate state can be delegated into a MagicBlock ER;
- authenticated condition updates and exact-version candidate sealing execute in the ER;
- a sealed candidate remains immutable across later condition mutation;
- the candidate can be committed and undelegated back to Solana;
- Solana can revalidate the candidate into a canonical `ExecutionLock`;
- the existing bounded settlement path can then execute and produce a verified `Receipt`;
- the ER does not need Vault-spend authority.

## What M3 does not prove

M3 does **not** establish:

- generic MagicBlock performance superiority;
- higher capture probability than the strongest Solana strategy;
- public-network/Jito superiority;
- arbitrary external DEX reservation;
- production economics;
- representative market demand;
- production security.

Those questions are handled by M4 and M5.
