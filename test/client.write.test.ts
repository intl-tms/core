import { describe, expect, it } from "vitest";
import { createClient } from "../src/client.js";
import { BASE, clientConfig, fakeRequest, jsonResponse, textResponse } from "./support/fakes.js";

const usages = [{ key: "k", source: "runtime", url: "https://app.test/p", count: 2, lastSeen: "2026-01-01T00:00:00.000Z" }];

describe("client: reading usage", () => {
  it("returns the usages with no error", async () => {
    const { request } = fakeRequest(() => jsonResponse(200, usages));
    expect(await createClient({ getConfig: () => clientConfig, request }).readUsage("k")).toEqual({ usages, error: false, configured: true });
  });

  it("the request is a GET to the usage-read URL with the key encoded", async () => {
    const { request, calls } = fakeRequest(() => jsonResponse(200, []));
    await createClient({ getConfig: () => clientConfig, request }).readUsage("a/b");
    expect(calls[0]?.url).toBe(`${BASE}/usage/a%2Fb`);
  });

  it("T9: with no usage-read endpoint it is not configured", async () => {
    const { request } = fakeRequest(() => jsonResponse(200, []));
    const config = { endpoints: { values: clientConfig.endpoints.values } };
    expect(await createClient({ getConfig: () => config, request }).readUsage("k")).toEqual({ usages: [], error: false, configured: false });
  });

  it("T9: and no request is made", async () => {
    const { request, calls } = fakeRequest(() => jsonResponse(200, []));
    await createClient({ getConfig: () => ({ endpoints: { values: clientConfig.endpoints.values } }), request }).readUsage("k");
    expect(calls).toEqual([]);
  });

  it("with no configuration loaded it is not configured and not an error", async () => {
    const { request } = fakeRequest(() => jsonResponse(200, []));
    expect(await createClient({ getConfig: () => undefined, request }).readUsage("k")).toEqual({ usages: [], error: false, configured: false });
  });

  it("T10: a failed read is an error but still configured", async () => {
    const { request } = fakeRequest(() => jsonResponse(500, { error: "x" }));
    const result = await createClient({ getConfig: () => clientConfig, request }).readUsage("k");
    expect([result.error, result.configured, result.usages]).toEqual([true, true, []]);
  });

  it("a read that throws is an error without throwing", async () => {
    const { request } = fakeRequest(() => Promise.reject(new TypeError("Failed to fetch")));
    expect((await createClient({ getConfig: () => clientConfig, request }).readUsage("k")).error).toBe(true);
  });

  it("a failed read carries its reason", async () => {
    const { request } = fakeRequest(() => jsonResponse(403, { error: "forbidden" }));
    expect((await createClient({ getConfig: () => clientConfig, request }).readUsage("k")).failure).toEqual({ class: "forbidden", status: 403, reason: "forbidden" });
  });

  it("a response that is not a list is an error", async () => {
    const { request } = fakeRequest(() => jsonResponse(200, { nope: 1 }));
    expect((await createClient({ getConfig: () => clientConfig, request }).readUsage("k")).error).toBe(true);
  });
});

