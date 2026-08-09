# Reactor Chamber — Deployment

## Recommended host: Cloudflare Pages

Reactor Chamber is a static React + Vite application under `chamber/`, so deploy it as a Git-connected Cloudflare Pages project.

### Project settings

```text
Repository        Jaydearcadian/reactor
Production branch main
Root directory    chamber
Framework preset  React (Vite)
Build command     npm run build
Build output      dist
Node              20.20.2
```

No server-side runtime or environment secrets are required by the current Chamber application.

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

From `chamber/`:

```bash
npm install
npm test
npm run build
```

Then verify the built/deployed application:

- loads M6 benchmark evidence rather than the development fixture;
- shows 121 authenticated hot transitions;
- shows Solana `123` canonical coordination transactions;
- shows MagicBlock `10` canonical coordination transactions;
- shows `91.87%` canonical-work reduction;
- all evidence links resolve to public GitHub paths;
- interactive M6 scrubber works;
- source selectors C0–C5 work;
- OBSERVE / ALIGN / FREEZE / COMMIT / VERIFY controls work;
- mobile layout remains readable;
- browser console has no uncaught runtime errors.

## Cloudflare Pages setup

In Cloudflare:

1. Workers & Pages → Create application → Pages.
2. Import `Jaydearcadian/reactor` from GitHub.
3. Set production branch to `main`.
4. Set Root directory to `chamber`.
5. Use React (Vite), or set build command `npm run build` manually.
6. Set build output directory to `dist`.
7. Deploy.

Cloudflare Pages will provide a `*.pages.dev` production URL and Git-linked preview deployments for pull requests.

## Submission URL

Use the production `*.pages.dev` URL for the hackathon submission unless a custom Reactor domain is already available and can be configured without delaying submission.
