import { cratesAdapter } from "./crates.ts";
import { githubAdapter } from "./github.ts";
import { npmAdapter } from "./npm.ts";
import type { SourceAdapter } from "./types.ts";

export type { SourceAdapter } from "./types.ts";

export const adapters: SourceAdapter[] = [
  githubAdapter,
  npmAdapter,
  cratesAdapter,
];

export const adapterMap: Record<string, SourceAdapter> = Object.fromEntries(
  adapters.map((a) => [a.id, a]),
);
