import { describe, expect, it } from "vitest";
import { createMemoryAdapter, type UntypedStorageAdapter } from "../src/storage.js";
import type { UsageReport } from "../src/wire.js";
import { MOUNT, setup, type TestConfig } from "./support/harness.js";

const REPORT = `${MOUNT}/usage`;
const page = "https://app.test/pricing";
const report = (body: unknown) => setup().call("POST", REPORT, { body });
const reason = async (body: unknown) => (await report(body)).body.error;

describe("usage reports", () => {
  it("U1: a valid report of two keys answers 200", async () => {
    expect((await report({ url: page, keys: [{ key: "a", count: 1 }, { key: "b", count: 3 }] })).status).toBe(200);
  });

  it("U1: the answer carries the number of keys recorded", async () => {
    expect((await report({ url: page, keys: [{ key: "a", count: 1 }, { key: "b", count: 3 }] })).body).toEqual({ ok: true, count: 2 });
  });

  it("U2: each key's usage read lists the reported URL", async () => {
    const { call } = setup();
    await call("POST", REPORT, { body: { url: page, title: "Pricing", keys: [{ key: "a", count: 2 }] } });
    expect((await call("GET", `${MOUNT}/usage/a`)).body).toEqual([{ key: "a", source: "runtime", url: page, title: "Pricing", count: 2, lastSeen: "1970-01-01T00:00:00.000Z" }]);
  });

  it("U3: a second report for the same URL overwrites the count and leaves one entry", async () => {
    const { call } = setup();
    await call("POST", REPORT, { body: { url: page, keys: [{ key: "a", count: 1 }] } });
    await call("POST", REPORT, { body: { url: page, keys: [{ key: "a", count: 4 }] } });
    expect((await call("GET", `${MOUNT}/usage/a`)).body.map((u: { count: number }) => u.count)).toEqual([4]);
  });

  it("U4: a second report that omits a key does not forget its earlier usage", async () => {
    const { call } = setup();
    await call("POST", REPORT, { body: { url: page, keys: [{ key: "a", count: 1 }, { key: "b", count: 1 }] } });
    await call("POST", REPORT, { body: { url: page, keys: [{ key: "a", count: 1 }] } });
    expect((await call("GET", `${MOUNT}/usage/b`)).body).toHaveLength(1);
  });

  it("U5: a javascript: URL is 400", async () => {
    expect(await reason({ url: "javascript:alert(1)", keys: [] })).toBe("url must be an http(s) URL");
  });

  it("a data: URL is 400", async () => {
    expect(await reason({ url: "data:text/html,x", keys: [] })).toBe("url must be an http(s) URL");
  });

  it("U6: a relative URL is 400", async () => {
    expect(await reason({ url: "/pricing", keys: [] })).toBe("url must be an http(s) URL");
  });

  it("a URL that is not a string is 400", async () => {
    expect(await reason({ url: 3, keys: [] })).toBe("url must be an http(s) URL");
  });

  it("a missing URL is 400 url and keys required", async () => {
    expect(await reason({ keys: [] })).toBe("url and keys required");
  });

  it("U7: keys that is not an array is 400 url and keys required", async () => {
    expect(await reason({ url: page, keys: "a" })).toBe("url and keys required");
  });

  it("U8: an entry with count 0 is 400 and names its index", async () => {
    expect(await reason({ url: page, keys: [{ key: "a", count: 1 }, { key: "b", count: 0 }] })).toBe("keys[1] must be { key: string, count: positive integer }");
  });

  it("U9: an entry with count 1.5 is 400", async () => {
    expect(await reason({ url: page, keys: [{ key: "a", count: 1.5 }] })).toBe("keys[0] must be { key: string, count: positive integer }");
  });

  it("a negative count is 400", async () => {
    expect(await reason({ url: page, keys: [{ key: "a", count: -1 }] })).toBe("keys[0] must be { key: string, count: positive integer }");
  });

  it("a count given as a string is 400", async () => {
    expect(await reason({ url: page, keys: [{ key: "a", count: "2" }] })).toBe("keys[0] must be { key: string, count: positive integer }");
  });

  it("U10: an entry with an empty key is 400", async () => {
    expect(await reason({ url: page, keys: [{ key: "", count: 1 }] })).toBe("keys[0] must be { key: string, count: positive integer }");
  });

  it("an entry that is not an object is 400", async () => {
    expect(await reason({ url: page, keys: ["a"] })).toBe("keys[0] must be { key: string, count: positive integer }");
  });

  it("U11: a title that is not a string is 400", async () => {
    expect(await reason({ url: page, title: 3, keys: [] })).toBe("title must be a string");
  });

  it("the title is judged before the entries", async () => {
    expect(await reason({ url: page, title: 3, keys: [{ key: "", count: 0 }] })).toBe("title must be a string");
  });

  it("a body that is not JSON is 400", async () => {
    expect((await setup().call("POST", REPORT, { rawBody: "{" })).body.error).toBe("body must be JSON");
  });

  it("a body that is not an object is 400", async () => {
    expect(await reason([])).toBe("body must be a JSON object");
  });

  it("an empty list of keys is accepted and records none", async () => {
    expect((await report({ url: page, keys: [] })).body).toEqual({ ok: true, count: 0 });
  });

  it("the report handed to storage is rebuilt from validated properties", async () => {
    const seen: UsageReport[] = [];
    const base = createMemoryAdapter<TestConfig>();
    const spy = { ...base, reportUsage: (r: UsageReport) => (seen.push(r), (base as UntypedStorageAdapter).reportUsage(r)) };
    await setup({}, spy as never).call("POST", REPORT, { body: { url: page, injected: 1, keys: [{ key: "a", count: 1, extra: true }] } });
    expect(seen).toEqual([{ url: page, keys: [{ key: "a", count: 1 }] }]);
  });

  it("a title reaches storage when supplied", async () => {
    const seen: UsageReport[] = [];
    const base = createMemoryAdapter<TestConfig>();
    const spy = { ...base, reportUsage: (r: UsageReport) => (seen.push(r), (base as UntypedStorageAdapter).reportUsage(r)) };
    await setup({}, spy as never).call("POST", REPORT, { body: { url: page, title: "Pricing", keys: [{ key: "a", count: 1 }] } });
    expect(seen[0]?.title).toBe("Pricing");
  });
});

