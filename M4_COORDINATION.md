# M4-Coordination — Non-Co-Bundleable Executability Capture

## Status

**Next active gate.**

M4-Engine demonstrated a large controlled local runtime latency signal for MagicBlock, but the prior atomic diagnostic also proved a strong Solana counterexample: if the final state transition can legitimately append Reactor's seal instruction, ordinary Solana can capture that configuration atomically too.

M4-Coordination therefore tests the class Reactor actually needs to own:

> A jointly executable configuration produced by independently changing sources whose writers cannot or will not co-bundle Reactor's seal instruction.

This is the first M4 gate aimed directly at the product thesis rather than runtime mechanics.

---

## Core hypothesis

> When independently controlled source updates create a short-lived jointly executable configuration and the source writers are structurally separated from the Reactor coordinator, a warmed MagicBlock Reactor session will capture a materially larger share of valuable exact-version windows than the strongest equivalent warmed Solana coordinator, without false locks.

The goal is not to prove that Solana cannot execute the action.

The goal is to test whether Reactor can **capture the moment of joint executability** more reliably when that moment emerges from state transitions that are not authored as one Reactor-aware transaction.

---

## Architectural rule: non-co-bundleability must be real

The benchmark must not merely instruct one omnipotent runner to "avoid bundling."

It must separate authority into roles:

```text
Source Writer A  ── may mutate source A only
Source Writer B  ── may mutate source B only
Source Writer C  ── may mutate source C only
...
Source Writer F  ── may mutate source F only

Reactor Coordinator ── may evaluate/seal only
```

### Enforced invariant

No benchmark transaction may contain both:

```text
source-state mutation
+
Reactor candidate seal
```

The source writers do not hold coordinator authority or behavior. The coordinator does not hold source-writer authority.

Even where `evaluate_session_candidate` is permissionless, the benchmark treats source writers as external, unmodified actors that do not know Reactor exists and do not append Reactor instructions to their own transactions.

This models external programs, venues, feeds, counterparties, keepers or independently operated agents whose state transitions are outside Reactor's transaction construction path.

### Strong-baseline requirement

We must not weaken Solana artificially.

The Solana baseline gets:

- prebuilt/pre-signed coordinator transactions when possible;
- warmed RPC/WebSocket connections;
- direct local validator connection for the local gate;
- processed-level observation;
- exact known candidate PDA;
- no unnecessary confirmation waits in the hot path;
- the same objective, conditions, expected versions and coordinator logic as the ER path.

If a stronger honest Solana observer/coordinator strategy exists, implement it.

### Strongest honest local Solana adversary: speculative exact-version submission

The first observer-driven smoke located a large apparent crossover, but observer reaction latency is not allowed to remain an artificial handicap for Solana.

Before evaluating the frozen gate, ordinary Solana therefore also receives a speculative coordinator strategy:

```text
prebuild many unique
 evaluate_session_candidate([1,1,2,1,1,1])
 transactions
          ↓
submit at bounded cadence before/during
external source-event schedule
          ↓
any attempt may capture only the exact
valuable version vector
```

Rules:

- source writers remain independent;
- no speculative transaction may mutate a source;
- every speculative attempt targets only the frozen expected vector;
- attempts must be uniquely signed so duplicate-signature suppression is not mistaken for inability to execute;
- the strategy may start before the opening source emission because the expected objective/version vector is known to the coordinator;
- failed early attempts are allowed and counted;
- submission count, landed successes/failures and transaction-fee cost are recorded;
- candidate account state, not RPC observer timing, remains capture ground truth;
- false locks remain disqualifying.

The initial implementation uses a distinct funded fee-payer keypair for each speculative transaction. This makes otherwise identical exact-version attempts unique without adding source authority or changing Reactor's instruction semantics.

The speculative strategy is intentionally favorable to Solana. Its purpose is to answer whether the ER advantage survives removal of reactive observer latency, not to model the cheapest production coordinator.

Runner:

```text
scripts/run_m4_coordination_speculative_solana.mjs
```

Default speculative smoke parameters:

