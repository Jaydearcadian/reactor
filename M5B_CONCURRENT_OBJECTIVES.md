# M5b — Concurrent Objective Runtime

## Status

**Active falsification gate.**

M5a demonstrated that Reactor can move exact-state evaluation into the authenticated state transition itself:

```text
source transition
      +
current objective evaluation
      +
maybe seal exact candidate
```

through:

```text
update_condition_and_maybe_seal(...)
```

The same Reactor semantics worked correctly on both local Solana and a local MagicBlock ER. The ER showed a large controlled local submit-to-processed latency signal for the tested transaction shape, but single-objective latency is not enough to justify a dedicated coordination layer.

M5b therefore asks the next systems question:

> **What happens when many persistent objectives are simultaneously active and their independently authenticated condition transitions arrive concurrently?**

This gate measures the transition-coupled Reactor primitive under load. It is not another observer-latency benchmark.

---

## Primary hypothesis

> As the number of concurrently active objectives rises, a hot-state runtime should preserve exact Reactor semantics while sustaining more objective transitions with lower transition-to-processed latency and less backlog than the same transition-coupled workload on the local Solana base runtime.

This hypothesis is deliberately narrower than a production or economic claim.

M5b does **not** assume that Solana cannot implement Reactor. M5a already proved that it can.

---

## Treatments

### A — Solana transition-coupled

Each objective lives on the local Solana base runtime.

The opening source transition itself calls:

```text
update_condition_and_maybe_seal(
  kind = 2,
  sequence = 2,
  predicate = true,
  ...
)
```

The instruction updates the authenticated condition and immediately evaluates the current objective state. If all conditions are jointly valid, it freezes the exact current versions into the `SessionCandidate`.

There is no WebSocket callback and no second seal transaction in the correctness path.

### B — MagicBlock transition-coupled

The six `ConditionState` accounts and one `SessionCandidate` per objective are delegated before measurement.

The same `update_condition_and_maybe_seal` instruction is submitted to the local ER with the same objective semantics.

Delegation and setup are excluded from the hot-path interval but recorded as architecture overhead that must be reintroduced in later end-to-end work.

### Historical adversary — speculative Solana

M4 already demonstrated that aggressive exact-version speculation can reproduce high capture reliability at substantial transaction amplification.

That baseline remains relevant to Reactor's broader coordination-efficiency story, but it is **not the primary M5b treatment** because it models a different source-integration assumption. M5b first compares the same transition-coupled primitive on both runtimes.

The old WebSocket-triggered ER coordinator is also not a primary treatment. M5a superseded it for performance evidence.

---

## Objective fixture

Every objective uses the same controlled state machine:

```text
Path
Objective
Vault
ConditionState × 6
SessionCandidate
```

Initial conditions:

```text
C0 seq1 true
C1 seq1 true
C2 seq1 false    <- blocker
C3 seq1 true
C4 seq1 true
C5 seq1 true
```

Opening transition:

```text
C2: seq1 false -> seq2 true
```

Expected candidate:

```text
ready = true
frozen_sequences = [1,1,2,1,1,1]
```

After the opening episode, C0 advances through the same transition-coupled instruction:

```text
C0: seq1 true -> seq2 false
```

The already-sealed candidate must remain unchanged. This keeps candidate immutability in the load gate rather than measuring throughput while silently dropping a core invariant.

---

## Concurrency ladder

The first controlled ladder is:

```text
1
10
50
100 objectives
```

Only after those levels remain semantically clean should the experiment extend to:

```text
250
500
1000+
```

Do not skip directly to a large number and treat runtime failure as product evidence. Each level is a capacity probe of the harness and architecture.

For publication-quality evidence, each objective-count level should eventually run in a fresh local validator/ER session and across multiple episodes.

---

## Scheduling

The measured opening transitions are prebuilt and signed before the episode.

Each objective gets a distinct fee payer for the measured transition so a shared writable payer account does not artificially serialize the workload.

Opening submissions are emitted inside a bounded deterministic burst rather than one sequential loop.

Default burst spread:

```text
20 ms
```

The runner deterministically distributes objective submissions across that interval. This is a load schedule, not a claim about authoritative market-window lifetime.

The measured hot interval begins immediately before each `sendRawTransaction` and ends when that transaction reaches a processed runtime status.

