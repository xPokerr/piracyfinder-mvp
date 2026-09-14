import type { SearchResult } from "../../../shared/types.ts";
import type { SourceAdapter } from "./types.ts";

const API = "https://crates.io/api/v1/crates";

interface Crate {
  id: string;
  description?: string;
  homepage?: string;
  repository?: string;
  updated_at: string;
}

export const cratesAdapter: SourceAdapter = {
  id: "crates",
  label: "crates.io",
  description: "Rust crate search via crates.io API",
  async search(query: string, signal: AbortSignal): Promise<SearchResult[]> {
    const res = await fetch(
      `${API}?q=${encodeURIComponent(query)}&per_page=20`,
      {
        signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "piracyfinder-mvp (open-source metasearch)",
        },
      },
    );
    if (!res.ok) throw new Error(`crates.io error ${res.status}`);
    const data = (await res.json()) as { crates?: Crate[] };
    return (data.crates ?? []).slice(0, 20).map((c) => ({
      id: `crates-${c.id}`,
      title: c.id,
      url:
        c.homepage && c.homepage.startsWith("https://")
          ? c.homepage
          : c.repository && c.repository.startsWith("https://")
            ? c.repository
            : `https://crates.io/crates/${c.id}`,
      snippet: c.description ?? "",
      source: "crates" as const,
      updatedAt: c.updated_at,
    }));
  },
};
