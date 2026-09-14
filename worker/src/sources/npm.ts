import type { SearchResult } from "../../../shared/types.ts";
import type { SourceAdapter } from "./types.ts";

const API = "https://registry.npmjs.org/-/v1/search";

interface NpmHit {
  package: {
    name: string;
    description?: string;
    date?: string;
    links: { npm: string; repository?: string };
  };
}

export const npmAdapter: SourceAdapter = {
  id: "npm",
  label: "npm",
  description: "Package search via registry.npmjs.org",
  async search(query: string, signal: AbortSignal): Promise<SearchResult[]> {
    const res = await fetch(
      `${API}?text=${encodeURIComponent(query)}&size=20`,
      { signal, headers: { Accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`npm error ${res.status}`);
    const data = (await res.json()) as { objects?: NpmHit[] };
    return (data.objects ?? []).slice(0, 20).map((h) => ({
      id: `npm-${h.package.name}`,
      title: h.package.name,
      url: h.package.links.npm,
      snippet: h.package.description ?? "",
      source: "npm" as const,
      updatedAt: h.package.date,
    }));
  },
};
