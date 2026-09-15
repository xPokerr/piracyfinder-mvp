import type { SourceInfo } from "../../shared/types.ts";
import { formatSse, runSearch, validateQuery } from "./search.ts";
import { adapters } from "./sources/registry.ts";
import { ASSET_SITE_IDS } from "./sources/sites.ts";

interface Env {
  FRONTEND_ORIGIN?: string;
}

function allowedOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get("Origin") ?? "";
  if (!origin) return null;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  if (env.FRONTEND_ORIGIN && origin === env.FRONTEND_ORIGIN) return origin;
  return null;
}

function corsHeaders(req: Request, env: Env): Headers {
  const h = new Headers();
  const origin = allowedOrigin(req, env);
  if (origin) h.set("Access-Control-Allow-Origin", origin);
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type");
  return h;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    }

    if (req.method === "GET" && url.pathname === "/api/sources") {
      const sources: SourceInfo[] = adapters.map((a) => ({
        id: a.id,
        label: a.label,
        description: a.description,
        assetSite: ASSET_SITE_IDS.has(a.id),
      }));
      return Response.json(sources, { headers: corsHeaders(req, env) });
    }

    if (req.method === "POST" && url.pathname === "/api/search") {
      let query: string;
      try {
        query = validateQuery(await req.json());
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : "Bad request" },
          { status: 400, headers: corsHeaders(req, env) },
        );
      }
      // Never log the query string.
      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: unknown) =>
            controller.enqueue(
              new TextEncoder().encode(formatSse(event as never, data)),
            );
          try {
            await runSearch(query, send);
          } catch {
            send("error", { message: "Search failed" });
          } finally {
            controller.close();
          }
        },
      });
      const headers = corsHeaders(req, env);
      headers.set("Content-Type", "text/event-stream");
      headers.set("Cache-Control", "no-cache");
      return new Response(stream, { headers });
    }

    return new Response("Not found", {
      status: 404,
      headers: corsHeaders(req, env),
    });
  },
};
