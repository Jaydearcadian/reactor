# M2 — Real Executability Lock

M2 turns Reactor from a deterministic model into a real Solana program primitive.

> Status: implemented in source and wired for `cargo check`; local-validator execution and devnet evidence are the next proof steps.

## Goal

Prove that six independently changing, versioned onchain conditions can produce one immutable execution lock that authorizes one bounded economic action, rejects stale or incompatible state, and emits a Receipt only after the declared postcondition is reached.

## Controlled economic fixture

The M2 fixture intentionally uses native SOL held in a Reactor-owned Vault account. This avoids SPL-token and venue-specific complexity while still proving real value movement.

The loaded objective is:

```text
Initial exposure: +700 units
Target exposure: <= +500 units
Action: transfer a bounded amount of SOL from the Reactor Vault
Exposure reduction encoded in the lock: >= 200 units
```

The numeric exposure model is a fixture variable. It is not a claim that lamports are economically equivalent to exposure units.

## State objects

### Path

Standing authorization boundary:

- authority;
- maximum lamports transferable by one lock;
- expiry slot.

### Objective

Immutable execution target:

- owning Path;
- objective seed;
- target exposure;
- minimum remaining condition validity;
- exact six condition account addresses.

### ConditionState

Each of the six sources has its own account:

```text
objective
source authority
kind
sequence
value
predicate_result
observed_slot
valid_until_slot
```

A source can update only its own ConditionState. Sequence numbers must increase monotonically.

### Vault

Program-owned account holding:

- Objective binding;
- current fixture exposure;
- SOL available above the rent-exempt floor.

### ExecutionLock

Created only when all six exact condition versions are simultaneously acceptable.

The lock freezes:

- Objective;
- Vault;
- recipient;
- six exact sequences;
- six values;
- six validity horizons;
- lock slot;
- transfer amount;
- exposure reduction;
- predicted post-execution exposure.

There is intentionally no instruction that mutates these frozen fields. The only mutable lifecycle bit is `consumed`.

### Receipt

Created during settlement after the program proves the postcondition:

- Objective;
- ExecutionLock;
- recipient;
- transferred lamports;
- exposure before;
- exposure after;
- execution slot;
- `verified = true`.

## Lock invariants

`evaluate_and_lock` must reject if any of the following is true:

1. the supplied Path is not the Objective's Path;
2. the supplied Vault is not owned by the Objective;
3. Path is expired;
4. transfer amount exceeds Path authority;
5. predicted exposure cannot satisfy the Objective;
6. any condition account is not one of the six canonical accounts;
7. a condition belongs to another Objective;
8. condition order is wrong;
9. an exact sequence does not match;
10. a predicate is false;
11. a condition has expired;
12. too little validity remains.

## Settlement invariants

`execute_locked` must reject if:

1. Path is expired;
2. Objective/Path or Vault/Objective binding is wrong;
3. lock is already consumed;
4. Objective, Vault, or recipient differ from the lock;
5. Vault has insufficient spendable lamports;
6. Vault exposure has changed so the locked predicted result is no longer true;
7. the resulting exposure does not satisfy the Objective.

Only after those checks does value move.

## Why slots, not milliseconds

Solana program state uses `Clock.slot` for onchain freshness. M2 does **not** claim that L1 gives authoritative millisecond validity windows.

Millisecond measurements belong in the external experiment telemetry:

```text
condition emitted
→ observer receives
→ lock transaction built
→ submitted
→ acknowledged
→ observed onchain
→ postcondition verified
```

MagicBlock later changes the location and frequency of the hot condition evaluation; it does not justify inventing sub-slot semantics inside the ordinary Solana program.

## M2 acceptance gate

M2 is complete only when all are demonstrated on a local validator and then devnet:

```text
[ ] Anchor program compiles
[ ] six condition accounts initialize
[ ] independent source authorities can update them
[ ] stale sequence is rejected
[ ] false predicate is rejected
[ ] expired condition is rejected
[ ] mismatched Path/Vault is rejected
[ ] incapable postcondition is rejected before lock
[ ] valid six-condition overlap creates exactly one lock
[ ] later condition updates cannot modify frozen lock fields
[ ] bounded SOL moves from Vault to frozen recipient
[ ] duplicate execution is rejected
[ ] exposure reaches the Objective target
[ ] Receipt records verified postcondition
```

Until these boxes are measured, Reactor remains an implementation candidate rather than a demonstrated M2 protocol.
