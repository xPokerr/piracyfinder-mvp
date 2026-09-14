// Shared contract between worker and web. Keep in sync on both sides.

export type SourceId = "github" | "npm" | "crates";

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: SourceId;
  score?: number;
  updatedAt?: string;
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
