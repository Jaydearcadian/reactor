# M2.5 — Solana Devnet Acceptance

M2 local-validator execution is complete. This gate repeats the same Reactor lifecycle on Solana devnet without changing the primitive.

## What must remain identical

- one `Path`;
- one bounded `Objective`;
- six independently authorized `ConditionState` accounts;
- stale exact-version lock rejection;
- false-predicate lock rejection;
- one immutable exact-version `ExecutionLock`;
- a later condition update that cannot mutate the accepted lock;
- 100,000 lamports transferred from the Reactor `Vault` to the frozen recipient;
- controlled exposure reduced from 700 to 500;
- a verified `Receipt`;
- one consumed lock;
- duplicate execution rejection.

Devnet does not prove MagicBlock advantage, market demand, production DEX compatibility, or production security.

## Run

From the repository root:

```bash
bash scripts/bootstrap_m2_devnet.sh
```

The script:

1. builds the Anchor program;
2. syncs `declare_id!` with the persistent local deploy keypair;
3. rebuilds;
4. checks the payer's Solana devnet balance and attempts faucet funding if necessary;
5. deploys or upgrades the Reactor program on Solana devnet;
6. verifies the deployed program account;
7. creates a fresh funded test authority so persistent devnet PDAs do not collide across runs;
8. runs the same adversarial M2 proof;
9. writes `experiment/results/m2-devnet-latest.json` only after all proof assertions pass.

## Environment overrides

```bash
export SOLANA_DEVNET_RPC_URL="https://api.devnet.solana.com"
export ANCHOR_WALLET="$HOME/.config/solana/id.json"
export REACTOR_DEVNET_MIN_BALANCE_SOL="3"
export REACTOR_RPC_PACE_MS="400"
```

A private RPC endpoint may be supplied through `SOLANA_DEVNET_RPC_URL` without changing the proof semantics.

## Evidence required for a pass

The terminal output and JSON artifact must include:

```text
expected failure: stale exact sequence
expected failure: false predicate
settlement signature: <public devnet signature>
vault debit: 100000 lamports
recipient credit: 100000 lamports
expected failure: duplicate execution
M2 devnet proof passed
```

And the result JSON must show:

```json
{
  "staleSequenceRejected": true,
  "falsePredicateRejected": true,
  "laterConditionUpdateIgnoredByFrozenLock": true,
  "vaultDebitLamports": 100000,
  "recipientDeltaLamports": 100000,
  "valueConserved": true,
  "exposureBefore": 700,
  "exposureAfter": 500,
  "receiptVerified": true,
  "lockConsumed": true,
  "duplicateExecutionRejected": true
}
```

## Promotion rule

Do not call M2 devnet demonstrated until the public-cluster run passes and its transaction evidence is captured.

Once it passes, freeze the M2 settlement primitive and move the hot coordination path into MagicBlock ER.
