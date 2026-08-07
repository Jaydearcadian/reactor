# M4 — Measured Capture Benchmark

## Status

**Protocol frozen; implementation beginning. No performance claim exists yet.**

M3a demonstrated that Reactor can delegate six authenticated condition accounts plus a `SessionCandidate` into a MagicBlock Ephemeral Rollup, reject stale and false states, seal exact versions, commit-and-undelegate the candidate back to Solana, materialize the canonical `ExecutionLock`, settle exactly 100000 lamports, verify `700 -> 500`, and reject replay.

M4 asks the harder question:

> Does Reactor's warmed MagicBlock hot path materially improve capture of short-lived jointly executable condition windows compared with strong base-layer paths receiving the same authenticated event stream?

M4 is a falsification gate. A technically correct M3 is not enough.

## Non-negotiable benchmark rule

Do **not** time `bootstrap_m3_magicblock.sh` and call that Reactor latency.

Build, deployment, account creation, funding, delegation, router propagation and session warm-up are setup costs. M4 begins measurement only after the compared path is ready to receive the controlled event schedule.

The critical interval is:

```text
T0 final required source event emitted
 |
T1 event acknowledged by path transport
 |
T2 authoritative condition state observed
 |
T3 lock/candidate decision submitted
 |
T4 lock/candidate acknowledged
 |
T5 lock/candidate observed / sealed        <-- CAPTURE
 |
T6 candidate commit initiated              [Reactor only]
 |
T7 base commitment observed                [Reactor only]
 |
T8 canonical lock materialized             [M4b]
 |
T9 settlement observed                     [M4b]
 |
T10 objective postcondition verified       [M4b]
```

### Primary hot-path latency

```text
capture_latency_ms = T5 - T0
```

### Decision latency

```text
decision_latency_ms = T5 - T2
```

### End-to-end verified latency

M4b only:

```text
verified_latency_ms = T10 - T0
```

## Authority model

The six conditions are independently authorized streams. The lock coordinator does not get to forge or silently rewrite source events.

For the controlled fixture, test code holds all development keypairs, but the benchmark preserves the logical boundary:

- each source signs and publishes its own condition update;
- the coordinator submits lock/evaluation separately;
- the standard-Solana baseline may not combine the final independent source update and the lock into one pre-coordinated transaction;
- all paths receive the same logical event sequence and sequence numbers.

If a future production integration supports a stronger atomic source-update + action primitive, that becomes a new baseline and Reactor must beat or reframe against it.

## Controlled schedule

Each trial starts from a warmed non-executable state:

```text
condition 0   seq=1 true
condition 1   seq=1 true
condition 2   seq=1 false   <-- final blocker
condition 3   seq=1 true
condition 4   seq=1 true
condition 5   seq=1 true
```

At `T0`, source 2 publishes:

```text
condition 2   seq=2 true
```

The logical jointly executable window opens.

After the configured window duration, source 0 publishes:

```text
condition 0   seq=2 false
```

The logical window closes.

The exact executable version vector for that window is:

```text
[1,1,2,1,1,1]
```

A valid capture must freeze exactly that vector. A lock/candidate that incorporates the later invalidating version, an older version, or a false predicate is not a capture.

## Window bands

Controlled mechanism bands:

- 50 ms
- 100 ms
- 150 ms
- 250 ms
- 500 ms
- 1,000 ms

After mechanism signal exists, run larger randomized samples across:

- 50–100 ms
- 100–200 ms
- 200–400 ms
- 400–800 ms
- 800–1,500 ms

Synthetic windows test mechanism behavior. They do **not** establish that real markets frequently contain such windows.

## M4a — capture-only hot-path probe

Purpose: cheaply determine whether there is a measurable signal before paying for many fresh settlement fixtures.

Paths:

### A. Standard Solana devnet

- fresh warmed Reactor fixture on Solana devnet;
- six `ConditionState` accounts remain on base;
- source updates are submitted as separate authenticated transactions;
- `evaluate_and_lock` is the decision primitive;
- capture requires the exact expected version vector.

### B. Reactor + MagicBlock devnet ER