describe("client: saving", () => {
  const save = async (writes: Parameters<ReturnType<typeof createClient>["save"]>[1], respond: Parameters<typeof fakeRequest>[0] = () => jsonResponse(200, { ok: true })) => {
    const fake = fakeRequest(respond);
    const result = await createClient({ getConfig: () => clientConfig, request: fake.request }).save("k", writes);
    return { ...fake, result };
  };
  const body = (calls: { init: RequestInit }[], index = 0) => JSON.parse(calls[index]!.init.body as string);

  it("T11: a save of two Locales makes two requests", async () => {
    expect((await save({ da: { value: "Hej" }, es: { value: "Hola" } })).calls).toHaveLength(2);
  });

  it("T12: each request is a PUT to the key's URL", async () => {
    const { calls } = await save({ da: { value: "Hej" } });
    expect([calls[0]?.init.method, calls[0]?.url]).toEqual(["PUT", `${BASE}/keys/k`]);
  });

  it("T12: each request has a JSON body containing its Locale", async () => {
    const { calls } = await save({ da: { value: "Hej" }, es: { value: "Hola" } });
    expect([body(calls, 0).locale, body(calls, 1).locale]).toEqual(["da", "es"]);
  });

  it("each request declares a JSON content type", async () => {
    const { calls } = await save({ da: { value: "Hej" } });
    expect(new Headers(calls[0]?.init.headers).get("content-type")).toBe("application/json");
  });

  it("CLI-31: only the provided parts of a write are sent", async () => {
    const { calls } = await save({ da: { value: "Hej" } });
    expect(body(calls)).toEqual({ locale: "da", value: "Hej" });
  });

  it("CLI-31: fields alone are sent without a value", async () => {
    const { calls } = await save({ da: { fields: { status: "draft" } } });
    expect(body(calls)).toEqual({ locale: "da", fields: { status: "draft" } });
  });

  it("an empty string value is sent, not dropped", async () => {
    const { calls } = await save({ da: { value: "" } });
    expect(body(calls)).toEqual({ locale: "da", value: "" });
  });

  it("T13: expected values are carried in the body", async () => {
    const { calls } = await save({ da: { value: "Hej", expected: { value: "Hi", fields: { status: "draft" } } } });
    expect(body(calls).expected).toEqual({ value: "Hi", fields: { status: "draft" } });
  });

  it("T14: when every Locale succeeds the overall result is ok", async () => {
    expect((await save({ da: { value: "a" }, es: { value: "b" } })).result.ok).toBe(true);
  });

  it("a successful Locale has ok and its status", async () => {
    expect((await save({ da: { value: "a" } })).result.results.da).toEqual({ ok: true, status: 200 });
  });

  const failOnDa: Parameters<typeof fakeRequest>[0] = (_url, init) => (JSON.parse(init.body as string).locale === "da" ? jsonResponse(400, { error: "bad" }) : jsonResponse(200, { ok: true }));

  it("T15: when one fails the overall result is not ok", async () => {
    expect((await save({ da: { value: "a" }, es: { value: "b" } }, failOnDa)).result.ok).toBe(false);
  });

  it("T16: the other Locale's result is still ok", async () => {
    expect((await save({ da: { value: "a" }, es: { value: "b" } }, failOnDa)).result.results.es?.ok).toBe(true);
  });

  it("CLI-39: a failure does not stop the Locales after it", async () => {
    expect((await save({ da: { value: "a" }, es: { value: "b" } }, failOnDa)).calls).toHaveLength(2);
  });

  it("results are in save order", async () => {
    expect(Object.keys((await save({ fr: { value: "a" }, da: { value: "b" } })).result.results)).toEqual(["fr", "da"]);
  });

  it("T17: a 400 with a JSON error body has the stated reason as its message", async () => {
    const { result } = await save({ da: { value: "a" } }, () => jsonResponse(400, { error: 'field "status" must be one of [draft, approved]' }));
    expect(result.results.da).toMatchObject({ ok: false, status: 400, message: 'field "status" must be one of [draft, approved]', failure: "invalid" });
  });

  it("a body with a message member and no error member uses the message", async () => {
    const { result } = await save({ da: { value: "a" } }, () => jsonResponse(500, { message: "database unavailable" }));
    expect(result.results.da?.message).toBe("database unavailable");
  });

  it("T18: a 502 with an HTML body has the body, capped, as its message", async () => {
    const html = `<html>${"x".repeat(1000)}</html>`;
    const { result } = await save({ da: { value: "a" } }, () => textResponse(502, html));
    expect(result.results.da?.message).toBe(html.slice(0, 300));
  });

  it("T19: a 500 with body {} has no message", async () => {
    const { result } = await save({ da: { value: "a" } }, () => jsonResponse(500, {}));
    expect("message" in result.results.da!).toBe(false);
  });

  it.each([["an empty body", ""], ["an empty array", "[]"], ["null", "null"], ["whitespace", "   "]])("CLI-35: %s is not a reason", async (_name, text) => {
    const { result } = await save({ da: { value: "a" } }, () => textResponse(500, text));
    expect("message" in result.results.da!).toBe(false);
  });

  it("T20: a 409 with a row carries the stored row", async () => {
    const { result } = await save({ da: { value: "a" } }, () => jsonResponse(409, { error: "conflict", code: "conflict", current: { value: "theirs", status: "draft" } }));
    expect(result.results.da).toMatchObject({ ok: false, status: 409, message: "conflict", current: { value: "theirs", status: "draft" }, failure: "conflict" });
  });

  it.each([["a string", "x"], ["null", null], ["an array", []], ["a row with no value", { status: "draft" }], ["a row whose value is not a string", { value: 3 }]])(
    "T21: a 409 whose current is %s carries no row",
    async (_name, current) => {
      const { result } = await save({ da: { value: "a" } }, () => jsonResponse(409, { error: "conflict", current }));
      expect("current" in result.results.da!).toBe(false);
    },
  );

  it("T22: a request that throws is a failure with no status and a message from the error", async () => {
    const { result } = await save({ da: { value: "a" } }, () => Promise.reject(new TypeError("Failed to fetch")));
    expect(result.results.da).toEqual({ ok: false, message: "TypeError: Failed to fetch", failure: "network" });
  });

  it("CLI-36: an error body that cannot be read still reports the status", async () => {
    const unreadable = { ok: false, status: 500, text: () => Promise.reject(new Error("stream broke")) } as unknown as Response;
    const { result } = await save({ da: { value: "a" } }, () => unreadable);
    expect(result.results.da).toMatchObject({ ok: false, status: 500 });
  });

  it("T23: with no configuration loaded the save fails as a whole", async () => {
    const { request } = fakeRequest(() => jsonResponse(200, { ok: true }));
    expect(await createClient({ getConfig: () => undefined, request }).save("k", { da: { value: "a" } })).toEqual({ ok: false, error: "config-not-loaded", results: {} });
  });

  it("T23: and no request is made", async () => {
    const { request, calls } = fakeRequest(() => jsonResponse(200, { ok: true }));
    await createClient({ getConfig: () => undefined, request }).save("k", { da: { value: "a" } });
    expect(calls).toEqual([]);
  });

  it("a save of nothing is ok and makes no request", async () => {
    const { result, calls } = await save({});
    expect([result.ok, calls.length]).toEqual([true, 0]);
  });
});
