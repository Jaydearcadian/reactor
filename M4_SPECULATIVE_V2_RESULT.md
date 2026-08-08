# M4 Speculative Baseline V2 — Result

## Status

**Demonstrated falsification of the raw capture-impossibility thesis.**

The corrected V2 baseline removed duplicate signatures and shared hot fee-payer locks by giving every speculative coordinator attempt a unique funded payer and using the independent source keys as the open/close transaction fee payers.

The run completed with every reported trial instrumentation-valid and zero false locks.

## Capture outcome

| External source-emission spacing | Solana speculative capture | MagicBlock speculative capture |
|---:|---:|---:|
| 10 ms | 2/2 | 0/2 |
| 20 ms | 2/2 | 0/2 |
| 50 ms | 2/2 | 2/2 |
| 100 ms | 2/2 | 2/2 |
| 150 ms | 2/2 | 2/2 |
| 250 ms | 2/2 | 2/2 |

Solana therefore captured