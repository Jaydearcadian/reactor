# Reactor

**Persistent exact-state coordination infrastructure for fast-moving onchain systems.**

> **Retry objectives, not transactions.**

Reactor keeps an objective alive across independently changing authenticated state, detects when the exact required configuration becomes executable, freezes that state into an immutable candidate, and carries the decision into bounded canonical execution and verified settlement.

It is not agent-only infrastructure. Reactor is intended for autonomous treasuries, protocol risk systems, keepers, multi-party execution systems, market/inventory automation, AI agents and other event-driven systems whose objectives outlive individual transaction attempts.

**Submission brief:** [`SUBMISSION.md`](./SUBMISSION.md)  
**Interactive demo:** [`chamber/`](./chamber/)  
**Solana program:** `75ph49gq12tUVV2XAfmDozseGfuu5ZTSZDPB8MPF8oax`

---

## The problem

Faster execution does not eliminate stale state.

As onchain systems become faster and more automated:

- state changes more frequently;
- more bots, keepers, protocols and agents act concurrently;
- opportunities and valid configurations disappear faster;
- transaction attempts become stale more quickly;
- retries can target assumptions that no longer hold.

The coordination question becomes:

> **When is an objective safely executable, and under which exact authenticated state?**

If every relevant state transition can legitimately be controlled and co-bundled by one actor into one atomic transaction, Reactor may be unnecessary. Reactor is designed for persistent objectives whose inputs change independently and may be controlled by different actors or systems.

---

## What Reactor does

```text
persistent Objective
        +
bounded Path / authority
        +
independently changing authenticated state
        ↓
exact joint-state evaluation
        ↓
immutable SessionCandidate
        ↓
canonical ExecutionLock
        ↓
bounded execution
        ↓
postcondition verification
        ↓
Receipt
```

The central abstraction is an **objective**, not persistent transaction bytes.

When a source transition creates a jointly executable configuration, Reactor can update the authenticated condition, evaluate the current objective state and seal the exact compatible source versions inside the same transition:

```text
update_condition_and_maybe_seal(...)
```

Later source updates do not mutate the sealed authorization.

---

## Why MagicBlock

Reactor separates **hot coordination** from **canonical economic authority**.

```text
SOLANA
Path / Objective / Vault
        │
        │ delegate hot coordination state
        ▼
MAGICBLOCK EPHEMERAL ROLLUP
ConditionState × N
SessionCandidate
        ↓
authenticated state transitions
exact objective evaluation
candidate sealing
        │
        │ commit candidate
        ▼
SOLANA
candidate revalidation
        ↓
ExecutionLock
        ↓
settlement
        ↓
Receipt
```

### Hot in MagicBlock

- `ConditionState × N`
- `SessionCandidate`
- high-frequency authenticated updates
- exact-state evaluation
- candidate sealing

### Canonical on Solana

- `Path`
- `Objective`
- `Vault`
- `ExecutionLock`
- settlement
- `Receipt`

The Ephemeral Rollup does **not** receive unrestricted Vault spending authority.

End-to-end integration evidence: [`M3_MAGICBLOCK.md`](./M3_MAGICBLOCK.md)

---

## Measured MagicBlock edge

### Question

**Does Reactor gain a measurable architectural advantage by moving high-frequency coordination state into a MagicBlock ER while keeping economic authority canonical on Solana?**

### M6 answer

**Yes, in the frozen high-coordination-density fixture.**

```text
1 persistent objective
120 non-executable churn transitions
1 opening transition
──────────────────────────────
121 authenticated hot transitions

→ 1 verified objective completion
```

| Metric | Solana treatment | MagicBlock hot-state treatment |
|---|---:|---:|
| objective-relevant hot transitions | 121 | 121 |
| verified completion | yes | yes |
| false seals | 0 | 0 |
| stale seals | 0 | 0 |
| candidate immutable | yes | yes |
| canonical coordination transactions | **123** | **10** |

**Canonical-work reduction: 91.87%.**

The pass threshold was frozen at **≥75% reduction** before observing the result, with correctness required on both treatments.

Evidence:

- [`M6_ESSENTIALITY_BENCHMARK.md`](./M6_ESSENTIALITY_BENCHMARK.md) — frozen protocol;
- [`M6_ESSENTIALITY_RESULT.md`](./M6_ESSENTIALITY_RESULT.md) — observed PASS and bounded interpretation;
- [`experiment/results/archive/`](./experiment/results/archive/) — immutable generated evidence;
- [`scripts/run_m6_essentiality_local.mjs`](./scripts/run_m6_essentiality_local.mjs) — benchmark implementation.

---

## Supporting experiments

### M3 — MagicBlock → Solana lifecycle

Demonstrated end to end:

- six condition accounts + one `SessionCandidate` delegated;
- stale exact sequence rejected in the ER;
- false predicate rejected in the ER;
- exact candidate sealed;
- candidate remained immutable after later state change;
- candidate committed and returned to Solana;
- canonical `ExecutionLock` materialized;
- 100,000 lamport bounded settlement completed;
- exposure moved `700 → 500`;
- `Receipt.verified == true`;
- replay rejected.

