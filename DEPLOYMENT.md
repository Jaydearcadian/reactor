# Reactor Chamber — Deployment

## Recommended host: Cloudflare Workers static assets

Reactor Chamber is a static React + Vite application under `chamber/`. The repository deploys it through Wrangler, but **only after Vite has produced `chamber/dist/`**.

The production asset boundary is:

```text
source              chamber/
compiled output     chamber/dist/
Cloudflare assets   chamber/dist/
```

Never configure Wrangler to publish `chamber/` directly. That serves TypeScript/Vite source files and produces a blank production page.

## Repository-authoritative deployment

The root repository owns deployment:

```bash
npm run deploy
```

That command performs:

```text
npm run build:chamber
  -> npm --prefix chamber install
  -> npm --prefix chamber run build
  -> tsc -b
  -> vite build
  -> chamber/dist/

npx wrangler deploy
  -> uploads chamber/dist/ only
```

`wrangler.jsonc` is committed and defines:

```jsonc
{
  "name": "reactor",
  "assets": {
    "directory": "chamber/dist",
    "not_found_handling": "single-page-application"
  }
}
```

## Cloudflare Git build settings

For a Git-connected Workers build use:

```text
Repository        Jaydearcadian/reactor
Production branch main
Root directory    /
Deploy command    npm run deploy
Node              20.20.2 or newer compatible Node 20+
```

Do not set the output directory to `chamber`. The committed Wrangler configuration is authoritative and publishes `chamber/dist`.

## Evidence requirement before production deploy

A production submission build must include immutable M6 evidence under:

```text
chamber/data/archive/m6-essentiality-*.json
```

`chamber/scripts/sync-evidence.mjs` resolves evidence in this order:

1. `chamber/data/m6-essentiality-latest.json` when available locally;
2. newest immutable `chamber/data/archive/m6-essentiality-*.json`;
3. development fixture only if neither exists.

The production submission must display:

```text
LOCAL BENCHMARK EVIDENCE
```

and must **not** display:

```text
DEVELOPMENT FIXTURE
```

## Pre-deploy acceptance gate

From the repository root:

```bash
npm run build:chamber
```

Or from `chamber/` directly:

```bash
npm install
npm test
npm run build
```

Then verify `chamber/dist/index.html` exists and references generated `/assets/...` bundles rather than `/src/main.tsx`.

The deployed application must:

- load M6 benchmark evidence rather than the development fixture;
- show 121 authenticated hot transitions;
- show Solana `123` canonical coordination transactions;
- show MagicBlock `10` canonical coordination transactions;
- show `91.87%` canonical-work reduction;
- resolve evidence links to public GitHub paths;
- keep the interactive M6 scrubber functional;
- keep source selectors C0–C5 functional;
- keep OBSERVE / ALIGN / FREEZE / COMMIT / VERIFY functional;
- remain readable on mobile;
- have no uncaught browser runtime errors.

## Submission URL

The current Worker name is `reactor`; after a successful production deployment the `workers.dev` URL is suitable for submission. A custom domain can be added later without changing the application build.