- fresh warmed Reactor fixture on the same Solana devnet;
- six conditions plus `SessionCandidate` are delegated before measurement;
- router-selected ER is discovered and verified before measurement;
- source updates execute in ER;
- `evaluate_session_candidate` is the decision primitive;
- capture requires the exact expected vector and immutable sealed candidate.

M4a does not count a product win. It only measures capture mechanics.

## M4b — verified end-to-end benchmark

Run representative bands selected from M4a with full economic verification.

A trial counts as a successful Reactor objective only if:

1. the valuable window was generated;
2. the exact valid configuration was captured;
3. candidate commit is observed on Solana;
4. candidate is undelegated back to Reactor ownership;
5. `materialize_lock` succeeds without adapting the sealed baseline;
6. `execute_locked` settles the exact bounded action;
7. objective postcondition is independently verified;
8. Receipt is `verified=true`;
9. no duplicate effect occurs.

Standard Solana trials must meet the equivalent final Objective/Receipt criteria.

### Primary metric

```text
Verified valid-window capture rate
= verified objectives attributable to valuable windows
  / valuable windows generated
```

## M4c — Jito strong baseline

Jito's documented Block Engine provides mainnet and testnet endpoints, not Solana devnet. Therefore Jito must not be represented as a same-cluster devnet baseline.

M4c requires a Reactor deployment on Solana testnet and a separately funded testnet fixture.

The Jito adapter must:

- use the documented low-latency transaction path;
- record transport acknowledgement separately from landing;
- never count bundle/transaction acceptance as objective success;
- record Jito tip and priority-fee configuration;
- verify landing through Solana/Jito status evidence;
- verify the same Reactor Objective postcondition.

Until testnet parity exists, Jito results are **contextual**, not directly merged into the M4a same-cluster capture table.

## Raw trial record

Every trial must retain at least:

```json
{
  "scenarioId": "...",
  "seed": "...",
  "path": "solana|magicblock|jito",
  "cluster": "...",
  "windowMs": 150,
  "expectedSequences": [1,1,2,1,1,1],
  "marks": {},
  "signatures": {},
  "capture": true,
  "exactVersionMatch": true,
  "falseLock": false,
  "staleAttempt": false,
  "duplicateEffect": false,
  "ambiguous": false,
  "verifiedObjective": false,
  "config": {}
}
```

Use a monotonic process clock for latency deltas and UTC wall time only for correlation/audit.

## Safety metrics

Non-negotiable:

```text
false-lock rate             = 0
false verified outcomes     = 0
duplicate economic effects  = 0
```

Also report:

- stale attempt rate;
- ambiguous outcome rate;
- failed transaction rate;
- candidate materialization rejection rate;
- commit/undelegate failure rate.

## Frozen continuation threshold

Before measured results exist, Reactor's continuation threshold is frozen as follows:

1. **zero false locks and zero false verified outcomes**;
2. at least **20 percentage points absolute verified capture-rate improvement** over the strongest same-cluster implemented baseline in **two adjacent short-window bands**; and
3. the 95% confidence interval for that improvement must exclude zero after the sample is large enough for interval reporting; and
4. the advantage must remain when setup/delegation time is excluded equally and only the warmed hot path is measured; and
5. any economic benefit must plausibly exceed added infrastructure, commitment and reservation costs before a production claim is made.

If M4a shows no meaningful hot-path signal, do not spend effort manufacturing a favorable M4b result.

## Kill / reframe conditions

Reactor should be narrowed or reframed if:

- standard Solana captures essentially all controlled valuable windows;
- the measured advantage exists only because the baseline is intentionally weakened;
- capture advantage disappears once source-event authority is modeled fairly;
- false locks appear;
- candidate sealing is fast but base revalidation rejects most candidates;
- commit latency makes captured configurations economically useless;
- a strong Jito/testnet baseline erases the advantage;
- real representative traces do not contain economically meaningful windows in the measured range.

## Evidence labels

M3a is **demonstrated integration correctness**.

M4a results are **measured capture mechanics**.

M4b results may become **measured verified execution evidence**.

M4c is a **strong optimized baseline** only after same-workload testnet parity is established.

No synthetic or devnet benchmark establishes production market prevalence or production profitability.
