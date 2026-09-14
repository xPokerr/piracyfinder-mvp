import type { SearchResult, SourceId } from "../../../shared/types.ts";

export interface SourceAdapter {
  id: SourceId;
  label: string;
  description: string;
  search(query: string, signal: AbortSignal): Promise<SearchResult[]>;
}
