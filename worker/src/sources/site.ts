import type { SearchResult, SourceId } from "../../../shared/types.ts";
import { detectOs } from "../../../shared/os.ts";
import { extractLinks, stripTags } from "./html.ts";
import type { SourceAdapter } from "./types.ts";
import type { SiteConfig } from "./sites.ts";
import { MAX_PER_SOURCE } from "../limits.ts";

// Sites check User-Agent and reject obvious bots; present as a browser.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const BROWSER_HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en;q=0.9,*;q=0.5",
} as const;

/**
 * For results whose title carries no OS evidence, fetch the post page and
 * read the OS from the site's own category tags (best effort, bounded).
 */
async function resolveOsFromPosts(
  cfg: SiteConfig,
  results: SearchResult[],
  signal: AbortSignal,
): Promise<void> {
  if (!cfg.postOs) return;
  const need = results
    .filter((r) => !r.os && !detectOs(r.title))
    .slice(0, cfg.postOs.max);
  await Promise.allSettled(
    need.map(async (r) => {
      const res = await fetch(r.url, { signal, headers: BROWSER_HEADERS });
      if (!res.ok) return;
      const html = await res.text();
      const m = cfg.postOs!.categoryPattern.exec(html);
      if (!m) return;
      const os = detectOs(stripTags(m[1] ?? m[0]));
      if (os) r.os = os;
    }),
  );
}

export function makeSiteAdapter(cfg: SiteConfig): SourceAdapter {
  return {
    id: cfg.id,
    label: cfg.label,
    description: cfg.description,
    async search(query: string, signal: AbortSignal): Promise<SearchResult[]> {
      const pageUrl = cfg.searchUrl(query);
      const res = await fetch(pageUrl, {
        signal,
        redirect: "follow",
        headers: BROWSER_HEADERS,
      });
      if (!res.ok) throw new Error(`${cfg.label} error ${res.status}`);
      const html = await res.text();
      const links = extractLinks(html, {
        ...cfg.extract,
        baseUrl: pageUrl,
        hosts: cfg.hosts,
        limit: MAX_PER_SOURCE,
      });
      const results: SearchResult[] = links.map((l, i) => {
        const os = l.category ? detectOs(l.category) : null;
        return {
          id: `${cfg.id}-${i}`,
          title: l.title,
          url: l.url,
          snippet: "",
          source: cfg.id as SourceId,
          ...(os ? { os } : {}),
        };
      });
      await resolveOsFromPosts(cfg, results, signal);
      return results;
    },
  };
}
