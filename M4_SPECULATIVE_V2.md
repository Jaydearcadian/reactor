# M4 Speculative Baseline V2 — Unique Payers, No Shared Lock

## Why V2 exists

The first speculative smoke produced an important provisional result: ordinary local Solana captured 11/12 exact candidates while the local MagicBlock ER captured 12/12, with zero false locks.

However, the V1 harness had two benchmark defects that prevent treating its attempt-rate and fee accounting as demonstrated evidence:

1. the transaction-uniqueness suffix repeated every six attempts, so later submissions reused prior signatures;
2. all source and coordinator transactions shared the same fee payer, creating a writable fee-payer account lock that can unnecessarily serialize the Solana baseline.

The exact candidate captures from V1 remain real state outcomes, but V1 did **not** implement the claimed ~200 unique attempts/sec adversarial load.

V2 removes both defects before any product conclusion is frozen.

## Strongest honest baseline

For every speculative attempt V2 creates a distinct coordinator fee-payer keypair before the measured interval.

```text
attempt 0 -> coordinator payer 0
attempt 1 -> coordinator payer 1
attempt 2 -> coordinator payer 2
...
```

Each payer is funded during setup, excluded from the hot path. Because the fee-payer public key and signature are different, every speculative transaction is genuinely unique even though every transaction carries the exact same Reactor instruction and expected vector.

The two source writers also use their own funded source keys as transaction fee payers:

```text
source C pays/signs C2 seq2=true
source A pays/signs C0 seq2=false
```

This removes the central wallet as a hot writable account from source/coordinator traffic.

## Reactor semantics

Every speculative transaction contains only:

```text
evaluate_session_candidate([1,1,2,1,1,1])
```

There is no memo, transfer, compute-budget trick, source mutation or unrelated state mutation used to manufacture uniqueness.

No transaction combines:

```text
source mutation + candidate seal
```

## Invariants

V2 aborts or marks instrumentation invalid if:

- planned speculative signatures are not all unique;
- the same processed signature is counted twice;
- more than one unique speculative transaction reports successful execution for the same candidate;
- a frozen candidate differs from `[1,1,2,1,1,1]`;
- a source writer and speculative coordinator share a fee-payer key.

Because `evaluate_session_candidate` requires `candidate.ready == false`, at most one unique speculative transaction may succeed for one candidate.

## Ordering evidence

Capture ground truth remains the frozen candidate account.

V2 additionally records:

- source-open signature + slot;
- successful seal signature + slot;
- source-close signature + slot.

When two or more relevant transactions share a slot, V2 attempts to fetch the local block and compare transaction indexes. This provides a stronger ordering diagnostic than processed-callback wall-clock timestamps.

The benchmark still does not claim an exact millisecond authoritative-state lifetime from slot/block ordering.

## Default smoke

```text
external source-emission spacing: 10,20,50,100,150,250 ms
pre-open speculation:              25 ms
attempt cadence:                    5 ms
post-close speculation:            25 ms
trials/band/path:                    2
```

This is still a smoke gate. The frozen statistical continuation gate remains closed until V2 semantics are clean and selected cases are run with a sufficient sample.

## Interpretation

If V2 Solana matches the ER at >=20 ms again, the correct conclusion is that **capture possibility alone is not Reactor's differentiator** under this synthetic objective. Aggressive base-layer speculation is a valid alternative.

The next comparison then becomes:

```text
reactive ER hot-state coordination
vs
speculative base-layer transaction flood
```

across:

- transaction/fee cost;
- number of active objectives;
- account contention;
- sustained concurrent source rates;
- throughput/backpressure;
- wasted failed attempts;
- verified settlement outcomes.

If V2 Solana loses materially even after removing payer contention and duplicate signatures, the case for the ER architecture becomes much stronger.
