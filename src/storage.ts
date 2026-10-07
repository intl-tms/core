// The storage seam: the one interface the request handler is written against,
// and a complete in-memory adapter for tests and spikes.

import type { Capability, LocaleOf, OpenRow, RowOf } from "./config.js";
import type { IsUntyped, RuntimeUsage, Usage, UsageReport, Write } from "./wire.js";
import { isEmptyPatch, writePatch } from "./wire.js";

/** A value or a promise of it. */
export type MaybePromise<T> = T | Promise<T>;

/** The Locales an adapter stores, typed by the configuration. */
export type AdapterLocale<C> = IsUntyped<C> extends true ? string : LocaleOf<C>;

/** The rows an adapter stores, typed by the configuration. */
export type AdapterRow<C> = IsUntyped<C> extends true ? OpenRow : RowOf<C>;

/** One Locale's write as an untyped adapter receives it. */
export interface UntypedWrite {
  locale: string;
  value?: string;
  fields?: Record<string, string>;
}

/**
 * An adapter typed for no particular configuration. It fits a handler built
 * for any configuration.
 */
export interface UntypedStorageAdapter {
  getValues: (key: string) => MaybePromise<Partial<Record<string, OpenRow>>>;
  saveValue: (key: string, write: UntypedWrite) => MaybePromise<void>;
  getUsage: (key: string) => MaybePromise<Usage[]>;
  reportUsage: (report: UsageReport) => MaybePromise<void>;
}

/** An adapter typed for one configuration. */
export interface TypedStorageAdapter<C> {
  getValues: (key: string) => MaybePromise<Partial<Record<AdapterLocale<C>, AdapterRow<C>>>>;
  saveValue: (key: string, write: Write<C>) => MaybePromise<void>;
  getUsage: (key: string) => MaybePromise<Usage[]>;
  reportUsage: (report: UsageReport) => MaybePromise<void>;
}

/**
 * Where rows live. Four operations are the whole required surface, and each
 * can be implemented against any database:
 *
 * - `getValues(key)`: every stored Locale for one key. Sparse: a Locale with no
 *   row is absent. Empty when nothing is stored.
 * - `saveValue(key, write)`: upserts one (key, Locale) as a partial merge of
 *   the supplied columns. A new row starts with an empty `value`. Use
 *   `writePatch` to see which columns a write touches; an empty patch means do
 *   nothing.
 * - `getUsage(key)`: a key's usages, most recently seen first. Empty when
 *   there are none.
 * - `reportUsage(report)`: upserts each (key, URL) in a report, overwriting
 *   count and last-seen. Never prunes.
 *
 * An adapter never answers HTTP and never validates input: it is handed only
 * validated, rebuilt data. Typed for a configuration, it is a compile error to
 * give it to a handler built for another; left untyped, it fits any
 * configuration.
 *
 * The members are declared as properties rather than methods on purpose:
 * method parameters are compared bivariantly, which would let a mismatched
 * adapter through.
 */
export type StorageAdapter<C = unknown> = IsUntyped<C> extends true ? UntypedStorageAdapter : TypedStorageAdapter<C>;

/** Options for {@link createMemoryAdapter}. */
export interface MemoryAdapterOptions {
  /** Time source for `lastSeen`, so tests can order usages without sleeping. Defaults to the system clock. */
  clock?: () => number | Date;
  /** Columns a new row starts with, so a partial write that creates a row can fill the others. */
  newRowDefaults?: Record<string, string>;
}

interface StoredUsage extends RuntimeUsage {
  sequence: number;
}

/**
 * A complete in-memory adapter. It exists so a Developer can drive the real
 * request handler in their own tests with no database. It is for tests and
 * spikes, never for serving: it forgets everything when the process ends and
 * shares nothing between instances.
 */
export function createMemoryAdapter<C = unknown>(options: MemoryAdapterOptions = {}): StorageAdapter<C> {
  const clock = options.clock ?? Date.now;
  const rows = new Map<string, Map<string, Record<string, unknown>>>();
  const usages = new Map<string, Map<string, StoredUsage>>();
  let sequence = 0;

  const adapter = {
    getValues: (key: string) => {
      const locales = rows.get(key);
      return Object.fromEntries([...(locales ?? [])].map(([locale, row]) => [locale, structuredClone(row)]));
    },
    saveValue: (key: string, write: { locale: string; value?: string; fields?: object }) => {
      const patch = writePatch(write);
      if (isEmptyPatch(patch)) return;
      let locales = rows.get(key);
      if (locales === undefined) rows.set(key, (locales = new Map()));
      const row = locales.get(write.locale) ?? { value: "", ...options.newRowDefaults };
      for (const column of Object.keys(patch)) Object.defineProperty(row, column, { value: patch[column], enumerable: true, writable: true, configurable: true });
      locales.set(write.locale, row);
    },
    getUsage: (key: string) =>
      [...(usages.get(key)?.values() ?? [])]
        .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : b.sequence - a.sequence))
        .map(({ sequence: _sequence, ...usage }) => usage),
    reportUsage: (report: UsageReport) => {
      const lastSeen = new Date(clock()).toISOString();
      for (const { key, count } of report.keys) {
        let byUrl = usages.get(key);
        if (byUrl === undefined) usages.set(key, (byUrl = new Map()));
        const title = report.title ?? byUrl.get(report.url)?.title;
        byUrl.set(report.url, { key, source: "runtime", url: report.url, ...(title === undefined ? {} : { title }), count, lastSeen, sequence: sequence++ });
      }
    },
  };
  return adapter as unknown as StorageAdapter<C>;
}

const OPTIONAL_OPERATIONS = {
  saveValueIf: "conflicts-atomic",
  saveValues: "batch-write",
  getValuesMany: "bulk-read",
  deleteValue: "delete",
  reportStaticUsage: "static-usage",
} as const satisfies Record<string, Capability>;

/**
 * Which optional operations an adapter implements. The four required
 * operations always work; anything beyond them is detected, never required, so
 * an adapter implementing only the four still works everywhere.
 */
export function detectAdapterCapabilities(adapter: object): Capability[] {
  const members = adapter as Record<string, unknown>;
  return (Object.keys(OPTIONAL_OPERATIONS) as (keyof typeof OPTIONAL_OPERATIONS)[]).filter((name) => typeof members[name] === "function").map((name) => OPTIONAL_OPERATIONS[name]);
}
