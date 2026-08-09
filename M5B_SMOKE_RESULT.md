# M5b — Concurrent Objective Runtime Smoke Result

## Status

**1-objective, corrected 10-objective, and corrected 50-objective local smoke gates passed on 2026-08-09.**

M5b tests Reactor's transition-coupled primitive under concurrent active objectives using the same instruction on local Solana and a local MagicBlock Ephemeral Rollup:

```text
authenticated condition transition
        +
current objective evaluation
        +
maybe seal exact SessionCandidate
```

The correctness path contains no WebSocket callback and no second seal transaction.

This document records smoke evidence only. It is not yet the publication-quality statistical M5b benchmark.

---

## Correctness invariant

Each objective starts with:

```text
C0 seq1 true
C1 seq1 true
C2 seq1 false
C3 seq1 true
C4 seq1 true
C5 seq1 true
```

The measured opening transition advances:

```text
C2: seq1 false -> seq2 true
```

A valid capture must produce:

```text
ready = true
frozen_sequences = [1,1,2,1,1,1]
```

A later C0 transition to `seq2 false` must not mutate the already-sealed candidate.

The smoke gate requires:

```text
zero false locks
full exact capture
all candidates immutable after close
zero measured opening failures
zero measured closing failures
```

---

## 1-objective smoke

Fresh local Solana + MagicBlock validator session.

| Metric | Local Solana | Local MagicBlock ER |
|---|---:|---:|
| exact captures | 1 / 1 | 1 / 1 |
| false locks | 0 | 0 |
| immutable after close | 1 / 1 | 1 / 1 |
| coordination amplification | 1.0x | 1.0x |
| p50 submit -> processed | 622.429 ms | 73.705 ms |
| exact captures / second | 1.607 | 13.568 |

Semantic gate: **PASS**.

`n=1` establishes harness correctness, not a performance conclusion.

---

## First 10-objective attempt — invalid performance evidence

The first 10-objective run produced:

```text
Solana       9 / 10 exact
MagicBlock   2 / 10 exact
false locks  0 both
```

Inspection showed a harness flaw: measured opening and closing transactions were signed inside `createFixture()` before the remaining fixtures had completed setup.

For MagicBlock, each later objective required candidate + six condition delegations before the burst started. Early pre-signed transactions therefore aged while setup continued and could reach submission with stale/expired recent blockhashes.

This contaminated both treatments and disproportionately affected the longer MagicBlock setup path.

The result is retained as a benchmark-design failure and must **not** be cited as a MagicBlock concurrency result.

Fix commit:

```text
af4b82f7be8d3f1df31ca085e3a484aa904523db
fix: refresh M5b transaction blockhashes after fixture setup
```

The corrected harness signs measured transactions only after all setup has completed and refreshes the blockhash again before the post-seal immutability phase.

---

## Corrected 10-objective smoke

Fresh local validator/ER session after the transaction-freshness fix.

### Correctness

| Metric | Local Solana | Local MagicBlock ER |
|---|---:|---:|
| exact captures | **10 / 10** | **10 / 10** |
| capture rate | 100% | 100% |
| false locks | **0** | **0** |
| immutable after close | **10 / 10** | **10 / 10** |
| opening failures | **0** | **0** |
| closing failures | **0** | **0** |
| coordination amplification | **1.0x** | **1.0x** |

Semantic gate: **PASS**.

### Local hot-path timing

| Metric | Local Solana | Local MagicBlock ER |
|---|---:|---:|
| min | 121.102 ms | 91.141 ms |
| mean | 832.127 ms | 244.085 ms |
| p50 | 987.508 ms | 254.599 ms |
| p95 | 1062.355 ms | 375.801 ms |
| p99 | 1091.390 ms | 408.885 ms |
| max | 1098.649 ms | 417.156 ms |
| completion tail | 1098.649 ms | 405.645 ms |
| exact captures / second | 8.723 | 21.820 |
| compute units | 126,960 | 126,960 |

At 10 objectives, the local ER had lower observed latency and a shorter completion tail while preserving identical Reactor semantics.

This is a single local episode, not a stable runtime ratio.

---

## First 50-objective attempt — invalid performance evidence

The first 50-objective run produced partial MagicBlock capture with repeated custom program error `0x1776` while Solana completed the workload.

`0x1776` maps to Anchor error 6006, `ExpiredCondition`.

The M5b fixture was still using:

```text
TTL_SLOTS = 20,000
```

The local ER runs with a much faster slot clock than the local Solana validator. Serial setup/delegation of 50 objective fixtures therefore allowed early ER conditions to expire before the measured burst.

M5b is a concurrency/load gate, not an expiry-window experiment, so this result is retained as another harness-validity failure and must **not** be cited as a runtime-capacity result.

