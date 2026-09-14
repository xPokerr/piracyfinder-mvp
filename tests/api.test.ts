import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/src/index.ts";

afterEach(() => vi.unstubAllGlobals());

const ENV = { FRONTEND_ORIGIN: "https://user.github.io" };

function searchReq(body: unknown) {
  return new Request("https://worker.test/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/search OS focus", () => {
  it("rejects an invalid os with 400", async () => {
    const res = await worker.fetch(searchReq({ query: "ab", os: "linux" }), ENV);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toMatch(/invalid os/i);
  });

  it("keeps rejecting short queries with 400", async () => {
    const res = await worker.fetch(searchReq({ query: "a" }), ENV);
    expect(res.status).toBe(400);
  });

  it("appends the os token to per-site queries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          '<h2 class="title"><a href="https://cracksurl.com/tool/" rel="bookmark">Tool 1.0</a></h2>',
          { status: 200 },
        ),
      ),
    );
    const res = await worker.fetch(
      searchReq({ query: "winrar", os: "mac" }),
      ENV,
    );
    expect(res.status).toBe(200);
    // Give the SSE stream's start() a moment to fan out to the adapters.
    await new Promise((r) => setTimeout(r, 50));
    const firstCall = vi.mocked(fetch).mock.calls[0]?.[0] as string;
    expect(firstCall).toContain("winrar%20mac");
  });

  it("leaves the query untouched without os", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 })),
    );
    await worker.fetch(searchReq({ query: "winrar" }), ENV);
    await new Promise((r) => setTimeout(r, 50));
    const firstCall = vi.mocked(fetch).mock.calls[0]?.[0] as string;
    expect(firstCall).toContain("winrar");
    expect(firstCall).not.toContain("winrar%20");
  });
});
