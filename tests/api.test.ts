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
