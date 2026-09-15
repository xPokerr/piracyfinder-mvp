import { fetchSources, streamSearch } from "./search.ts";
import { detectOs, type OsFilter } from "../../shared/os.ts";

interface Result {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  /** OS evidence from the site's category tags, when the worker found it. */
  os?: "windows" | "mac";
}

interface Status {
  source: string;
  state: "queued" | "running" | "done" | "error" | "timeout";
  count: number;
  ms?: number;
  error?: string;
}

interface Chip {
  label: string;
  status: Status | null;
  enabled: boolean;
}

const form = document.querySelector<HTMLFormElement>("#search-form")!;
const input = document.querySelector<HTMLInputElement>("#q")!;
const go = document.querySelector<HTMLButtonElement>("#go")!;
const cancelBtn = document.querySelector<HTMLButtonElement>("#cancel")!;
const live = document.querySelector("#live")!;
const resultsEl = document.querySelector("#results")!;
const sourcesEl = document.querySelector("#sources")!;
const emptyEl = document.querySelector<HTMLElement>("#empty")!;
const emptyQ = document.querySelector<HTMLElement>("#empty-q")!;
const emptyFail = document.querySelector<HTMLElement>("#empty-fail")!;
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

const EXT_ARROW =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';

let current: AbortController | null = null;
let querySeq = 0;
let osFilter: OsFilter | null = null;
let searching = false;
let searchStartedAt = 0;
const seen = new Map<string, Result>();
const chips = new Map<string, Chip>();
const assetSites = new Set<string>();

// OS evidence: category tags from the site (worker-set `os` field) win over
// title heuristics. Mac filter keeps only explicit Mac evidence; Windows
// filter hides Mac-only results (untitled posts are Windows-first here).
function resultOs(r: Result): OsFilter | null {
  if (r.os === "windows" || r.os === "mac") return r.os;
  return detectOs(r.title);
}

