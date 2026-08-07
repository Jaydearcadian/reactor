# M3 — MagicBlock Ephemeral Rollup Integration

## Purpose

M2 proved the Reactor primitive on a local Solana validator and on Solana devnet. M3 does **not** redesign that primitive. It moves only the rapidly changing condition/evaluation path into a MagicBlock Ephemeral Rollup (ER) and preserves Solana as the canonical lock, settlement and Receipt layer.

The question M3 must answer is:

> Can Reactor move its hot condition-coordination path into an Ephemeral Rollup, seal one exact executable candidate there, commit that candidate back to Solana, and then use the already-proven Solana settlement path without weakening the M2 invariants?

M3 is an integration proof. It is **not yet** evidence that MagicBlock improves capture rate or latency. That comparison belongs to M4.

## Hard architecture boundary

```text
SOLANA DEVNET
────────────────────────────────────────
Path
Objective
Vault
canonical ExecutionLock
Settlement
Receipt
        │
        │ delegate hot state only
        ▼
MAGICBLOCK ER
────────────────────────────────────────
ConditionState × 6
SessionCandidate
        ↓
rapid authenticated updates
        ↓
joint-validity evaluation
        ↓
READY candidate
exact sequence/value/validity snapshot
        │
        │ commit
        ▼
SOLANA DEVNET
────────────────────────────────────────
materialize_lock(candidate)
        ↓
canonical ExecutionLock
        ↓
execute_locked()
        ↓
Receipt
```

### Never delegated in M3

- `Path`
- `Objective`
- `Vault`
- canonical `ExecutionLock`
- `Receipt`
- settlement authority

### Delegated in M3

- the six `ConditionState` accounts for one Reactor session;
- one `SessionCandidate` account that can be sealed once when all six conditions are jointly executable.

## Why `SessionCandidate` exists

An ER-local observation is not sufficient settlement authority. A candidate is therefore a bounded, immutable handoff object rather than the final economic lock.

It records:

```text
SessionCandidate {
  objective
  vault
  recipient
  condition_keys[6]
  sequences[6]
  values[6]
  valid_until_slots[6]
  exposure_snapshot
  target_exposure
  transfer_lamports
  exposure_reduction
  predicted_exposure
  detected_slot
  ready
}
```

The candidate may be produced quickly in the ER, but it cannot spend the Vault.

After the candidate is committed back to Solana, `materialize_lock` must revalidate all base-layer authority and economic invariants before creating the canonical `ExecutionLock`.

## Base-layer revalidation

`materialize_lock` MUST verify at least:

1. candidate is `ready`;
2. candidate belongs to the supplied `Objective`;
3. candidate binds the supplied `Vault`;
4. `Objective.path == Path`;
5. `Vault.objective == Objective`;
6. Path is not expired;
7. transfer amount is non-zero and within the Path limit;
8. exposure reduction is positive;
9. current Vault exposure still equals the candidate's sealed exposure snapshot;
10. the recomputed post-execution exposure equals the candidate prediction;
11. the predicted exposure still satisfies the Objective target;
12. recipient and action parameters copied into `ExecutionLock` are exactly those sealed in the candidate.

If the Vault or authority state changed after ER detection, materialization must fail rather than silently adapt the candidate.

## Candidate immutability

A `SessionCandidate` begins `ready = false`.

The ER evaluation instruction may transition it exactly once:

```text
OPEN → READY
```

There is no `READY → OPEN` transition and no instruction may overwrite a ready candidate.

Condition accounts may continue changing after the candidate becomes ready. Those later changes must not change the sealed versions inside the candidate.

## M3 implementation stages

### M3a — explicit commit + base materialization

Use this first because it is easier to falsify and debug:

1. create six condition accounts + `SessionCandidate` on Solana devnet;
2. delegate the seven hot accounts to a MagicBlock devnet validator;
3. submit condition updates against the ER endpoint;
4. reject stale exact-version candidate attempts;
5. reject a current version whose predicate is false;
6. publish a new valid version;
7. seal one exact candidate in the ER;
8. mutate another condition after sealing and prove candidate is unchanged;
9. commit candidate state to Solana;
10. read the committed candidate from Solana;
11. call `materialize_lock` on Solana;
12. call existing `execute_locked` on Solana;
13. verify exact value conservation, `700 → 500`, verified Receipt and duplicate rejection.

### M3b — Magic Action handoff

Only after M3a passes, replace the manual base-layer materialization call with a post-commit Magic Action that invokes `materialize_lock` after the candidate commit lands.

M3b changes orchestration, not the economic invariants.

## M3 acceptance gate

M3a passes only if all are true:

- [ ] upgraded Reactor program deploys on Solana devnet;
- [ ] six `ConditionState` accounts and one `SessionCandidate` are created;
- [ ] all seven hot accounts are delegated to the intended MagicBlock validator;
- [ ] delegation is observed rather than inferred from RPC acceptance;
- [ ] authenticated condition updates execute through the ER path;
- [ ] stale exact sequence is rejected in ER;
- [ ] false predicate is rejected in ER;
- [ ] exact current versions seal one candidate;
- [ ] candidate records the exact six sequence versions;
- [ ] a later condition update does not mutate the candidate;
- [ ] candidate commit is observed on Solana;
- [ ] base-layer `materialize_lock` revalidates Path, Objective, Vault and sealed exposure;
- [ ] canonical `ExecutionLock` matches candidate versions and action parameters exactly;
- [ ] existing `execute_locked` debits Vault by exactly 100000 lamports;
- [ ] recipient receives exactly 100000 lamports;
- [ ] controlled exposure moves exactly `700 → 500`;
- [ ] Receipt is `verified=true`;
- [ ] lock is consumed;
- [ ] duplicate execution is rejected;
- [ ] ER, commit, materialization and settlement signatures/evidence are stored separately.

## M3 failure conditions

Reactor must stop/reframe the integration if any of these occur:

- a delegated hot account cannot preserve authenticated per-source updates;
- an ER-ready candidate can be mutated after sealing;
- committed candidate state cannot be deterministically linked to the base materialized lock;
- base materialization cannot safely reject changed Vault/Path state;
- settlement requires delegating the Vault or weakening the M2 authority model;
- successful ER acknowledgement is being mistaken for committed Solana state;
- the integration requires artificial timing assumptions rather than real observed execution.

## Evidence boundary after M3

A passing M3 proves that Reactor's hot coordination state can execute through MagicBlock and hand a sealed candidate back into the proven Solana settlement primitive.

It still does **not** prove:

- that ER is faster in the relevant workload;
- that ER captures more valuable transient windows;
- that Solana/Jito misses meaningful real-world opportunities;
- production market-maker demand;
- arbitrary external DEX reservation semantics;
- production security.

Those performance claims are reserved for M4.
