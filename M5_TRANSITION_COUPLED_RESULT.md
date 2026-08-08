# M5a — Transition-Coupled Runtime Result

## Status

**Demonstrated locally on 2026-08-08.**

This result supersedes the earlier WebSocket-triggered M5 reactive-ER smoke as performance evidence.

The earlier harness placed an off-runtime observation loop in the correctness path:

```text
ER source update
  -> WebSocket callback
  -> Node coordinator
  -> second ER transaction
  -> seal
```

That harness produced `coordinatorTx=0` on the ER and was subsequently classified as invalid performance evidence: no seal transaction had even been submitted.

M5a now tests the same Reactor state transition on both runtimes:

```text
source-authenticated condition update
        +
current-state objective evaluation
        +
maybe-seal exact candidate
```

in one Reactor instruction:

```text
update_condition_and_maybe_seal(...)
```

No account-change/WebSocket callback is required for correctness.

---

## Program identity

```text
Reactor program
75ph49gq12tUVV2XAfmDozseGfuu5ZTSZDPB8MPF8oax
```

The benchmark bootstrap synchronizes `declare_id!` from `target/deploy/reactor-keypair.json` before `anchor build`, then verifies that the generated IDL and program keypair agree.

Local MagicBlock validator binary reported:

```text
magicblock-config 0.13.19
```

---

## Fixture

Each fresh trial initializes one Objective with six independently authenticated `ConditionState` accounts and one `SessionCandidate`.

Before the measured transition:

```text
C0 seq1 true
C1 seq1 true
C2 seq1 false   <- blocker
C3 seq1 true
C4 seq1 true
C5 seq1 true
```

The measured transaction is the C2 source advancing its own condition:

```text
C2: seq1 false
 -> seq2 true
```

through `update_condition_and_maybe_seal`.

If the six current conditions are jointly executable, Reactor freezes the current versions directly into the `SessionCandidate`.

Expected frozen vector:

```text
[1,1,2,1,1,1]
```

A later C0 transition verifies that already-frozen candidate state remains immutable.

---

## Correctness result

```text
                     Solana        MagicBlock ER
trials               10            10
exact captures        10/10         10/10
failures              0             0
post-seal immutable   10/10         10/10
false locks           0             0
```

The critical result is that **both runtimes implement the same Reactor lock semantics correctly**.

Therefore Reactor must not claim that Solana is intrinsically incapable of catching or constructing an equivalent exact execution lock.

---

## Local submit-to-processed latency

Measured interval:

```text
send prebuilt update_condition_and_maybe_seal transaction
        ->
processed signature notification
```

It includes local RPC submission and processed-signature notification. It is not pure program execution time and is not a public-network latency claim.

### Solana local base

```text
min       323.949 ms
mean      386.274 ms
p50       396.801 ms
p95       404.456 ms
p99       406.952 ms
max       407.575 ms
```

### MagicBlock local ER

```text
min        23.565 ms
mean       29.369 ms
p50        29.294 ms
p95        33.536 ms
p99        34.169 ms
max        34.327 ms
```

### Observed local effect

```text
mean       ~13.15x lower interval on ER
p50        ~13.55x lower interval on ER
p95        ~12.06x lower interval on ER
p99        ~11.91x lower interval on ER
```

Equivalent interval reductions were approximately 92.4%, 92.6%, 91.7%, and 91.6% respectively.

These are controlled local-runtime observations only. Do **not** generalize this as "MagicBlock is 13x faster than Solana" or as a mainnet/public-cluster performance claim.

---

## What this proves

**Demonstrated:**

1. Solana can perform Reactor's transition-coupled exact-state capture correctly.
2. MagicBlock ER can perform the same transition-coupled exact-state capture correctly.
3. The earlier ER `capture=0` result came from the WebSocket/offchain coordinator harness rather than an inability of the ER to seal the state.
4. Under this warmed local fixture, the MagicBlock ER path has a large submit-to-processed latency advantage for the same Reactor transition.
5. Reactor can remove the external guessed-version vector from its primary hot path: the runtime can inspect and freeze the current six versions itself.

---

## What this does not prove

This result does not yet establish:

- production/mainnet latency ratios;
- public MagicBlock-vs-public Solana transport parity;
- throughput advantage at many simultaneous objectives;
- lower end-to-end economic cost after delegation and commit;
- Jito comparison;
- arbitrary external DEX-state reservation;
- production security;
- real market demand.

---

## Product interpretation

The surviving thesis is no longer:

> MagicBlock can create a lock Solana cannot.

The stronger and more accurate architecture is:

> Reactor is a persistent objective/executability state machine. Solana can execute its semantics; MagicBlock is an acceleration layer for the high-frequency hot-state portion when the workload benefits enough to justify delegation and commit complexity.

The current hot path becomes:

```text
source transition
      ->
Reactor update_condition_and_maybe_seal
      ->
exact SessionCandidate
      ->
commit / undelegate when useful
      ->
Solana materialize canonical ExecutionLock
      ->
settlement
      ->
Receipt
```

---

## Next falsification gate — M5b load

Single-objective latency is now established only as a local systems signal.

The next experiment must test whether the signal survives realistic concurrent hot-state load using the **same transition-coupled semantics** on both runtimes.

Initial levels:

```text
1 objective
10 objectives
50 objectives
100 objectives
```

Then, if stable:

```text
250
500
1000+
```

Primary metrics:

- exact capture rate;
- false locks;
- source transitions/sec;
- successful seals/sec;
- p50/p95/p99 transition-to-processed interval;
- backlog / failed submissions;
- compute consumed;
- base-layer transactions generated;
- delegation setup cost excluded and reported separately;
- commit/materialize/settle cost added in a later end-to-end phase.

M5b should be considered a success only if correctness remains exact and the ER advantage remains meaningful as concurrency and update rate increase.
