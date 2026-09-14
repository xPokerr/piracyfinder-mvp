import { makeSiteAdapter } from "./site.ts";
import { SITES } from "./sites.ts";
import type { SourceAdapter } from "./types.ts";

export type { SourceAdapter } from "./types.ts";
export { SITES } from "./sites.ts";

export const adapters: SourceAdapter[] = SITES.map(makeSiteAdapter);

export const adapterMap: Record<string, SourceAdapter> = Object.fromEntries(
  adapters.map((a) => [a.id, a]),
);
