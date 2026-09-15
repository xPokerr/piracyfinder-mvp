// Minimal SSE client over fetch + ReadableStream. Caller owns AbortController
// so a new query or Cancel cleanly isolates streams.

export interface SseHandlers {
  onEvent: (event: string, data: unknown) => void;
  signal: AbortSignal;
}

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

export async function streamSearch(
  query: string,
  { onEvent, signal }: SseHandlers,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Search failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = /^event: (.+)$/m.exec(chunk)?.[1]?.trim() ?? "message";
      const lines = [...chunk.matchAll(/^data: (.*)$/gm)].map((m) => m[1]);
      try {
        onEvent(ev, JSON.parse(lines.join("\n")));
      } catch {
        /* ignore malformed chunk */
      }
    }
  }
}

export async function fetchSources(signal?: AbortSignal) {
  const res = await fetch(`${API_BASE}/api/sources`, { signal });
  if (!res.ok) throw new Error("Could not load sources");
  return (await res.json()) as {
    id: string;
    label: string;
    description: string;
    assetSite?: boolean;
  }[];
}
