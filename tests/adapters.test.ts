import { afterEach, describe, expect, it, vi } from "vitest";
import { cratesAdapter } from "../worker/src/sources/crates.ts";
import { githubAdapter } from "../worker/src/sources/github.ts";
import { npmAdapter } from "../worker/src/sources/npm.ts";

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("github adapter", () => {
  it("maps repos to results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          items: [
            {
              id: 1,
              full_name: "a/b",
              html_url: "https://github.com/a/b",
              description: "desc",
              updated_at: "2024-01-01T00:00:00Z",
            },
          ],
        }),
      ),
    );
    const out = await githubAdapter.search("x", new AbortController().signal);
    expect(out[0]).toMatchObject({ title: "a/b", source: "github" });
  });

  it("throws friendly error on rate limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    await expect(
      githubAdapter.search("x", new AbortController().signal),
    ).rejects.toThrow(/rate limit/i);
  });
});

describe("npm adapter", () => {
  it("maps packages to results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          objects: [
            {
              package: {
                name: "left-pad",
                description: "pad",
                date: "2024-01-01",
                links: { npm: "https://www.npmjs.com/package/left-pad" },
              },
            },
          ],
        }),
      ),
    );
    const out = await npmAdapter.search("pad", new AbortController().signal);
    expect(out[0]).toMatchObject({ title: "left-pad", source: "npm" });
  });
});

describe("crates adapter", () => {
  it("falls back to crates.io URL when homepage is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          crates: [{ id: "serde", updated_at: "2024-01-01T00:00:00Z" }],
        }),
      ),
    );
    const out = await cratesAdapter.search(
      "serde",
      new AbortController().signal,
    );
    expect(out[0].url).toBe("https://crates.io/crates/serde");
  });
});
