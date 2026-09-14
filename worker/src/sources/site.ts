import type { SearchResult, SourceId } from "../../../shared/types.ts";
import { extractLinks } from "./html.ts";
import type { SourceAdapter } from "./types.ts";
import type { SiteConfig } from "./sites.ts";
import { MAX_PER_SOURCE } from "../limits.ts";

// Sites check User-Agent and reject obvious bots; present as a browser.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

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
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en;q=0.9,*;q=0.5",
        },
      });
      if (!res.ok) throw new Error(`${cfg.label} error ${res.status}`);
      const html = await res.text();
      const links = extractLinks(html, {
        ...cfg.extract,
        baseUrl: pageUrl,
        hosts: cfg.hosts,
        limit: MAX_PER_SOURCE,
      });
      return links.map((l, i) => ({
        id: `${cfg.id}-${i}`,
        title: l.title,
        url: l.url,
        snippet: "",
        source: cfg.id as SourceId,
      }));
    },
  };
}
