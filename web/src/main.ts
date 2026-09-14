import { fetchSources, streamSearch } from "./search.ts";
import { detectOs, type OsFilter } from "../../shared/os.ts";

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
const osButtons = {
  windows: document.querySelector<HTMLButtonElement>("#os-windows")!,
  mac: document.querySelector<HTMLButtonElement>("#os-mac")!,
} as const;

// simple-icons paths (CC0), rendered with currentColor.
const OS_SVG: Record<OsFilter, string> = {
  windows:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M0 3.449 9.75 2.1v9.451H0zm10.949-1.5L24 0v11.4H10.949zM0 12.6h9.75v9.451L0 20.699zM10.949 12.6H24V24l-12.9-1.801z"/></svg>',
  mac: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.702"/></svg>',
};

let current: AbortController | null = null;
let querySeq = 0;
let osFilter: OsFilter | null = null;
const seen = new Map<string, Result>();
const activeFilters = new Set<string>();
const labelById = new Map<string, string>();

function renderProgress(statuses: Map<string, Status>) {
  progress.innerHTML = "";
  for (const [id, s] of statuses) {
    const div = document.createElement("div");
    div.className = "prog";
    div.textContent = `${labelById.get(id) ?? id}: ${s.state}${s.count ? ` (${s.count})` : ""}${s.error ? ` — ${s.error}` : ""}`;
    progress.appendChild(div);
  }
}

// Mac filter keeps only titles with explicit Mac evidence; Windows filter
// hides Mac-only results (untitled posts are Windows-first on these sites).
function osVisible(title: string): boolean {
  if (!osFilter) return true;
  const detected = detectOs(title);
  return osFilter === "mac" ? detected === "mac" : detected !== "mac";
}

function renderResults() {
  resultsEl.innerHTML = "";
  for (const r of seen.values()) {
    if (!activeFilters.has(r.source)) continue;
    if (!osVisible(r.title)) continue;
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
    badge.textContent = labelById.get(r.source) ?? r.source;
    h.append(a, badge);
    const detected = detectOs(r.title);
    if (detected) {
      const osBadge = document.createElement("span");
      osBadge.className = "badge os";
      osBadge.title = detected === "mac" ? "macOS" : "Windows";
      osBadge.innerHTML = OS_SVG[detected];
      h.append(osBadge);
    }
    const p = document.createElement("p");
    p.textContent = r.snippet;
    card.append(h, p);
    resultsEl.appendChild(card);
  }
}

function setOsFilter(os: OsFilter | null) {
  osFilter = os;
  for (const key of Object.keys(osButtons) as OsFilter[]) {
    osButtons[key].setAttribute("aria-pressed", String(os === key));
  }
  renderResults();
}

for (const key of Object.keys(osButtons) as OsFilter[]) {
  osButtons[key].addEventListener("click", () =>
    setOsFilter(osFilter === key ? null : key),
  );
}

async function loadFilters() {
  try {
    const sources = await fetchSources();
    filters.innerHTML = "<legend>Filter by source</legend>";
    for (const s of sources) {
      labelById.set(s.id, s.label);
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
