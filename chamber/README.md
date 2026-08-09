# Reactor Chamber

Reactor Chamber is Reactor's interactive experimental record. It explains the research question, the experiment lineage, the assumptions that were falsified, the evidence that survived, and the operating region the system has actually demonstrated.

Benchmark execution produces evidence; Chamber consumes it. Three.js is only an experiment reconstruction and is never the source of truth.

## Information architecture

The application is organized as a research observatory rather than a cinematic product demo:

```text
OVERVIEW
  what Reactor is
  current research question
  current measured result

EXPERIMENTS
  M3 lifecycle correctness
  M4 capture-superiority falsification
  M5a transition-coupled sealing
  M5b concurrency-scaling falsification
  M6 coordination-density PASS
  M7 keeper-equivalence next gate

M6 INTERACTIVE
  contained six-axis reconstruction
  transition scrubber
  source inspection
  OBSERVE / ALIGN / FREEZE / COMMIT / VERIFY
  measured result table
  supported claim and explicit non-claims

METHOD
  frozen gates
  invalid harness runs
  same-semantics comparisons
  bounded claims

EVIDENCE
  protocol / result / JSON / runner / next null baseline
  gate-by-gate status
```

Every experiment record follows the same descriptive grammar:

```text
QUESTION
HYPOTHESIS
FIXTURE
OBSERVATION
RESULT
WHAT CHANGED NEXT
```

The experiment lineage is intentionally allowed to show falsifications. M4 removed the claim that MagicBlock can capture a state Solana fundamentally cannot. The corrected M5b 50-objective smoke falsified the naive claim that more horizontal objective concurrency automatically increases the ER performance advantage. M6 changed the scaling dimension to temporal coordination density and passed its precommitted gate.

## M6 reconstruction

The M6 visualization remains evidence-driven and uses the semantic spatial skeleton:

- **X = source identity**;
- **Y = admissibility deviation**;
- **Z = transition history**.

It renders:

- six independently authenticated temporal axes;
- exact-state admissibility plane;
- frozen six-point SessionCandidate fingerprint;
- live-vs-sealed sequence divergence after the immutability probe;
- MagicBlock hot-state field and canonical Solana boundary;
- canonical artifacts at verification depth.

The visualization is now contained inside the M6 experiment section instead of owning the full viewport.

## Evidence

The benchmark writes:

```text
../experiment/results/m6-essentiality-latest.json
data/m6-essentiality-latest.json
```

Before `dev` and `build`, `scripts/sync-evidence.mjs` copies the Chamber evidence into `public/data/`.

If the file is missing or invalid, Chamber displays `DEVELOPMENT FIXTURE`; it does not invent a PASS result.

After a passing frozen run, archive the exact generated JSON from the repository root:

```bash
node scripts/archive_m6_pass.mjs
```

The archiver refuses any non-PASS result or result containing a failed gate.

## Run

From `chamber/`:

```bash
npm install
npm test
npm run build
npm run dev
```

Default dev address:

```text
http://127.0.0.1:4173
```

## Truth invariant

`deriveChamberState()` owns selected benchmark state. DOM and Three.js render the same derived value. M6 stage controls may change camera/material/evidence emphasis, but they never silently change transition time.
