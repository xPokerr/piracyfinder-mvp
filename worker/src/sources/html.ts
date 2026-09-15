// Minimal regex-based HTML link extraction. Each megathread site renders its
// search results with a different theme, so the extractor supports the small
// set of strategies observed across them instead of a real DOM.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// Paths that are navigation/system pages or assets, never search results.
const PATH_DENY =
  /\/(category|tag|tags|author|page|feed|feeds|search|login|login-page|register|signup|sign-up|account|my-account|profile|join|password|lost-password)(\/|$)|\/(wp-admin|wp-content|wp-includes|wp-json)|xmlrpc\.php|\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|txt|xml|rss|json|pdf|zip|rar|7z)(?:[?#]|$)|(?:^|\/)(about|about-us|contact|contact-us|privacy|privacy-policy|terms|terms-conditions|disclaimer|dmca|copyright|sitemap|advertise|donate|donations|support|faq|request|requests|contrib|contributors|brand|members|authors|shop|cart|checkout|wishlist|compare|refund|licen[cs]e)(?:\/|$)|#/i;

// Fresh regex per call: a shared /g regex keeps lastIndex across calls and
// silently skips leading matches in matchAll().
const ANCHOR_SOURCE = "<a\\b([^>]*)>([\\s\\S]*?)<\\/a>";
const HREF = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/i;

function hrefOf(attrs: string): string | null {
  const m = HREF.exec(attrs);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

export interface ExtractedLink {
  title: string;
  url: string;
  /** Category tag text found near the result, e.g. "Windows" / "mac". */
  category?: string;
}

export interface ExtractOptions {
  /** Absolute URL of the page the HTML came from, for resolving relative links. */
  baseUrl?: string;
  /** Only links on one of these hostnames are kept. */
  hosts?: string[];
  /** Theme container around each result link, e.g. "entry-title". */
  containerClass?: string;
  /** Only keep WordPress-style post links (`<a ... rel="bookmark">`). */
  requireRelBookmark?: boolean;
  /** Only keep anchors carrying a `title` attribute. */
  requireTitleAttr?: boolean;
  /** Only keep anchors whose inner HTML contains exactly `class="<value>"`. */
  requireInnerClassExact?: string;
  /** When set, link paths must match it (checked before PATH_DENY). */
  pathAllow?: RegExp;
  /** Extra per-site deny pattern applied on top of PATH_DENY. */
  pathDenyExtra?: RegExp;
  /**
   * Extracted from each result's card segment, so it sees category tags
   * before or after the title link. First capture group is used as the
   * category text.
   */
  categoryPattern?: RegExp;
  /**
   * Category tag precedes the title link (e.g. motka) instead of following
   * it (e.g. Download Pirate). Determines which card segment is searched.
   */
  categoryBefore?: boolean;
  limit?: number;
}

function anchorMatches(
  attrs: string,
  inner: string,
  opts: ExtractOptions,
  url: URL,
): boolean {
  if (opts.requireRelBookmark && !/\brel\s*=\s*["']?[^"'>]*\bbookmark\b/i.test(attrs)) {
    return false;
  }
  if (opts.requireTitleAttr && !/(?:^|\s)title\s*=\s*(?:"|')/i.test(attrs)) {
    return false;
  }
  if (
    opts.requireInnerClassExact &&
    !inner.includes(`class="${opts.requireInnerClassExact}"`)
  ) {
    return false;
  }
  const path = url.pathname;
  if (opts.pathAllow && !opts.pathAllow.test(path)) return false;
  if (PATH_DENY.test(path)) return false;
  if (opts.pathDenyExtra && opts.pathDenyExtra.test(path)) return false;
  return true;
}

/**
 * Extract candidate result links. When `containerClass` is set, only anchors
 * that follow a container element carrying that class are considered;
 * otherwise every anchor is considered and filtered by the option flags.
 */
export function extractLinks(html: string, opts: ExtractOptions): ExtractedLink[] {
  const limit = opts.limit ?? 20;
  const hosts = opts.hosts ?? [];
  const out: ExtractedLink[] = [];
  const seen = new Set<string>();

  const push = (attrs: string, inner: string, region?: string) => {
    const rawHref = hrefOf(attrs);
    if (rawHref === null) return;
    let url: URL;
    try {
      url = new URL(rawHref, opts.baseUrl);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    const host = url.hostname.toLowerCase();
    if (!hosts.includes(host)) return;
    if (!anchorMatches(attrs, inner, opts, url)) return;
    const titleAttr =
      /(?:^|\s)title\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ??
      /(?:^|\s)title\s*=\s*'([^']*)'/i.exec(attrs)?.[1] ??
      "";
    const title = stripTags(inner) || stripTags(titleAttr);
    if (title.length < 4) return;
    let category: string | undefined;
    if (region && opts.categoryPattern) {
      const cm = opts.categoryPattern.exec(region);
      if (cm) category = stripTags(cm[1] ?? cm[0]) || undefined;
    }
    const key = `${url.hostname}${url.pathname}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title: title.slice(0, 200), url: url.toString(), category });
  };

  if (opts.containerClass) {
    // e.g. <h2 class="entry-title ..."> <a href=...>Title</a>
    const container = new RegExp(
      `class="[^"]*\\b${opts.containerClass.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^"]*"`,
      "gi",
    );
    const anchor = new RegExp(ANCHOR_SOURCE, "i");
    const cms = [...html.matchAll(container)];
    for (let i = 0; i < cms.length && out.length < limit; i++) {
      const start = cms[i].index ?? 0;
      let region: string | undefined;
      if (opts.categoryPattern) {
        if (opts.categoryBefore) {
          // Card region ends where this title starts; begins after the
          // previous title (or a lookback for the first card).
          const from =
            i > 0
              ? (cms[i - 1].index ?? 0) + cms[i - 1][0].length
              : Math.max(0, start - 1200);
          region = html.slice(from, start);
        } else {
          // Card region from this title to the next one.
          const to =
            i + 1 < cms.length
              ? cms[i + 1].index ?? html.length
              : Math.min(html.length, start + 4000);
          region = html.slice(start, to);
        }
      }
      const a = anchor.exec(html.slice(start, start + 4000));
      if (!a) continue;
      push(a[1], a[2], region);
    }
  } else {
    for (const a of html.matchAll(new RegExp(ANCHOR_SOURCE, "gi"))) {
      push(a[1], a[2]);
      if (out.length >= limit) break;
    }
  }
  return out;
}
