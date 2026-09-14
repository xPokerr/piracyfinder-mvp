// Operating-system helpers shared by worker and web.

export type OsFilter = "windows" | "mac";

/** Token appended to per-site queries when an OS filter is active. */
export const OS_TOKEN: Record<OsFilter, string> = {
  windows: "windows",
  mac: "mac",
};

const MAC =
  /\bmac\b|\bmacos\b|\bmac\s+os\b|\bos\s+x\b|apple\s*silicon|\bfor\s+mac\b/i;
const WIN =
  /\bwindows?\b|\bwin\s*(?:7|8|8\.1|10|11)\b|\bx64\b|\bx86\b|\bwin64\b/i;

/**
 * Best-effort OS detection from a result title. Returns null when the title
 * gives no evidence (most megathread posts are Windows-first and untitled,
 * so "unknown" results stay visible under the Windows filter).
 */
export function detectOs(title: string): OsFilter | null {
  if (MAC.test(title)) return "mac";
  return WIN.test(title) ? "windows" : null;
}
