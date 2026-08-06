# Reactor Product Truth

**Version:** 0.1.0  
**Status:** Proposed foundation  
**Maturity:** M1 — framed product hypothesis  
**Evidence:** X1 — deterministic local fixture only

## Canonical definition

Reactor is a transient executability-lock engine. It observes independently changing, authenticated execution conditions inside an active Session, detects when they become jointly executable under one Pact, freezes their exact compatible state versions into an immutable lock, submits the resulting attempt, and verifies whether the declared objective became true.

## Primary user

An operator responsible for a time-sensitive onchain execution objective whose safe execution depends on multiple changing states.

The initial experiment uses market-maker inventory defense as a loaded adapter. That vertical does not define Reactor.

## Painful moment

A valid executable configuration appears briefly, but disappears before an ordinary observe-build-submit path can capture it. The objective is delayed, missed, or exposed to a stale attempt.

## Current workaround

Operators use offchain monitors, keepers, prebuilt transactions, priority fees, bundles, wider validity periods, and repeated submissions. These methods can reduce latency but do not make submission equivalent to verified objective completion.

## Core outcome

Convert one temporary, compatible condition overlap into one immutable execution configuration and one independently verified objective result.

## Product primitive

**Simultaneous Executability Lock**

A lock may exist only when:

1. every required condition is present;
2. every source update is authenticated by the adapter boundary;
3. every sequence is current;
4. every predicate evaluates true;
5. every observation remains valid at lock time;
6. the observations share a non-empty validity interval;
7. the exact action remains within the Path;
8. no prior lock exists for the same Pact.

## System language

- **Objective:** the postcondition that must become true.
- **Path:** standing authority, limits, expiry, approved programs, assets, and targets.
- **Pact:** immutable objective, required conditions, completion rules, and failure policy.
- **Session:** bounded period in which condition state is observed and evaluated.
- **State:** latest authenticated values and versions of the required conditions.
- **Lock:** immutable binding of compatible condition versions and exact attempt parameters.
- **Attempt:** submitted execution derived from a lock.
- **Proof:** machine-verifiable evidence for condition alignment and resulting effects.
- **Receipt:** permanent objective-level outcome record.
- **Gaia:** explicit unresolved state for ambiguous effects or obligations.

## Decisive workflow

```text
Pact created
→ Path armed
→ Session observes independent conditions
→ compatible overlap appears
→ Reactor freezes exact versions
→ attempt is submitted
→ effect is observed
→ postcondition is verified
→ Receipt closes the Pact
```

## Current demo boundary

One objective, six independently changing condition streams, one short valid overlap, one immutable lock, one simulated attempt, and one verified local Receipt.

## Initial experimental adapter

Market-maker inventory defense:

- exposure breach;
- oracle freshness and confidence;
- hedge liquidity;
- execution cost;
- predicted post-trade health;
- active Path authority.

## Product invariants

1. A transaction submission is never labeled objective completion.
2. A lock binds exact source versions and cannot absorb later updates.
3. Missing, false, expired, or incompatible conditions cannot create a lock.
4. One Pact cannot create multiple accepted locks.
5. State advances from evidence, not optimistic API responses.
6. Ambiguous effects enter Gaia rather than success or blind retry.
7. The vertical adapter may change; the Reactor lifecycle must not.
8. Current implementation and evidence status must never be overstated.

## Negative invariants

Reactor is not currently:

- an order book;
- an arbitrage bot;
- a market-making strategy;
- a generic agent coordination framework;
- an LLM execution system;
- a universal intent protocol;
- a guarantee that every transaction lands;
- a complete persistent-objective retry and recovery runtime;
- production-ready infrastructure.

## Long-term direction

The first primitive captures one transient opportunity. Later stages may re-arm residual objectives, select new routes, reconcile partial effects, compensate bounded failures, and continue until verified closure, expiry, impossibility, or Gaia.

That roadmap must not be presented as current functionality.
