import type { SearchResult } from "../../../shared/types.ts";
import type { SourceAdapter } from "./types.ts";

const API = "https://api.github.com/search/repositories";

interface GithubRepo {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  updated_at: string;
}

export const githubAdapter: SourceAdapter = {
  id: "github",
  label: "GitHub",
  description: "Repository search (unauthenticated, rate-limited)",
  async search(query: string, signal: AbortSignal): Promise<SearchResult[]> {
    const res = await fetch(
      `${API}?q=${encodeURIComponent(query)}&per_page=20`,
      { signal, headers: { Accept: "application/vnd.github+json" } },
    );
    if (res.status === 403 || res.status === 429) {
      throw new Error("GitHub rate limit reached, retry shortly");
    }
    if (!res.ok) throw new Error(`GitHub error ${res.status}`);
    const data = (await res.json()) as { items?: GithubRepo[] };
    return (data.items ?? []).slice(0, 20).map((r) => ({
      id: `github-${r.id}`,
      title: r.full_name,
      url: r.html_url,
      snippet: r.description ?? "",
      source: "github" as const,
      updatedAt: r.updated_at,
    }));
  },
};
