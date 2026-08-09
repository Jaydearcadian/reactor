# Reactor

**Executability coordination for persistent objectives over independently changing onchain state.**

Reactor is an experimental execution-control primitive for objectives whose validity depends on multiple changing conditions. It binds actions to exact state versions, captures a jointly executable configuration into an immutable candidate/lock, and separates transaction submission from verified objective completion.

> **Status — experimental research prototype.** Reactor's exact-version locking and bounded settlement primitive is demonstrated locally and on Solana devnet. MagicBlock Ephemeral Rollup integration is demonstrated end to end. M4 completed a 300-cycle / 900-observation randomized coordination benchmark with zero false locks. M5a subsequently demonstrated transition-coupled exact-state capture on both local Solana and a local MagicBlock ER, with the ER showing a large controlled local submit-to-processed latency signal for the same Reactor transition. Production economics, public-network superiority, real market demand and arbitrary external-resource reservation remain unproven.

## The core idea

Transactions answer:

> **What instruction should execute now?**

Reactor is exploring a different abstraction:

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
immutable candidate / lock
        ↓
bounded execution attempt
        ↓
postcondition verification
        ↓
Receipt
```

The long-term product principle is:

> **Retry objectives, not transactions. Bind actions to exact state, not stale observations.**

## Where Reactor is actually differentiated

Reactor is **not** based on the claim that Solana cannot atomically construct an exact execution lock.

The experiments explicitly falsified that stronger claim.

If the actor creating the final state transition can legitimately bundle:

```text
state update
+
condition check
+
seal / execution
```

ordinary Solana atomicity can implement the same Reactor semantics.

Reactor is aimed at objectives whose executability emerges from state that changes across independently controlled actors, programs, venues, feeds or agents—and at the systems cost of keeping those objectives executable as concurrency rises.

## Why MagicBlock

MagicBlock is an acceleration substrate for Reactor's hot state, not a replacement canonical settlement layer.

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

The ER never receives authority to spend the canonical Vault.

**MagicBlock accelerates the high-frequency coordination path; Solana remains the canonical authority and settlement layer.**

## Evidence progression

| Milestone | Question | Result |
|---|---|---|
| M2 | Can Reactor freeze exact state and execute a bounded action? | **Yes — demonstrated locally + Solana devnet** |
| M3 | Can hot state live in MagicBlock and safely hand back to Solana? | **Yes — demonstrated end to end** |
| M4-Engine | Is there a local runtime latency signal? | **Yes — large controlled signal** |
| M4-Coordination | Does reactive ER capture beat ordinary reactive Solana? | **Yes in the tested local fixture** |
| M4 strongest baseline | Can aggressive Solana speculation reproduce capture reliability? | **Yes — 99% vs 99%** |
| M5a | Can exact capture move into the state transition itself on both runtimes? | **Yes — 10/10 both; large local ER latency signal** |
| M5b+ | Does the architecture remain useful under concurrency, end-to-end cost and real workloads? | **Open** |

---

## M2 — Exact executability lock

The Anchor program introduces:

- `Path` — standing authority, transfer limit and expiry;
- `Objective` — target postcondition and canonical condition set;
- `ConditionState` — independently authorized, monotonically versioned state;
- `Vault` — Reactor-owned lamports and controlled fixture exposure;
- `SessionCandidate` — exact-version hot-state handoff object;
- `ExecutionLock` — immutable accepted execution configuration;
- `Receipt` — verified before/after outcome evidence.

### Demonstrated Solana devnet fixture

```text
program                     75ph49gq12tUVV2XAfmDozseGfuu5ZTSZDPB8MPF8oax
stale exact sequence        rejected
false predicate             rejected
frozen sequences            [1,1,3,1,1,1]
later condition update      lock unchanged
vault debit                 100000 lamports
recipient credit            100000 lamports
exposure                    700 -> 500
Receipt                     verified=true
lock                         consumed=true
duplicate execution         rejected
```

See:

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

## M4 — Coordination benchmark

M4 compared three strategies under the same exact-version Reactor semantics:

```text
SR — Solana reactive
source update -> observer -> coordinator seal

MR — MagicBlock reactive
source update -> ER observer/coordinator -> seal

