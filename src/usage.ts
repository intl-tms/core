// Pure usage helpers. They are public so a server can deduplicate without
// pulling in browser code.

import type { UsageEntry } from "./wire.js";

/**
 * Reduces a URL to its origin plus path, dropping the query and the fragment.
 * Parameterised routes stay distinct while tracking noise collapses. A value
 * that is not an absolute URL comes back unchanged.
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin === "null" ? url : parsed.origin + parsed.pathname;
  } catch {
    return url;
  }
}

/**
 * Whether `url` is a parseable absolute URL with the http or https scheme.
 * A stored URL is served back and navigated to from another Editor's panel,
 * so any other scheme could execute in their page: it is refused where it
 * enters and checked again where it is followed.
 */
export function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Counts findings per key, sorted by key so a signature built from it is stable. */
export function aggregateUsage(found: readonly { key: string }[]): UsageEntry[] {
  const counts = new Map<string, number>();
  for (const { key } of found) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** A stable identity for a page's report: `<url>|<key>:<count>,<key>:<count>,…`. */
export function usageSignature(url: string, entries: readonly UsageEntry[]): string {
  return `${url}|${entries.map((e) => `${e.key}:${e.count}`).join(",")}`;
}
