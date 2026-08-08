# Reactor × MagicBlock Skill Audit

## Status

**2026-08-08: M5 reactive-ER result is INVALID as ER performance evidence.**

The official `magicblock-labs/magicblock-dev-skill` was ingested and the Reactor integration was re-audited against its architecture, delegation, local-development, debugging, TypeScript, and crank guidance. The Solana Foundation `solana-dev` skill was also reviewed because the MagicBlock skill explicitly recommends pairing the two.

## What remains correct

The high-level Reactor state boundary is sound:

```text
Solana base
  Path / Objective / Vault
  canonical settlement / Receipt

MagicBlock ER
  delegated hot condition state
  delegated SessionCandidate
  low-latency coordination

ER -> commit candidate -> Solana materialize -> settle
```

MagicBlock is justified only for the hot repeated-write / low-latency coordination portion. Canonical authority and settlement remain on Solana.

The dependency lines also match the skill's known-good compatibility guidance:

```text
Rust:
anchor-lang 0.32.1
ephemeral-rollups-sdk 0.16.2 + anchor-compat

TypeScript:
@coral-xyz/anchor 0.32.1
@magicblock-labs/ephemeral-rollups-sdk 0.15.5
```

The local direct ER endpoint pair used by MagicBlock's own engine examples is:

```text
HTTP http://localhost:7799
WS   ws://localhost:7800
```

so the existence of the 7799/7800 pair is not itself the M5 bug.

## What M5 got wrong

### 1. WebSocket delivery was treated as execution truth

The M5 reactive treatment was:

```text
source update on ER
      ->
accountChange WebSocket callback
      ->
Node coordinator
      ->
second ER transaction
      ->
seal
```

When the callback did not fire, M5 reported:

```text
coordinatorTx=0
capture=0
```

That does **not** prove the ER failed to process the source update or could not seal the candidate. It only proves the Node coordinator did not submit a seal.

The MagicBlock reference application explicitly warns that WebSocket subscriptions are endpoint-bound and can stall when transaction routing and subscription placement diverge. WebSocket observation is therefore an integration surface that must be validated independently, not treated as the execution primitive itself.

### 2. Subscription readiness used a fixed sleep

M5 registers `onAccountChange` subscriptions and then does:

```text
sleep(100ms)
```

before emitting source updates.

The MagicBlock local-development guidance says to avoid fixed sleeps where state polling/observation is possible. A returned subscription ID is not evidence that the remote subscription is already ready to receive the first one-shot state transition.

A one-time opening update can therefore be missed even if the ER and program are healthy.

### 3. Source transactions were not execution-verified

M5's source path records the result of `sendRawTransaction`, but it does not subsequently fetch the signature status / transaction metadata and prove:

```text
meta.err == null
condition sequence actually advanced
predicate actually changed
```

If the source transaction is rejected after RPC acceptance, no blocker account change occurs and the coordinator correctly remains at zero submissions.

This is especially important because ER fee payers / cloned system accounts, blockhashes, and writable delegated accounts all have runtime-specific failure modes.

### 4. `skipPreflight: true` was universal and errors were not inspected

M5 sends every hot transaction with:

```text
skipPreflight: true
maxRetries: 0
```

The MagicBlock skill says to preserve preflight for supported flows and use `skipPreflight: true` only where a known ER simulation incompatibility requires it, documenting the reason and inspecting executed logs afterwards.

M5 currently skips the diagnostic information and then interprets missing downstream behavior as a capture result.

### 5. Off-runtime observation was inserted into the hot coordination loop

This is the larger architecture problem.

Reactor's condition sources already mutate Reactor-owned `ConditionState` accounts through the Reactor program. That means the source transition is already entering the Reactor state machine.

The most natural hot path is therefore:

```text
source-authenticated condition transition
          ->
ER-local objective evaluation
          ->
maybe seal exact candidate
```

not:

```text
condition transition
  -> external WebSocket
  -> Node process
  -> second transaction
  -> evaluation
```

The latter recreates an off-runtime observation round-trip and makes Reactor depend on WebSocket delivery for correctness.

## Corrected architecture

### Preferred: state-transition-coupled evaluation

Introduce an ER-native instruction conceptually equivalent to:

```text
update_condition_and_maybe_seal(
  kind,
  sequence,
  value,
  predicate,
  valid_until
)
```

It must:

1. authenticate the selected condition source;
2. monotonically update exactly that condition;
3. validate the candidate's six configured condition accounts;
4. inspect the **current** six condition versions;
5. if all predicates/validity rules hold and candidate is not already ready, freeze the exact current versions into `SessionCandidate`;
6. if the objective is not yet executable, keep the condition update and return success rather than reverting it;
7. once sealed, later condition updates may continue but must never mutate the frozen candidate.

This is stronger than the current `evaluate_session_candidate(expected_sequences)` benchmark primitive because it does not require an offchain coordinator to guess the exact next version vector.

### Secondary: ER crank

A crank is appropriate when the trigger is repeated ER-local maintenance rather than an explicit source transaction. It can evaluate active objective state on a bounded schedule without an application-operated cron server.

For Reactor's current source-driven condition model, state-transition-coupled evaluation is preferable because it reacts exactly when new authoritative condition state enters Reactor and avoids periodic speculative work.

## Consequence for the Solana comparator

This correction also changes the fair baseline.

If Reactor can perform update + maybe-seal in one state transition, ordinary Solana can run the same program logic too. Therefore the honest comparison becomes:

```text
same source-driven Reactor transition
same exact candidate semantics
same objective set

Solana base runtime
vs
MagicBlock ER runtime
```

under:

- high-frequency source updates;
- many simultaneously active objectives;
- account contention;
- backlog;
- capture latency;
- throughput;
- base settlement frequency/cost.

The product claim is no longer "Solana cannot make the lock."

The defensible claim to test is:

> Reactor is a persistent objective/executability state machine that can run on Solana, while MagicBlock is an acceleration layer for the hot coordination workload when repeated low-latency transitions materially benefit from ER execution.

MagicBlock becomes architecturally justified only if the measured workload benefits enough to offset delegation, commit, and operational complexity.

## Immediate recovery plan

1. Mark the current M5 reactive-ER `capture=0` observations as harness-invalid, not protocol results.
2. Run an isolated ER diagnostic with independent stage evidence:
   - base owner after delegation;
   - ER owner after delegation;
   - warm subscription event observed;
   - source-open transaction execution status;
   - blocker account state after source-open;
   - reactive callback arrival;
   - seal transaction execution status;
   - exact candidate state;
   - source-close execution status.
3. Remove WebSocket delivery from Reactor's correctness-critical capture design.
4. Implement state-transition-coupled `update + maybe seal` semantics.
5. Rebuild M5 around the same transition semantics on Solana and ER, measuring runtime throughput/latency and later full settlement cost.

## Claim labels

**Demonstrated**
- MagicBlock M3 delegation / seal / commit / materialize / settle lifecycle works.
- Local M4 engine showed a strong ER submit-to-processed runtime signal under the controlled fixture.
- Ordinary Solana can create/capture the same exact candidate under strong atomic/speculative strategies.

**Invalid / withdrawn as evidence**
- M5 `magicblock captures=0` from the WebSocket-triggered reactive harness.

**Planned / not yet demonstrated**
- state-transition-coupled ER capture under concurrent objective load;
- throughput/cost advantage after fair same-logic Solana comparison;
- full end-to-end M5 settlement advantage.
