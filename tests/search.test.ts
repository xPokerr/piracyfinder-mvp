import { describe, expect, it } from "vitest";
import {
  dedupe,
  formatSse,
  isAllowedUrl,
  isAssetTitle,
  isJunkTitle,
  isRelevantTitle,
  normalizeUrl,
  runSearch,
  sanitizeResults,
  titleTokens,
  validateQuery,
  type Emit,
} from "../worker/src/search.ts";
import { adapters } from "../worker/src/sources/registry.ts";

describe("validateQuery", () => {
  it("accepts 2-150 chars and rejects the rest", () => {
    expect(validateQuery({ query: "ab" })).toBe("ab");
    expect(() => validateQuery({ query: "a" })).toThrow();
    expect(() => validateQuery({ query: "x".repeat(151) })).toThrow();
    expect(() => validateQuery({})).toThrow();
  });
});

describe("url validation", () => {
  it("requires https and strips hash/trailing slash", () => {
    expect(normalizeUrl("http://example.com/a")).toBeNull();
    expect(normalizeUrl("https://example.com/a/#x")).toBe(
      "https://example.com/a",
    );
  });

  it("enforces per-source host allowlist", () => {
    expect(isAllowedUrl("https://cracksurl.com/a/b", "cracksurl")).toBe(true);
    expect(isAllowedUrl("https://evil.com/x", "cracksurl")).toBe(false);
  });

  it("drops disallowed urls during sanitize", () => {
    const out = sanitizeResults(
      [
        {
          id: "1",
          title: "evil",
          url: "https://evil.com/x",
          snippet: "",
          source: "cracksurl",
        },
      ],
      "cracksurl",
      "ableton",
    );
    expect(out).toHaveLength(0);
  });
});

describe("relevance gate", () => {
  it("splits query into alphanumeric tokens of at least 2 chars", () => {
    expect(titleTokens("Ableton Live 12!")).toEqual(["ableton", "live", "12"]);
    expect(titleTokens("a b -")).toEqual([]);
  });

  it("keeps titles containing any query term", () => {
    expect(isRelevantTitle("Ableton Live 12 Suite", "ableton")).toBe(true);
    expect(isRelevantTitle("AppCleaner 3.6", "cleaner")).toBe(true);
    expect(isRelevantTitle("Adobe Photoshop 2026", "photoshop mac")).toBe(true);
  });

  it("drops titles without any query term", () => {
    expect(isRelevantTitle("Windows Slideshow Mockup", "ableton")).toBe(false);
    expect(isRelevantTitle("Laptop Screen Mockup", "winrar windows")).toBe(
      false,
    );
  });

  it("is lenient when the query has no usable tokens", () => {
    expect(isRelevantTitle("anything", "??")).toBe(true);
  });

  it("sanitize filters irrelevant titles for the query", () => {
    const out = sanitizeResults(
      [
        {
          id: "1",
          title: "Modular Windows Slideshow Presentation",
          url: "https://cracksurl.com/x/",
          snippet: "",
          source: "cracksurl",
        },
        {
          id: "2",
          title: "Ableton Live 12 Suite",
          url: "https://cracksurl.com/y/",
          snippet: "",
          source: "cracksurl",
        },
      ],
      "cracksurl",
      "ableton",
    );
    expect(out.map((r) => r.title)).toEqual(["Ableton Live 12 Suite"]);
  });
});