```text
cadence: 10 ms
lead before source-open emission: 50 ms
tail after source-close emission: 100 ms
max attempts/trial: 64
trials/band: 2
```

Do not increase statistical sample size until this adversarial baseline has been run and inspected.

---

## Roles

### 1. Independent source writers

Six logical writers exist. Each has a distinct key and can update exactly one condition stream.

For the controlled fixture:

```text
C0 source A
C1 source B
C2 source C
C3 source D
C4 source E
C5 source F
```

The benchmark process may hold dev keys for orchestration, but transactions remain separately signed and separately submitted. Keys are never combined into the coordinator transaction.

### 2. Reactor coordinator

The coordinator watches the six condition streams and may submit only:

```text
evaluate_session_candidate(expected_sequences)
```

It cannot mutate a source condition.

### 3. Invalidating writer

A separate writer closes the executable window by advancing one previously-valid source to a new false version.

This close transaction is independently signed and scheduled from T0.

---

## Controlled state schedule

Warm state before each trial:

```text
C0 seq1 = true
C1 seq1 = true
C2 seq1 = false   <- blocker
C3 seq1 = true
C4 seq1 = true
C5 seq1 = true
```

Expected executable version vector:

```text
[1,1,2,1,1,1]
```

At T0, source C independently submits:

```text
C2 seq2 = true
```

This creates the valuable configuration.

At T0 + window_ms, source A independently submits:

```text
C0 seq2 = false
```

This destroys the valuable configuration.

A successful exact capture must freeze:

```text
[1,1,2,1,1,1]
```

Any candidate that freezes another version vector is a false lock.

A decision that executes only after C0 reaches seq2 is a miss/stale attempt.

---

## Two execution paths

### Solana baseline

Hot conditions and `SessionCandidate` remain on local Solana.

Observer-driven flow:

```text
source C submits C2 seq2=true
        ↓
Solana processes update
        ↓
coordinator learns executable state
        ↓
coordinator submits evaluate_session_candidate([1,1,2,1,1,1])
        ↓
source A independently closes window
```

Adversarial speculative flow:

```text
coordinator begins bounded unique exact-version attempts
        ↓
source C independently submits C2 seq2=true
        ↓
Solana processes whichever transactions its scheduler admits
        ↓
one speculative attempt may seal exact vector
        ↓
source A independently submits C0 seq2=false
```

No source transaction includes the Reactor seal.

### MagicBlock treatment

The six condition accounts and `SessionCandidate` are delegated to the warmed local ER before the trial.

Flow:

```text
source C submits C2 seq2=true to ER
        ↓
ER processes update
        ↓
coordinator learns executable state
        ↓
coordinator submits evaluate_session_candidate([1,1,2,1,1,1])
        ↓
source A independently closes window
```

Delegation/setup is excluded from the hot-path interval.

Canonical Path/Vault/settlement authority remains on Solana. This gate measures candidate capture only.

---

## Observation strategy

M4-Coordination must avoid repeating the public-devnet observer mistakes.

For the local gate:

1. prebuild and pre-sign source-open, coordinator-seal and source-close transactions;
2. warm all connections/subscriptions before T0;
3. submit source-open at T0;
4. use the earliest authoritative processed signal available to the observer-driven coordinator;
5. immediately submit the already-signed seal transaction;
6. independently submit close at `T0 + window_ms`;
7. verify the actual candidate account after the race;
8. use exact ledger state/version ordering for capture classification;
9. report observer timing separately from ledger outcome.

For the speculative Solana adversary, step 4 is intentionally bypassed: exact-version attempts may already be in flight before the source-open transaction is emitted.

### Important distinction

```text
observer latency != ledger capture classification
```

The previous atomic diagnostic proved why these must remain separate.

### Emission schedule != authoritative state lifetime

The smoke analyzer also established that the configured wall-clock spacing between source submissions must not be relabeled as guaranteed on-ledger state lifetime. Transaction processing can reorder when independently emitted updates become observable, and processed WebSocket callback order is not a canonical total execution ordering.

