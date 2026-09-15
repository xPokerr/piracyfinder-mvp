import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeEntities,
  extractLinks,
  stripTags,
} from "../worker/src/sources/html.ts";
import { SITES } from "../worker/src/sources/sites.ts";
import { adapters } from "../worker/src/sources/registry.ts";

afterEach(() => vi.unstubAllGlobals());

const BASE = "https://example.com/?s=q";

describe("html extraction", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("A &amp; B &#8211; C &#x27;D&#39;")).toBe(
      "A & B – C 'D'",
    );
    expect(decodeEntities("bad &unknown; &#999999999999;")).toBe(
      "bad &unknown; &#999999999999;",
    );
  });

  it("strips tags and collapses whitespace", () => {
    expect(stripTags("<b>Hello</b>  <span>world</span>\n  !")).toBe(
      "Hello world !",
    );
  });

  it("extracts anchors inside a theme container, resolving relative hrefs", () => {
    const html = `<nav><a href="https://example.com/category/x/">Cat</a></nav>
      <h2 class="entry-title"><a href="https://example.com/foo-1-0/">Foo 1.0</a></h2>
      <h2 class="entry-title"><a href="/bar-2-0/">Bar 2.0 &amp; Co</a></h2>`;
    const out = extractLinks(html, {
      baseUrl: BASE,
      hosts: ["example.com"],
      containerClass: "entry-title",
    });
    expect(out.map((o) => o.title)).toEqual(["Foo 1.0", "Bar 2.0 & Co"]);
    expect(out[1].url).toBe("https://example.com/bar-2-0/");
  });

  it("extracts category tags from the card segment (before the title)", () => {
    const html = `<h2 class="entry-title"><a href="https://example.com/win-app/">Win App</a></h2>
      <ul class="entry-meta"><li class="meta-categories"><a href="https://example.com/category/windows/">Windows</a></li></ul>
      <h2 class="entry-title"><a href="https://example.com/mac-app/">Mac App</a></h2>
      <ul class="entry-meta"><li class="meta-categories"><a href="https://example.com/category/mac/">Mac 🍏</a></li></ul>`;
    const out = extractLinks(html, {
      baseUrl: BASE,
      hosts: ["example.com"],
      containerClass: "entry-title",
      categoryPattern: /meta-categories[\s\S]{0,200}?<a[^>]*>([^<]{2,40})</i,
    });
    expect(out.map((o) => o.category)).toEqual(["Windows", "Mac 🍏"]);
  });

  it("extracts category tags that follow the title link", () => {
    const html = `<h2 class="cs-entry__title"><a href="https://example.com/tool-1/">Tool 1</a></h2>
      <div class="cs-meta-category"><ul><li><a href="https://example.com/c/windows/">Windows</a></li></ul></div>
      <h2 class="cs-entry__title"><a href="https://example.com/tool-2/">Tool 2</a></h2>
      <div class="cs-meta-category"><ul><li><a href="https://example.com/c/graphics/">Graphics</a></li></ul></div>`;
    const out = extractLinks(html, {
      baseUrl: BASE,
      hosts: ["example.com"],
      containerClass: "cs-entry__title",
      categoryPattern: /cs-meta-category[\s\S]{0,400}?<a[^>]*>([^<]{2,40})</i,
    });
    expect(out.map((o) => o.category)).toEqual(["Windows", "Graphics"]);
  });

  it("rel=bookmark keeps post links, global deny drops system pages", () => {
    const html = `<a href="https://example.com/tool-1/" rel="bookmark">Tool 1</a>
      <a href="https://example.com/privacy-policy/" rel="bookmark">Privacy</a>
      <a href="https://example.com/tool-2/">Tool 2</a>`;
    const out = extractLinks(html, {
      baseUrl: BASE,
      hosts: ["example.com"],
      requireRelBookmark: true,
    });
    expect(out.map((o) => o.title)).toEqual(["Tool 1"]);
  });

  it("title-attr mode keeps post links and drops category nav", () => {
    const html = `<a href="https://example.com/lumenzia/" title="Lumenzia v12">Lumenzia v12</a>
      <a href="https://example.com/photoshop/">Photoshop</a>`;
    const out = extractLinks(html, {
      baseUrl: BASE,
      hosts: ["example.com"],
      requireTitleAttr: true,
    });
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://example.com/lumenzia/");
    expect(out[0].title).toBe("Lumenzia v12");
  });

  it("falls back to the title attribute when the anchor text is empty", () => {
    const html = `<a href="https://example.com/x/" title="Only In Attr"><img src="a.png" alt=""></a>`;
    const out = extractLinks(html, {
      baseUrl: BASE,
      hosts: ["example.com"],
      requireTitleAttr: true,
    });
    expect(out[0].title).toBe("Only In Attr");
  });

  it("inner-exact class mode handles card layouts", () => {
    const html = `<a href="https://example.com/photoshop-2026/"><div class="bloque"><div class="title">Adobe Photoshop 2026</div></div></a>
      <a href="https://example.com/entry-title/"><div class="entry-title">decoy</div></a>`;
    const out = extractLinks(html, {
      baseUrl: BASE,
      hosts: ["example.com"],
      requireInnerClassExact: "title",
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: "Adobe Photoshop 2026" });
  });

  it("pathAllow restricts to item pages and other hosts are dropped", () => {
    const html = `<a href="https://g4d.test/item/magic-action.html">Magic Action</a>
      <a href="https://g4d.test/about/">About Us</a>
      <a href="https://other.test/item/x.html">Foreign</a>`;
    const out = extractLinks(html, {
      baseUrl: BASE,
      hosts: ["g4d.test"],
      pathAllow: /^\/item\/[^/]+\.html$/i,
    });
    expect(out.map((o) => o.title)).toEqual(["Magic Action"]);
  });

  it("dedupes by host+path and respects the limit", () => {
    const items = Array.from(
      { length: 30 },
      (_, i) =>
        `<h2 class="entry-title"><a href="https://example.com/p${i}/">Post ${i}</a></h2>`,
    ).join("");
    const out = extractLinks(items, {
      baseUrl: BASE,
      hosts: ["example.com"],
      containerClass: "entry-title",
      limit: 5,
    });
    expect(out).toHaveLength(5);
    expect(out[4].title).toBe("Post 4");
  });

  it("drops foreign hosts, non-http schemes and assets", () => {
    const html = `<a href="https://evil.com/a/">Evil</a>
      <a href="javascript:void(0)">Js</a>
      <a href="https://example.com/logo.png">Logo</a>`;
    expect(
      extractLinks(html, { baseUrl: BASE, hosts: ["example.com"] }),
    ).toHaveLength(0);
  });
});