SS — Solana speculative
continuous unique exact-version attempts around the expected state
```

No benchmark transaction was allowed to combine source mutation with candidate sealing.

### Statistical configuration

```text
source-emission regimes:       10 ms, 50 ms, 150 ms
trials / regime / strategy:    100
randomized cycles:             300
strategy observations:        900
speculative cadence:           50 ms
window jitter:                 ±20%
random seed:                   4082026
false-lock requirement:        0
```

The configured millisecond regimes are **source-emission spacing**, not asserted authoritative on-ledger lifetimes.

### Final M4 result

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

### What M4 falsified

MagicBlock reactive and aggressive speculative Solana both reached **99%** exact capture.

Therefore Reactor does **not** claim:

> MagicBlock can capture a state that Solana fundamentally cannot.

The stronger M4 interpretation is:

> **Reactive low-latency coordination reproduced the same exact-capture reliability that the implemented base-layer strategy achieved through repeated speculation.**

That turns the next research question into **coordination efficiency under sustained load**, not capture possibility alone.

M4 currently measures transaction amplification and waste. It does **not** prove a 5× economic cost advantage.

---

## M5a — Transition-coupled execution

The earlier reactive architecture still depended on an off-runtime callback:

```text
source update
 -> WebSocket
 -> Node coordinator
 -> second transaction
 -> seal
```

M5a removed that coordinator round trip from the correctness path.

The final source-authenticated transition can now perform:

```text
update condition
+
evaluate current objective state
+
maybe seal exact candidate
```

through one Reactor instruction:

```text
update_condition_and_maybe_seal(...)
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

This matters because it proves the Reactor semantics are portable: **Solana can implement the same transition-coupled objective logic correctly.**

### Controlled local runtime signal

Measured `sendRawTransaction -> processed signature notification`:

| Metric | Local Solana | Local MagicBlock ER |
|---|---:|---:|
| mean | 386.274 ms | 29.369 ms |
| p50 | 396.801 ms | 29.294 ms |
| p95 | 404.456 ms | 33.536 ms |
| p99 | 406.952 ms | 34.169 ms |

This was roughly a **13× lower observed interval** on the local ER for this fixture.

That is a controlled local systems signal only. It is **not** a claim that MagicBlock is generically 13× faster than Solana.

See:

```text
M5_TRANSITION_COUPLED_RESULT.md
```

### Product consequence

The architecture is now better described as:

> **Reactor is a persistent objective/executability state machine. Solana can execute its semantics; MagicBlock is an acceleration layer for the high-frequency hot-state portion when the workload benefits enough to justify delegation and commit complexity.**

---

## Current research frontier

The next proof is no longer “can Reactor capture an exact state?”

That is demonstrated.

The important remaining questions are:

1. **Concurrency** — what happens with 10, 50, 100, 500 or 1000+ simultaneous objectives?
2. **Coordination work** — how many transactions / retries / failed attempts are required per successful objective?
3. **Economic cost** — fees, compute, bandwidth, state maintenance, delegation and commit cost per successful outcome.
4. **End-to-end completion** — candidate → commit → canonical lock → settlement → verified Receipt under load.
5. **Public infrastructure** — same-workload public comparison including the strongest fair Solana/Jito route.
6. **Real vertical** — replace synthetic conditions with an economically meaningful non-co-bundleable workload.
7. **Resource preservation** — prove Reactor can reserve or immediately consume the economically relevant resource, not merely prove that an executable configuration once existed.

The product thesis survives only if those tests show that persistent exact-state objectives justify a dedicated coordination layer.

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

### M5 transition-coupled local benchmark

See `M5_TRANSITION_COUPLED_RESULT.md` and the corresponding M5 bootstrap/runner scripts in `scripts/`.

Local tooling includes Rust/Cargo, Anchor, Solana CLI, Node.js/npm, `mb-test-validator` and `ephemeral-validator`.

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
- 300-cycle M4 statistical coordination benchmark;
- transition-coupled exact-state capture on both local runtimes.

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

## Repository map

```text
reactor/
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

## Current program

```text
Solana program
75ph49gq12tUVV2XAfmDozseGfuu5ZTSZDPB8MPF8oax
```
