# Reactor Experiment Protocol

**Protocol version:** 0.1.0  
**Current evidence target:** X1 deterministic local fixture  
**Future evidence target:** X3 public devnet benchmark

## Question

Can Reactor capture valid joint-executability windows that a delayed observer misses, while rejecting stale, incomplete, expired, or invalid configurations?

The local fixture validates semantics and experiment shape only. It does not establish real Solana or MagicBlock performance.

## Unit under test

One Pact with six required condition streams:

1. exposure breach;
2. oracle safety;
3. hedge liquidity;
4. execution cost;
5. predicted health;
6. Path authority.

## Controlled objective

```text
Reduce exposure from +700 DemoSOL to no more than +500 DemoSOL.
Maximum execution cost: 25 bps.
Minimum post-execution health: 1.50.
Complete before Session expiry.
```

## Treatment and baseline

Both paths receive the same ordered update stream and use the same objective and predicates.

- **Baseline path:** deterministic observer with a configurable reaction delay.
- **Reactor path:** deterministic evaluator with a shorter configurable reaction delay and immutable version lock.

These are models, not measured networks.

Future measured paths:

- standard Solana RPC submission;
- optimized/Jito path;
- MagicBlock Reactor.

## Independent variables

- execution path;
- joint-validity window duration;
- update cadence;
- invalidation timing;
- reaction delay;
- settlement outcome.

## Controlled variables

- objective;
- condition events;
- sequence ordering;
- validity periods;
- success postcondition;
- experiment seed;
- measurement clock.

## Dependent measurements

- valid windows generated;
- valid windows captured;
- locks created;
- attempts submitted;
- objectives verified;
- windows missed;
- false locks;
- duplicate locks;
- detection-to-lock latency;
- terminal lifecycle state.

## Primary metric

```text
Verified valid-window capture rate
= verified objectives / valuable valid windows generated
```

## Safety metrics

```text
False-lock rate = 0
Duplicate accepted locks = 0
False verified outcomes = 0
```

## Scenario matrix

The deterministic suite includes nominal overlap durations of:

- 50ms;
- 100ms;
- 150ms;
- 250ms;
- 500ms;
- 1,000ms.

It also includes:

- incomplete alignment;
- invalidation before evaluation;
- stale sequence replay;
- expiry before evaluation;
- later updates after a lock;
- duplicate evaluation;
- failed settlement;
- ambiguous observation.

## Local-fixture interpretation

The local result may say:

> Under the configured deterministic reaction-delay model, Reactor captured windows that the delayed baseline missed while preserving lock invariants.

It may not say:

> MagicBlock outperforms Solana or Jito in production.

## Future devnet acceptance proposal

Continue product development only if a measured, representative workload shows:

- a material capture-rate advantage over the strongest implemented baseline;
- zero false locks;
- immutable locked versions;
- verified settlement postconditions;
- explicit accounting for failed or ambiguous attempts;
- an economic benefit exceeding reservation and infrastructure costs.

The precise materiality threshold must be frozen before the measured experiment begins.
