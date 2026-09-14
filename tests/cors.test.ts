import { describe, expect, it } from "vitest";
import worker from "../worker/src/index.ts";

const ENV = { FRONTEND_ORIGIN: "https://user.github.io" };

function req(path: string, origin?: string, method = "GET") {
  const headers = new Headers();
  if (origin !== undefined) headers.set("Origin", origin);
  return new Request(`https://worker.test${path}`, { method, headers });
}

describe("CORS", () => {
  it("echoes localhost dev origins", async () => {
    const res = await worker.fetch(req("/api/sources", "http://localhost:5173"), ENV);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173",
    );
  });

  it("allows the exact FRONTEND_ORIGIN", async () => {
    const res = await worker.fetch(req("/api/sources", ENV.FRONTEND_ORIGIN), ENV);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ENV.FRONTEND_ORIGIN);
  });

  it("sends no Access-Control-Allow-Origin for disallowed origins", async () => {
    const res = await worker.fetch(req("/api/sources", "https://evil.com"), ENV);
    expect(res.status).toBe(200); // still useful, just no CORS grant
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("serves requests without Origin (curl) without CORS headers", async () => {
    const res = await worker.fetch(req("/api/sources"), ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("answers OPTIONS preflight without granting disallowed origins", async () => {
    const res = await worker.fetch(
      req("/api/sources", "https://evil.com", "OPTIONS"),
      ENV,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
