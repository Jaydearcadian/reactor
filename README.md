# Reactor

**Persistent objective coordination for autonomous onchain systems.**

**Open-source research + executable reference implementation.**

Reactor explores how agents, programs, feeds, venues and other independently controlled actors can coordinate around a shared objective without giving any one participant control over all of the state.

Instead of repeatedly submitting transactions and hoping their assumptions remain valid when execution lands, Reactor keeps an objective alive, evaluates it as authenticated state changes occur, freezes the exact configuration that makes the objective executable, and carries that decision toward bounded execution and verified settlement.

> **Retry objectives, not transactions. Bind actions to exact state, not stale observations.**

**MagicBlock runs Reactor's high-frequency coordination path. Solana remains the canonical authority and settlement layer.**

[Architecture](#architecture) · [Evidence](#evidence) · [Research program](#research-program) · [Reproduce](#reproduce)

---

## Solana Blitz V7 — Collaboration

Reactor treats collaboration as a systems problem.

A shared onchain objective may depend on state controlled by different agents, protocols, feeds, risk engines, venues or policies. None of those participants needs to surrender control of its own state. Reactor coordinates their authenticated transitions and determines when the combined configuration is jointly executable.

```text
Agent / Actor A ── state ──┐
Oracle          ── state ──┤
Protocol B      ── state ──┤
Risk Engine     ── state ──┼── Persistent Objective
Venue           ── state ──┤           │
Policy          ── state ──┘           ▼
                                  jointly executable?
                                         │
                                         ▼
                                      Reactor
```

The collaboration is not social coordination layered on top of a blockchain. It is **machine-level collaboration over independently controlled state**.

---

## What Reactor is

Transactions answer:

> **What instruction should execute now?**

Reactor explores a different abstraction:

> **Under which exact state is a persistent objective allowed to become executable, and how do we preserve and verify that decision?**

```text
persistent Objective
        +
bounded Path / authority
        +
independently changing state
        ↓
exact joint-validity evaluation
        ↓
immutable SessionCandidate
        ↓
canonical ExecutionLock
        ↓
bounded execution attempt
        ↓
postcondition verification
        ↓
Receipt
```

A Reactor objective is not a transaction waiting to be retried. It is a state machine that remains active while its authorized inputs change.

When a source transition creates a jointly executable configuration, Reactor can evaluate the objective inside that authenticated transition and seal the exact current versions:

```text
update condition
+
evaluate current objective state
+
maybe seal exact candidate
```

The current transition-coupled instruction is:

```text
update_condition_and_maybe_seal(...)
```

---

## Architecture

Reactor separates **hot coordination** from **canonical economic authority**.

```text
SOLANA
Path / Objective / Vault
        │
        │ delegate hot state only
        ▼
MAGICBLOCK ER
ConditionState × N
SessionCandidate
        ↓
rapid authenticated transitions
        ↓
exact objective evaluation
        ↓
sealed candidate
        │
        │ commit + undelegate when needed
        ▼
SOLANA
materialize canonical ExecutionLock
        ↓
bounded settlement
        ↓
Receipt / verified postcondition
```

### What stays canonical on Solana

- `Path` — standing authority, limits and expiry;
- `Objective` — target postcondition and canonical condition set;
- `Vault` — canonical controlled economic state;
- `ExecutionLock` — accepted exact execution configuration;
- settlement;
- `Receipt` — verified before/after outcome evidence.

### What can become hot state in MagicBlock

- `ConditionState × N`;
- `SessionCandidate`.

The Ephemeral Rollup never receives authority to spend the canonical Vault.

That boundary is deliberate:

> **MagicBlock accelerates the coordination state. Solana preserves canonical authority and settlement.**

---

## Why this exists

Reactor is **not** based on the claim that Solana cannot atomically construct an exact execution lock.

The experiments explicitly falsified that stronger claim.

If the actor creating the final relevant state transition can legitimately bundle:

```text
state update
+
condition check
+
seal / execution
```

ordinary Solana atomicity can implement the same Reactor semantics.

Reactor becomes more interesting when executability emerges from state controlled by different actors, programs, venues, feeds or agents, and when those objectives remain active across sustained change.

The research question is therefore no longer:

> Can MagicBlock capture a state that Solana fundamentally cannot?

It is:

> **Does a dedicated hot-state coordination runtime make persistent exact-state objectives operationally more efficient as concurrency, state-change rate and verification requirements increase?**

---

## Evidence

Reactor is a research project, but the current reference implementation is real and tested.

| Milestone | Question | Result |
|---|---|---|
| M2 | Can Reactor freeze exact state and execute a bounded action? | **Yes — local + Solana devnet** |
| M3 | Can hot state live in MagicBlock and safely hand back to Solana? | **Yes — demonstrated end to end** |
| M4-Engine | Is there a local runtime latency signal? | **Yes — controlled local signal** |
| M4-Coordination | Does reactive ER beat ordinary reactive Solana in the tested fixture? | **Yes** |
| M4 strongest baseline | Can aggressive Solana speculation reproduce capture reliability? | **Yes — 99% vs 99%** |
| M5a | Can objective evaluation move into the authenticated state transition on both runtimes? | **Yes — 10/10 both** |
| M5b | Does transition-coupled coordination remain correct under concurrent objectives? | **10-objective smoke passed; higher-load gate active** |

### Current program

```text
Solana program
75ph49gq12tUVV2XAfmDozseGfuu5ZTSZDPB8MPF8oax
```

---

## M2 — Exact executability lock

The first complete Reactor primitive demonstrated:

```text
exact condition versions
        ↓
immutable ExecutionLock
        ↓
bounded action
        ↓
verified Receipt
```

Solana devnet fixture:

```text
stale exact sequence        rejected
false predicate             rejected
frozen sequences            [1,1,3,1,1,1]
later condition update      lock unchanged
vault debit                 100000 lamports
recipient credit            100000 lamports
exposure                    700 -> 500
Receipt                     verified=true
lock                        consumed=true
duplicate execution         rejected
```

Evidence:

```text
M2_EXECUTABILITY_LOCK.md
M2_DEVNET.md
experiment/results/m2-devnet-2026-08-07.json
```

---

## M3 — MagicBlock → Solana lifecycle

M3 moved six condition accounts and one `SessionCandidate` into a MagicBlock ER while keeping Path, Objective, Vault, canonical lock, settlement and Receipt on Solana.

The passing devnet run demonstrated:

```text
7 hot accounts               delegated + ownership verified
stale exact sequence         rejected in ER
false predicate              rejected in ER
candidate                    exact versions frozen
post-seal mutation           candidate unchanged
candidate commit             observed on Solana
candidate undelegation       observed on Solana
canonical ExecutionLock      materialized
vault debit                  100000 lamports
recipient credit             100000 lamports
exposure                     700 -> 500
Receipt                      verified=true
lock                         consumed=true
duplicate execution          rejected
```

Evidence:

```text
M3_MAGICBLOCK.md
experiment/results/m3-magicblock-devnet-2026-08-07.json
```

M3 is an integration-correctness proof, not a performance claim.

---

## M4 — Falsifying the first thesis

M4 compared three strategies under the same exact-version Reactor semantics:

```text
SR — Solana reactive
source update -> observer -> coordinator seal

MR — MagicBlock reactive
source update -> ER observer/coordinator -> seal

SS — Solana speculative
continuous unique exact-version attempts around expected state
```

Randomized benchmark:

```text
source-emission regimes       10 ms, 50 ms, 150 ms
trials / regime / strategy    100
randomized cycles             300
strategy observations         900
speculative cadence           50 ms
window jitter                 ±20%
random seed                   4082026
false-lock requirement        0
```

The millisecond regimes are source-emission spacing, not asserted authoritative on-ledger state lifetimes.

### Result

| Regime | Solana reactive | MagicBlock reactive | Solana speculative | SS attempts / capture | SS waste |
|---:|---:|---:|---:|---:|---:|
| ~10 ms | 0% | 97% | 97% | 4.12× | 75.75% |
| ~50 ms | 1% | 100% | 100% | 4.48× | 77.68% |
| ~150 ms | 6% | 100% | 100% | 6.58× | 84.80% |
| **Overall** | **2.33%** | **99%** | **99%** | **5.07×** | **80.28%** |

All **900 observations** completed with **zero false locks**.

The speculative Solana baseline submitted:

```text
1,506 exact-version attempts
  297 successful captures
1,209 landed failed / stale attempts
```

### What changed because of M4

MagicBlock reactive and aggressive speculative Solana both reached **99% exact capture**.

So Reactor does **not** claim:

> MagicBlock can capture a state that Solana fundamentally cannot.

The stronger result is:

> **Reactive low-latency coordination reproduced the same exact-capture reliability that the implemented base-layer strategy achieved through repeated speculation.**

M4 therefore changed Reactor's research direction from **capture possibility** to **coordination efficiency**.

M4 measures transaction amplification and waste. It does **not** prove a 5× economic cost advantage.

---

## M5a — Transition-coupled objectives

The earlier reactive architecture still depended on an off-runtime round trip:

```text
source update
 -> WebSocket
 -> Node coordinator
 -> second transaction
 -> seal
```

M5a removed that callback from the correctness path.

The final source-authenticated transition now performs:

```text
update condition
+
evaluate current objective state
+
maybe seal exact candidate
```

### Correctness

```text
                     Solana        MagicBlock ER
trials               10            10
exact captures        10/10         10/10
failures              0             0
post-seal immutable   10/10         10/10
false locks           0             0
```

This demonstrates an important boundary:

> **Reactor semantics are portable. Solana can execute the same transition-coupled objective logic correctly.**

### Controlled local runtime signal

Measured `sendRawTransaction -> processed signature notification`:

| Metric | Local Solana | Local MagicBlock ER |
|---|---:|---:|
| mean | 386.274 ms | 29.369 ms |
| p50 | 396.801 ms | 29.294 ms |
| p95 | 404.456 ms | 33.536 ms |
| p99 | 406.952 ms | 34.169 ms |

That was roughly a **13× lower observed interval** on the local ER for this transaction shape.

It is a controlled local systems signal only. It is **not** a generic MagicBlock-vs-Solana speed claim.

Evidence:

```text
M5_TRANSITION_COUPLED_RESULT.md
```

---

## M5b — Concurrent persistent objectives

M5b asks whether the same transition-coupled primitive remains exact as multiple objectives are simultaneously active.

The benchmark uses:

```text
Path
Objective
Vault
ConditionState × 6
SessionCandidate
```

per objective, with distinct measured fee payers and no WebSocket callback in the correctness path.

### Corrected 10-objective smoke

```text
                     Solana        MagicBlock ER
exact captures        10/10         10/10
false locks           0             0
immutable after close 10/10         10/10
open failures         0             0
close failures        0             0
coord amplification   1.0x          1.0x
```

Single local episode timing:

| Metric | Local Solana | Local MagicBlock ER |
|---|---:|---:|
| p50 | 987.508 ms | 254.599 ms |
| p95 | 1062.355 ms | 375.801 ms |
| p99 | 1091.390 ms | 408.885 ms |
| completion tail | 1098.649 ms | 405.645 ms |
| exact captures / second | 8.723 | 21.820 |

Both treatments consumed the same total Reactor compute in that smoke: **126,960 compute units**.

This is still smoke evidence, not a stable production performance ratio.

The first 50-objective attempt is not treated as runtime-capacity evidence because the configured condition TTL became binding during long serial fixture/delegation setup. That harness-validity issue is being removed before the 50-objective level is interpreted.

Evidence and methodology:

```text
M5B_CONCURRENT_OBJECTIVES.md
M5B_SMOKE_RESULT.md
scripts/run_m5b_concurrent_objectives_local.mjs
```

---

## Research program

Reactor is intentionally a **long-running open-source research project**, not a protocol with a predetermined answer.

The reference implementation evolves when experiments invalidate an assumption.

```text
M1  transient executability
        ↓
M2  exact-state lock + verified settlement
        ↓
M3  MagicBlock hot state -> Solana canonical lifecycle
        ↓
M4  reactive coordination vs aggressive speculation
        ↓
     stronger capture-superiority claim falsified
        ↓
M5  transition-coupled persistent objectives
        ↓
M5b concurrency and coordination efficiency
        ↓
M5c verified completion under load
        ↓
M6  real non-co-bundleable workload
        ↓
M6b resource preservation / reservation
```

### Current research frontier

The next questions are:

1. **Concurrency** — how does the runtime behave as active objectives rise from 10 to 50, 100 and beyond?
2. **Coordination work** — how many submissions, retries and failed attempts are required per successful objective?
3. **Economic cost** — compute, fees, bandwidth, state maintenance, delegation and commit cost per verified outcome.
4. **End-to-end completion** — candidate → commit → canonical lock → settlement → verified Receipt under load.
5. **Public infrastructure** — same-workload comparison on public infrastructure with the strongest fair Solana route.
6. **Real vertical** — replace synthetic predicates with an economically meaningful non-co-bundleable objective.
7. **Resource preservation** — prove Reactor can reserve or immediately consume the economically relevant resource, not merely prove that a valid configuration existed.

The product thesis survives only if those tests show that persistent exact-state objectives justify a dedicated coordination layer.

---

## Evidence discipline

Reactor distinguishes:

```text
SUBMITTED != ACKNOWLEDGED != OBSERVED != VERIFIED
```

RPC acceptance, a signature or an ER acknowledgement is never treated as verified objective completion by itself.

### Demonstrated

- exact-version locks and candidates;
- stale/replay rejection;
- false-condition rejection;
- candidate/lock immutability after later state changes;
- bounded native-SOL value conservation;
- verified objective postconditions;
- replay protection;
- MagicBlock hot-state delegation;
- ER candidate sealing;
- commit/undelegate back to Solana;
- canonical Solana revalidation/materialization;
- 300-cycle / 900-observation M4 benchmark;
- transition-coupled exact-state capture on both local runtimes;
- corrected 10-objective M5b concurrent smoke with zero false locks and full immutability.

### Not demonstrated / not claimed

- fundamental MagicBlock capability superiority over Solana;
- production-wide latency ratios;
- production fee savings;
- public Solana/Jito superiority or inferiority;
- arbitrary external DEX state reservation;
- representative market demand;
- production security;
- production profitability.

---

## Reproduce

### Deterministic fixture

```bash
python -m unittest discover -s tests -v
python scripts/run_experiment.py
```

### M3 MagicBlock / Solana lifecycle

```bash
bash scripts/bootstrap_m3_magicblock.sh
```

### M4 statistical coordination benchmark

```bash
bash scripts/bootstrap_m4_coordination_statistical_local.sh
```

### M5a transition-coupled local benchmark

```bash
bash scripts/bootstrap_m5_transition_coupled_local.sh
```

### M5b concurrent objective smoke

```bash
REACTOR_M5B_OBJECTIVE_COUNT=10 \
REACTOR_M5B_EPISODES=1 \
bash scripts/bootstrap_m5b_concurrent_objectives_local.sh
```

Local tooling includes Rust/Cargo, Anchor, Solana CLI, Node.js/npm, `mb-test-validator` and `ephemeral-validator`.

---

## Repository map

```text
reactor/
├── README.md
├── PRODUCT_TRUTH.md
├── THESIS.md
├── EXPERIMENT_PROTOCOL.md
├── STATE_MACHINE.md
├── M2_EXECUTABILITY_LOCK.md
├── M2_DEVNET.md
├── M3_MAGICBLOCK.md
├── M4_ENGINE.md
├── M4_COORDINATION.md
├── M4_COORDINATION_SMOKE_RESULT.md
├── M4_SPECULATIVE_V2.md
├── M4_BENCHMARK.md
├── M5_COORDINATION_EFFICIENCY.md
├── M5_TRANSITION_COUPLED_RESULT.md
├── M5B_CONCURRENT_OBJECTIVES.md
├── M5B_SMOKE_RESULT.md
├── LIVE_BENCHMARK.md
├── WHITEPAPER.md
├── programs/reactor/
├── src/reactor/
├── src-js/
├── scripts/
├── tests/
├── tests-js/
└── experiment/results/
```

---

## Status

**Experimental research prototype.**

Reactor's exact-version locking and bounded settlement primitive is demonstrated locally and on Solana devnet. MagicBlock Ephemeral Rollup integration is demonstrated end to end. M4 completed a 300-cycle / 900-observation randomized coordination benchmark with zero false locks. M5a demonstrated transition-coupled exact-state capture on both local Solana and a local MagicBlock ER. M5b has passed the corrected 10-objective concurrent smoke gate and is continuing through higher-load falsification tests.

Production economics, public-network superiority, real market demand and arbitrary external-resource reservation remain unproven.

Reactor is open research. Failures, falsifications and benchmark corrections are part of the record rather than hidden from it.
