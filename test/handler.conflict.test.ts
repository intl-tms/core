import { describe, expect, it } from "vitest";
import { createMemoryAdapter, type UntypedStorageAdapter } from "../src/storage.js";
import { MOUNT, setup, type TestConfig } from "./support/harness.js";

const PATH = `${MOUNT}/keys/k`;

/** A handler over a stored `da` row of { value: "B", status: "draft" }. */
async function withStoredRow(extra: Record<string, string> = {}) {
  const harness = setup();
  await harness.adapter.saveValue("k", { locale: "da", value: "B", fields: { status: "draft", ...extra } });
  return harness;
}
const stored = async (call: Awaited<ReturnType<typeof withStoredRow>>["call"]) => (await call("GET", PATH)).body.locales.da;

describe("write conflicts: the worked cases", () => {
  it("case 1: value C expecting B is written", async () => {
    const { call } = await withStoredRow();
    await call("PUT", PATH, { body: { locale: "da", value: "C", expected: { value: "B" } } });
    expect((await stored(call)).value).toBe("C");
  });

  it("case 2: value C expecting A is 409", async () => {
    const { call } = await withStoredRow();
    expect((await call("PUT", PATH, { body: { locale: "da", value: "C", expected: { value: "A" } } })).status).toBe(409);
  });

  it("case 3: value B expecting A is written, because the stored value already equals the write", async () => {
    const { call } = await withStoredRow();
    expect((await call("PUT", PATH, { body: { locale: "da", value: "B", expected: { value: "A" } } })).status).toBe(200);
  });

  it("case 4: a status write expecting a different value column is 409, because every named column is held to", async () => {
    const { call } = await withStoredRow();
    expect((await call("PUT", PATH, { body: { locale: "da", fields: { status: "approved" }, expected: { value: "A" } } })).status).toBe(409);
  });

  it("case 5: a status write expecting the stored status is written", async () => {
    const { call } = await withStoredRow();
    expect((await call("PUT", PATH, { body: { locale: "da", fields: { status: "approved" }, expected: { fields: { status: "draft" } } } })).status).toBe(200);
  });

  it("case 6: a write with no expected values is a blind merge", async () => {
    const { call } = await withStoredRow();
    expect((await call("PUT", PATH, { body: { locale: "da", value: "C" } })).status).toBe(200);
  });

  it("case 7: with no stored row there is nothing to conflict with", async () => {
    expect((await setup().call("PUT", PATH, { body: { locale: "da", value: "C", expected: { value: "whatever the page said" } } })).status).toBe(200);
  });
});