describe("site registry", () => {
  it("has unique ids, https search urls and hosts for every source", () => {
    const ids = SITES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SITES) {
      expect(s.searchUrl("test q")).toMatch(/^https:\/\//);
      expect(s.hosts.length).toBeGreaterThan(0);
      expect(s.extract.baseUrl).toBeUndefined(); // injected at fetch time
    }
    expect(adapters).toHaveLength(SITES.length);
    expect(adapters.map((a) => a.id)).toEqual(ids);
  });
});

describe("site adapter", () => {
  it("fetches the search page and maps extracted links", async () => {
    const page = `<article><h2 class="title"><a href="https://cracksurl.com/winrar-7-full/" rel="bookmark">WinRAR 7 Full</a></h2></article>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(page, { status: 200 })),
    );
    const adapter = adapters.find((a) => a.id === "cracksurl")!;
    const out = await adapter.search("winrar", new AbortController().signal);
    expect(out[0]).toMatchObject({
      title: "WinRAR 7 Full",
      url: "https://cracksurl.com/winrar-7-full/",
      source: "cracksurl",
    });
    const called = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(called).toContain("?s=winrar");
  });

  it("throws a friendly error on bot-block responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("forbidden", { status: 403 })),
    );
    const adapter = adapters.find((a) => a.id === "cracksurl")!;
    await expect(
      adapter.search("winrar", new AbortController().signal),
    ).rejects.toThrow(/403/);
  });

  it("resolves OS from post pages when the title has no evidence", async () => {
    const searchPage = `<div class="bav"><a href="https://appdoze.net/some-app/"><div class="bap-c"><div class="title">Some App 2026</div></div></a></div>`;
    const postPage = `<div class="meta-cats"><ul><li><a href="https://appdoze.net/category/mac/">macOS</a></li></ul></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) =>
        String(input).includes("?s=")
          ? new Response(searchPage, { status: 200 })
          : new Response(postPage, { status: 200 }),
      ),
    );
    const adapter = adapters.find((a) => a.id === "appdoze")!;
    const out = await adapter.search("some app", new AbortController().signal);
    expect(out[0]).toMatchObject({
      title: "Some App 2026",
      os: "mac",
      source: "appdoze",
    });
    // 1 search page + 1 post page
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
  });
});
