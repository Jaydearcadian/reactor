# Reactor Chamber

Reactor Chamber is the evidence-driven visual proof instrument for Reactor objective coordination. Benchmark execution produces evidence; Chamber consumes it. Three.js is a projection of state, never the source of truth.

## Current milestone

Chamber now renders the complete M6 conceptual grammar:

- six independently authenticated temporal axes;
- **X = source identity**, **Y = admissibility deviation**, **Z = transition history**;
- exact-state admissibility plane;
- frozen six-point SessionCandidate fingerprint;
- live-vs-sealed sequence divergence after the immutability probe;
- MagicBlock hot-state field and explicit canonical Solana boundary;
- measured canonical-work comparison and frozen gate panel;
- horizontal transition scrubber;
- vertical conceptual navigation: `OBSERVE → ALIGN → FREEZE → COMMIT → VERIFY`;
- source isolation without losing surrounding context;
- keyboard navigation and reduced-motion behavior;
- development fallback that cannot masquerade as benchmark evidence.

The same persistent scene changes investigative depth rather than remounting between pages.

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

The archiver refuses any non-PASS result or any result containing a failed gate and writes immutable timestamped copies under the experiment and Chamber archive directories.

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

## Navigation

Horizontal axis = benchmark time:

- `←` / `→` — previous / next authenticated transition;
- timeline drag — scrub exact transition state;
- `Space` — play / pause.

Vertical axis = conceptual depth:

- mouse wheel outside the timeline/evidence aperture;
- `↑` / `↓` or `PageUp` / `PageDown`;
- direct stage buttons on desktop.

Source inspection:

- `1`–`6` — C0–C5;
- `0` — return to C2.

Deep links can combine both axes:

```text
/chamber?t=87&stage=align
/chamber?t=121&stage=freeze
/chamber?t=122&stage=verify
```

## Design invariant

Nothing in the scene is allowed to change benchmark truth. `deriveChamberState()` owns the selected state; DOM and Three.js render the same derived value. Conceptual stage changes camera, material and evidence emphasis, but never silently changes transition time.
