import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";
import { createHandler } from "../src/handler.js";
import { createMemoryAdapter, type UntypedWrite } from "../src/storage.js";
import { MOUNT, ORIGIN, setup, type TestConfig } from "./support/harness.js";

const PATH = `${MOUNT}/keys/k`;

function spied() {
  const writes: UntypedWrite[] = [];
  const base = createMemoryAdapter<TestConfig>({ clock: () => 0 });
  const adapter = { ...base, saveValue: (key: string, write: UntypedWrite) => (writes.push(write), (base as { saveValue: (k: string, w: UntypedWrite) => unknown }).saveValue(key, write)) };
  return { writes, ...setup({}, adapter as never) };
}

const put = (body: unknown) => setup().call("PUT", PATH, { body });
const reason = async (body: unknown) => (await put(body)).body.error;

describe("writing a key", () => {
  it("W1: a valid write answers 200", async () => {
    expect((await put({ locale: "da", value: "x" })).status).toBe(200);
  });

  it("success answers a small acknowledgement", async () => {
    expect((await put({ locale: "da", value: "x" })).body).toEqual({ ok: true });
  });

  it("W2: a subsequent read shows the written value", async () => {
    const { call } = setup();
    await call("PUT", PATH, { body: { locale: "da", value: "x" } });
    expect((await call("GET", PATH)).body.locales.da.value).toBe("x");
  });

  it("W3: a field-only write over a row with a value leaves the value", async () => {
    const { call } = setup();
    await call("PUT", PATH, { body: { locale: "da", value: "x" } });
    await call("PUT", PATH, { body: { locale: "da", fields: { status: "draft" } } });
    expect((await call("GET", PATH)).body.locales.da.value).toBe("x");
  });

  it("W4: a value-only write over a row with fields leaves the fields", async () => {
    const { call } = setup();
    await call("PUT", PATH, { body: { locale: "da", value: "x", fields: { status: "draft" } } });
    await call("PUT", PATH, { body: { locale: "da", value: "y" } });
    expect((await call("GET", PATH)).body.locales.da.status).toBe("draft");
  });

  it("W5: an empty string value answers 200", async () => {
    expect((await put({ locale: "da", value: "" })).status).toBe(200);
  });

  it("W5: and the stored value is empty", async () => {
    const { call } = setup();
    await call("PUT", PATH, { body: { locale: "da", value: "x" } });
    await call("PUT", PATH, { body: { locale: "da", value: "" } });
    expect((await call("GET", PATH)).body.locales.da.value).toBe("");
  });

  it("W6: clearing a Select to the empty string is a real edit and answers 200", async () => {
    expect((await put({ locale: "da", fields: { status: "" } })).status).toBe(200);
  });

  it("W6: the cleared Select is stored as empty", async () => {
    const { call } = setup();
    await call("PUT", PATH, { body: { locale: "da", fields: { status: "draft" } } });
    await call("PUT", PATH, { body: { locale: "da", fields: { status: "" } } });
    expect((await call("GET", PATH)).body.locales.da.status).toBe("");
  });

  it("W21: a write that leaves a required Field empty still answers 200", async () => {
    expect((await put({ locale: "da", value: "x" })).status).toBe(200);
  });

  it("W20: an extra top-level property does not travel to the adapter", async () => {
    const { writes, call } = spied();
    await call("PUT", PATH, { body: { locale: "da", value: "x", injected: { $set: 1 } } });
    expect(writes).toEqual([{ locale: "da", value: "x" }]);
  });

  it("the write handed to storage carries the validated fields", async () => {
    const { writes, call } = spied();
    await call("PUT", PATH, { body: { locale: "da", value: "x", fields: { status: "draft", note: "n" } } });
    expect(writes[0]).toEqual({ locale: "da", value: "x", fields: { status: "draft", note: "n" } });
  });

  it("the key reaches storage decoded", async () => {
    const { adapter, call } = setup();
    await call("PUT", `${MOUNT}/keys/a%2Fb`, { body: { locale: "da", value: "x" } });
    expect(Object.keys(await adapter.getValues("a/b"))).toEqual(["da"]);
  });
});

