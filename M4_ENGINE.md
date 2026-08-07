# M4-Engine — Controlled Local Runtime Benchmark

## Why this gate exists

The public-devnet atomic diagnostic proved that the exact `SessionCandidate` can be sealed on both ordinary Solana and MagicBlock when the final authenticated condition update and `evaluate_session_candidate` are composed into the same transaction.

It also proved that client-side `processed` notification time is not a trustworthy proxy for validator execution time on public infrastructure. The observed callback delays include RPC transport, WebSocket delivery, geography, provider behavior and rate limiting.

M4-Engine therefore removes public network infrastructure from the comparison.

## Question

> Given the same Reactor program, the same six condition accounts, the same `SessionCandidate`, and the same prebuilt atomic transaction (`update_condition` + `evaluate_session_candidate`), what is the warmed local submit-to-processed latency on a local Solana base runtime versus a local MagicBlock Ephemeral Rollup?

This is an **engine/runtime diagnostic**, not the final product capture proof.

## Environment

MagicBlock's documented fully-local topology:

```text
local Solana base
http://127.0.0.1:8899
ws://127.0.0.1:8900

        +

local Ephemeral Rollup
http://127.0.0.1:7799
ws://127.0.0.1:7800
validator identity:
mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev
```

The bootstrap uses:

```text
mb-test-validator --reset

ephemeral-validator \
  --remotes http://127.0.0.1:8899 \
  --remotes ws://127.0.0.1:8900 \
  -l 7799 \
  --lifecycle ephemeral
```

## Fair transaction

Both paths receive the same two Reactor instructions in one signed transaction:

```text
1. update_condition(
     condition2,
     sequence=2,
     predicate=true
   )

2. evaluate_session_candidate(
     [1,1,2,1,1,1]
   )
```

The source-2 signer authenticates the update. The second instruction only seals the already-bounded `SessionCandidate`; it does not spend the Vault.

### Solana path

All condition accounts and the candidate remain Reactor-owned on local Solana.

### MagicBlock path

The six conditions and candidate are delegated before measurement to the documented local ER validator identity. Setup/delegation is excluded from the measured interval.

## Measured interval

Each transaction is constructed, assigned a blockhash, signed, and subscribed **before** the measurement begins.

```text
T0 immediately before sendRawTransaction
 |
 | local runtime receives + executes atomic transaction
 |
T1 pre-warmed processed-signature notification
```

```text
submit_to_processed_ms = T1 - T0
```

A trial is valid only when the candidate subsequently verifies:

```text
ready == true
frozen_sequences == [1,1,2,1,1,1]
false lock == false
```

After capture, source 0 advances to sequence 2 false and the runner verifies that the candidate remains frozen. This post-capture mutation is not part of the latency interval.

## Metrics

Per path:

- trial count
- successful exact seals
- failed transactions
- false locks
- p50 submit-to-processed latency
- p95 submit-to-processed latency
- p99 submit-to-processed latency
- min / max / mean

Raw per-trial marks and signatures are retained in:

```text
experiment/results/m4-engine-local-latest.json
```

## Interpretation

M4-Engine can answer:

> Is there a runtime-level latency signal when public network transport is removed?

It cannot answer:

- whether real markets expose valuable windows of this duration;
- whether MagicBlock is necessary for a bundleable final update;
- whether public production routing preserves the local advantage;
- whether the system improves verified economic outcomes.

A local ER advantage is **necessary evidence for the latency story, not sufficient product proof**.

## Product-thesis consequence from the atomic diagnostic

The strong Solana baseline demonstrated that if the final state transition is Reactor-aware and can include `evaluate_session_candidate`, ordinary Solana can atomically capture that configuration too.

Therefore the eventual Reactor differentiation must be tested against a harder coordination class, such as state produced by independent external programs/actors that cannot or will not co-bundle Reactor's seal instruction. That experiment follows M4-Engine; it must not be replaced by a deliberately weak two-transaction Solana baseline.
