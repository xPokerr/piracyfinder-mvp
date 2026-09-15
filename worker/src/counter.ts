// Durable Object: one global instance ("global") counts unique anonymous
// visitors and which of them sent a heartbeat recently. SQLite storage keeps
// the totals durable across deployments.

const LIVE_WINDOW_MS = 60_000;

interface SqlStorage {
  exec(query: string, ...params: unknown[]): { toArray(): Record<string, unknown>[] };
}

interface CounterContext {
  storage: { sql: SqlStorage };
}

export class VisitorCounter {
  private ctx: CounterContext;

  constructor(ctx: CounterContext) {
    this.ctx = ctx;
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, last_seen INTEGER NOT NULL)",
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/visit") {
      const body = (await request.json().catch(() => ({}))) as { id?: unknown };
      const id = typeof body.id === "string" ? body.id.trim() : "";
      if (!/^[a-f0-9-]{8,64}$/i.test(id)) {
        return Response.json({ error: "Invalid id" }, { status: 400 });
      }
      this.ctx.storage.sql.exec(
        "INSERT INTO visitors (id, last_seen) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen",
        id,
        Date.now(),
      );
      return this.statsResponse();
    }
    if (request.method === "GET" && url.pathname === "/stats") {
      return this.statsResponse();
    }
    return new Response("Not found", { status: 404 });
  }

  private statsResponse(): Response {
    const now = Date.now();
    const payload = {
      live: this.count("SELECT COUNT(*) AS n FROM visitors WHERE last_seen > ?", now - LIVE_WINDOW_MS),
      total: this.count("SELECT COUNT(*) AS n FROM visitors"),
    };
    return Response.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  private count(query: string, ...params: unknown[]): number {
    const rows = this.ctx.storage.sql.exec(query, ...params).toArray();
    return Number(rows[0]?.n ?? 0);
  }
}
