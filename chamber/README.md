# Reactor Chamber v1 — Truth Slice

Reactor Chamber is the visual proof instrument for Reactor objective coordination. It is intentionally separated from the protocol fixture at the repository root: benchmark execution produces evidence; Chamber consumes evidence.

## Current milestone

This commit implements the first synchronized vertical slice:

- isolated React + TypeScript + Vite application;
- React Three Fiber / Three.js scene;
- M6 evidence adapter with an explicitly labelled development fallback;
- deterministic `deriveChamberState()` truth layer;
- C2 temporal trajectory and admissibility displacement;
- exact-state plane;
- frozen candidate fingerprint;
- live vs sealed sequence-vector divergence;
- timeline scrubbing and keyboard fast paths;
- progressive evidence aperture;
- reduced-motion-aware entry behavior;
- truth-layer tests.

The scene uses a semantic skeleton:

- **X** = source identity (the v1 slice renders C2; the six-source expansion is next),
- **Y** = admissibility deviation,
- **Z** = transition history.

The visualization is a projection of benchmark state, never the source of truth.

## Run

From `chamber/`:

```bash
npm install
npm test
npm run build
npm run dev
```

Before `dev` and `build`, `scripts/sync-evidence.mjs` copies `data/m6-essentiality-latest.json` to the served `public/data/` location when a local M6 result exists. If it does not exist, Chamber clearly identifies itself as `DEVELOPMENT FIXTURE` and never fabricates a benchmark verdict.

## Keyboard

- `←` / `→` — previous / next transition
- `Space` — play / pause
- `1`–`6` — select C0–C5 evidence
- `0` — return to C2

## Next expansion

Do not skip the truth slice validation. Once this slice builds and the real 120-transition M6 evidence renders correctly, expand to all six temporal axes, then implement the vertical conceptual stages: `OBSERVE → ALIGN → FREEZE → COMMIT → VERIFY`.
