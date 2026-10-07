import { describe, expect, it } from "vitest";
import { createMemoryAdapter } from "../src/storage.js";
import { MOUNT, setup, type TestConfig } from "./support/harness.js";

const META = { sourceMessage: "Go to <link>Templates</link>", description: "Hero", references: [{ path: "src/page.tsx", line: 42 }], orphan: false };

describe("reading a key", () => {
  it("R1: a key with nothing stored answers 200 with an empty locales map", async () => {
    const reply = await setup().call("GET", `${MOUNT}/keys/k`);
    expect([reply.status, reply.body]).toEqual([200, { locales: {} }]);
  });

  it("R2: the map holds exactly the Locales that have rows", async () => {
    const { adapter, call } = setup();
    await adapter.saveValue("k", { locale: "en", value: "Hi" });
    await adapter.saveValue("k", { locale: "da", value: "Hej" });
    expect(Object.keys((await call("GET", `${MOUNT}/keys/k`)).body.locales)).toEqual(["en", "da"]);
  });

  it("a row is the translation string plus its stored fields", async () => {
    const { adapter, call } = setup();
    await adapter.saveValue("k", { locale: "da", value: "Hej", fields: { status: "draft", note: "" } });
    expect((await call("GET", `${MOUNT}/keys/k`)).body.locales.da).toEqual({ value: "Hej", status: "draft", note: "" });
  });

  it("R3: with no metadata hook the body has no meta property", async () => {
    expect("meta" in (await setup().call("GET", `${MOUNT}/keys/k`)).body).toBe(false);
  });

  it("R4: a metadata hook's answer is carried in the body", async () => {
    expect((await setup({ metadata: () => META }).call("GET", `${MOUNT}/keys/k`)).body.meta).toEqual(META);
  });

  it("R5: a hook that returns nothing leaves no meta property", async () => {
    expect("meta" in (await setup({ metadata: () => undefined }).call("GET", `${MOUNT}/keys/k`)).body).toBe(false);
  });

  it("a hook that returns null leaves no meta property", async () => {
    expect("meta" in (await setup({ metadata: () => null }).call("GET", `${MOUNT}/keys/k`)).body).toBe(false);
  });

  it("R6: an asynchronous hook's result is carried in the body", async () => {
    expect((await setup({ metadata: async () => META }).call("GET", `${MOUNT}/keys/k`)).body.meta).toEqual(META);
  });

  it("the hook is asked about the decoded key", async () => {
    const asked: string[] = [];
    await setup({ metadata: (key) => (asked.push(key), undefined) }).call("GET", `${MOUNT}/keys/a%2Fb`);
    expect(asked).toEqual(["a/b"]);
  });

  it("metadata and rows travel together", async () => {
    const { adapter, call } = setup({ metadata: () => META });
    await adapter.saveValue("k", { locale: "da", value: "Hej" });
    expect((await call("GET", `${MOUNT}/keys/k`)).body).toEqual({ meta: META, locales: { da: { value: "Hej" } } });
  });

  it("storage and metadata are fetched concurrently", async () => {
    const order: string[] = [];
    const adapter = { ...createMemoryAdapter<TestConfig>(), getValues: async () => (order.push("storage:start"), await Promise.resolve(), order.push("storage:end"), {}) };
    await setup({ metadata: async () => (order.push("meta:start"), await Promise.resolve(), order.push("meta:end"), undefined) }, adapter).call("GET", `${MOUNT}/keys/k`);
    expect(order.slice(0, 2)).toEqual(["storage:start", "meta:start"]);
  });

  it("a read performs exactly one storage call", async () => {
    let calls = 0;
    const base = createMemoryAdapter<TestConfig>();
    await setup({}, { ...base, getValues: (key) => (calls++, base.getValues(key)) }).call("GET", `${MOUNT}/keys/k`);
    expect(calls).toBe(1);
  });
});