describe("asset filter", () => {
  it("drops add-on resources when the query is the host program", () => {
    expect(
      isAssetTitle("Leather Badge Generator - Photoshop Actions", "photoshop"),
    ).toBe(true);
    expect(
      isAssetTitle(
        "Videohive Photoshop Edutainment Video Template",
        "photoshop",
      ),
    ).toBe(true);
    expect(
      isAssetTitle("Lumenzia v12.0.2 Plugin For Photoshop", "photoshop"),
    ).toBe(true);
    expect(
      isAssetTitle(
        "BorisFX Sapphire 2026 plugin for Adobe, AVX, OFX & Photoshop",
        "photoshop",
      ),
    ).toBe(true);
    expect(
      isAssetTitle(
        "Sparrow's Photoshop Remove Tool AI Crack Download",
        "photoshop",
      ),
    ).toBe(true);
    expect(
      isAssetTitle("Gumroad – Gradient Map Pack Photoshop Download", "photoshop"),
    ).toBe(true);
    expect(
      isAssetTitle("Photoshop – Coolorus 2.7.1 Free 2026 Download", "photoshop"),
    ).toBe(true);
    expect(
      isAssetTitle("Design Gaming Thumbnails In Photoshop", "photoshop"),
    ).toBe(true);
    expect(
      isAssetTitle("Mega Bundle for Retouch Pro Adobe Photoshop", "photoshop"),
    ).toBe(true);
    expect(
      isAssetTitle("Modern Opener | After Effects Template", "after effects"),
    ).toBe(true);
    expect(
      isAssetTitle(
        "Christmas Titles - DaVinci Resolve by StrokeVorkz",
        "davinci resolve",
      ),
    ).toBe(true);
    expect(isAssetTitle("Office Color Icons by Jumsoft", "office")).toBe(true);
    expect(
      isAssetTitle("Effects Pack for Photoshop Free Download", "photoshop"),
    ).toBe(true);
  });

  it("keeps the program itself", () => {
    expect(isAssetTitle("Adobe Photoshop 27.9.1 + AI Crack", "photoshop")).toBe(
      false,
    );
    expect(isAssetTitle("Adobe Photoshop 2026", "photoshop")).toBe(false);
    expect(isAssetTitle("Adobe Photoshop 2026 for Mac 27.6.0", "photoshop")).toBe(
      false,
    );
    expect(isAssetTitle("Ableton Live 12 Suite 12.4.5", "ableton")).toBe(false);
  });

  it("keeps products whose name is the query, even if they are plugins", () => {
    expect(
      isAssetTitle("Lumenzia v12.0.2 Plugin For Photoshop", "lumenzia"),
    ).toBe(false);
  });

  it("keeps everything when the query asks for assets", () => {
    expect(
      isAssetTitle("Leather Badge Generator - Photoshop Actions", "photoshop brushes"),
    ).toBe(false);
    expect(
      isAssetTitle("Photoshop Actions pack", "photoshop actions"),
    ).toBe(false);
  });
});

describe("junk filter", () => {
  it("drops course/tutorial-like titles", () => {
    expect(
      isJunkTitle(
        "Punkademic Ableton Live Lite & Intro Complete Guide TUTORIAL",
        "ableton",
      ),
    ).toBe(true);
    expect(isJunkTitle("After Effects Video Course", "after effects")).toBe(
      true,
    );
    expect(isJunkTitle("How to install Photoshop", "photoshop")).toBe(true);
  });

  it("keeps them when the query explicitly asks for one", () => {
    expect(
      isJunkTitle("Ableton Live Complete Tutorial", "ableton tutorial"),
    ).toBe(false);
  });

  it("keeps regular software titles", () => {
    expect(isJunkTitle("Ableton Live 12 Suite 12.4.5", "ableton")).toBe(false);
    expect(isJunkTitle("WinRAR 7.30 for Mac", "winrar")).toBe(false);
  });

  it("sanitize drops junk titles for the query", () => {
    const out = sanitizeResults(
      [
        {
          id: "1",
          title: "Ableton Live Intro Complete Guide TUTORIAL",
          url: "https://cracksurl.com/x/",
          snippet: "",
          source: "cracksurl",
        },
        {
          id: "2",
          title: "Ableton Live 12 Suite",
          url: "https://cracksurl.com/y/",
          snippet: "",
          source: "cracksurl",
        },
      ],
      "cracksurl",
      "ableton",
    );
    expect(out.map((r) => r.title)).toEqual(["Ableton Live 12 Suite"]);
  });
});

describe("dedupe", () => {
  it("drops duplicate urls case-insensitively", () => {
    const rows = dedupe([
      {
        id: "1",
        title: "a",
        url: "https://A.com/x",
        snippet: "",
        source: "motka",
      },
      {
        id: "2",
        title: "b",
        url: "https://a.com/x",
        snippet: "",
        source: "motka",
      },
    ]);
    expect(rows).toHaveLength(1);
  });
});