Fix commit:

```text
3200cf3ebc3b19b706879ec463728d38bc0a38da
fix: keep M5b condition validity non-binding during load setup
```

The corrected M5b bootstrap defaults to:

```text
REACTOR_M5B_TTL_SLOTS=5000000
```

so condition expiry is deliberately non-binding during long fixture setup.

---

## Corrected 50-objective smoke

Fresh local validator/ER session with non-binding condition validity.

```text
objectives/path               50
episodes/path                 1
burst spread                  20 ms
primitive                     update_condition_and_maybe_seal
condition TTL                 5,000,000 slots
shared measured payer         false
fresh blockhash per phase     true
```

### Correctness

| Metric | Local Solana | Local MagicBlock ER |
|---|---:|---:|
| exact captures | **50 / 50** | **50 / 50** |
| capture rate | **100%** | **100%** |
| false locks | **0** | **0** |
| immutable after close | **50 / 50** | **50 / 50** |
| opening failures | **0** | **0** |
| closing failures | **0** | **0** |
| coordination amplification | **1.0x** | **1.0x** |

Semantic gate: **PASS**.

### Local hot-path timing

| Metric | Local Solana | Local MagicBlock ER |
|---|---:|---:|
| min | 434.064 ms | 300.525 ms |
| mean | 597.673 ms | 968.496 ms |
| p50 | 595.147 ms | 1080.363 ms |
| p95 | 768.322 ms | 1301.019 ms |
| p99 | 794.392 ms | 1343.782 ms |
| max | 797.353 ms | 1350.319 ms |

### Local capacity diagnostics

| Metric | Local Solana | Local MagicBlock ER |
|---|---:|---:|
| episode interval | 813.304 ms | 1652.684 ms |
| completion tail | 655.961 ms | 1348.596 ms |
| exact captures / second | 61.478 | 30.254 |
| compute units | 634,800 | 634,800 |
| observed fees | 500,000 lamports | 0 local-runtime lamports |
| estimated fees | 500,000 lamports | 0 local-runtime lamports |
| max opening prepared age | 2543.545 ms | 2032.621 ms |
| max closing prepared age | 2771.341 ms | 1819.938 ms |

The equal compute total again confirms that both treatments executed the same Reactor transition workload.

The local ER zero-fee observation reflects this validator configuration only and is **not** a production pricing claim.

### What the 50-objective result falsified

The simple scaling hypothesis did **not** survive this smoke.

At 10 objectives, the local ER showed lower submit-to-processed latency and higher measured exact-capture throughput.

At 50 objectives, both runtimes remained semantically perfect, but the local Solana validator completed the measured workload faster:

```text
10 objectives
MagicBlock ER   lower p95 / shorter tail / higher captures-per-second

50 objectives
Solana          lower p95 / shorter tail / higher captures-per-second
```

In the corrected 50-objective episode, local Solana produced roughly **2.03× the measured exact captures per second** of the local ER and roughly **half the completion tail**.

Therefore Reactor does **not** claim:

> MagicBlock's local performance advantage automatically increases with objective concurrency.

The result instead opens a more useful systems question:

> **Where is the workload crossover, what creates it, and which runtime/delegation topology makes an ER advantageous for persistent objective coordination?**

Potential explanations such as local scheduler configuration, RPC submission behavior, executor count, account scheduling, delegation topology or harness/client bottlenecks remain hypotheses until isolated experimentally.

---

## Current interpretation

M5b has now demonstrated something stronger than a one-sided benchmark win:

1. Reactor's transition-coupled semantics remained exact at both 10 and 50 concurrent objectives on both tested runtimes.
2. Zero false locks and full post-seal immutability survived both corrected concurrency levels.
3. The performance ranking changed between 10 and 50 objectives in the current local configuration.
4. The naive thesis that the ER should simply scale better with more objectives is therefore falsified.

This strengthens the case for treating Reactor as an open systems research program rather than optimizing the benchmark around a predetermined MagicBlock result.

It does **not** establish:

- a production crossover point;
- public-network Solana or MagicBlock superiority;
- sustained-load behavior across many repeated episodes;
- delegation + commit + materialization + settlement economics;
- realistic market workload economics;
- a production MagicBlock fee advantage.

Given the submission deadline, the next engineering priority is **not another larger smoke number**. The next research work after the submission should isolate the crossover with repeated runs and intermediate objective counts, then move to verified completion under load.

---

## Reproduce

```bash
REACTOR_M5B_OBJECTIVE_COUNT=50 \
REACTOR_M5B_EPISODES=1 \
bash scripts/bootstrap_m5b_concurrent_objectives_local.sh
```

Evidence path:

```text
experiment/results/m5b-concurrent-objectives-50-latest.json
```
