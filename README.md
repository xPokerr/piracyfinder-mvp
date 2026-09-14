# PiracyFinder — r/Piracy Megathread Software Search

Live federated search across the software sites listed in the **“Direct downloads”** section of the [r/Piracy software megathread](https://www.reddit.com/r/Piracy/wiki/megathread/software/). Static Vite frontend, Cloudflare Worker backend streaming results over SSE.

PiracyFinder is link-only metasearch: every query is forwarded to each site’s own public search page, the results page is parsed and titles/links are relayed. Nothing is hosted, mirrored or cached here.

## Sources

The worker fans a query out to every site below in parallel:

| Source | Site | Search page |
| --- | --- | --- |
| CRACKSurl | cracksurl.com | `/?s=` |
| AEdownload | aedownload.com | `/?s=` |
| AppDoze | appdoze.net | `/?s=` |
| Download Pirate | www.downloadpirate.com | `/?s=` |
| Gift4Designer | gift4designer.net | `/search?q=` |
| HunterAE | hunterae.com | `/?s=` |
| INTRO HD | intro-hd.net | `/?s=` |
| MATESFX | freevideoeffect.com (ex matesfx.com) | `/?s=` |
| Motka | motka.net | `/?s=` |
| PLC4Me | plctop.com (ex plc4me.com) | `/?s=` |
| Softlay | www.softlay.com | `/?s=` |
| VFXMed | www.vfxmed.com | `/?s=` |

Megathread sites intentionally **not** wired up (they cannot be searched server-side):

- **LRepacks** / **DIAKOV** — their DataLife Engine search ignores the query server-side and always renders the same default posts; relaying that would be misleading.
- **soft98** / **YASIR252** — anti-bot interstitials (reCAPTCHA / Cloudflare challenge).
- **Vfxloot** — client-side rendered SPA, no server-rendered results.
- **SCloud** — signup-only, no public search page.

Note: these are third-party sites; availability and anti-bot behavior can change at any time. A failing source is reported as an `error`/`timeout` status in the UI while the other sources keep streaming.

## Architecture

- `web/` — static Vite + TypeScript frontend (`index.html`, `src/main.ts`, `src/search.ts`, `src/styles.css`)
- `worker/src/` — Cloudflare Worker: `index.ts` routes, `search.ts` orchestration, `limits.ts` budget constants, `sources/` site configs + generic HTML adapter
  - `sources/sites.ts` — one config per site (search URL, allowed hosts, result-extraction strategy)
  - `sources/html.ts` — regex-based link extraction with per-theme strategies (theme container class, `rel="bookmark"`, `title` attribute, card inner class, path allow-list)
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
- `POST /api/search` body `{ "query": "2-150 chars", "os": "windows" | "mac" (optional) }` → `text/event-stream` with `status`, `result`, `done`, `error` events.

When `os` is set, the worker appends the OS token (`mac`/`windows`) to each site's query so their full-text search ranks matching posts first; the frontend additionally filters streamed results by title (Mac requires explicit "Mac/macOS" evidence, the Windows view only hides Mac-only titles) and shows an OS badge on each card.

## Limits

Per-source timeout 6s, total budget 8s, max 20 results/source, 60 total. Query never logged. Result URLs must be https and pass a per-source host allowlist derived from the site configs.
