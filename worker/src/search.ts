import type {
  DonePayload,
  SearchResult,
  SourceId,
  SourceStatus,
  SseEventName,
} from "../../shared/types.ts";
import { adapters, type SourceAdapter } from "./sources/registry.ts";

export const PER_SOURCE_TIMEOUT_MS = 6000;
export const TOTAL_BUDGET_MS = 8000;
export const MAX_PER_SOURCE = 20;
export const MAX_TOTAL = 60;

const HOST_ALLOWLIST: Record<SourceId, string[] | null> = {
  github: ["github.com"],
  npm: ["www.npmjs.com", "npmjs.com"],
  crates: null, // crate homepages may point anywhere; require https
};

export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:") return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    const s = u.toString().replace(/\/$/, "");
    return s;
  } catch {
    return null;
  }
}

export function isAllowedUrl(url: string, source: SourceId): boolean {
  const allow = HOST_ALLOWLIST[source];
  if (!allow) return normalizeUrl(url) !== null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return allow.includes(host);
  } catch {
    return false;
  }
}

export function sanitizeResults(
  items: SearchResult[],
  source: SourceId,
): SearchResult[] {
  const out: SearchResult[] = [];
  for (const r of items) {
    if (!r.title || !r.url) continue;
    const url = normalizeUrl(r.url);
    if (!url || !isAllowedUrl(url, source)) continue;
    out.push({
      ...r,
      title: r.title.slice(0, 200),
      snippet: (r.snippet ?? "").slice(0, 500),
      url,
    });
  }
  return out.slice(0, MAX_PER_SOURCE);
}

export function dedupe(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = r.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validateQuery(value: unknown): string {
  if (typeof value !== "object" || value === null) throw new Error("Invalid body");
  const q = (value as { query?: unknown }).query;
  if (typeof q !== "string") throw new Error("Query must be a string");
  const query = q.trim();
  if (query.length < 2 || query.length > 150) {
    throw new Error("Query must be 2-150 characters");
  }
  return query;
}

export type Emit = (event: SseEventName, data: unknown) => void;

async function runOne(
  adapter: SourceAdapter,
  query: string,
  parentSignal: AbortSignal,
  emit: Emit,
): Promise<SearchResult[]> {
  const started = Date.now();
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (parentSignal.aborted) ctrl.abort();
  parentSignal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), PER_SOURCE_TIMEOUT_MS);
  emit("status", {
    source: adapter.id,
    state: "running",
    count: 0,
  } satisfies SourceStatus);
  try {
    const raw = await adapter.search(query, ctrl.signal);
    const clean = sanitizeResults(raw, adapter.id);
    emit("status", {
      source: adapter.id,
      state: "done",
      count: clean.length,
      ms: Date.now() - started,
    } satisfies SourceStatus);
    return clean;
  } catch (err) {
    const timeout =
      ctrl.signal.aborted || (err instanceof Error && err.name === "AbortError");
    emit("status", {
      source: adapter.id,
      state: timeout ? "timeout" : "error",
      count: 0,
      ms: Date.now() - started,
      error:
        timeout
          ? "Source timed out"
          : err instanceof Error
            ? err.message
            : "Source failed",
    } satisfies SourceStatus);
    return [];
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", onAbort);
  }
}

export async function runSearch(
  query: string,
  emit: Emit,
  srcs: SourceAdapter[] = adapters,
): Promise<DonePayload> {
  const total = new AbortController();
  const totalTimer = setTimeout(() => total.abort(), TOTAL_BUDGET_MS);
  const statuses: SourceStatus[] = [];
  const capture: Emit = (event, data) => {
    if (event === "status") statuses.push(data as SourceStatus);
    emit(event, data);
  };
  // Global URL dedupe across sources; each source emits its results as soon
  // as it finishes so a fast source streams before a slow one.
  const seen = new Set<string>();
  let emitted = 0;
  const emitResults = (clean: SearchResult[]) => {
    for (const r of clean) {
      if (emitted >= MAX_TOTAL) break;
      const key = r.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      emitted++;
      emit("result", r);
    }
  };
  try {
    await Promise.all(
      srcs.map((a) => runOne(a, query, total.signal, capture).then(emitResults)),
    );
    const done: DonePayload = { total: emitted, statuses };
    emit("done", done);
    return done;
  } finally {
    clearTimeout(totalTimer);
  }
}

export function formatSse(event: SseEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
