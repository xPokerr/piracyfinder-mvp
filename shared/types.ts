// Shared contract between worker and web. Keep in sync on both sides.

import type { OsFilter } from "./os.ts";

// One id per megathread "Direct downloads" site wired into the registry.
export type SourceId =
  | "cracksurl"
  | "aedownload"
  | "appdoze"
  | "downloadpirate"
  | "gift4designer"
  | "hunterae"
  | "introhd"
  | "matesfx"
  | "motka"
  | "plc4me"
  | "softlay"
  | "vfxmed";

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: SourceId;
  score?: number;
  updatedAt?: string;
  /** OS evidence from the site's own category tags, when extractable. */
  os?: OsFilter;
}

export type SourceState =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "timeout";

export interface SourceStatus {
  source: SourceId;
  state: SourceState;
  count: number;
  ms?: number;
  error?: string;
}

export interface SourceInfo {
  id: SourceId;
  label: string;
  description: string;
}

export type SseEventName = "status" | "result" | "done" | "error";

export interface SearchRequest {
  query: string;
}

export interface DonePayload {
  total: number;
  statuses: SourceStatus[];
}
