# M5b — Concurrent Objective Runtime Smoke Result

## Status

**1-objective and corrected 10-objective local smoke gates passed on 2026-08-09.**

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

```text
objectives/path               1
burst spread                  20 ms
```

### Result

| Metric | Local Solana | Local MagicBlock ER |
|---|---:|---:|
| exact captures | 1 / 1 | 1 / 1 |
| false locks | 0 | 0 |
| immutable after close | 1 / 1 | 1 / 1 |
| coordination amplification | 1.0x | 1.0x |
| p50 submit -> processed | 622.429 ms | 73.705 ms |
| exact captures / second | 1.607 | 13.568 |

Semantic gate: **PASS**.

This run established the M5b harness and correctness path. `n=1` is not performance evidence by itself.

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

The corrected harness now:

```text
create all fixtures
finish all setup/delegation
fetch fresh phase blockhash
sign all opening transitions
run burst
verify candidates
fetch new fresh blockhash
sign all closing transitions
run close burst
verify immutability
```

It also records transaction preparation age, blockhash metadata and failure samples.

---

## Corrected 10-objective smoke

Fresh local validator/ER session after the transaction-freshness fix.

```text
objectives/path               10
episodes/path                 1
burst spread                  20 ms
primitive                     update_condition_and_maybe_seal
shared measured payer         false
fresh blockhash per phase     true
```

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

### Local capacity diagnostics

| Metric | Local Solana | Local MagicBlock ER |
|---|---:|---:|
| episode interval | 1146.399 ms | 458.285 ms |
| completion tail | 1098.649 ms | 405.645 ms |
| exact captures / second | 8.723 | 21.820 |
| compute units | 126,960 | 126,960 |
| observed fees | 100,000 lamports | 0 local-runtime lamports |
| estimated fees | 100,000 lamports | 0 local-runtime lamports |
| max opening prepared age | 409.778 ms | 402.428 ms |
| max closing prepared age | 451.399 ms | 624.944 ms |

The equal compute total is useful: the two treatments executed the same Reactor transition workload in this smoke.

The local ER zero-fee observation reflects this local validator configuration only. It is **not** a production MagicBlock pricing claim.

---

## Current interpretation

The corrected 10-objective run supports a stronger local systems signal than M5a's single-objective measurement:

> Both local runtimes preserved exact Reactor semantics at 10 concurrent objectives with one measured transition per successful capture, while the MagicBlock ER showed materially lower p50/p95/p99 submit-to-processed intervals and a shorter completion tail in this single local episode.

This is still smoke evidence.

It does **not** yet establish:

- a stable performance ratio;
- production or public-network superiority;
- sustained-load behavior;
- delegation + commit + settlement economics;
- realistic market workload economics;
- a production MagicBlock fee advantage.

The next falsification level is **50 concurrent objectives** in a fresh local session.

Promotion to 100 requires the 50-objective semantic gate to pass with trustworthy instrumentation.

---

## Next run

```bash
REACTOR_M5B_OBJECTIVE_COUNT=50 \
REACTOR_M5B_EPISODES=1 \
bash scripts/bootstrap_m5b_concurrent_objectives_local.sh
```

Watch transaction-preparation age as objective count rises. If phase preparation approaches recent-blockhash expiry, the harness must be changed again before treating misses as runtime evidence.
