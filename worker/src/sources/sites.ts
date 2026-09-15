import type { SourceId } from "../../../shared/types.ts";
import type { ExtractOptions } from "./html.ts";

/**
 * One entry per community megathread "Direct downloads" site that exposes a
 * server-rendered search page (scrapable without JS or bot challenges).
 *
 * Sites from the megathread intentionally NOT wired up:
 * - LRepacks / DIAKOV: their DataLife search ignores the query server-side
 *   (always renders the same default posts) — results would be misleading.
 * - soft98 / YASIR252: anti-bot interstitials (reCAPTCHA / Cloudflare).
 * - Vfxloot: client-side rendered SPA, nothing to scrape.
 * - SCloud: signup-only, no public search endpoint.
 */
export interface SiteConfig {
  id: SourceId;
  label: string;
  description: string;
  hosts: string[];
  /** Builds the server-rendered search page URL for a query. */
  searchUrl: (query: string) => string;
  /** "GET" appends nothing else; only GET is used today. */
  extract: ExtractOptions;
  /**
   * OS resolution for sites whose category tags live on the post page
   * instead of the search results: fetch up to `max` post pages for results
   * whose title carries no OS evidence and read the category there.
   */
  postOs?: { categoryPattern: RegExp; max: number };
  /**
   * Design/asset libraries: their catalogs are add-ons for other programs,
   * so when a query is not asset-seeking their results get a small cap
   * (see ASSET_SITE_CAP in search.ts).
   */
  assetSite?: boolean;
}

const enc = encodeURIComponent;
const wpSearch = (host: string) => (q: string) => `https://${host}/?s=${enc(q)}`;
const containerOpts = (containerClass: string): ExtractOptions => ({ containerClass });
const titleAttrOpts = (): ExtractOptions => ({ requireTitleAttr: true });

export const SITES: SiteConfig[] = [
  {
    id: "cracksurl",
    label: "CRACKSurl",
    description: "Windows/software cracks and full releases",
    hosts: ["cracksurl.com", "www.cracksurl.com"],
    searchUrl: wpSearch("cracksurl.com"),
    extract: { requireRelBookmark: true },
  },
  {
    id: "aedownload",
    label: "AEdownload",
    description: "After Effects, Premiere and Videohive templates",
    hosts: ["aedownload.com", "www.aedownload.com"],
    searchUrl: wpSearch("aedownload.com"),
    assetSite: true,
    extract: containerOpts("entry-title"),
  },
  {
    id: "appdoze",
    label: "AppDoze",
    description: "Repacked Windows applications and games",
    hosts: ["appdoze.net", "appdoze.com", "www.appdoze.net"],
    searchUrl: wpSearch("appdoze.net"),
    extract: { requireInnerClassExact: "title" },
    // OS lives in each post's meta-cats block, not on the search page.
    postOs: {
      categoryPattern: /class="meta-cats"[\s\S]{0,200}?<a[^>]*>([^<]{2,40})</i,
      max: 6,
    },
  },
  {
    id: "downloadpirate",
    label: "Download Pirate",
    description: "General software, plugins and design resources",
    hosts: ["downloadpirate.com", "www.downloadpirate.com"],
    searchUrl: wpSearch("www.downloadpirate.com"),
    extract: {
      containerClass: "cs-entry__title",
      // Category tag follows the title inside the same card segment.
      categoryPattern:
        /cs-meta-category[\s\S]{0,400}?<a[^>]*>([^<]{2,40})</i,
    },
  },
  {
    id: "gift4designer",
    label: "Gift4Designer",
    description: "Design resources: mockups, actions, graphics",
    hosts: ["gift4designer.net", "www.gift4designer.net"],
    searchUrl: (q) => `https://gift4designer.net/search?q=${enc(q)}`,
    assetSite: true,
    extract: { pathAllow: /^\/item\/[^/]+\.html$/i },
  },
  {
    id: "hunterae",
    label: "HunterAE",
    description: "After Effects projects and motion graphics",
    hosts: ["hunterae.com", "www.hunterae.com"],
    searchUrl: wpSearch("hunterae.com"),
    assetSite: true,
    extract: containerOpts("front-view-title"),
  },
  {
    id: "introhd",
    label: "INTRO HD",
    description: "Intro templates for After Effects and Premiere",
    hosts: ["intro-hd.net", "www.intro-hd.net"],
    searchUrl: wpSearch("intro-hd.net"),
    assetSite: true,
    extract: titleAttrOpts(),
  },
  {
    id: "matesfx",
    label: "MATESFX",
    description: "Video editing assets: plugins, LUTs, fonts (ex matesfx.com)",
    hosts: ["freevideoeffect.com", "www.freevideoeffect.com"],
    searchUrl: wpSearch("freevideoeffect.com"),
    assetSite: true,
    extract: containerOpts("jeg_post_title"),
  },
  {
    id: "motka",
    label: "Motka",
    description: "Design resources: fonts, templates, mockups",
    hosts: ["motka.net", "www.motka.net"],
    searchUrl: wpSearch("motka.net"),
    assetSite: true,
    extract: {
      containerClass: "entry-title",
      // Category tag precedes the title inside the same card segment.
      categoryBefore: true,
      categoryPattern: /meta-categories[\s\S]{0,200}?<a[^>]*>([^<]{2,40})</i,
    },
  },
  {
    id: "plc4me",
    label: "PLC4Me",
    description: "PLC, HMI/SCADA industrial software and tutorials",
    hosts: ["plctop.com", "www.plctop.com", "plc4me.com"],
    searchUrl: wpSearch("plctop.com"),
    extract: titleAttrOpts(),
  },
  {
    id: "softlay",
    label: "Softlay",
    description: "Software guides and downloads",
    hosts: ["softlay.com", "www.softlay.com"],
    searchUrl: wpSearch("www.softlay.com"),
    extract: containerOpts("entry-title"),
  },
  {
    id: "vfxmed",
    label: "VFXMed",
    description: "VFX plugins: Adobe, Maxon, Foundry tools",
    hosts: ["vfxmed.com", "www.vfxmed.com"],
    searchUrl: wpSearch("www.vfxmed.com"),
    extract: containerOpts("entry-title"),
  },
];

export const HOST_ALLOWLIST: Record<SourceId, string[]> = Object.fromEntries(
  SITES.map((s) => [s.id, s.hosts]),
) as Record<SourceId, string[]>;

export const ASSET_SITE_IDS: ReadonlySet<string> = new Set(
  SITES.filter((s) => s.assetSite).map((s) => s.id),
);