describe("write body validation, in order", () => {
  it("W8: a body that is not JSON is 400 body must be JSON", async () => {
    const reply = await setup().call("PUT", PATH, { rawBody: "{nope" });
    expect([reply.status, reply.body]).toEqual([400, { error: "body must be JSON", code: "invalid-json" }]);
  });

  it("W8: an empty body is not JSON", async () => {
    expect((await setup().call("PUT", PATH, { rawBody: "" })).body.error).toBe("body must be JSON");
  });

  it.each([["W9", []], ["W10", null], ["a string", "x"], ["a number", 3]])("%s: a JSON %j is refused as not an object", async (_id, body) => {
    expect(await reason(body)).toBe("body must be a JSON object");
  });

  it("W11: a missing locale is 400 locale required", async () => {
    expect(await reason({ value: "x" })).toBe("locale required");
  });

  it("an empty locale is 400 locale required", async () => {
    expect(await reason({ locale: "", value: "x" })).toBe("locale required");
  });

  it("a locale that is not a string is 400 locale must be a string", async () => {
    expect(await reason({ locale: 3, value: "x" })).toBe("locale must be a string");
  });

  it("W12: a locale carrying an operator object is 400", async () => {
    expect(await reason({ locale: { $ne: "" }, value: "x" })).toBe("locale must be a string");
  });

  it("W12: and the adapter is never called", async () => {
    const { writes, call } = spied();
    await call("PUT", PATH, { body: { locale: { $ne: "" }, value: "x" } });
    expect(writes).toEqual([]);
  });

  it("W13: an unconfigured locale is 400 and the reason lists the configured Locales", async () => {
    expect(await reason({ locale: "xx", value: "x" })).toBe('unknown locale "xx" -- configured: [en, da, es, fr]');
  });

  it("W14: a value that is not a string is 400", async () => {
    expect(await reason({ locale: "da", value: 3 })).toBe("value must be a string");
  });

  it("a null value is 400, not treated as absent", async () => {
    expect(await reason({ locale: "da", value: null })).toBe("value must be a string");
  });

  it("W15: fields that is not an object is 400", async () => {
    expect(await reason({ locale: "da", fields: "x" })).toBe("fields must be an object");
  });

  it("an array for fields is 400", async () => {
    expect(await reason({ locale: "da", fields: [] })).toBe("fields must be an object");
  });

  it("W16: an undeclared field is 400", async () => {
    expect(await reason({ locale: "da", fields: { nope: "x" } })).toBe('unknown field "nope"');
  });

  it("a field named like an object prototype member is undeclared, not inherited", async () => {
    expect(await reason({ locale: "da", fields: { constructor: "x" } })).toBe('unknown field "constructor"');
  });

  it("W17: a Read-only field is 400", async () => {
    expect(await reason({ locale: "da", fields: { updatedBy: "me" } })).toBe('field "updatedBy" is readonly');
  });

  it("W18: a field value that is a number is 400", async () => {
    expect(await reason({ locale: "da", fields: { note: 3 } })).toBe('field "note" must be a string');
  });

  it("W19: a Select value outside its options is 400 and the reason lists the options", async () => {
    expect(await reason({ locale: "da", fields: { status: "bogus" } })).toBe('field "status" must be one of [draft, approved]');
  });

  it("a Select value that is one of its options is accepted", async () => {
    expect((await put({ locale: "da", fields: { status: "approved" } })).status).toBe(200);
  });

  it("W7: a write with a locale and nothing else is 400 nothing to update", async () => {
    const reply = await put({ locale: "da" });
    expect([reply.status, reply.body]).toEqual([400, { error: "nothing to update", code: "nothing-to-update" }]);
  });

  it("an empty fields object and no value is 400 nothing to update", async () => {
    expect(await reason({ locale: "da", fields: {} })).toBe("nothing to update");
  });

  it("every validation error other than not-JSON carries the invalid-request code", async () => {
    expect((await put({ locale: "xx", value: "x" })).body.code).toBe("invalid-request");
  });

  it("the locale is judged before the value", async () => {
    expect(await reason({ locale: "xx", value: 3 })).toBe('unknown locale "xx" -- configured: [en, da, es, fr]');
  });

  it("the value is judged before the fields", async () => {
    expect(await reason({ locale: "da", value: 3, fields: { nope: "x" } })).toBe("value must be a string");
  });

  it("a field being undeclared is judged before it being a string", async () => {
    expect(await reason({ locale: "da", fields: { nope: 3 } })).toBe('unknown field "nope"');
  });

  it("W22: with no Schema a fields entry is 400 unknown field", async () => {
    const bare = resolveConfig({ locales: ["en", "da"], basePath: `${ORIGIN}${MOUNT}` });
    const handler = createHandler({ config: bare, adapter: createMemoryAdapter(), authorize: () => true });
    const response = await handler(new Request(`${ORIGIN}${PATH}`, { method: "PUT", body: JSON.stringify({ locale: "da", fields: { status: "x" } }) }));
    expect((await response.json()).error).toBe('unknown field "status"');
  });
});
