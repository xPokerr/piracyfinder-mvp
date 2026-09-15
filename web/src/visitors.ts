// Anonymous visitor presence and totals. A random per-browser id lives in
// localStorage (no cookies, nothing identifiable); a heartbeat every 20s
// keeps the "online" count fresh and animates the numbers in the header.

const VID_KEY = "threadseek_vid";

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

function visitorId(): string {
  let id = localStorage.getItem(VID_KEY);
  if (!id || !/^[a-f0-9-]{8,64}$/i.test(id)) {
    id = randomId();
    localStorage.setItem(VID_KEY, id);
  }
  return id;
}

interface VisitStats {
  live: number;
  total: number;
}

export function initVisitors(apiBase: string): void {
  const wrapEl = document.querySelector<HTMLElement>("#visitors");
  if (!wrapEl) return;
  const wrap: HTMLElement = wrapEl;
  const liveEl = wrap.querySelector<HTMLElement>("#v-live")!;
  const totalEl = wrap.querySelector<HTMLElement>("#v-total")!;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let current: VisitStats = { live: 0, total: 0 };

  const setNum = (el: HTMLElement, from: number, to: number) => {
    // Background tabs freeze rAF: write the value directly there (and for
    // reduced motion); the tween only runs in visible tabs.
    if (reduced || from === to || document.hidden) {
      el.textContent = String(to);
      return;
    }
    el.classList.add("tick");
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 500);
      el.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
      else el.classList.remove("tick");
    };
    requestAnimationFrame(step);
  };

  async function beat() {
    try {
      const res = await fetch(`${apiBase}/api/visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: visitorId() }),
      });
      if (!res.ok) return;
      const stats = (await res.json()) as VisitStats;
      const prev = { ...current };
      current = stats;
      setNum(liveEl, prev.live, stats.live);
      setNum(totalEl, prev.total, stats.total);
      wrap.hidden = false;
    } catch {
      /* counter unreachable: hide the badge rather than show wrong data */
    }
  }

  void beat();
  setInterval(beat, 20_000);
}