describe("write conflicts: the answer", () => {
  it("the 409 body names the conflict and carries the code", async () => {
    const { call } = await withStoredRow();
    const reply = await call("PUT", PATH, { body: { locale: "da", value: "C", expected: { value: "A" } } });
    expect([reply.body.error, reply.body.code]).toEqual(["conflict", "conflict"]);
  });

  it("X1: current equals what a read returns for that Locale", async () => {
    const { call } = await withStoredRow();
    const reply = await call("PUT", PATH, { body: { locale: "da", value: "C", expected: { value: "A" } } });
    expect(reply.body.current).toEqual(await stored(call));
  });

  it("X2: after a conflict a read shows the row unchanged", async () => {
    const { call } = await withStoredRow();
    await call("PUT", PATH, { body: { locale: "da", value: "C", expected: { value: "A" } } });
    expect(await stored(call)).toEqual({ value: "B", status: "draft" });
  });

  it("a conflict in one column stops the whole write, including its other columns", async () => {
    const { call } = await withStoredRow();
    await call("PUT", PATH, { body: { locale: "da", value: "C", fields: { note: "n" }, expected: { value: "A" } } });
    expect((await stored(call)).note).toBeUndefined();
  });

  it("X5: an expected Select value no longer among the options is accepted for comparison", async () => {
    const { adapter, call } = setup();
    // A legacy row: the Schema has since stopped listing this option, so only an untyped view can store it.
    await (adapter as UntypedStorageAdapter).saveValue("k", { locale: "da", value: "B", fields: { status: "retired" } });
    expect((await call("PUT", PATH, { body: { locale: "da", fields: { status: "approved" }, expected: { fields: { status: "retired" } } } })).status).toBe(200);
  });

  it("X6: a stored field that is absent equals an expected empty string", async () => {
    const { call } = await withStoredRow();
    expect((await call("PUT", PATH, { body: { locale: "da", value: "C", expected: { fields: { note: "" } } } })).status).toBe(200);
  });

  it("X7: a stored non-string value is compared by its JSON text", async () => {
    const base = createMemoryAdapter<TestConfig>();
    const adapter: UntypedStorageAdapter = { ...base, getValues: () => ({ da: { value: "B", note: { x: 1 } } }) } as never;
    const reply = await setup({}, adapter as never).call("PUT", PATH, { body: { locale: "da", value: "C", expected: { fields: { note: '{"x":1}' } } } });
    expect(reply.status).toBe(200);
  });

  it("a stored non-string value that differs from the expected text conflicts", async () => {
    const base = createMemoryAdapter<TestConfig>();
    const adapter = { ...base, getValues: () => ({ da: { value: "B", note: { x: 1 } } }) };
    const reply = await setup({}, adapter as never).call("PUT", PATH, { body: { locale: "da", value: "C", expected: { fields: { note: "other" } } } });
    expect(reply.status).toBe(409);
  });

  it("X8: with no expected values the adapter's read is not called", async () => {
    let reads = 0;
    const base = createMemoryAdapter<TestConfig>();
    await setup({}, { ...base, getValues: (key: string) => (reads++, base.getValues(key)) }).call("PUT", PATH, { body: { locale: "da", value: "C" } });
    expect(reads).toBe(0);
  });

  it("a checked write reads once and writes once", async () => {
    const calls: string[] = [];
    const base = createMemoryAdapter<TestConfig>();
    const spy = { ...base, getValues: (key: string) => (calls.push("read"), base.getValues(key)), saveValue: (key: string, write: never) => (calls.push("write"), (base as UntypedStorageAdapter).saveValue(key, write)) };
    await setup({}, spy as never).call("PUT", PATH, { body: { locale: "da", value: "C", expected: { value: "" } } });
    expect(calls).toEqual(["read", "write"]);
  });

  it("an empty expected object checks nothing and the write goes through", async () => {
    const { call } = await withStoredRow();
    expect((await call("PUT", PATH, { body: { locale: "da", value: "C", expected: {} } })).status).toBe(200);
  });

  it("expected values for a different Locale's row are not consulted", async () => {
    const { call } = await withStoredRow();
    expect((await call("PUT", PATH, { body: { locale: "es", value: "C", expected: { value: "A" } } })).status).toBe(200);
  });
});

describe("expected value validation", () => {
  const reason = async (expected: unknown, extra: Record<string, unknown> = { value: "x" }) =>
    (await setup().call("PUT", PATH, { body: { locale: "da", ...extra, expected } })).body.error;

  it("X3: expected that is not an object is 400", async () => {
    expect(await reason(3)).toBe("expected must be an object");
  });

  it("expected null is 400", async () => {
    expect(await reason(null)).toBe("expected must be an object");
  });

  it("expected.value that is not a string is 400", async () => {
    expect(await reason({ value: 3 })).toBe("expected.value must be a string");
  });

  it("expected.fields that is not an object is 400", async () => {
    expect(await reason({ fields: "x" })).toBe("expected.fields must be an object");
  });

  it("an expected field that is not declared is 400", async () => {
    expect(await reason({ fields: { nope: "x" } })).toBe('expected: unknown field "nope"');
  });

  it("X4: an expected Read-only field is 400", async () => {
    expect(await reason({ fields: { updatedBy: "x" } })).toBe('expected: field "updatedBy" is readonly');
  });

  it("an expected field value that is not a string is 400", async () => {
    expect(await reason({ fields: { note: 3 } })).toBe('expected: field "note" must be a string');
  });

  it("nothing to update is judged before expected", async () => {
    expect(await reason(3, {})).toBe("nothing to update");
  });
});
