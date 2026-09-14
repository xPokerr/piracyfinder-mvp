import { fetchSources, streamSearch } from "./search.ts";

interface Result {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
}

interface Status {
  source: string;
  state: string;
  count: number;
  ms?: number;
  error?: string;
}

const form = document.querySelector<HTMLFormElement>("#search-form")!;
const input = document.querySelector<HTMLInputElement>("#q")!;
const go = document.querySelector<HTMLButtonElement>("#go")!;
const cancelBtn = document.querySelector<HTMLButtonElement>("#cancel")!;
const live = document.querySelector("#live")!;
const progress = document.querySelector("#progress")!;
const resultsEl = document.querySelector("#results")!;
const filters = document.querySelector<HTMLFieldSetElement>("#filters")!;

let current: AbortController | null = null;
let querySeq = 0;
const seen = new Map<string, Result>();
const activeFilters = new Set<string>();

function renderProgress(statuses: Map<string, Status>) {
  progress.innerHTML = "";
  for (const [id, s] of statuses) {
    const div = document.createElement("div");
    div.className = "prog";
    div.textContent = `${id}: ${s.state}${s.count ? ` (${s.count})` : ""}${s.error ? ` — ${s.error}` : ""}`;
    progress.appendChild(div);
  }
}

function renderResults() {
  resultsEl.innerHTML = "";
  for (const r of seen.values()) {
    if (!activeFilters.has(r.source)) continue;
    const url = new URL(r.url, location.href);
    if (url.protocol !== "https:") continue;
    const card = document.createElement("article");
    card.className = "card";
    const h = document.createElement("h2");
    const a = document.createElement("a");
    a.href = r.url;
    a.rel = "noopener noreferrer";
    a.textContent = r.title;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = r.source;
    h.append(a, badge);
    const p = document.createElement("p");
    p.textContent = r.snippet;
    card.append(h, p);
    resultsEl.appendChild(card);
  }
}

async function loadFilters() {
  try {
    const sources = await fetchSources();
    filters.innerHTML = "<legend>Filter by source</legend>";
    for (const s of sources) {
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = s.id;
      box.setAttribute("aria-label", `Show ${s.label} results`);
      box.addEventListener("change", () => {
        // Rebuild the visible set from checkboxes.
        activeFilters.clear();
        filters
          .querySelectorAll<HTMLInputElement>("input[type=checkbox]")
          .forEach((c) => {
            if (c.checked) activeFilters.add(c.value);
          });
        renderResults();
      });
      box.checked = true;
      label.append(box, ` ${s.label}`);
      filters.appendChild(label);
    }
    // Default: all visible.
    activeFilters.clear();
    sources.forEach((s) => activeFilters.add(s.id));
  } catch {
    filters.textContent = "Source filter unavailable.";
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const query = input.value.trim();
  if (query.length < 2 || query.length > 150) {
    live.textContent = "Query must be 2-150 characters.";
    return;
  }
  current?.abort();
  current = new AbortController();
  const seq = ++querySeq;
  const statuses = new Map<string, Status>();
  seen.clear();
  resultsEl.innerHTML = "";
  progress.innerHTML = "";
  live.textContent = `Searching for "${query}"…`;
  go.disabled = true;
  cancelBtn.disabled = false;

  streamSearch(query, {
    signal: current.signal,
    onEvent: (event, data) => {
      if (seq !== querySeq) return; // stale stream
      if (event === "status") {
        const s = data as Status;
        statuses.set(s.source, s);
        renderProgress(statuses);
        live.textContent = `${s.source}: ${s.state}`;
      } else if (event === "result") {
        const r = data as Result;
        if (!seen.has(r.url)) {
          seen.set(r.url, r);
          renderResults();
        }
      } else if (event === "done") {
        const d = data as { total: number };
        live.textContent = `Done — ${d.total} results.`;
        go.disabled = false;
        cancelBtn.disabled = true;
      } else if (event === "error") {
        live.textContent = "Search failed.";
        go.disabled = false;
        cancelBtn.disabled = true;
      }
    },
  }).catch((err) => {
    if (seq !== querySeq) return;
    if (err instanceof Error && err.name === "AbortError") {
      live.textContent = "Search cancelled.";
    } else {
      live.textContent = "Search failed.";
    }
    go.disabled = false;
    cancelBtn.disabled = true;
  });
});

cancelBtn.addEventListener("click", () => {
  current?.abort();
  querySeq++; // isolate: late chunks from cancelled stream are ignored
  live.textContent = "Search cancelled.";
  go.disabled = false;
  cancelBtn.disabled = true;
});

loadFilters();
