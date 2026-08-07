# Reactor Live Setup

This document defines the minimum environment required to move the Reactor benchmark from X1/X2 scaffolding to X3 measured network evidence.

## Standard Solana path

The current live settlement fixture is intentionally minimal: a signed native SOL transfer whose postcondition is independently verified from the recipient balance.

Required environment variables:

```bash
export SOLANA_RPC_URL="https://api.devnet.solana.com"
export SOLANA_SECRET_KEY='[64 comma-separated key bytes]'
export REACTOR_RECIPIENT="<recipient public key>"
export REACTOR_LAMPORTS="1000"
```

Run:

```bash
npm install
npm run fixture:solana
```

A successful run must report:

- a transaction signature;
- exact requested lamports;
- exact observed recipient-balance delta;
- `verified: true` only when the postcondition is met;
- submit-to-ack, ack-to-observed, observed-to-verified, and submit-to-verified timings.

No private key must be committed to this repository.

## Why this fixture is small

The first live proof should establish the measurement discipline before adding Reactor-specific economics. A native transfer gives us one shared signed action with a simple independent postcondition. Once the timing/evidence pipeline is stable, the transfer is replaced by the Reactor hedge settlement fixture while keeping the same evidence states.

## MagicBlock integration target

The MagicBlock path must move the condition-evaluation and executability-lock phase into a delegated Ephemeral Rollup Session. The base-layer action should occur only after the ER commit path permits it, and it must still be measured through observation and postcondition verification. An ER commit or Magic Action submission is not itself a verified objective.

## Jito comparability constraint

Do not report a three-way devnet latency table unless all paths are truly measured on a comparable cluster and workload.

The public MagicBlock development path is documented around Solana devnet. Jito Block Engine exposes mainnet/testnet infrastructure rather than a matching public devnet path. Therefore:

- standard Solana devnet vs MagicBlock devnet can form the first same-cluster comparison;
- Jito should be measured separately on a supported cluster until an equivalent MagicBlock environment exists;
- cross-cluster results may be exploratory but must not be interpreted as causal path superiority.

## X3 evidence gate

A path may enter the X3 result table only when it records all of:

1. identical logical scenario identifier and condition versions;
2. decision or lock timestamp;
3. signed transaction bytes or reproducible transaction construction parameters;
4. submission timestamp;
5. acknowledgement timestamp;
6. onchain observation and status;
7. independently checked postcondition;
8. final evidence state;
9. fees/tips and errors where applicable.

The primary metric remains verified valid-window capture rate. False-lock rate must remain zero.
