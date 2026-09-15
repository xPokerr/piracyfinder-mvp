import { describe, expect, it } from "vitest";
import worker from "../worker/src/index.ts";

const ENV = { FRONTEND_ORIGIN: "https://user.github.io" };

function searchReq(body: unknown) {
  return new Request("https://worker.test/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function counterEnv() {
  return {
    FRONTEND_ORIGIN: "https://user.github.io",
    COUNTER: {
      idFromName: () => ({}),
      get: () => ({
        fetch: async () =>
          new Response(JSON.stringify({ live: 2, total: 7 }), { status: 200 }),
      }),
    },
  };
}

describe("POST /api/search validation", () => {
  it("rejects short queries with 400", async () => {
    const res = await worker.fetch(searchReq({ query: "a" }), ENV);
    expect(res.status).toBe(400);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await worker.fetch(searchReq({ nope: 1 }), ENV);
    expect(res.status).toBe(400);
  });

  it("returns an SSE stream for a valid query", async () => {
    const res = await worker.fetch(searchReq({ query: "ableton" }), ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
  });
});

describe("visitor counter routes", () => {
  it("returns 503 for stats when the counter binding is missing", async () => {
    const res = await worker.fetch(
      new Request("https://worker.test/api/stats"),
      ENV,
    );
    expect(res.status).toBe(503);
  });

  it("relays the visit heartbeat payload with CORS headers", async () => {
    const res = await worker.fetch(
      new Request("https://worker.test/api/visit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ENV.FRONTEND_ORIGIN,
        },
        body: JSON.stringify({ id: "abcd-1234-abcd-1234" }),
      }),
      counterEnv(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://user.github.io",
    );
    expect(await res.json()).toEqual({ live: 2, total: 7 });
  });

  it("serves /api/stats through the counter", async () => {
    const res = await worker.fetch(
      new Request("https://worker.test/api/stats"),
      counterEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ live: 2, total: 7 });
  });
});
