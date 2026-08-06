# Reactor State Machine

## Pact lifecycle

```text
CREATED
  → ARMED
  → OBSERVING
  → ALIGNING
  → LOCKED
  → SUBMITTED
  → OBSERVED
  → VERIFIED
```

Failure and exception branches:

```text
ALIGNING  → OBSERVING      condition compatibility is lost before lock
OBSERVING → EXPIRED        Session or Path expires
LOCKED    → FAILED         attempt cannot be submitted safely
SUBMITTED → FAILED         known failed execution with no ambiguous effect
SUBMITTED → GAIA_REQUIRED  execution effect cannot be classified safely
OBSERVED  → FAILED         measured postcondition contradicts the objective
OBSERVED  → GAIA_REQUIRED  evidence is incomplete or contradictory
```

## State meanings

- **CREATED:** objective and condition requirements exist.
- **ARMED:** authority, limits, and Session parameters are active.
- **OBSERVING:** current condition versions are being accepted.
- **ALIGNING:** all required predicates appear true, but lock evaluation is pending.
- **LOCKED:** one exact compatible version set and action configuration is immutable.
- **SUBMITTED:** an execution attempt has been dispatched.
- **OBSERVED:** a receipt or effect has been observed but not yet verified against the objective.
- **VERIFIED:** the declared postcondition has been measured and satisfied.
- **FAILED:** a known terminal failure occurred without unresolved effects.
- **EXPIRED:** no new attempt may begin under the current Path or Session.
- **GAIA_REQUIRED:** an effect or obligation remains ambiguous and requires reconciliation.

## Lock invariants

1. A lock contains every required condition exactly once.
2. Every condition snapshot is valid at `locked_at_ms`.
3. Every predicate is true.
4. `max(observed_at_ms) <= locked_at_ms < min(valid_until_ms)`.
5. Every sequence is the latest accepted sequence at lock time.
6. A later update cannot mutate the lock.
7. A Pact may accept at most one lock in the current MVP.
8. No value-moving action is considered complete before postcondition verification.