describe("usage reads", () => {
  it("U12: a key with no usages answers 200 with an empty list", async () => {
    const reply = await setup().call("GET", `${MOUNT}/usage/unknown`);
    expect([reply.status, reply.body]).toEqual([200, []]);
  });

  it("U13: of two reports at different times the later one is first", async () => {
    let now = 1000;
    const { call } = setup({}, createMemoryAdapter<TestConfig>({ clock: () => now }));
    await call("POST", REPORT, { body: { url: "https://app.test/old", keys: [{ key: "a", count: 1 }] } });
    now = 2000;
    await call("POST", REPORT, { body: { url: "https://app.test/new", keys: [{ key: "a", count: 1 }] } });
    expect((await call("GET", `${MOUNT}/usage/a`)).body.map((u: { url: string }) => u.url)).toEqual(["https://app.test/new", "https://app.test/old"]);
  });

  it("the key is decoded before storage is asked", async () => {
    const asked: string[] = [];
    const base = createMemoryAdapter<TestConfig>();
    await setup({}, { ...base, getUsage: (key: string) => (asked.push(key), []) } as never).call("GET", `${MOUNT}/usage/a%2Fb`);
    expect(asked).toEqual(["a/b"]);
  });

  it("a wrong method on the report route answers 405 with POST allowed", async () => {
    const reply = await setup().call("GET", REPORT);
    expect([reply.status, reply.headers.get("allow")]).toEqual([405, "POST"]);
  });

  it("a wrong method on the read route answers 405 with GET allowed", async () => {
    const reply = await setup().call("POST", `${MOUNT}/usage/a`);
    expect([reply.status, reply.headers.get("allow")]).toEqual([405, "GET"]);
  });
});
