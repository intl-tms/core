import { describe, expect, it } from "vitest";
import { createClient } from "../src/client.js";
import { BASE, clientConfig, fakeRequest, jsonResponse, textResponse } from "./support/fakes.js";

const envelope = { locales: { en: { value: "Hi" }, da: { value: "Hej", status: "draft" } } };

describe("client: reading values", () => {
  it("T1: with no configuration loaded the error flag is set", async () => {
    const { request } = fakeRequest(() => jsonResponse(200, envelope));
    expect((await createClient({ getConfig: () => undefined, request }).readValues("k")).error).toBe(true);
  });

  it("T1: and no request is made", async () => {
    const { request, calls } = fakeRequest(() => jsonResponse(200, envelope));
    await createClient({ getConfig: () => undefined, request }).readValues("k");
    expect(calls).toEqual([]);
  });

  it("T1: and the values are empty", async () => {
    const { request } = fakeRequest(() => jsonResponse(200, envelope));
    expect((await createClient({ getConfig: () => undefined, request }).readValues("k")).values).toEqual({ locales: {} });
  });

  it("T2: a successful read returns the envelope", async () => {
    const { request } = fakeRequest(() => jsonResponse(200, envelope));
    expect((await createClient({ getConfig: () => clientConfig, request }).readValues("k")).values).toEqual(envelope);
  });

  it("T2: and the error flag is clear", async () => {
    const { request } = fakeRequest(() => jsonResponse(200, envelope));
    expect((await createClient({ getConfig: () => clientConfig, request }).readValues("k")).error).toBe(false);
  });

  it("the key metadata in the envelope is passed through", async () => {
    const { request } = fakeRequest(() => jsonResponse(200, { meta: { sourceMessage: "Hi" }, locales: {} }));
    expect((await createClient({ getConfig: () => clientConfig, request }).readValues("k")).values.meta).toEqual({ sourceMessage: "Hi" });
  });

  it("the request is a GET to the values URL with the key percent-encoded", async () => {
    const { request, calls } = fakeRequest(() => jsonResponse(200, envelope));
    await createClient({ getConfig: () => clientConfig, request }).readValues("a/b c");
    expect([calls[0]?.url, calls[0]?.init.method ?? "GET"]).toEqual([`${BASE}/keys/a%2Fb%20c`, "GET"]);
  });

  it("the configuration is read freshly on every call", async () => {
    const { request, calls } = fakeRequest(() => jsonResponse(200, envelope));
    const served: { config?: typeof clientConfig } = {};
    const client = createClient({ getConfig: () => served.config, request });
    await client.readValues("k");
    served.config = clientConfig;
    await client.readValues("k");
    expect(calls).toHaveLength(1);
  });

  it("T3: a 500 sets the error flag and leaves the values empty", async () => {
    const { request } = fakeRequest(() => jsonResponse(500, { error: "internal error" }));
    const result = await createClient({ getConfig: () => clientConfig, request }).readValues("k");
    expect([result.error, result.values]).toEqual([true, { locales: {} }]);
  });

  it("T4: a request that throws sets the error flag without throwing", async () => {
    const { request } = fakeRequest(() => {
      throw new TypeError("Failed to fetch");
    });
    expect((await createClient({ getConfig: () => clientConfig, request }).readValues("k")).error).toBe(true);
  });

  it("a request that rejects sets the error flag", async () => {
    const { request } = fakeRequest(() => Promise.reject(new TypeError("Failed to fetch")));
    expect((await createClient({ getConfig: () => clientConfig, request }).readValues("k")).error).toBe(true);
  });

  it("a 200 whose body is not JSON is a failure", async () => {
    const { request } = fakeRequest(() => textResponse(200, "<html>login</html>"));
    expect((await createClient({ getConfig: () => clientConfig, request }).readValues("k")).error).toBe(true);
  });

  it("a 200 whose body has no locales map is a failure", async () => {
    const { request } = fakeRequest(() => jsonResponse(200, { nope: true }));
    expect((await createClient({ getConfig: () => clientConfig, request }).readValues("k")).error).toBe(true);
  });

  it("a 200 whose locales is an array is a failure", async () => {
    const { request } = fakeRequest(() => jsonResponse(200, { locales: [] }));
    expect((await createClient({ getConfig: () => clientConfig, request }).readValues("k")).error).toBe(true);
  });
});