Therefore:

- configured `window_ms` is reported as **source-emission spacing**;
- processed callback deltas are diagnostic only;
- exact frozen version state / execution error remains the primary capture classifier.

---

## Initial window bands

M4-Engine measured the local ER atomic path around 4-8 ms and local Solana around 203-288 ms for the tested transaction shape.

M4-Coordination should therefore begin with bands broad enough to locate the transition rather than cherry-pick a win:

```text
10 ms
20 ms
50 ms
100 ms
150 ms
250 ms
500 ms
```

Smoke phase:

```text
2 trials per band per path
```

Only after harness semantics are clean **and the speculative Solana adversary has been evaluated**:

```text
>= 50 trials per selected band per path
```

Prefer 100 trials per selected band if local runtime cost remains low.

---

## Primary metric

### Exact valuable-window capture rate

```text
exact captures / valuable windows generated
```

An exact capture requires:

```text
candidate.ready == true
candidate.frozen_sequences == [1,1,2,1,1,1]
false_lock == false
```

The candidate must represent the valuable configuration, not merely any successful later state.

---

## Secondary metrics

Per path and window band:

- exact capture rate;
- stale-attempt rate;
- false-lock rate;
- ambiguous-trial rate;
- open-observed -> seal-processed latency where observation is used;
- T0 -> seal-processed observer latency where observation is used;
- source-open processed slot;
- seal processed slot;
- close processed slot;
- exact frozen version vector;
- trial failure reason;
- speculative attempts submitted where applicable;
- speculative attempts landed successfully/failed;
- speculative transaction-fee cost.

Report Wilson/Newcombe 95% intervals for capture rates and treatment-minus-baseline differences.

---

## Frozen continuation threshold

Do not redefine the threshold after seeing results.

Reactor clears the local M4-Coordination continuation gate only if:

1. MagicBlock false-lock rate is exactly zero in the analyzed sample;
2. MagicBlock exact capture rate exceeds the **strongest implemented Solana baseline, including speculative submission if stronger**, by **at least 20 percentage points** in two adjacent short-window bands;
3. the 95% interval for the capture-rate difference excludes zero in both bands;
4. the advantage survives warmed connections and equal exclusion of setup/delegation cost;
5. no observer artifact is being counted as an execution miss;
6. the winning bands remain plausible relative to the measured M4-Engine latency distribution.

If these conditions fail, do not manufacture a product win.

---

## Falsification conditions

The product thesis weakens materially if any of the following occur:

- the strongest Solana coordinator, including speculative exact-version submission, captures essentially every valuable window in the relevant bands;
- ER coordination latency does not translate into higher exact capture rate;
- false locks appear;
- the apparent advantage disappears under a cleaner observer or speculative coordinator;
- the only winning windows are so short that no valuable real-world source configuration plausibly persists that long;
- the benchmark requires source writers to cooperate with Reactor in ways the target vertical would not;
- the coordinator needs privileged source keys in production;
- the ER advantage exists only because the Solana baseline waits for confirmation or performs avoidable RPC work.

---

## What this gate can prove

A passing M4-Coordination result would support:

> Under controlled local conditions, Reactor's warmed ER coordination path captures short-lived exact executable configurations produced by independently submitted source updates materially more reliably than the strongest equivalent warmed Solana coordinator.

It would **not yet prove**:

- public-network performance;
- Jito parity;
- real market value;
- verified settlement success;
- production economics.

Those remain later gates.

---

## What follows a pass

### M4b — Verified end-to-end capture

Take representative winning bands and continue:

```text
exact ER candidate
  -> commit + undelegate
  -> base materialize_lock
  -> execute_locked
  -> Receipt verified
```

Primary metric:

```text
verified valid-window capture rate
```

### M4c — Strong public baseline

Reproduce the relevant experiment on same-cluster public infrastructure and include the strongest available Solana/Jito path fairly.

### M5 — Vertical proof

Replace synthetic conditions with a market-maker inventory-defense or comparable economically meaningful fixture and account for infrastructure, reservation and settlement costs.
