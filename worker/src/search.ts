import type {
  DonePayload,
  SearchResult,
  SourceId,
  SourceStatus,
  SseEventName,
} from "../../shared/types.ts";
import { adapters, type SourceAdapter } from "./sources/registry.ts";
import { ASSET_SITE_IDS, HOST_ALLOWLIST } from "./sources/sites.ts";

export {
  PER_SOURCE_TIMEOUT_MS,
  TOTAL_BUDGET_MS,
  MAX_PER_SOURCE,
  MAX_TOTAL,
  ASSET_SITE_CAP,
} from "./limits.ts";

import {
  PER_SOURCE_TIMEOUT_MS,
  TOTAL_BUDGET_MS,
  MAX_PER_SOURCE,
  MAX_TOTAL,
  ASSET_SITE_CAP,
} from "./limits.ts";

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

/**
 * Relevance gate: sites with full-text OR search return loosely related
 * posts (body matches, sidebar widgets), so keep only results whose title
 * contains at least one query term. Titles without any term are junk.
 */
export function titleTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 2);
}

export function isRelevantTitle(title: string, query: string): boolean {
  const tokens = titleTokens(query);
  if (tokens.length === 0) return true;
  const t = title.toLowerCase();
  return tokens.some((tok) => t.includes(tok));
}

// Courses and guides are not the downloadable software this engine is for.
const JUNK_RE =
  /\b(tutorials?|courses?|trainings?|lessons?|e-?books?|guides?|handbooks?|masterclasses?|webinars?|workshops?)\b|\bhow[- ]to\b/gi;

/**
 * Drop course/tutorial-like posts unless the query explicitly asks for one
 * (every junk word in the title must also appear in the query to keep it).
 */
export function isJunkTitle(title: string, query: string): boolean {
  const q = query.toLowerCase();
  for (const m of title.matchAll(JUNK_RE)) {
    const word = (m[1] ?? "how to").toLowerCase();
    if (!q.includes(word)) return true;
  }
  return false;
}

// Add-on resources built FOR a program are not the program itself.
const ASSET_SRC =
  "actions?|templates?|brushes?|presets?|mockups?|fonts?|typefaces?|overlays?|luts?|textures?|plugins?|extensions?|add-?ons?|scripts?|panels?|styles|icons?|vectors?|illustrations?|openers?|slideshows?|transitions?|titles";
const ASSET_RE = new RegExp(`\\b(?:${ASSET_SRC})\\b`, "i");

/**
 * Drop asset/add-on posts when the query is really about the host program:
 * "Photoshop Actions", "Photoshop Template" or "... Plugin for Photoshop"
 * are noise for a "photoshop" search. Titles stay when the query itself
 * names the asset ("photoshop brushes") or the product (query "lumenzia"
 * against "Lumenzia plugin for photoshop" keeps it, the token is the
 * subject there, not a qualifier).
 */
export function isAssetTitle(title: string, query: string): boolean {
  if (ASSET_RE.test(query)) return false;
  const tokens = titleTokens(query).filter((t) => t.length >= 3);
  if (tokens.length === 0) return false;
  const t = title.toLowerCase();
  for (const tok of tokens) {
    // "<token> ... <asset>" — the token qualifies the asset ("photoshop actions").
    if (
      new RegExp(`\\b${tok}\\b[^.,;|()]{0,30}?\\b(?:${ASSET_SRC})\\b`, "i").test(
        t,
      )
    ) {
      return true;
    }
    // "<asset> ... <token>" — asset word before the product name
    // ("Christmas Titles - DaVinci Resolve").
    if (
      new RegExp(`\\b(?:${ASSET_SRC})\\b[^.,;|()]{0,30}?\\b${tok}\\b`, "i").test(
        t,
      )
    ) {
      return true;
    }
    // "<asset> for <token>" — "plugin for photoshop".
    if (
      new RegExp(`\\b(?:${ASSET_SRC})\\b\\s+for\\s+\\b${tok}\\b`, "i").test(t)
    ) {
      return true;
    }
    // "<anything> for <token>" — when the query names the host ("Y for
    // Photoshop", optionally with a brand word in between), it is an add-on.
    // "X for Mac" style titles are unaffected: the token is the product there.
    if (new RegExp(`\\bfor\\s+(?:[a-z0-9]+\\s+)?${tok}\\b`, "i").test(t)) {
      return true;
    }
  }
  return false;
}

export function isAllowedUrl(url: string, source: SourceId): boolean {
  const allow = HOST_ALLOWLIST[source];
  if (!allow) return false;
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
  query: string,
): SearchResult[] {
  // Design/asset libraries flood program searches; when the query is not
  // asset-seeking, keep only a few picks from them so software sites dominate.
  const cap =
    ASSET_SITE_IDS.has(source) && !ASSET_RE.test(query)
      ? ASSET_SITE_CAP
      : MAX_PER_SOURCE;
  const out: SearchResult[] = [];
  for (const r of items) {
    if (!r.title || !r.url) continue;
    if (!isRelevantTitle(r.title, query)) continue;
    if (isJunkTitle(r.title, query)) continue;
    if (isAssetTitle(r.title, query)) continue;
    const url = normalizeUrl(r.url);
    if (!url || !isAllowedUrl(url, source)) continue;
    out.push({
      ...r,
      title: r.title.slice(0, 200),
      snippet: (r.snippet ?? "").slice(0, 500),
      url,
    });
  }
  return out.slice(0, cap);
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
    const clean = sanitizeResults(raw, adapter.id, query);
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
