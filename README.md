# ThreadSeek

Link-only federated metasearch across a community-curated selection of software sites. Static Vite frontend, Cloudflare Worker backend streaming results over SSE.

ThreadSeek forwards each query to the public search page of every site in its source list, parses the results page and relays titles and links. Nothing is hosted, mirrored or cached here.

## Sources

The source list is based on a community-maintained megathread (see the footer link). The worker fans a query out to every wired-up site in parallel:

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

Sites intentionally **not** wired up (they cannot be searched server-side):

- **LRepacks** / **DIAKOV** — their DataLife Engine search ignores the query server-side and always renders the same default posts; relaying that would be misleading.
- **soft98** / **YASIR252** — anti-bot interstitials (reCAPTCHA / Cloudflare challenge).
- **Vfxloot** — client-side rendered SPA, no server-rendered results.
- **SCloud** — signup-only, no public search page.

These are third-party sites; availability and anti-bot behavior can change at any time. A failing source is reported as an `error`/`timeout` status in the UI while the other sources keep streaming.

## Relevance

Queries are sent pure (no keyword stuffing). The worker applies three gates:

- a result is dropped when its title contains no query term (kills full-text OR noise);
- course/tutorial-like titles ("tutorial", "guide", "how to"…) are dropped unless the query asks for one;
- add-on resources ("Photoshop Actions", "plugin for photoshop") are dropped for program-name queries — asset-seeking queries ("photoshop brushes") keep them.

OS evidence for the Windows/macOS toggle comes from the sites' own category tags when available (parsed from the search page for Motka and Download Pirate, resolved from the post page for AppDoze) and falls back to title heuristics. Asset libraries are capped and ranked below software sites for program-name queries.

## Architecture

- `web/` — static Vite + TypeScript frontend (`index.html`, `src/main.ts`, `src/search.ts`, `src/styles.css`)
- `worker/src/` — Cloudflare Worker: `index.ts` routes, `search.ts` orchestration + relevance gates, `limits.ts` budget constants, `sources/` site configs + generic HTML adapter
  - `sources/sites.ts` — one config per site (search URL, allowed hosts, extraction strategy, OS category parsing)
  - `sources/html.ts` — regex-based link extraction with per-theme strategies (theme container class, `rel="bookmark"`, `title` attribute, card inner class, path allow-list)
- `shared/` — shared contract (SearchResult, SourceStatus, SSE events) and OS detection helpers

## Environment

- `FRONTEND_ORIGIN` (worker, `worker/wrangler.toml`): exact origin allowed for CORS, e.g. `https://<user>.github.io/<repo>`. Localhost origins are accepted automatically in dev.
- `VITE_API_BASE` (Pages build, repository variable): worker base URL, e.g. `https://<worker>.workers.dev`. The Pages workflow fails with a clear error if it is missing, and runs `npm test -- --run`, `npm run typecheck`, then `npm run build` before publishing to Pages.

Local dev: leave `VITE_API_BASE` unset and the frontend uses same-origin (`/api/...`, e.g. via `wrangler dev` proxy); set it to the worker URL only when the local frontend must call a remote worker.

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

## API

- `GET /api/sources` → `[{ id, label, description, assetSite }]`
- `POST /api/search` body `{ "query": "2-150 chars" }` → `text/event-stream` with `status`, `result`, `done`, `error` events.

## Limits

Per-source timeout 6s, total budget 8s, max 20 results/source (4 for asset libraries on non-asset queries), 60 total. Query never logged. Result URLs must be https and pass a per-source host allowlist derived from the site configs.