Evidence: [`M3_MAGICBLOCK.md`](./M3_MAGICBLOCK.md)

### M4 — exact-state capture baseline

Randomized benchmark:

```text
300 cycles
900 strategy observations
zero false locks
```

Overall exact capture:

| Strategy | Capture |
|---|---:|
| Solana reactive | 2.33% |
| MagicBlock reactive | 99% |
| aggressive Solana speculative | 99% |

The speculative Solana baseline required:

```text
1,506 attempts
297 captures
1,209 landed failed / stale attempts
≈80.28% speculative waste
```

M4 falsified the claim that MagicBlock could capture a state Solana fundamentally could not. The stronger surviving result is that reactive ER coordination achieved high capture reliability without the speculative amplification used by the strongest implemented Solana baseline.

### M5a — transition-coupled exact-state authorization

Same Reactor instruction on both runtimes:

```text
Solana exact captures        10/10
MagicBlock exact captures    10/10
false locks                  0 / 0
post-seal immutable          10/10 / 10/10
```

Controlled local mean `sendRawTransaction → processed`:

```text
Solana       386.274 ms
MagicBlock    29.369 ms
```

This is a controlled local signal for the tested transaction shape, not a generic runtime superiority claim.

Evidence: [`M5_TRANSITION_COUPLED_RESULT.md`](./M5_TRANSITION_COUPLED_RESULT.md)

### M5b — concurrent persistent objectives

Corrected 50-objective smoke:

```text
Solana       50/50 exact
MagicBlock   50/50 exact
false locks  0 both
immutable    50/50 both
```

But local Solana completed that workload faster:

```text
exact captures / second
Solana       61.478
MagicBlock   30.254
```

This falsified the naïve thesis that increasing horizontal objective count automatically makes the ER increasingly advantageous.

Evidence: [`M5B_SMOKE_RESULT.md`](./M5B_SMOKE_RESULT.md)

---

## Who Reactor is for

Reactor becomes interesting when all of the following are true:

```text
persistent objective
+
independently changing state
+
exact-state authorization matters
+
no single actor necessarily controls all relevant transitions
+
bounded authority
+
verified outcome
```

Representative systems:

- autonomous treasury and risk management;
- keeper / automation networks;
- protocol safety controllers;
- multi-party coordination workflows;
- market and inventory automation;
- AI agents pursuing persistent economic objectives.

AI agents are a user class, not the definition of Reactor.

---

## Why faster systems make coordination interesting

Future high-speed systems increasingly separate four concerns:

```text
OBJECTIVE
What outcome should become true?
        ↓
COORDINATION
When is it safely executable, under which exact state?
        ↓
EXECUTION
Land the bounded action.
        ↓
VERIFICATION
Did the intended outcome actually occur?
```

Execution infrastructure is getting faster. Reactor explores the underdeveloped middle layer: **deterministic exact-state coordination**.

A useful shorthand is:

> **Fast execution without exact-state binding can become fast stale execution.**

---

## Forward research: inference cost

High-frequency autonomous systems may also suffer from **inference amplification** if every deterministic state update wakes an expensive reasoning model.

A future Reactor experiment will compare a naïve agent re-evaluation loop against Reactor-gated coordination using metrics such as:

- model calls per verified objective completion;
- tokens per objective;
- inference spend per verified completion;
- decision latency;
- correctness.

No inference-cost savings are claimed yet.

---

## Research integrity

Reactor is an open systems research project, not a benchmark optimized around a predetermined answer.

The experiments have removed claims as well as supported them:

```text
M3   ER → Solana lifecycle                 demonstrated
M4   fundamental capture superiority       falsified
M5a  transition-coupled semantics          passed
M5b  naive horizontal scaling advantage    falsified
M6   coordination-density advantage         passed
M7   keeper equivalence                     next
```

Next adversarial protocol: [`M7_KEEPER_EQUIVALENCE_BENCHMARK.md`](./M7_KEEPER_EQUIVALENCE_BENCHMARK.md)

---

## What is not claimed

Current evidence does **not** establish:

- generic MagicBlock superiority over Solana;
- production-wide latency ratios;
- public-network throughput superiority;
- production fee savings;
- that every objective should use an ER;
- Reactor superiority over a semantics-equivalent keeper;
- arbitrary external DEX resource reservation;
- production security;
- representative market demand;
- inference-cost savings.

---

## Interactive submission demo

`chamber/` is Reactor's submission-facing explanation and evidence viewer.

It presents:

1. why coordination becomes a first-class problem;
2. what Reactor is and who it is for;
3. why MagicBlock owns the hot coordination path;
4. the measured ER edge;
5. an interactive M6 run reconstruction;
6. direct links from claims to repository evidence;
7. the falsification history.

Run locally:

```bash
cd chamber
npm install
npm test
npm run build
npm run dev
```

The production build prefers immutable evidence from `chamber/data/archive/` when a mutable `latest` result is not present.
