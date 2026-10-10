import { encode } from "./codec.js";

/** A message Catalog: keys to strings, or to further subtrees. */
export interface Catalog {
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is Catalog {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Options for {@link markCatalog}. */
export interface MarkOptions {
  /**
   * The string that joins path segments into a key. Defaults to ".". A segment
   * that itself contains the separator is escaped with a backslash, so a flat
   * key "a.b" and the nested path a, b never collapse into one key unless the
   * Developer chooses a separator that makes them so.
   */
  separator?: string;
}

const DEFAULT_SEPARATOR = ".";
const memo = new WeakMap<Catalog, Map<string, Catalog>>();

function escapeSegment(segment: string, separator: string): string {
  return segment.replaceAll("\\", "\\\\").replaceAll(separator, `\\${separator}`);
}

function walk(node: Catalog, prefix: string, ancestors: Set<Catalog>, separator: string): Catalog {
  ancestors.add(node);
  const out: Catalog = {};
  for (const name of Object.keys(node)) {
    const value = node[name];
    const segment = escapeSegment(name, separator);
    const path = prefix === "" ? segment : `${prefix}${separator}${segment}`;
    let marked: unknown = value;
    if (typeof value === "string") marked = encode(value, path);
    else if (isPlainObject(value) && !ancestors.has(value)) marked = walk(value, path, ancestors, separator);
    // A key named "__proto__" must become an own property, not the prototype.
    if (name === "__proto__") Object.defineProperty(out, name, { value: marked, enumerable: true, writable: true, configurable: true });
    else out[name] = marked;
  }
  ancestors.delete(node);
  return out;
}

/**
 * Attaches a Marker to every string in a Catalog, once, where the website
 * assembles its messages. Returns a new tree of the same shape and never
 * changes the input.
 *
 * Empty strings are marked too, so a missing translation becomes something an
 * Editor can find and fill instead of an invisible blank. Anything that is not
 * a string or a plain subtree (numbers, booleans, null, arrays, class
 * instances, cycles) is carried through untouched and never throws: one
 * malformed entry must not take down a request.
 *
 * The result is memoised by the identity of the input object, so a long-lived
 * server marks each Locale's Catalog once rather than once per request. Treat
 * a Catalog you have passed in as immutable afterwards.
 *
 * Apply it to the merged Catalog, after every message source has been
 * combined, so every source is marked the same way.
 */
export function markCatalog<T extends Catalog>(catalog: T, options: MarkOptions = {}): T {
  const separator = options.separator === undefined || options.separator === "" ? DEFAULT_SEPARATOR : options.separator;
  let bySeparator = memo.get(catalog);
  const cached = bySeparator?.get(separator);
  if (cached !== undefined) return cached as T;
  const marked = walk(catalog, "", new Set(), separator);
  if (bySeparator === undefined) memo.set(catalog, (bySeparator = new Map()));
  bySeparator.set(separator, marked);
  return marked as T;
}
