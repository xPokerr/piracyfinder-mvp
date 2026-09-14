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

  const push = (attrs: string, inner: string) => {
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
    const key = `${url.hostname}${url.pathname}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title: title.slice(0, 200), url: url.toString() });
  };

  if (opts.containerClass) {
    // e.g. <h2 class="entry-title ..."> <a href=...>Title</a>
    const container = new RegExp(
      `class="[^"]*\\b${opts.containerClass.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^"]*"`,
      "gi",
    );
    const anchor = new RegExp(ANCHOR_SOURCE, "i");
    for (const m of html.matchAll(container)) {
      const from = (m.index ?? 0) + m[0].length;
      const a = anchor.exec(html.slice(from, from + 4000));
      if (!a) continue;
      push(a[1], a[2]);
      if (out.length >= limit) break;
    }
  } else {
    for (const a of html.matchAll(new RegExp(ANCHOR_SOURCE, "gi"))) {
      push(a[1], a[2]);
      if (out.length >= limit) break;
    }
  }
  return out;
}