describe("runSearch orchestration", () => {
  it("emits status/result/done in order and caps totals", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}`,
      title: `t${i} test`,
      url: `https://cracksurl.com/o/r${i}`,
      snippet: "",
      source: "cracksurl" as const,
    }));
    const stub = adapters.map((a) => ({
      ...a,
      search: async () => [...many],
    }));

    const events: [string, unknown][] = [];
    const emit: Emit = (event, data) => events.push([event, data]);
    const done = await runSearch("test query", emit, stub);
    expect(done.total).toBeLessThanOrEqual(60);
    const names = events.map(([e]) => e);
    expect(names[0]).toBe("status");
    expect(names).toContain("result");
    expect(names[names.length - 1]).toBe("done");
    expect(formatSse("done", done)).toContain("event: done");
  });

  it("marks a failing source as error but still completes", async () => {
    const stub = adapters.map((a) =>
      a.id === "motka"
        ? { ...a, search: async () => Promise.reject(new Error("boom")) }
        : { ...a, search: async () => [] },
    );
    const events: [string, unknown][] = [];
    const done = await runSearch("ok query", (e, d) =>
      events.push([e, d]),
      stub,
    );
    expect(done.total).toBe(0);
    expect(
      events.some(
        ([e, d]) =>
          e === "status" &&
          (d as { source: string; state: string }).source === "motka" &&
          (d as { state: string }).state === "error",
      ),
    ).toBe(true);
  });

  it("emits a fast source's results before a slow source finishes", async () => {
    let release!: (v: never[]) => void;
    const gate = new Promise<never[]>((res) => {
      release = res;
    });
    const fast = {
      id: "fast",
      title: "fast query",
      url: "https://cracksurl.com/o/fast",
      snippet: "",
      source: "cracksurl" as const,
    };
    const slow = {
      id: "slow",
      title: "slow query",
      url: "https://motka.net/slow",
      snippet: "",
      source: "motka" as const,
    };
    const stub = [
      {
        id: "cracksurl" as const,
        label: "g",
        description: "",
        search: async () => [fast],
      },
      {
        id: "motka" as const,
        label: "n",
        description: "",
        search: () => gate.then(() => [slow]),
      },
    ];
    const events: [string, unknown][] = [];
    const pending = runSearch("query", (e, d) => events.push([e, d]), stub);
    await new Promise((r) => setTimeout(r, 50));
    const early = events.filter(([e]) => e === "result");
    expect(early).toHaveLength(1);
    expect(early[0][1]).toMatchObject({ url: fast.url });
    release([]);
    const done = await pending;
    expect(done.total).toBe(2);
    expect(events[events.length - 1][0]).toBe("done");
  });

  it("dedupes urls across sources and caps at 60", async () => {
    const dup = {
      id: "d",
      title: "dup query",
      url: "https://cracksurl.com/o/dup",
      snippet: "",
      source: "cracksurl" as const,
    };
    const mk = (prefix: string, dupFirst: boolean) => ({
      id: "cracksurl" as const,
      label: "g",
      description: "",
      search: async () => [
        ...(dupFirst ? [dup] : [{ ...dup, id: `${prefix}-dup2` }]),
        ...Array.from({ length: 20 }, (_, i) => ({
          id: `${prefix}${i}`,
          title: `${prefix}${i} query`,
          url: `https://cracksurl.com/o/${prefix}${i}`,
          snippet: "",
          source: "cracksurl" as const,
        })),
      ],
    });
    // 4 stubs x 20 (after sanitize cap) = 80, minus 1 cross-source dup = 79
    // unique -> must be capped at MAX_TOTAL (60).
    const stub = [mk("a", true), mk("b", false), mk("c", true), mk("d", true)];
    const events: [string, unknown][] = [];
    const done = await runSearch("query", (e, d) => events.push([e, d]), stub);
    const results = events.filter(([e]) => e === "result");
    expect(done.total).toBe(60);
    expect(results).toHaveLength(60);
    const urls = results.map(([, d]) => (d as { url: string }).url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
