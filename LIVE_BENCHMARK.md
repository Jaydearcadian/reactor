# Reactor Live Benchmark Contract

This document defines the minimum evidence required before Reactor may claim a measured execution advantage over a Solana baseline.

## Benchmark question

Can Reactor capture and verify materially more short-lived jointly executable condition windows than strong base-layer submission paths receiving the same authenticated condition stream, without producing false locks or stale settlement attempts?

## Paths

### A. Standard Solana

A signed settlement transaction is submitted through a conventional Solana JSON-RPC endpoint. Transport acknowledgement, chain observation, confirmation, and objective postcondition verification are recorded separately.

### B. Jito

The same signed settlement action is submitted through the applicable Jito low-latency path. Bundle or transaction acceptance is only a transport acknowledgement. Landing/observation and postcondition verification remain separate evidence states.

### C. MagicBlock Reactor

Required condition state is delegated or otherwise made authoritative inside the Ephemeral Rollup. Reactor evaluates the Pact there, creates an immutable executability lock, commits the relevant state, triggers the base-layer action, observes the resulting transaction, and verifies the declared objective postcondition.

Magic Actions do not remove Solana base-layer constraints. Commit-to-base-layer execution therefore remains part of the measured path.

## Shared workload rule

All paths must receive the same logical condition events and attempt the same economic action. A benchmark is invalid if Reactor receives earlier, richer, or more authoritative information than the baselines unless that informational advantage is itself the explicit subject of the experiment.

Each trial must record:

- scenario id and deterministic seed;
- condition source ids and sequence numbers;
- event emission timestamps;
- observation timestamps per path;
- valid overlap start and end;
- lock timestamp where applicable;
- submission timestamp;
- transport acknowledgement timestamp;
- onchain observation timestamp;
- confirmation/finality state used;
- postcondition verification timestamp;
- final objective state;
- fees/tips where applicable;
- error or ambiguity classification.

## Evidence states

```text
READY
  ↓
SUBMITTED
  ↓
ACKNOWLEDGED    transport accepted the request
  ↓
OBSERVED        intended transaction/effect was observed onchain
  ↓
VERIFIED        declared objective postcondition was independently checked
```

Failure and ambiguous outcome are terminal evidence classifications for that attempt. `ACKNOWLEDGED` must never be counted as `VERIFIED`.

## Metrics

### Primary

**Verified valid-window capture rate**

```text
verified objectives attributable to generated valuable windows
---------------------------------------------------------------
valuable valid windows generated
```

### Safety

- false-lock rate;
- stale settlement-attempt rate;
- duplicate-effect rate;
- ambiguous-outcome rate.

### Latency

Report p50, p95, and p99 for:

- event emission → path observation;
- path observation → lock/decision;
- lock/decision → submission;
- submission → acknowledgement;
- acknowledgement → onchain observation;
- observation → postcondition verification;
- event emission → verified objective.

## Trial families

Start with controlled overlap bands rather than one hand-picked value:

- 50–100 ms;
- 100–200 ms;
- 200–400 ms;
- 400–800 ms;
- 800–1,500 ms.

Then replace synthetic durations with replayed or representative traces. Synthetic trials prove mechanism behavior; they do not prove market prevalence.

## Validity gates

A result may be promoted to X3 only if:

1. all compared paths run against real public/devnet network infrastructure;
2. identical workload provenance is retained;
3. clock and timestamp methodology is documented;
4. no path is credited for transport acknowledgement alone;
5. false-lock and duplicate-effect counts are disclosed;
6. failed and ambiguous attempts remain in the denominator where protocol rules require them;
7. raw per-trial records are retained;
8. configuration, endpoint class, software versions, and commit SHA are recorded.

## Kill / reframe conditions

Reactor should be weakened, narrowed, or killed if:

- Jito or another strong baseline captures nearly all valuable windows at lower complexity;
- measured Reactor advantage disappears outside artificial expiry schedules;
- ER condition state cannot be made sufficiently authoritative and fresh;
- locks frequently become unexecutable before base-layer settlement;
- reservation requirements make transient capture unnecessary;
- false locks occur at a rate incompatible with the target risk domain.

## Current boundary

The repository currently contains an X1 deterministic fixture and the instrumentation required to begin live probes. No X3 performance claim exists until signed transaction adapters, a MagicBlock deployment, a Jito path, and reproducible live trials are present.
