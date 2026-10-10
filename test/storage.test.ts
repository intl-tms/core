import { describe, expect, it } from "vitest";
import { createMemoryAdapter } from "../src/storage.js";

const report = (url: string, keys: [string, number][], title?: string) => ({
  url,
  ...(title === undefined ? {} : { title }),
  keys: keys.map(([key, count]) => ({ key, count })),
});

describe("in-memory adapter: values", () => {
  it("A1: with nothing saved, getting values returns an empty map", async () => {
    expect(await createMemoryAdapter().getValues("k")).toEqual({});
  });

  it("a saved value is read back for its Locale", async () => {
    const adapter = createMemoryAdapter();
    await adapter.saveValue("k", { locale: "da", value: "Hej" });
    expect(await adapter.getValues("k")).toEqual({ da: { value: "Hej" } });
  });

  it("the map is sparse: only Locales with a row appear", async () => {
    const adapter = createMemoryAdapter();
    await adapter.saveValue("k", { locale: "da", value: "x" });
    expect(Object.keys(await adapter.getValues("k"))).toEqual(["da"]);
  });

  it("keys are independent of one another", async () => {
    const adapter = createMemoryAdapter();
    await adapter.saveValue("a", { locale: "da", value: "x" });
    expect(await adapter.getValues("b")).toEqual({});
  });

  it("A2: a field-only save to a new row gives the row an empty string value", async () => {
    const adapter = createMemoryAdapter();
    await adapter.saveValue("k", { locale: "da", fields: { status: "draft" } });
    expect((await adapter.getValues("k")).da?.value).toBe("");
  });

  it("a field-only save stores the field", async () => {
    const adapter = createMemoryAdapter();
    await adapter.saveValue("k", { locale: "da", fields: { status: "draft" } });
    expect((await adapter.getValues("k")).da?.status).toBe("draft");
  });

  it("A3: new-row defaults fill the other columns of a new row", async () => {
    const adapter = createMemoryAdapter({ newRowDefaults: { status: "draft" } });
    await adapter.saveValue("k", { locale: "da", value: "x" });
    expect((await adapter.getValues("k")).da?.status).toBe("draft");
  });

  it("new-row defaults do not overwrite what the write supplies", async () => {
    const adapter = createMemoryAdapter({ newRowDefaults: { status: "draft" } });
    await adapter.saveValue("k", { locale: "da", fields: { status: "approved" } });
    expect((await adapter.getValues("k")).da?.status).toBe("approved");
  });

  it("new-row defaults are not applied to an existing row", async () => {
    const adapter = createMemoryAdapter({ newRowDefaults: { note: "n" } });
    await adapter.saveValue("k", { locale: "da", value: "x" });
    await adapter.saveValue("k", { locale: "da", fields: { note: "" } });
    expect((await adapter.getValues("k")).da?.note).toBe("");
  });

  it("A4: an empty write stores nothing", async () => {
    const adapter = createMemoryAdapter();
    await adapter.saveValue("k", { locale: "da" });
    expect(await adapter.getValues("k")).toEqual({});
  });

  it("a value-only save keeps the stored fields", async () => {
    const adapter = createMemoryAdapter();
    await adapter.saveValue("k", { locale: "da", value: "x", fields: { status: "draft" } });
    await adapter.saveValue("k", { locale: "da", value: "y" });
    expect((await adapter.getValues("k")).da).toEqual({ value: "y", status: "draft" });
  });

  it("a field-only save keeps the stored value", async () => {
    const adapter = createMemoryAdapter();
    await adapter.saveValue("k", { locale: "da", value: "x" });
    await adapter.saveValue("k", { locale: "da", fields: { status: "draft" } });
    expect((await adapter.getValues("k")).da?.value).toBe("x");
  });

  it("an empty string value is stored, not treated as absent", async () => {
    const adapter = createMemoryAdapter();
    await adapter.saveValue("k", { locale: "da", value: "x" });
    await adapter.saveValue("k", { locale: "da", value: "" });
    expect((await adapter.getValues("k")).da?.value).toBe("");
  });

  it("mutating a returned row does not change the store", async () => {
    const adapter = createMemoryAdapter();
    await adapter.saveValue("k", { locale: "da", value: "x" });
    const first = await adapter.getValues("k");
    first.da!.value = "tampered";
    expect((await adapter.getValues("k")).da?.value).toBe("x");
  });
});

