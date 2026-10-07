// The shapes that cross the wire between a website and its editing tools, and
// the two pure helpers every layer shares.

import type { LocaleOf, OpenRow, WritableRowOf } from "./config.js";

/** A source location a key is referenced from. */
export interface KeyReference {
  path: string;
  line?: number;
}

/**
 * Facts about a key that belong to no single Locale. Every member is optional.
 * The Core defines the shape and consumes it; it owns no mechanism for
 * producing it.
 */
export interface KeyMeta {
  /**
   * The text the key was written for. Read as the authority on that key's
   * wording, so supply it only if the source text really does live in the code.
   */
  sourceMessage?: string;
  /** A note for translators. */
  description?: string;
  references?: KeyReference[];
  /** Nothing references the key any more. */
  orphan?: boolean;
}

/** A Locale's stored row as it travels over the wire. */
export type WireRow = OpenRow;

/**
 * The answer to reading a key. `locales` is sparse: a Locale with no stored
 * row is absent, so a panel can tell "never translated" from "translated to
 * an empty string".
 */
export interface ValuesEnvelope<R = WireRow> {
  meta?: KeyMeta;
  locales: Record<string, R>;
}

/** The columns a write may carry, typed by the configuration. */
export type FieldsOfWrite<C> = Omit<WritableRowOf<C>, "value">;

/** True when a type argument was left off, meaning "typed for no particular configuration". */
export type IsUntyped<C> = [unknown] extends [C] ? true : false;

/** One Locale's partial write, as the storage adapter receives it. */
export interface Write<C = unknown> {
  locale: IsUntyped<C> extends true ? string : LocaleOf<C>;
  value?: string;
  fields?: IsUntyped<C> extends true ? Record<string, string> : FieldsOfWrite<C>;
}

/** What a client loaded for the columns it is about to write, in text form. */
export interface ExpectedValues {
  value?: string;
  fields?: Record<string, string>;
}

/** The body of a write request. */
export interface WriteRequest {
  locale: string;
  value?: string;
  fields?: Record<string, string>;
  expected?: ExpectedValues;
}

/** One key's occurrence count in a usage report. */
export interface UsageEntry {
  key: string;
  count: number;
}

/** One page's worth of runtime sightings. */
export interface UsageReport {
  url: string;
  title?: string;
  keys: UsageEntry[];
}

/** A key seen rendered on a page. */
export interface RuntimeUsage {
  key: string;
  source: "runtime";
  url: string;
  title?: string;
  count: number;
  /** ISO 8601. */
  lastSeen: string;
}

/** A key referenced from a source file. */
export interface StaticUsage {
  key: string;
  source: "static";
  file: string;
  line?: number;
  /** ISO 8601. */
  lastSeen: string;
}

/** A record that a key is used in one place. */
export type Usage = RuntimeUsage | StaticUsage;

/** How a request failed, for tools that branch on the class instead of the text. */
export type FailureClass = "config-not-loaded" | "offline" | "timeout" | "network" | "unauthenticated" | "forbidden" | "invalid" | "conflict" | "not-found" | "server" | "unknown";

/** The outcome of saving one Locale. */
export interface LocaleSaveResult {
  ok: boolean;
  /** The HTTP status, when there was a response. */
  status?: number;
  /** The reason on failure. */
  message?: string;
  /** The stored row, when the failure was a Write conflict. */
  current?: WireRow;
  failure?: FailureClass;
}

/** The outcome of saving several Locales of one key. */
export interface SaveResult {
  /** True only when every Locale succeeded. */
  ok: boolean;
  /** Set only for whole-save failures such as `config-not-loaded` or `stale-selection`. */
  error?: string;
  results: Record<string, LocaleSaveResult>;
}

/** What a save did to the page. */
export type PageEffect = "updated" | "stale" | "untouched";

/** A save result plus its effect on the page. */
export interface SaveOutcome extends SaveResult {
  page: PageEffect;
}

/**
 * Any stored value as displayable, comparable text: missing as empty, a string
 * as itself, anything else as its JSON. The server compares with exactly this
 * function when it checks for a Write conflict, and the panel uses it to diff
 * a draft, so missing and empty being equal is the same rule everywhere.
 */
export function fieldText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Flattens a write into the columns it touches: `value` if supplied, plus
 * each supplied field under its own name. Absent properties are dropped and
 * empty strings are kept, because clearing a field is an edit. An empty patch
 * means "not a write".
 *
 * The handler and every storage adapter share this helper so they cannot
 * disagree about what counts as a write.
 */
export function writePatch(write: PatchSource): Record<string, string> {
  const patch: Record<string, string> = {};
  if (write.value !== undefined) patch.value = write.value;
  if (write.fields !== undefined) {
    const fields = write.fields as Record<string, unknown>;
    for (const name of Object.keys(fields)) {
      const column = fields[name];
      if (typeof column === "string") defineColumn(patch, name, column);
    }
  }
  return patch;
}

/** Anything shaped like a write: the columns are read, everything else ignored. */
export interface PatchSource {
  locale?: string;
  value?: string | undefined;
  fields?: object | undefined;
}

/** Defines a column as an own property, so a Field named like an object prototype member stays ordinary. */
function defineColumn(patch: Record<string, string>, name: string, column: string): void {
  Object.defineProperty(patch, name, { value: column, enumerable: true, writable: true, configurable: true });
}

/** Whether a patch carries no columns at all. */
export function isEmptyPatch(patch: Record<string, string>): boolean {
  for (const _ in patch) return false;
  return true;
}

/**
 * The columns of a write that conflict with the stored row: those the sender
 * expected to hold one thing and the store holds another.
 *
 * For each column named in `expected` (written or not, because a client may
 * make a write to one column conditional on another), the stored value in text
 * form must equal the expected value, or already equal what the write carries
 * for that column. A stored value that already is what the write carries is
 * not a conflict: two Editors who made the same change are not told they
 * disagree. A column the write does not carry never equals the stored value.
 *
 * The caller decides what "no stored row" means (it means no conflict); this
 * function is only asked when there is a row.
 */
export function conflictingColumns(
  current: Record<string, unknown>,
  expected: ExpectedValues,
  write: { value?: string | undefined; fields?: object | undefined },
): string[] {
  const written = write.fields as Record<string, unknown> | undefined;
  const conflicts: string[] = [];
  if (expected.value !== undefined) {
    const stored = fieldText(current.value);
    if (stored !== expected.value && stored !== write.value) conflicts.push("value");
  }
  for (const name of Object.keys(expected.fields ?? {})) {
    const stored = fieldText(Object.hasOwn(current, name) ? current[name] : undefined);
    if (stored !== expected.fields![name] && stored !== written?.[name]) conflicts.push(name);
  }
  return conflicts;
}
