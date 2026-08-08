# M4-Coordination Smoke Result — 2026-08-07

## Status

**Demonstrated smoke signal; frozen continuation gate NOT evaluated.**

This run tested the same externally scheduled source-update pattern on local Solana and a local MagicBlock Ephemeral Rollup with structurally separated source writers and Reactor coordinator behavior. No source-update transaction contained the Reactor seal instruction.

Configured source-emission spacing:

```text
10, 20, 50, 100, 150, 250, 500 ms
```

Two trials were run per configured delay per path.

## Ledger-grounded outcome

| Source-emission spacing | Solana exact capture | MagicBlock exact capture |
|---:|---:|---:|
| 10 ms | 0/2 | 2/2 |
| 20 ms | 0/2 | 2/2 |
| 50 ms | 0/2 | 2/2 |
| 100 ms | 0/2 | 2/2 |
| 150 ms | 0/2 | 2/2 |
| 250 ms | 2/2 | 2/2 |
| 500 ms | 2/2 | 2/2 |

Across every trial:

```text
false locks = 0
ambiguous trials = 0
```

Every Solana miss from 10 through 150 ms was a clean exact-version rejection with Reactor error `6014 SequenceMismatch`.

Every MagicBlock success froze the exact expected vector:

```text
[1,1,2,1,1,1]
```

## What this smoke run demonstrates

For the tested external source-emission schedules, the warmed local ER path ingested the independently submitted source changes and sealed the exact jointly executable state in every 10-500 ms trial, while the observer-driven local Solana coordinator did not seal the expected state at 10-150 ms and began succeeding at 250 ms.

This is the strongest product-facing signal produced so far, but it is still a smoke result.

## Critical timing caveat

The configured band is **not a guaranteed authoritative on-ledger state lifetime**.

It is:

```text
open-source emission at T0
        ->
independent close-source emission at T0 + configured delay
```

Transaction processing can alter or even reverse the order in which those writes become observable on a runtime.

The analyzer's processed-callback approximation exposed this clearly. For Solana, some 50, 100 and 150 ms trials produced negative:

```text
close_processed_callback - open_processed_callback
```

values. Therefore processed callback timestamps cannot be treated as a canonical total ordering of ledger execution, and those trials must not be described as literal 50/100/150 ms authoritative Solana windows.

The exact candidate / `6014` outcomes remain useful because they are execution results, while millisecond processed-window estimates remain observer-side diagnostics.

## Better interpretation

This smoke is best classified as an **external event ingestion + coordination race**:

> Given the same independently emitted source-event schedule, can the runtime ingest those events and allow the Reactor coordinator to freeze the exact expected configuration before the later source event supersedes it?

Under that definition, the smoke strongly favors the ER treatment in the 10-150 ms source-emission bands.

It does not yet prove an equal authoritative state window existed on both runtimes.

## Why the frozen gate remains closed

The continuation gate is intentionally not evaluated because:

1. only two trials were run per configured delay;
2. configured delay is source-emission spacing, not guaranteed authoritative state lifetime;
3. the strongest honest Solana coordinator baseline has not yet been implemented.

## Next adversarial baseline

Before scaling sample size, implement a **speculative Solana coordinator**.

Instead of waiting for the opening account-change notification, the baseline may continuously submit unique prebuilt exact-version `evaluate_session_candidate([1,1,2,1,1,1])` attempts at a bounded cadence while the objective is active.

This gives ordinary Solana a much stronger chance to capture the expected version vector without relying on observer reaction latency.

Requirements:

- source writers remain structurally separate;
- no transaction combines source mutation + Reactor seal;
- every speculative attempt targets the exact expected vector;
- attempts are uniquely signed so duplicate-signature suppression does not invalidate the baseline;
- submission count and transaction cost are recorded;
- exact candidate state remains the capture ground truth;
- false-lock rate must remain zero;
- speculative strategy cost is reported as part of the tradeoff.

Only after the speculative baseline is measured should the benchmark choose crossover bands for >=50-trial statistical testing.