describe("in-memory adapter: usage", () => {
  it("a key with no usage reads as an empty list", async () => {
    expect(await createMemoryAdapter().getUsage("k")).toEqual([]);
  });

  it("A5: lastSeen is the injected clock's time", async () => {
    const adapter = createMemoryAdapter({ clock: () => Date.parse("2026-01-12T09:30:00.000Z") });
    await adapter.reportUsage(report("https://x.test/p", [["k", 1]]));
    expect((await adapter.getUsage("k"))[0]?.lastSeen).toBe("2026-01-12T09:30:00.000Z");
  });

  it("a report is stored as a runtime usage with its page details", async () => {
    const adapter = createMemoryAdapter({ clock: () => 0 });
    await adapter.reportUsage(report("https://x.test/p", [["k", 3]], "Pricing"));
    expect((await adapter.getUsage("k"))[0]).toEqual({ key: "k", source: "runtime", url: "https://x.test/p", title: "Pricing", count: 3, lastSeen: "1970-01-01T00:00:00.000Z" });
  });

  it("a second report for the same page overwrites the count and keeps one entry", async () => {
    const adapter = createMemoryAdapter();
    await adapter.reportUsage(report("https://x.test/p", [["k", 1]]));
    await adapter.reportUsage(report("https://x.test/p", [["k", 5]]));
    expect((await adapter.getUsage("k")).map((u) => (u.source === "runtime" ? u.count : 0))).toEqual([5]);
  });

  it("a report that omits a key does not forget its earlier usage", async () => {
    const adapter = createMemoryAdapter();
    await adapter.reportUsage(report("https://x.test/p", [["a", 1], ["b", 1]]));
    await adapter.reportUsage(report("https://x.test/p", [["a", 2]]));
    expect(await adapter.getUsage("b")).toHaveLength(1);
  });

  it("usages are listed most recently seen first", async () => {
    let now = 1000;
    const adapter = createMemoryAdapter({ clock: () => now });
    await adapter.reportUsage(report("https://x.test/old", [["k", 1]]));
    now = 2000;
    await adapter.reportUsage(report("https://x.test/new", [["k", 1]]));
    expect((await adapter.getUsage("k")).map((u) => (u.source === "runtime" ? u.url : ""))).toEqual(["https://x.test/new", "https://x.test/old"]);
  });

  it("a page re-reported later moves to the front", async () => {
    let now = 1000;
    const adapter = createMemoryAdapter({ clock: () => now });
    await adapter.reportUsage(report("https://x.test/a", [["k", 1]]));
    now = 2000;
    await adapter.reportUsage(report("https://x.test/b", [["k", 1]]));
    now = 3000;
    await adapter.reportUsage(report("https://x.test/a", [["k", 1]]));
    expect((await adapter.getUsage("k")).map((u) => (u.source === "runtime" ? u.url : ""))).toEqual(["https://x.test/a", "https://x.test/b"]);
  });

  it("two reports within the same millisecond still order the later one first", async () => {
    const adapter = createMemoryAdapter({ clock: () => 5000 });
    await adapter.reportUsage(report("https://x.test/first", [["k", 1]]));
    await adapter.reportUsage(report("https://x.test/second", [["k", 1]]));
    expect((await adapter.getUsage("k")).map((u) => (u.source === "runtime" ? u.url : ""))).toEqual(["https://x.test/second", "https://x.test/first"]);
  });

  it("an accepted report without a title keeps the previously stored title", async () => {
    const adapter = createMemoryAdapter();
    await adapter.reportUsage(report("https://x.test/p", [["k", 1]], "Pricing"));
    await adapter.reportUsage(report("https://x.test/p", [["k", 2]]));
    expect((await adapter.getUsage("k"))[0]).toMatchObject({ title: "Pricing" });
  });
});