describe("client: the fallback seed", () => {
  const read = async (fallback: { locale: string; value: string } | undefined, body: unknown = envelope) => {
    const { request } = fakeRequest(() => jsonResponse(200, body));
    return createClient({ getConfig: () => clientConfig, request }).readValues("k", fallback);
  };

  it("T5: with no row for the fallback's Locale it seeds one", async () => {
    expect((await read({ locale: "es", value: "Hola" })).values.locales.es).toEqual({ value: "Hola" });
  });

  it("T6: a stored row always beats the fallback", async () => {
    expect((await read({ locale: "da", value: "page text" })).values.locales.da).toEqual({ value: "Hej", status: "draft" });
  });

  it("T7: for the Source Locale with a source message and no row, the row stays absent", async () => {
    const body = { meta: { sourceMessage: "Go to <a>Docs</a>" }, locales: { da: { value: "Hej" } } };
    expect((await read({ locale: "en", value: "Go to " }, body)).values.locales.en).toBeUndefined();
  });

  it("T8: for the Source Locale with no source message and no row, it is seeded", async () => {
    expect((await read({ locale: "en", value: "Hi" }, { locales: {} })).values.locales.en).toEqual({ value: "Hi" });
  });

  it("an empty source message does not count as one", async () => {
    expect((await read({ locale: "en", value: "Hi" }, { meta: { sourceMessage: "" }, locales: {} })).values.locales.en).toEqual({ value: "Hi" });
  });

  it("a non-Source Locale is seeded even when a source message exists", async () => {
    const body = { meta: { sourceMessage: "Hi" }, locales: {} };
    expect((await read({ locale: "da", value: "Hej" }, body)).values.locales.da).toEqual({ value: "Hej" });
  });

  it("with no Source Locale configured the fallback is applied", async () => {
    const { request } = fakeRequest(() => jsonResponse(200, { meta: { sourceMessage: "Hi" }, locales: {} }));
    const result = await createClient({ getConfig: () => ({ endpoints: clientConfig.endpoints }), request }).readValues("k", { locale: "en", value: "Hi" });
    expect(result.values.locales.en).toEqual({ value: "Hi" });
  });

  it("a failed read seeds nothing", async () => {
    const { request } = fakeRequest(() => jsonResponse(500, {}));
    const result = await createClient({ getConfig: () => clientConfig, request }).readValues("k", { locale: "da", value: "Hej" });
    expect(result.values).toEqual({ locales: {} });
  });

  it("the seed does not mutate the envelope the server sent", async () => {
    const body = { locales: { en: { value: "Hi" } } };
    await read({ locale: "es", value: "Hola" }, body);
    expect(body.locales).toEqual({ en: { value: "Hi" } });
  });
});

describe("client: read failures carry their reason", () => {
  const failure = async (respond: () => Response | Promise<Response>, config: typeof clientConfig | null = clientConfig) => {
    const { request } = fakeRequest(respond);
    return (await createClient({ getConfig: () => config ?? undefined, request }).readValues("k")).failure;
  };

  it("a server's stated reason is kept", async () => {
    expect((await failure(() => jsonResponse(500, { error: "internal error" })))?.reason).toBe("internal error");
  });

  it("the HTTP status is kept", async () => {
    expect((await failure(() => jsonResponse(500, { error: "x" })))?.status).toBe(500);
  });

  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [400, "invalid"],
    [404, "not-found"],
    [500, "server"],
    [503, "server"],
  ])("a %i is classified %s", async (status, expected) => {
    expect((await failure(() => jsonResponse(status, { error: "x" })))?.class).toBe(expected);
  });

  it("a request that throws is classified as a network failure", async () => {
    expect((await failure(() => Promise.reject(new TypeError("Failed to fetch"))))?.class).toBe("network");
  });

  it("a thrown error's text is the reason", async () => {
    expect((await failure(() => Promise.reject(new TypeError("Failed to fetch"))))?.reason).toBe("TypeError: Failed to fetch");
  });

  it("a configuration that has not arrived is a failure with that reason", async () => {
    expect((await failure(() => jsonResponse(200, envelope), null))?.reason).toBe("config-not-loaded");
  });

  it("a successful read has no failure", async () => {
    expect(await failure(() => jsonResponse(200, envelope))).toBeUndefined();
  });
});
