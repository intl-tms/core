import { describe, expect, it } from "vitest";
import { createClient, type RequestFn } from "../src/client.js";
import { resolveConfig } from "../src/config.js";
import { createHandler } from "../src/handler.js";
import { createMemoryAdapter } from "../src/storage.js";

const config = resolveConfig({
  locales: ["en", "da", "es"],
  basePath: "https://app.test/api/tms",
  sourceLocale: "en",
  schema: { fields: [{ type: "select", name: "status", options: [{ label: "Draft", value: "draft" }, { label: "Approved", value: "approved" }] }, { type: "text", name: "note" }] },
});

/** The client and the handler, joined by an in-process request function: no network. */
function wire(options: { authorize?: () => boolean; sourceMessage?: string } = {}) {
  let tick = 0;
  const adapter = createMemoryAdapter<typeof config>({ clock: () => (tick += 1000) });
  const handler = createHandler({
    config,
    adapter,
    authorize: options.authorize ?? (() => true),
    ...(options.sourceMessage === undefined ? {} : { metadata: () => ({ sourceMessage: options.sourceMessage }) }),
    onError: () => undefined,
  });
  const request: RequestFn = (url, init) => handler(new Request(url, init));
  return { adapter, client: createClient({ getConfig: () => config, request }) };
}

describe("client against the real handler", () => {
  it("reads a key with nothing stored as an empty envelope", async () => {
    expect((await wire().client.readValues("k")).values).toEqual({ locales: {} });
  });

  it("a saved value reads back", async () => {
    const { client } = wire();
    await client.save("k", { da: { value: "Hej", fields: { status: "draft" } } });
    expect((await client.readValues("k")).values.locales.da).toEqual({ value: "Hej", status: "draft" });
  });

  it("a save of two Locales reports each as ok", async () => {
    const { client } = wire();
    expect((await client.save("k", { da: { value: "Hej" }, es: { value: "Hola" } })).results).toEqual({ da: { ok: true, status: 200 }, es: { ok: true, status: 200 } });
  });

  it("a key with awkward characters survives the round trip", async () => {
    const { client } = wire();
    await client.save("a/b c.d?e#f", { da: { value: "x" } });
    expect((await client.readValues("a/b c.d?e#f")).values.locales.da?.value).toBe("x");
  });

  it("a clear to the empty string reaches storage", async () => {
    const { client } = wire();
    await client.save("k", { da: { value: "x" } });
    await client.save("k", { da: { value: "" } });
    expect((await client.readValues("k")).values.locales.da?.value).toBe("");
  });

  it("a write the server refuses carries the server's own reason", async () => {
    const { client } = wire();
    const result = await client.save("k", { da: { fields: { status: "bogus" } } });
    expect(result.results.da).toMatchObject({ ok: false, status: 400, message: 'field "status" must be one of [draft, approved]', failure: "invalid" });
  });

  it("an unauthorized call is classified as not authenticated", async () => {
    const result = await wire({ authorize: () => false }).client.save("k", { da: { value: "x" } });
    expect(result.results.da).toMatchObject({ ok: false, status: 401, failure: "unauthenticated" });
  });

  it("an unauthorized read is classified with its reason", async () => {
    expect((await wire({ authorize: () => false }).client.readValues("k")).failure).toEqual({ class: "unauthenticated", status: 401, reason: "unauthorized" });
  });

  it("a write whose expected values are stale comes back as a conflict carrying the stored row", async () => {
    const { client } = wire();
    await client.save("k", { da: { value: "theirs", fields: { status: "draft" } } });
    const result = await client.save("k", { da: { value: "mine", expected: { value: "what I loaded" } } });
    expect(result.results.da).toMatchObject({ ok: false, status: 409, failure: "conflict", current: { value: "theirs", status: "draft" } });
  });

  it("a write whose expected values are current goes through", async () => {
    const { client } = wire();
    await client.save("k", { da: { value: "v1" } });
    expect((await client.save("k", { da: { value: "v2", expected: { value: "v1" } } })).ok).toBe(true);
  });

  it("a conflict leaves the stored row unchanged", async () => {
    const { client } = wire();
    await client.save("k", { da: { value: "theirs" } });
    await client.save("k", { da: { value: "mine", expected: { value: "stale" } } });
    expect((await client.readValues("k")).values.locales.da?.value).toBe("theirs");
  });

  it("a source message from the metadata hook keeps the Source Locale row from being seeded with page text", async () => {
    const { client } = wire({ sourceMessage: "Go to <a>Docs</a>" });
    const result = await client.readValues("k", { locale: "en", value: "Go to " });
    expect([result.values.meta?.sourceMessage, result.values.locales.en]).toEqual(["Go to <a>Docs</a>", undefined]);
  });

  it("without a source message the Source Locale row is seeded from the page", async () => {
    expect((await wire().client.readValues("k", { locale: "en", value: "Hi" })).values.locales.en).toEqual({ value: "Hi" });
  });

  it("a usage report is accepted and read back for each key", async () => {
    const { client } = wire();
    const outcome = await client.reportUsage({ url: "https://app.test/pricing", title: "Pricing", keys: [{ key: "a", count: 2 }, { key: "b", count: 1 }] });
    const usages = (await client.readUsage("a")).usages;
    expect([outcome, usages.map((u) => (u.source === "runtime" ? [u.url, u.count] : null))]).toEqual(["sent", [["https://app.test/pricing", 2]]]);
  });

  it("a usage read for an unknown key is an empty list, not an error", async () => {
    expect(await wire().client.readUsage("unknown")).toEqual({ usages: [], error: false, configured: true });
  });

  it("a usage report with a hostile URL is refused by the server and reported as failed", async () => {
    expect(await wire().client.reportUsage({ url: "javascript:alert(1)", keys: [{ key: "a", count: 1 }] })).toBe("failed");
  });
});
