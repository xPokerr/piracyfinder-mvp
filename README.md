# PiracyFinder MVP — Open Source Metasearch

Live federated search across three public, legitimate open-source indexes: GitHub repositories, npm packages, and crates.io crates. Static Vite frontend, Cloudflare Worker backend streaming results over SSE. No file downloads, no piracy-specific sources, no CAPTCHA bypassing.

## Architecture

- `web/` — static Vite + TypeScript frontend (`index.html`, `src/main.ts`, `src/search.ts`, `src/styles.css`)
- `worker/src/` — Cloudflare Worker: `index.ts` routes, `search.ts` orchestration, `sources/` one adapter per source + registry
- `shared/types.ts` — shared contract (SearchResult, SourceStatus, SSE events)

## Required env

- `FRONTEND_ORIGIN` (worker): exact origin allowed for CORS, e.g. `https://<user>.github.io`. Localhost origins are accepted automatically in dev.
- `VITE_API_BASE` (Pages build): worker base URL, e.g. `https://<worker>.workers.dev` (a trailing slash is accepted and stripped). Set it as a repository variable: Settings → Variables → Actions → New repository variable named `VITE_API_BASE`. The Pages workflow fails with a clear error if it is missing, and runs `npm test -- --run`, `npm run typecheck`, then `npm run build` before publishing to Pages.

Local dev: leave `VITE_API_BASE` unset and the frontend uses same-origin (`/api/...`, e.g. via `wrangler dev` proxy or same host); set `VITE_API_BASE` to the worker URL only when the local frontend must call a remote worker. Production (GitHub Pages) always requires the repository variable — same-origin is not available there because frontend and worker are on different hosts.

## Develop

```bash
npm install
npm run dev        # frontend on localhost, set VITE_API_BASE to worker URL
npm test
npm run typecheck
npm run build
```

Worker (requires `wrangler`):

```bash
npx wrangler dev --cwd worker
npx wrangler deploy --cwd worker
```

Set the var on deploy: `npx wrangler deploy --cwd worker --var FRONTEND_ORIGIN:https://<user>.github.io`.

## API

- `GET /api/sources` → `[{ id, label, description }]`
- `POST /api/search` body `{ "query": "2-150 chars" }` → `text/event-stream` with `status`, `result`, `done`, `error` events.

## Limits

Per-source timeout 6s, total budget 8s, max 20 results/source, 60 total. Query never logged. Result URLs must be https and pass a per-source host allowlist (crates.io allows any https homepage, required since crate homepages live anywhere).
