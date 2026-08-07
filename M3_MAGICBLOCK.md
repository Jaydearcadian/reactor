# M3 — MagicBlock Ephemeral Rollup Integration

## Status

**Implementation staged; execution proof pending.**

M2 and M2.5 are already demonstrated on a local validator and Solana devnet. M3 source now adds MagicBlock delegation hooks, a one-way `SessionCandidate`, explicit ER evaluation/sealing, commit-and-undelegate handoff, base-layer `materialize_lock`, and a devnet proof runner. These M3 claims remain unproven until `scripts/bootstrap_m3_magicblock.sh` compiles, deploys and passes against MagicBlock devnet.

## Purpose

M3 does **not** redesign the proven Reactor primitive. It moves only the rapidly changing condition/evaluation path into a MagicBlock Ephemeral Rollup (ER) and preserves Solana as the canonical lock, settlement and Receipt layer.

The question M3 must answer is:

> Can Reactor move its hot condition-coordination path into an Ephemeral Rollup, seal one exact executable candidate there, return that candidate to Reactor ownership on Solana, and then use the already-proven settlement path without weakening the M2 invariants?

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
        │ initialize + delegate hot state
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
        │ commit-and-undelegate candidate
        ▼
SOLANA DEVNET
────────────────────────────────────────
SessionCandidate back under Reactor ownership
        ↓
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

The six conditions may remain delegated after the M3a proof. The candidate is commit-and-undelegated because base-layer `materialize_lock` must read it as a normal Reactor-owned Anchor account.

## `SessionCandidate`

An ER-local observation is not sufficient settlement authority. A candidate is therefore a bounded, immutable handoff object rather than the final economic lock.

The implemented candidate records:

```text
SessionCandidate {
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
}
```

The candidate may be produced quickly in the ER, but it cannot spend the Vault.

## Base-layer revalidation

`materialize_lock` verifies:

1. candidate is `ready`;
2. candidate authority equals the materializing signer;
3. candidate binds the supplied `Path`, `Objective` and `Vault`;
4. `Objective.path == Path`;
5. `Vault.objective == Objective`;
6. candidate condition set still equals the Objective condition set;
7. Path is not expired;
8. transfer amount remains within the Path limit;
9. current Vault exposure still equals the candidate's sealed exposure baseline;
10. recomputed post-execution exposure exactly equals the candidate prediction;
11. the predicted exposure still satisfies the Objective target;
12. recipient, exact condition versions and action parameters are copied unchanged into the canonical `ExecutionLock`.

If Vault or authority state changed after ER detection, materialization fails rather than silently adapting the candidate.

## Candidate immutability

A `SessionCandidate` begins:

```text
ready = false
```

ER evaluation may transition it once:

```text
OPEN → READY
```

`evaluate_session_candidate` rejects attempts to reseal a ready candidate. Conditions may continue changing after sealing; those changes must not alter the frozen versions in the candidate.

## M3a — explicit ER handoff

The implemented proof path is:

1. deploy/upgrade the Reactor program on Solana devnet;
2. create fresh `Path`, `Objective`, `Vault`, six conditions and one candidate;
3. delegate the six conditions and candidate from Solana;
4. observe all seven accounts at the MagicBlock ER endpoint;
5. submit authenticated condition updates through the ER client;
6. reject a stale exact-version candidate attempt in ER;
7. reject a current version whose predicate is false in ER;
8. publish a new valid version;
9. seal `[1,1,3,1,1,1]` into the candidate;
10. mutate another condition after sealing and prove the candidate is unchanged;
11. commit-and-undelegate the candidate from ER;
12. observe candidate ownership restored to Reactor on Solana;
13. fetch the committed candidate through the base-layer program client;
14. call `materialize_lock` on Solana;
15. verify canonical `ExecutionLock` matches the ER candidate;
16. call unchanged `execute_locked` on Solana;
17. prove exact 100000-lamport value conservation, `700 → 500`, verified Receipt and duplicate rejection.

Run:

```bash
bash scripts/bootstrap_m3_magicblock.sh
```

Default endpoints:

```text
Solana devnet  https://api.devnet.solana.com
MagicBlock ER  https://devnet.magicblock.app/
MagicBlock WS  wss://devnet.magicblock.app/
```

A passing run writes:

```text
experiment/results/m3-magicblock-latest.json
```

## M3b — Magic Action handoff

Only after M3a passes should the explicit handoff be replaced or augmented with a Magic Action that performs the base-layer continuation after candidate state has been safely committed.

M3b changes orchestration, not economic authority. The ER still must never directly spend the Reactor Vault.

## M3a acceptance gate

M3a passes only if all are true:

- [ ] upgraded Reactor program compiles with Anchor 0.32.1 + `ephemeral-rollups-sdk` 0.16.2 `anchor-compat`;
- [ ] upgraded program deploys on Solana devnet;
- [ ] six `ConditionState` accounts and one `SessionCandidate` are created;
- [ ] all seven hot accounts are delegated;
- [ ] all seven delegated accounts are observed at the ER endpoint;
- [ ] authenticated condition updates execute through the ER path;
- [ ] stale exact sequence is rejected in ER;
- [ ] false predicate is rejected in ER;
- [ ] exact current versions seal one candidate;
- [ ] candidate freezes exactly `[1,1,3,1,1,1]`;
- [ ] a later condition update does not mutate the candidate;
- [ ] commit-and-undelegate succeeds for the candidate;
- [ ] Reactor ownership of the candidate is observed again on Solana;
- [ ] base-layer candidate contents match the ER-sealed candidate;
- [ ] `materialize_lock` revalidates Path, Objective, Vault and sealed exposure;
- [ ] canonical `ExecutionLock` matches candidate versions/action parameters;
- [ ] unchanged `execute_locked` debits Vault by exactly 100000 lamports;
- [ ] recipient receives exactly 100000 lamports;
- [ ] controlled exposure moves exactly `700 → 500`;
- [ ] Receipt is `verified=true`;
- [ ] lock is consumed;
- [ ] duplicate execution is rejected;
- [ ] delegation, ER seal, finalize/undelegate, materialization and settlement signatures are stored separately.

## Failure conditions

Stop or reframe M3 if any of these occur:

- a delegated condition cannot preserve authenticated per-source updates;
- a ready candidate can be mutated after sealing;
- candidate cannot be returned to Reactor ownership without weakening the model;
- returned candidate cannot be deterministically linked to the canonical lock;
- base materialization cannot reject changed Vault/Path state;
- settlement requires delegating the Vault or weakening M2 authority;
- ER acknowledgement is mistaken for committed Solana state;
- the integration depends on artificial timing assumptions rather than observed execution.

## Evidence boundary

A passing M3a proves only that Reactor's hot coordination state can execute through MagicBlock and hand a sealed candidate back into the proven Solana settlement primitive.

It still does **not** prove:

- that ER is faster for Reactor's target workload;
- that ER captures more valuable transient windows;
- that ordinary Solana/Jito misses meaningful opportunities;
- durable reservation of arbitrary external DEX state;
- representative market-maker demand;
- production security.

Those performance and market claims are reserved for M4 and later evidence.