---

## Ground truth

A successful objective requires all of:

```text
open transaction processed successfully
candidate.ready == true
candidate.frozen_sequences == [1,1,2,1,1,1]
post-seal source transition processed
candidate remains frozen at [1,1,2,1,1,1]
```

A candidate that becomes ready with any other version vector is a **false lock** and invalidates the run.

RPC submission acknowledgement alone is not capture evidence.

---

## Primary metrics

### Correctness

Per runtime and objective count:

- objectives attempted;
- successful opening transitions;
- exact captures;
- capture rate;
- false locks;
- post-seal immutable candidates;
- submission failures;
- runtime failures;
- verification failures.

### Capacity

- processed opening transitions / second;
- exact captures / second;
- measured episode wall time;
- first-submit -> last-processed interval;
- backlog proxy: processing completion spread after the final scheduled submission.

### Latency distribution

For successful exact captures:

- min;
- mean;
- p50;
- p95;
- p99;
- max `sendRawTransaction -> processed status`.

Latency is a secondary systems metric. It is no longer the product thesis by itself.

### Work

For the transition-coupled treatments:

```text
opening transactions submitted / exact captures
opening transactions processed / exact captures
failed opening transactions / exact captures
```

The ideal transition-coupled coordination amplification factor is approximately `1.0×`.

### Local fee/compute diagnostics

Where the runtime exposes them, record:

- `getFeeForMessage` fee estimate;
- transaction fee from confirmed metadata;
- compute units consumed.

Null or zero local ER values must be reported as local runtime observations only. They are not production pricing claims.

---

## Fairness rules

1. Both primary treatments execute the same Reactor instruction and exact objective semantics.
2. No WebSocket/account-change callback exists in the correctness path.
3. Measured transactions are prebuilt and signed before their scheduled burst.
4. Each measured objective uses a distinct fee payer to avoid shared-payer account locking.
5. Setup, account creation, funding and delegation are excluded equally from the hot transition interval.
6. Setup/delegation cost is not forgotten; it remains a required M5c/M6 economic input.
7. Exact candidate state, not callback timing, classifies correctness.
8. Any instrumentation failure is reported separately rather than converted into a runtime miss.

---

## Progression rule

M5b should advance through the concurrency ladder only while:

```text
false locks == 0
AND
candidate immutability failures == 0
AND
instrumentation is trustworthy
```

Any semantic failure stops promotion to a larger count until explained.

A useful MagicBlock systems signal requires more than a lower p50. It should remain visible in p95/p99 and/or processed-objective throughput as objective count rises.

Do not freeze a production superiority claim from this local gate.

---

## Falsification conditions

The MagicBlock acceleration story weakens if:

- the ER loses exactness or immutability under concurrency;
- its p95/p99 advantage collapses as objective count rises;
- throughput is comparable to or worse than the local Solana base runtime once the same primitive is used;
- delegation/state-maintenance overhead later outweighs the hot-path gain;
- the workload only looks favorable because measured transactions share fewer writable accounts on one treatment;
- the harness itself becomes the bottleneck before either runtime does.

Reactor's broader thesis also weakens if transition-coupled Solana remains operationally sufficient for the target vertical at realistic scale.

---

## What follows M5b

### M5c — Verified completion under load

Take the transition-coupled candidate through:

```text
candidate
  -> commit / undelegate
  -> canonical materialize_lock
  -> execute_locked
  -> Receipt
  -> verified objective postcondition
```

The denominator then becomes **verified objective completions**, not candidates.

### M6 — Real vertical

Replace the six synthetic predicates with an economically meaningful objective such as bounded inventory/risk defense.

### M6b — Resource preservation

Prove that Reactor can reserve or immediately consume the economically relevant resource rather than merely recording that a jointly executable configuration once existed.

---

## Runner

Single local session / objective count:

```bash
REACTOR_M5B_OBJECTIVE_COUNT=10 \
REACTOR_M5B_EPISODES=1 \
bash scripts/bootstrap_m5b_concurrent_objectives_local.sh
```

The runner writes:

```text
experiment/results/m5b-concurrent-objectives-<count>-latest.json
```

Recommended first smoke:

```text
1 -> 10 -> 50 -> 100
```

Run each count in a fresh bootstrap session before treating the result as capacity evidence.
