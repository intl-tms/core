import type { StorageAdapter } from "./storage.js";

/** The outcome of one conformance check. */
export interface ConformanceResult {
  name: string;
  ok: boolean;
  /** Why it failed. */
  error?: string;
}

/** The outcome of a whole conformance run. */
export interface ConformanceReport {
  results: ConformanceResult[];
  failures: ConformanceResult[];
}

/** Options for {@link runAdapterConformance}. */
export interface ConformanceOptions {
  /** A Locale the adapter accepts. Defaults to "en". */
  locale?: string;
  /** A writable Field name the adapter accepts. When omitted, the checks that need a Field are skipped. */
  fieldName?: string;
  /**
   * Called between two usage reports so their last-seen times differ. Give it a
   * function that moves an injected clock. Without one the run waits a few
   * real milliseconds, which is only enough for a clock with millisecond
   * resolution.
   */
  advanceTime?: () => void | Promise<void>;
  /** Prefix for the keys the run writes, so a shared database can tell them apart. */
  keyPrefix?: string;
}

class CheckFailed extends Error {}

function expectEqual(actual: unknown, expected: unknown, what: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new CheckFailed(`${what}: expected ${e}, got ${a}`);
}

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

/**
 * Runs the whole storage contract against any adapter and reports what it
 * got wrong, so a Developer's adapter is proven correct by one test file. It
 * depends on no test runner: assert that `failures` is empty.
 *
 * Every check uses keys of its own, so it is safe to run against a shared
 * database, but it does write to it.
 */
export async function runAdapterConformance(adapter: StorageAdapter, options: ConformanceOptions = {}): Promise<ConformanceReport> {
  const locale = options.locale ?? "en";
  const field = options.fieldName;
  const advance = options.advanceTime ?? pause;
  const run = `${options.keyPrefix ?? "conformance"}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let counter = 0;
  const freshKey = (): string => `${run}:${counter++}`;
  const results: ConformanceResult[] = [];

  const check = async (name: string, body: () => Promise<void>): Promise<void> => {
    try {
      await body();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const page = (path: string): string => `https://conformance.invalid/${run}/${path}`;

  await check("getting values for a key with nothing stored gives an empty map", async () => {
    expectEqual(await adapter.getValues(freshKey()), {}, "values");
  });

  await check("a saved value is read back for its Locale", async () => {
    const key = freshKey();
    await adapter.saveValue(key, { locale, value: "Hej" });
    expectEqual((await adapter.getValues(key))[locale]?.value, "Hej", "value");
  });

  await check("values are sparse: a Locale with no row is absent", async () => {
    const key = freshKey();
    await adapter.saveValue(key, { locale, value: "x" });
    expectEqual(Object.keys(await adapter.getValues(key)), [locale], "locales");
  });

  await check("save stores an empty string value", async () => {
    const key = freshKey();
    await adapter.saveValue(key, { locale, value: "x" });
    await adapter.saveValue(key, { locale, value: "" });
    expectEqual((await adapter.getValues(key))[locale]?.value, "", "value after clearing");
  });

  await check("an empty write stores nothing", async () => {
    const key = freshKey();
    await adapter.saveValue(key, { locale });
    expectEqual(await adapter.getValues(key), {}, "values");
  });

  if (field !== undefined) {
    await check("a field-only save to a new row gives the row an empty value", async () => {
      const key = freshKey();
      await adapter.saveValue(key, { locale, fields: { [field]: "a" } });
      expectEqual((await adapter.getValues(key))[locale]?.value, "", "value of the new row");
    });

    await check("a field-only save keeps the stored value", async () => {
      const key = freshKey();
      await adapter.saveValue(key, { locale, value: "x" });
      await adapter.saveValue(key, { locale, fields: { [field]: "a" } });
      expectEqual((await adapter.getValues(key))[locale]?.value, "x", "value");
    });

    await check("a value-only save keeps the stored fields", async () => {
      const key = freshKey();
      await adapter.saveValue(key, { locale, value: "x", fields: { [field]: "a" } });
      await adapter.saveValue(key, { locale, value: "y" });
      expectEqual((await adapter.getValues(key))[locale]?.[field], "a", "field");
    });

    await check("a field cleared to the empty string is stored as empty", async () => {
      const key = freshKey();
      await adapter.saveValue(key, { locale, value: "x", fields: { [field]: "a" } });
      await adapter.saveValue(key, { locale, fields: { [field]: "" } });
      expectEqual((await adapter.getValues(key))[locale]?.[field], "", "field after clearing");
    });
  }

  await check("usage for a key with none is an empty list", async () => {
    expectEqual(await adapter.getUsage(freshKey()), [], "usages");
  });

  await check("a usage report lists the page for each key", async () => {
    const key = freshKey();
    await adapter.reportUsage({ url: page("a"), title: "A", keys: [{ key, count: 2 }] });
    const usages = await adapter.getUsage(key);
    expectEqual(usages.map((u) => (u.source === "runtime" ? [u.url, u.count] : null)), [[page("a"), 2]], "usages");
  });

  await check("a second report for the same page overwrites the count and keeps one entry", async () => {
    const key = freshKey();
    await adapter.reportUsage({ url: page("a"), keys: [{ key, count: 1 }] });
    await adapter.reportUsage({ url: page("a"), keys: [{ key, count: 5 }] });
    const usages = await adapter.getUsage(key);
    expectEqual(usages.map((u) => (u.source === "runtime" ? u.count : null)), [5], "counts");
  });

  await check("a usage report never prunes", async () => {
    const [kept, left] = [freshKey(), freshKey()];
    await adapter.reportUsage({ url: page("a"), keys: [{ key: kept, count: 1 }, { key: left, count: 1 }] });
    await adapter.reportUsage({ url: page("a"), keys: [{ key: kept, count: 2 }] });
    expectEqual((await adapter.getUsage(left)).length, 1, "usages of the key the later report omitted");
  });

  await check("usages are listed most recently seen first", async () => {
    const key = freshKey();
    await adapter.reportUsage({ url: page("old"), keys: [{ key, count: 1 }] });
    await advance();
    await adapter.reportUsage({ url: page("new"), keys: [{ key, count: 1 }] });
    const urls = (await adapter.getUsage(key)).map((u) => (u.source === "runtime" ? u.url : ""));
    expectEqual(urls, [page("new"), page("old")], "order");
  });

  return { results, failures: results.filter((r) => !r.ok) };
}
