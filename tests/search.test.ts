import { describe, expect, it } from "vitest";
import {
  dedupe,
  formatSse,
  isAllowedUrl,
  normalizeUrl,
  runSearch,
  sanitizeResults,
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
    expect(normalizeUrl("http://github.com/a")).toBeNull();
    expect(normalizeUrl("https://github.com/a/#x")).toBe(
      "https://github.com/a",
    );
  });

  it("enforces per-source host allowlist", () => {
    expect(isAllowedUrl("https://github.com/a/b", "github")).toBe(true);
    expect(isAllowedUrl("https://evil.com/x", "github")).toBe(false);
    expect(isAllowedUrl("https://example.com/crate", "crates")).toBe(true);
  });

  it("drops disallowed urls during sanitize", () => {
    const out = sanitizeResults(
      [
        {
          id: "1",
          title: "evil",
          url: "https://evil.com/x",
          snippet: "",
          source: "github",
        },
      ],
      "github",
    );
    expect(out).toHaveLength(0);
  });
});

describe("dedupe", () => {
  it("drops duplicate urls case-insensitively", () => {
    const rows = dedupe([
      { id: "1", title: "a", url: "https://A.com/x", snippet: "", source: "npm" },
      { id: "2", title: "b", url: "https://a.com/x", snippet: "", source: "npm" },
    ]);
    expect(rows).toHaveLength(1);
  });
});

describe("runSearch orchestration", () => {
  it("emits status/result/done in order and caps totals", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}`,
      title: `t${i}`,
      url: `https://github.com/o/r${i}`,
      snippet: "",
      source: "github" as const,
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
      a.id === "npm"
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
          (d as { source: string; state: string }).source === "npm" &&
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
      title: "fast",
      url: "https://github.com/o/fast",
      snippet: "",
      source: "github" as const,
    };
    const slow = {
      id: "slow",
      title: "slow",
      url: "https://www.npmjs.com/package/slow",
      snippet: "",
      source: "npm" as const,
    };
    const stub = [
      { id: "github" as const, label: "g", description: "", search: async () => [fast] },
      { id: "npm" as const, label: "n", description: "", search: () => gate.then(() => [slow]) },
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
      title: "dup",
      url: "https://github.com/o/dup",
      snippet: "",
      source: "github" as const,
    };
    const mk = (prefix: string, dupFirst: boolean) => ({
      id: "github" as const,
      label: "g",
      description: "",
      search: async () => [
        ...(dupFirst ? [dup] : [{ ...dup, id: `${prefix}-dup2` }]),
        ...Array.from({ length: 20 }, (_, i) => ({
          id: `${prefix}${i}`,
          title: `${prefix}${i}`,
          url: `https://github.com/o/${prefix}${i}`,
          snippet: "",
          source: "github" as const,
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
