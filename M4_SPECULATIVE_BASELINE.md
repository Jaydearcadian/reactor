# M4-Coordination — Adversarial Speculative Baseline

## Status

**Active adversarial gate after the M4-Coordination smoke.**

The observer-driven smoke produced a strong separation under the tested external source-emission schedule:

```text
10 ms:  Solana 0/2  | MagicBlock 2/2
20 ms:  Solana 0/2  | MagicBlock 2/2
50 ms:  Solana 0/2  | MagicBlock 2/2
100 ms: Solana 0/2  | MagicBlock 2/2
150 ms: Solana 0/2  | MagicBlock 2/2
250 ms: Solana 2/2  | MagicBlock 2/2
500 ms: Solana 2/2  | MagicBlock 2/2
```

That result is not yet the frozen continuation gate because the Solana coordinator waited for a processed account-change signal before submitting its seal.

This adversarial baseline removes that dependency.

---

## Question

> If an ordinary Solana coordinator is already armed for the objective and continuously submits exact-version seal attempts before and throughout the externally generated executable interval, can it eliminate the capture advantage seen in the observer-driven smoke?

If yes, Reactor's earlier separation was substantially an observer-reaction artifact.

If no, the result points toward the more interesting limitation: ordinary Solana cannot ingest/process the independently emitted source transitions and exact seal attempts quickly enough to preserve the transient configuration, even when the coordinator speculates aggressively.

---

## Structural rules

The non-co-bundleable constraint remains unchanged.

Source writers and coordinator are separate roles:

```text
Source C: update C2 only
Source A: update C0 only
Coordinator: evaluate_session_candidate only
```

No transaction may contain both a source mutation and a Reactor seal.

The coordinator is allowed to know:

- the objective;
- the six condition accounts;
- the current version vector;
- the exact next expected vector `[1,1,2,1,1,1]`;
- that this objective remains active.

For this adversarial test, it does **not** need to observe the opening event before attempting to seal.

---

## Speculative coordinator

Before T0, the coordinator begins submitting unique prebuilt transactions containing only:

```text
evaluate_session_candidate([1,1,2,1,1,1])
```

Attempts continue at a bounded fixed cadence until the independent close event is emitted.

An attempt before the expected state exists fails safely with exact-version/predicate validation.

An attempt while the expected state exists may seal it.

An attempt after the state disappears fails safely.

Once the candidate is sealed, later attempts fail with `CandidateAlreadySealed` and cannot alter the frozen candidate.

### Default smoke configuration

```text
pre-open speculation: 25 ms
attempt cadence:        5 ms   (~200 attempts/sec/objective)
source-emission bands:  10, 20, 50, 100, 150, 250 ms
trials/band/path:       2
```

The cadence is intentionally aggressive. It is configurable so an even stronger 1-2 ms stress baseline can be run later if the 5 ms baseline still loses.

---

## Unique transaction requirement

Repeatedly sending the same signed Solana transaction is not a valid speculative baseline because duplicate signatures may be suppressed.

Each speculative attempt must therefore have a unique message/signature without changing Reactor semantics.

The harness appends a fixed-width pattern of **read-only sysvar remaining accounts** to the otherwise identical `evaluate_session_candidate` instruction. Reactor ignores these remaining accounts. Their only purpose is to make each pre-signed transaction message unique.

No attempt:

- mutates a source condition;
- changes the expected vector;
- changes Path/Vault state;
- spends the Vault;
- creates a different candidate;
- carries a different economic action.

This avoids introducing a transfer or economic side effect merely to defeat duplicate-signature suppression.

---

## Treatment paths

The speculative strategy is run on **both** runtimes so the comparison remains symmetric:

```text
local Solana + speculative coordinator
local MagicBlock ER + speculative coordinator
```

The important adversarial question is whether speculation lets Solana close the gap.

The prior observer-driven MagicBlock result remains useful context, but this gate does not intentionally handicap the ER treatment.

---

## Ground truth

Primary capture classification remains ledger/state based:

```text
candidate.ready == true
candidate.frozen_sequences == [1,1,2,1,1,1]
false_lock == false
```

Exact candidate success proves the execution ordering required for the expected state:

```text
open C2 seq2=true
    < exact seal
    < close C0 seq2=false
```

For misses, the harness also records source transaction slots and attempts best-effort block-order reconstruction to distinguish:

```text
A. expected runtime state existed but coordinator missed it
B. close became authoritative before open, so the expected runtime state never existed on that runtime
C. ordering could not be resolved
```

External source-emission capture rate and confirmed-runtime-window capture rate must be reported separately.

---

## Cost accounting

Speculation is not free.

Per trial record:

- attempts planned;
- attempts submitted;
- attempts processed;
- successful seal attempts;
- failed attempts;
- dropped/unobserved attempts;
- configured attempts/sec;
- estimated fee per attempt when RPC exposes it;
- estimated total speculative fees;
- candidate correctness.

A speculative Solana strategy that only matches ER capture by spending orders of magnitude more transactions is still an important result. It changes the product argument from pure possibility to coordination latency/cost efficiency.

---

## Interpretation matrix

### Solana speculation closes the gap

If Solana reaches approximately the same capture rate as ER in the short bands:

> The observer-driven smoke overstated the necessity of the ER. Reactor must either treat speculative base-layer execution as a valid alternative or move to a workload where sustained speculation is economically/operationally unacceptable.

### Solana speculation still loses

If aggressive speculation still fails materially while ER captures exact candidates:

> The limitation is deeper than observer reaction. The base runtime is failing to ingest/order the independent source transitions and exact coordinator attempts inside the external event schedule quickly enough, while the ER can.

That would be substantially stronger evidence for Reactor's hot-state coordination architecture.

### Both fail

The selected bands are below the useful coordination frontier. Move upward; do not manufacture a win.

---

## Gate discipline

This is still a smoke/adversarial-baseline stage.

Do not evaluate the frozen >=20 percentage-point continuation threshold until:

1. speculative baseline semantics are clean;
2. the strongest relevant cadence is selected;
3. source/runtime ordering classification is reliable enough;
4. selected bands are run with >=50 trials/path;
5. false locks remain zero;
6. Wilson/Newcombe confidence intervals are computed.
