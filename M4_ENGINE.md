# M4-Engine — Controlled Local Runtime Benchmark

## Status

**Demonstrated locally on 2026-08-07.**

The controlled run completed 10/10 exact seals on both ordinary local Solana and the local MagicBlock Ephemeral Rollup, with zero failed transactions and zero false locks.

Observed local `sendRawTransaction -> processed signature notification` latency:

| Metric | Local Solana | Local MagicBlock ER | Solana / ER |
|---|---:|---:|---:|
| min | 202.635 ms | 3.864 ms | 52.45× |
| mean | 247.487 ms | 5.253 ms | 47.11× |
| p50 | 243.422 ms | 5.087 ms | 47.85× |
| p95 | 282.307 ms | 6.913 ms | 40.84× |
| p99 | 286.717 ms | 7.449 ms | 38.49× |
| max | 287.820 ms | 7.584 ms | 37.95× |

Correctness for the same run:

```text
Solana:     10/10 successful exact seals, 0 failures, 0 false locks
MagicBlock: 10/10 successful exact seals, 0 failures, 0 false locks
```

The mean observed latency reduction was approximately **97.88%** and the p50 reduction approximately **97.91%**.

### Claim boundary

This result demonstrates a **large controlled local submit-to-processed latency signal** for the ER under this fixture. It does **not** demonstrate that MagicBlock is generically 47× faster than Solana, nor does it by itself prove Reactor's product thesis.

The measured interval still includes loopback RPC submission and processed-signature notification. The value of the local experiment is that public Internet transport, provider geography, rate limiting and remote WebSocket propagation are removed from both paths.

The raw result produced by the runner is:

```text
experiment/results/m4-engine-local-latest.json
```

That local evidence artifact should be retained with the benchmark run; the table above records the demonstrated summary only.

## Why this gate exists

The public-devnet atomic diagnostic proved that the exact `SessionCandidate` can be sealed on both ordinary Solana and MagicBlock when the final authenticated condition update and `evaluate_session_candidate` are composed into the same transaction.

It also proved that client-side `processed` notification time is not a trustworthy proxy for validator execution time on public infrastructure. The observed callback delays include RPC transport, WebSocket delivery, geography, provider behavior and rate limiting.

M4-Engine therefore removes public network infrastructure from the comparison.

## Question

> Given the same Reactor program, the same six condition accounts, the same `SessionCandidate`, and the same prebuilt atomic transaction (`update_condition` + `evaluate_session_candidate`), what is the warmed local submit-to-processed latency on a local Solana base runtime versus a local MagicBlock Ephemeral Rollup?

This is an **engine/runtime diagnostic**, not the final product capture proof.

## Environment

Local topology:

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

The working bootstrap starts the ER headlessly and resets its local ledger:

```text
mb-test-validator --reset

ephemeral-validator \
  --no-tui \
  --reset \
  --remotes http://127.0.0.1:8899 \
  --remotes ws://127.0.0.1:8900 \
  -l 7799 \
  --lifecycle ephemeral
```

Before ER startup the bootstrap funds the fixed local ER validator identity on the local base chain and verifies its balance is above the validator's startup requirement.

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

The six conditions and candidate are delegated before measurement to the fixed local ER validator identity. Setup/delegation is excluded from the measured interval.

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

## Interpretation

M4-Engine answers:

> Is there a runtime-level latency signal when public network transport is removed?

For the demonstrated 10-trial run, **yes**: the local ER showed a very large submit-to-processed advantage while preserving exact candidate correctness.

It does not answer:

- whether real markets expose valuable windows of this duration;
- whether MagicBlock is necessary for a bundleable final update;
- whether public production routing preserves the local advantage;
- whether the system improves verified economic outcomes;
- whether the same effect size persists over larger samples, different machines, load, account contention, or production topology.

A local ER advantage is **necessary evidence for the latency story, not sufficient product proof**.

## Product-thesis consequence from the atomic diagnostic

The strong Solana baseline demonstrated that if the final state transition is Reactor-aware and can include `evaluate_session_candidate`, ordinary Solana can atomically capture that configuration too.

Therefore Reactor's differentiation cannot be merely "independent sources" or "fast observation." It must be tested against a harder coordination class in which the state that creates joint executability is produced by external programs/actors that **cannot or will not co-bundle Reactor's seal instruction**.

That is the next gate. It must preserve the strongest honest Solana baseline and must not recreate an artificially weak two-transaction comparison.