function osVisible(r: Result): boolean {
  if (!osFilter) return true;
  const detected = resultOs(r);
  return osFilter === "mac" ? detected === "mac" : detected !== "mac";
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

/* ---------- source chips: live status + result filter ---------- */

async function loadSources() {
  try {
    for (const s of await fetchSources()) {
      chips.set(s.id, { label: s.label, status: null, enabled: true });
      if (s.assetSite) assetSites.add(s.id);
    }
    renderSources();
  } catch {
    sourcesEl.innerHTML =
      '<span class="source-chip">Source list unavailable.</span>';
  }
}

function renderSources() {
  sourcesEl.innerHTML = "";
  for (const [id, chip] of chips) {
    const b = document.createElement("button");
    b.type = "button";
    const state = chip.status?.state ?? "idle";
    b.className = `source-chip ${state}`;
    b.setAttribute("aria-pressed", String(chip.enabled));
    b.title =
      chip.status?.error ??
      `${chip.label}: ${state}${chip.status?.count ? ` (${chip.status.count})` : ""}`;
    b.addEventListener("click", () => {
      chip.enabled = !chip.enabled;
      renderSources();
      renderResults();
    });
    const dot = document.createElement("span");
    dot.className = "dot";
    const label = document.createElement("span");
    label.textContent = chip.label;
    b.append(dot, label);
    if (chip.status?.count) {
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = String(chip.status.count);
      b.append(count);
    }
    sourcesEl.appendChild(b);
  }
}

/* ---------- results ---------- */

function hue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function skeleton(): HTMLElement {
  const div = document.createElement("div");
  div.className = "skel";
  return div;
}

function cardFor(r: Result): HTMLElement {
  const card = document.createElement("article");
  card.className = "card";

  const avatar = document.createElement("span");
  avatar.className = "avatar";
  avatar.style.setProperty("--h", String(hue(r.source)));
  avatar.textContent = (chips.get(r.source)?.label ?? r.source)
    .charAt(0)
    .toUpperCase();

  const main = document.createElement("div");
  main.className = "card-main";

  const h = document.createElement("h2");
  const a = document.createElement("a");
  a.href = r.url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = r.title;
  h.append(a);

  const meta = document.createElement("p");
  meta.className = "card-meta";
  const src = document.createElement("span");
  src.className = "src-chip";
  src.textContent = chips.get(r.source)?.label ?? r.source;
  meta.append(src);
  const detected = resultOs(r);
  if (detected) {
    const osBadge = document.createElement("span");
    osBadge.className = "os-badge";
    osBadge.title = detected === "mac" ? "macOS" : "Windows";
    osBadge.innerHTML = OS_SVG[detected];
    meta.append(osBadge);
  }
  const host = document.createElement("span");
  host.className = "host";
  try {
    host.textContent = new URL(r.url).hostname.replace(/^www\./, "");
  } catch {
    /* keep empty */
  }
  meta.append(host);

  main.append(h, meta);
  if (r.snippet) {
    const p = document.createElement("p");
    p.className = "snippet";
    p.textContent = r.snippet;
    main.append(p);
  }

  const arrow = document.createElement("span");
  arrow.className = "ext-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.innerHTML = EXT_ARROW;

  card.append(avatar, main, arrow);
  return card;
}

function visibleResults(): Result[] {
  // Software sites first; asset libraries keep their picks but rank after.
  return [...seen.values()]
    .filter(
      (r) => chips.get(r.source)?.enabled !== false && osVisible(r),
    )
    .sort(
      (a, b) =>
        Number(assetSites.has(a.source)) - Number(assetSites.has(b.source)),
    );
}

function renderResults() {
  resultsEl.innerHTML = "";
  const rows = visibleResults();
  if (rows.length === 0) {
    // While the search is running, shimmering skeletons signal progress.
    if (searching) {
      for (let i = 0; i < 6; i++) resultsEl.append(skeleton());
    }
    return;
  }
  for (const r of rows) resultsEl.append(cardFor(r));
}

function showEmpty(query: string) {
  emptyQ.textContent = query;
  const failed = [...chips.values()].filter(
    (c) => c.status && (c.status.state === "error" || c.status.state === "timeout"),
  );
  if (failed.length > 0) {
    emptyFail.textContent = `Some sites could not be reached: ${failed
      .map((c) => c.label)
      .join(", ")}.`;
    emptyFail.hidden = false;
  } else {
    emptyFail.hidden = true;
  }
  emptyEl.hidden = false;
}

/* ---------- search flow ---------- */

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
  searching = true;
  searchStartedAt = performance.now();
  seen.clear();
  emptyEl.hidden = true;
  resultsEl.innerHTML = "";
  live.textContent = `Searching “${query}” across ${chips.size} sites…`;
  go.disabled = true;
  cancelBtn.disabled = false;
  renderResults();

  streamSearch(query, {
    signal: current.signal,
    onEvent: (event, data) => {
      if (seq !== querySeq) return; // stale stream
      if (event === "status") {
        const s = data as Status;
        const chip = chips.get(s.source);
        if (chip) chip.status = s;
        renderSources();
      } else if (event === "result") {
        const r = data as Result;
        if (!seen.has(r.url)) {
          seen.set(r.url, r);
          renderResults();
        }
      } else if (event === "done") {
        searching = false;
        go.disabled = false;
        cancelBtn.disabled = true;
        renderResults();
        const secs = ((performance.now() - searchStartedAt) / 1000).toFixed(1);
        const total = (data as { total: number }).total;
        if (total === 0) {
          showEmpty(query);
          live.textContent = "No results.";
        } else {
          live.textContent = `${total} results · ${secs}s`;
        }
      } else if (event === "error") {
        searching = false;
        live.textContent = "Search failed.";
        go.disabled = false;
        cancelBtn.disabled = true;
        renderResults();
      }
    },
  }).catch((err) => {
    if (seq !== querySeq) return;
    searching = false;
    if (err instanceof Error && err.name === "AbortError") {
      live.textContent = "Search cancelled.";
    } else {
      live.textContent = "Search failed.";
    }
    go.disabled = false;
    cancelBtn.disabled = true;
    renderResults();
  });
});

cancelBtn.addEventListener("click", () => {
  current?.abort();
  querySeq++; // isolate: late chunks from cancelled stream are ignored
  searching = false;
  live.textContent = "Search cancelled.";
  go.disabled = false;
  cancelBtn.disabled = true;
  renderResults();
});

for (const b of document.querySelectorAll<HTMLButtonElement>("#suggest [data-q]")) {
  b.addEventListener("click", () => {
    input.value = b.dataset.q ?? "";
    form.requestSubmit();
  });
}

loadSources();
