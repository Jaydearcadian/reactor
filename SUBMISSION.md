# Reactor — Submission Brief

## One-line definition

**Reactor is persistent exact-state coordination infrastructure for fast-moving onchain systems.**

It keeps an objective alive across independently changing authenticated state, detects when the exact required configuration becomes executable, freezes that state into an immutable candidate, and carries the decision into bounded canonical execution and verified settlement.

> **Retry objectives, not transactions.**

---

## Why Reactor exists

Faster chains improve execution, but they also increase state churn, automation, concurrency and the rate at which observations become stale.

The coordination problem becomes:

> **When is an objective safely executable, and under which exact authenticated state?**

If every relevant transition can be controlled and co-bundled by one actor into one atomic transaction, Reactor may be unnecessary. Reactor is designed for persistent objectives whose inputs change independently and may be controlled by different agents, protocols, feeds, venues, keepers or policy systems.

Typical users include:

- autonomous treasury systems;
- protocol risk controllers;
- keeper and automation networks;
- multi-party execution systems;
- market/inventory management systems;
- AI agents whose objectives outlive individual transactions.

Reactor is not agent-only infrastructure.

---

## Architecture

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
        │
authenticated transitions
exact-state evaluation
candidate sealing
        │
        │ commit candidate
        ▼
SOLANA
revalidate candidate
        ↓
ExecutionLock
        ↓
bounded settlement
        ↓
Receipt / verified postcondition
```

### MagicBlock owns the hot path

- `ConditionState × N`
- `SessionCandidate`
- rapid authenticated state transitions
- exact joint-state evaluation
- candidate sealing

### Solana remains canonical

- `Path`
- `Objective`
- `Vault`
- `ExecutionLock`
- settlement
- `Receipt`

The ER never receives unrestricted Vault spending authority.

Evidence: [`M3_MAGICBLOCK.md`](./M3_MAGICBLOCK.md)

---

## The measured MagicBlock edge

### Question

**Does Reactor gain a measurable architectural advantage by moving high-frequency coordination state into a MagicBlock ER while keeping economic authority canonical on Solana?**

### Answer

**Yes, in the frozen M6 high-coordination-density fixture.**

One persistent objective experienced:

```text
120 non-executable churn transitions
+ 1 opening transition
= 121 authenticated hot transitions

→ 1 verified objective completion
```

Observed primary result:

| Metric | Solana treatment | MagicBlock hot-state treatment |
|---|---:|---:|
| objective-relevant hot transitions | 121 | 121 |
| verified completion | yes | yes |
| false seals | 0 | 0 |
| stale seals | 0 | 0 |
| candidate immutable | yes | yes |
| canonical coordination transactions | **123** | **10** |

**Canonical-work reduction: 91.87%**

The frozen pass gate required at least 75% reduction while preserving correctness. M6 passed.

Evidence:

- [`M6_ESSENTIALITY_BENCHMARK.md`](./M6_ESSENTIALITY_BENCHMARK.md) — protocol frozen before the result;
- [`M6_ESSENTIALITY_RESULT.md`](./M6_ESSENTIALITY_RESULT.md) — bounded interpretation of the observed PASS;
- [`experiment/results/archive/`](./experiment/results/archive/) — immutable generated JSON evidence;
- [`scripts/run_m6_essentiality_local.mjs`](./scripts/run_m6_essentiality_local.mjs) — benchmark implementation.

---

## Supporting evidence

### M4 — exact-state capture

MagicBlock reactive coordination reached **99% exact capture** across the randomized benchmark. Ordinary reactive Solana reached **2.33%**. An aggressive speculative Solana baseline also reached **99%**, but required **1,506 attempts for 297 captures**, with **1,209 landed stale/failed attempts**.

Interpretation: MagicBlock did not prove a fundamental capability Solana lacked; it achieved high exact-state capture without the same speculative amplification used by the strongest implemented Solana baseline.

### M5a — transition-coupled execution

The same `update_condition_and_maybe_seal(...)` instruction completed **10/10 correctly** on both runtimes with zero false locks and full post-seal immutability.

Controlled local mean `sendRawTransaction → processed` interval:

- Solana: **386.274 ms**
- MagicBlock ER: **29.369 ms**

This is a local transaction-shape signal, not a generic runtime superiority claim.

### M5b — falsification

At 50 concurrent objectives, both runtimes remained semantically exact, but local Solana completed the workload faster than the local ER.

This falsified the naïve claim that simply increasing objective count makes the ER increasingly advantageous. Reactor therefore shifted from horizontal concurrency to **coordination density** as the more relevant workload dimension.

Evidence: [`M5B_SMOKE_RESULT.md`](./M5B_SMOKE_RESULT.md)

---

## Why this matters as systems get faster

High-speed execution can move the bottleneck from:

```text
Can we execute fast enough?
```

toward:

```text
Can independently acting systems execute the right thing
against the right exact state without stale assumptions,
duplicate attempts or runaway retries?
```

Reactor occupies the middle layer:

```text
OBJECTIVE
What outcome should become true?
        ↓
REACTOR / COORDINATION
When is it safely executable, under which exact state?
        ↓
EXECUTION
Land the bounded action.
        ↓
VERIFICATION
Did the intended outcome actually occur?
```

---

## Forward research: inference cost

AI agents are one important user class, but not Reactor's definition.

A future experiment will test whether deterministic Reactor coordination can reduce **inference amplification** compared with waking an LLM on every state transition.

Candidate metrics:

- model calls per verified objective completion;
- tokens per objective;
- inference spend per verified completion;
- decision latency;
- correctness.

No inference-cost savings are claimed yet.

---

## What Reactor does not claim

The current evidence does **not** establish:

- generic MagicBlock superiority over Solana;
- production-wide latency ratios;
- public-network throughput superiority;
- production fee savings;
- that every objective should use an ER;
- that Reactor is superior to a semantics-equivalent keeper;
- arbitrary external DEX resource reservation;
- production security or market demand.

The next adversarial experiment is [`M7_KEEPER_EQUIVALENCE_BENCHMARK.md`](./M7_KEEPER_EQUIVALENCE_BENCHMARK.md).

---

## Demo

The `chamber/` application is the submission-facing interactive explanation and evidence viewer.

It presents:

1. why persistent exact-state coordination matters;
2. what Reactor is and who it is for;
3. the MagicBlock/Solana authority split;
4. the measured ER edge;
5. an interactive reconstruction of the M6 run;
6. direct links from every major claim to repository evidence;
7. the experiment log and falsified hypotheses.

Build locally:

```bash
cd chamber
npm install
npm test
npm run build
npm run dev
```
