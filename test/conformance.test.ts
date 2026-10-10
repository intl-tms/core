import { describe, expect, it } from "vitest";
import { runAdapterConformance } from "../src/conformance.js";
import { createMemoryAdapter, detectAdapterCapabilities, type StorageAdapter } from "../src/storage.js";

function clockedAdapter() {
  let now = 1_000_000;
  return { adapter: createMemoryAdapter({ clock: () => now }), advanceTime: () => void (now += 1000) };
}

const failedNames = async (adapter: StorageAdapter, advanceTime: () => void, withField = true) =>
  (await runAdapterConformance(adapter, { locale: "en", ...(withField ? { fieldName: "status" } : {}), advanceTime })).failures.map((f) => f.name);

describe("adapter conformance suite", () => {
  it("passes against the in-memory adapter", async () => {
    const { adapter, advanceTime } = clockedAdapter();
    expect(await failedNames(adapter, advanceTime)).toEqual([]);
  });

  it("runs every check, including the field checks, when a field name is given", async () => {
    const { adapter, advanceTime } = clockedAdapter();
    expect((await runAdapterConformance(adapter, { fieldName: "status", advanceTime })).results.length).toBeGreaterThanOrEqual(12);
  });

  it("skips the field checks when no field name is given", async () => {
    const { adapter, advanceTime } = clockedAdapter();
    const withField = await runAdapterConformance(adapter, { fieldName: "status", advanceTime });
    const without = await runAdapterConformance(adapter, { advanceTime });
    expect(without.results.length).toBeLessThan(withField.results.length);
  });

  it("fails an adapter that treats an empty string as not supplied", async () => {
    const { adapter, advanceTime } = clockedAdapter();
    const broken: StorageAdapter = { ...adapter, saveValue: (key, write) => adapter.saveValue(key, write.value === "" ? { locale: write.locale } : write) };
    expect(await failedNames(broken, advanceTime)).toContain("save stores an empty string value");
  });

  it("fails an adapter that clobbers stored fields on a value-only save", async () => {
    const { adapter, advanceTime } = clockedAdapter();
    const broken: StorageAdapter = { ...adapter, saveValue: (key, write) => adapter.saveValue(key, write.fields === undefined ? { ...write, fields: { status: "" } } : write) };
    expect(await failedNames(broken, advanceTime)).toContain("a value-only save keeps the stored fields");
  });

  it("fails an adapter whose values are not sparse", async () => {
    const { adapter, advanceTime } = clockedAdapter();
    const broken: StorageAdapter = { ...adapter, getValues: async (key) => ({ ...(await adapter.getValues(key)), zz: { value: "" } }) };
    expect(await failedNames(broken, advanceTime)).toContain("values are sparse: a Locale with no row is absent");
  });

  it("fails an adapter that prunes usage on report", async () => {
    const { adapter, advanceTime } = clockedAdapter();
    let current = adapter;
    const broken: StorageAdapter = {
      ...adapter,
      reportUsage: (report) => {
        current = createMemoryAdapter(); // forgets every earlier report
        return current.reportUsage(report);
      },
      getUsage: (key) => current.getUsage(key),
    };
    expect(await failedNames(broken, advanceTime)).toContain("a usage report never prunes");
  });

  it("fails an adapter that lists usages oldest first", async () => {
    const { adapter, advanceTime } = clockedAdapter();
    const broken: StorageAdapter = { ...adapter, getUsage: async (key) => (await adapter.getUsage(key)).reverse() };
    expect(await failedNames(broken, advanceTime)).toContain("usages are listed most recently seen first");
  });

  it("reports a throwing adapter as a failure instead of rejecting", async () => {
    const { adapter, advanceTime } = clockedAdapter();
    const broken: StorageAdapter = { ...adapter, getValues: () => Promise.reject(new Error("db down")) };
    expect((await failedNames(broken, advanceTime)).length).toBeGreaterThan(0);
  });

  it("carries the thrown error's text on a failure", async () => {
    const { adapter, advanceTime } = clockedAdapter();
    const broken: StorageAdapter = { ...adapter, getValues: () => Promise.reject(new Error("db down")) };
    const report = await runAdapterConformance(broken, { advanceTime });
    expect(report.failures[0]?.error).toContain("db down");
  });
});

describe("adapter capability detection", () => {
  it("an adapter implementing only the four operations has no optional capabilities", () => {
    expect(detectAdapterCapabilities(createMemoryAdapter())).toEqual([]);
  });

  it("an optional batch operation is detected", () => {
    expect(detectAdapterCapabilities({ ...createMemoryAdapter(), saveValues: async () => undefined })).toEqual(["batch-write"]);
  });

  it("an optional conditional write is detected", () => {
    expect(detectAdapterCapabilities({ ...createMemoryAdapter(), saveValueIf: async () => undefined })).toEqual(["conflicts-atomic"]);
  });

  it("a member that is not a function is not a capability", () => {
    expect(detectAdapterCapabilities({ ...createMemoryAdapter(), saveValues: 1 })).toEqual([]);
  });
});
