import { describe, expect, it } from "vitest";
import { createMemoryAdapter, type UntypedStorageAdapter } from "../src/storage.js";
import { MOUNT, ORIGIN, setup, type TestConfig } from "./support/harness.js";

const KEY = `${MOUNT}/keys/k`;
const USAGE = `${MOUNT}/usage`;
const write = { locale: "da", value: "x" };
const report = { url: "https://app.test/p", keys: [{ key: "a", count: 1 }] };
const LISTED = "https://workbench.example.dev";
const FOREIGN = "https://evil.example";

/** A handler whose adapter and authorization record whether they were reached. */
function watched(cors?: { origins: string[]; credentials?: boolean }) {
  const reached = { saved: 0, reported: 0, authorized: 0 };
  const base = createMemoryAdapter<TestConfig>();
  const adapter = {
    ...base,
    saveValue: (k: string, w: never) => (reached.saved++, (base as UntypedStorageAdapter).saveValue(k, w)),
    reportUsage: (r: never) => (reached.reported++, (base as UntypedStorageAdapter).reportUsage(r)),
  };
  const harness = setup({ authorize: () => (reached.authorized++, true), ...(cors === undefined ? {} : { cors }) }, adapter as never);
  return { ...harness, reached };
}

describe("writes require a JSON content type", () => {
  it.each(["text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/xml"])("a PUT with %s is 415", async (type) => {
    const reply = await setup().call("PUT", KEY, { rawBody: JSON.stringify(write), headers: { "content-type": type } });
    expect([reply.status, reply.body]).toEqual([415, { error: "writes must be sent as application/json", code: "unsupported-media-type" }]);
  });

  it("a PUT with no content type is 415", async () => {
    const reply = await setup().handler(new Request(`${ORIGIN}${KEY}`, { method: "PUT", body: new Blob([JSON.stringify(write)]) }));
    expect(reply.status).toBe(415);
  });

  it("a refused PUT never reaches storage", async () => {
    const { call, reached } = watched();
    await call("PUT", KEY, { rawBody: JSON.stringify(write), headers: { "content-type": "text/plain" } });
    expect(reached.saved).toBe(0);
  });

  it("a usage report with a form content type is 415 and never reaches storage", async () => {
    const { call, reached } = watched();
    const reply = await call("POST", USAGE, { rawBody: JSON.stringify(report), headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect([reply.status, reached.reported]).toEqual([415, 0]);
  });

  it.each(["application/json", "application/json; charset=utf-8", "APPLICATION/JSON", "Application/Json;charset=UTF-8"])("a PUT with %s is accepted", async (type) => {
    expect((await setup().call("PUT", KEY, { rawBody: JSON.stringify(write), headers: { "content-type": type } })).status).toBe(200);
  });

  it("a type that merely contains json is not accepted", async () => {
    expect((await setup().call("PUT", KEY, { rawBody: JSON.stringify(write), headers: { "content-type": "text/plain; x=application/json" } })).status).toBe(415);
  });

  it("a read needs no content type", async () => {
    expect((await setup().call("GET", KEY)).status).toBe(200);
  });

  it("the content type is judged after authorization, so a denied caller still gets 401", async () => {
    const reply = await setup({ authorize: () => false }).call("PUT", KEY, { rawBody: "x", headers: { "content-type": "text/plain" } });
    expect(reply.status).toBe(401);
  });

  it("a body that is not JSON under a JSON content type is still 400", async () => {
    expect((await setup().call("PUT", KEY, { rawBody: "{nope" })).status).toBe(400);
  });
});

describe("writes from another origin are refused before authorization", () => {
  it("a write from the website's own origin is accepted", async () => {
    expect((await setup().call("PUT", KEY, { body: write, origin: ORIGIN })).status).toBe(200);
  });

  it("a write from a foreign origin is 403", async () => {
    const reply = await setup().call("PUT", KEY, { body: write, origin: FOREIGN });
    expect([reply.status, reply.body]).toEqual([403, { error: "origin not allowed", code: "forbidden-origin" }]);
  });

  it("a refused write never reaches storage", async () => {
    const { call, reached } = watched();
    await call("PUT", KEY, { body: write, origin: FOREIGN });
    expect(reached.saved).toBe(0);
  });

  it("a refused write never consults authorization", async () => {
    const { call, reached } = watched();
    await call("PUT", KEY, { body: write, origin: FOREIGN });
    expect(reached.authorized).toBe(0);
  });

  it("a usage report from a foreign origin is refused too", async () => {
    const { call, reached } = watched();
    const reply = await call("POST", USAGE, { body: report, origin: FOREIGN });
    expect([reply.status, reached.reported]).toEqual([403, 0]);
  });

  it("an origin of null (a sandboxed frame, a privacy-stripped form post) is refused", async () => {
    expect((await setup().call("PUT", KEY, { body: write, origin: "null" })).status).toBe(403);
  });

  it("an origin that merely starts with the website's own is refused", async () => {
    expect((await setup().call("PUT", KEY, { body: write, origin: `${ORIGIN}.evil.example` })).status).toBe(403);
  });

  it("a write with no Origin header (a server or a script, not a browser form) is accepted", async () => {
    expect((await setup().call("PUT", KEY, { body: write })).status).toBe(200);
  });

  it("a write from an origin the cross-origin policy lists is accepted", async () => {
    expect((await setup({ cors: { origins: [LISTED] } }).call("PUT", KEY, { body: write, origin: LISTED })).status).toBe(200);
  });

  it("a write from an unlisted origin is refused even when a policy exists", async () => {
    expect((await setup({ cors: { origins: [LISTED] } }).call("PUT", KEY, { body: write, origin: FOREIGN })).status).toBe(403);
  });

  it("the website's public origin, taken from the base path, is its own even behind a proxy that rewrites the request URL", async () => {
    const { handler } = setup();
    const request = new Request(`http://internal:3000${KEY}`, { method: "PUT", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(write) });
    expect((await handler(request)).status).toBe(200);
  });

  it("a read from a foreign origin is still served: the cross-origin policy governs who may read the answer", async () => {
    expect((await setup().call("GET", KEY, { origin: FOREIGN })).status).toBe(200);
  });

  it("the refusal declares that it varies by origin when a policy is configured", async () => {
    const reply = await setup({ cors: { origins: [LISTED] } }).call("PUT", KEY, { body: write, origin: FOREIGN });
    expect([reply.headers.get("vary"), reply.headers.get("access-control-allow-origin")]).toEqual(["Origin", null]);
  });

  it("a wrong method is still 405 before the origin is judged", async () => {
    expect((await setup().call("DELETE", KEY, { origin: FOREIGN })).status).toBe(405);
  });

  it("a preflight from a listed origin is still answered", async () => {
    expect((await setup({ cors: { origins: [LISTED] } }).call("OPTIONS", KEY, { origin: LISTED })).status).toBe(204);
  });

  it("the origin is judged before the content type, so a forged form post learns nothing about the body rules", async () => {
    const reply = await setup().call("PUT", KEY, { rawBody: "x", headers: { "content-type": "text/plain" }, origin: FOREIGN });
    expect(reply.status).toBe(403);
  });
});
