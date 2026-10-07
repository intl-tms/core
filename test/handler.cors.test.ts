import { describe, expect, it } from "vitest";
import { createHandler } from "../src/handler.js";
import { createMemoryAdapter } from "../src/storage.js";
import { config, MOUNT, setup } from "./support/harness.js";

const LISTED = "https://workbench.example.dev";
const policy = { origins: [LISTED, "https://other.example.dev"] };
const header = (reply: { headers: Headers }, name: string) => reply.headers.get(name);

describe("cross-origin access", () => {
  it("O1: with no policy there are no cross-origin headers", async () => {
    const reply = await setup().call("GET", `${MOUNT}/config`, { origin: LISTED });
    expect([...reply.headers.keys()].filter((k) => k.startsWith("access-control") || k === "vary")).toEqual([]);
  });

  it("O2: a listed origin is named in the allow-origin header", async () => {
    expect(header(await setup({ cors: policy }).call("GET", `${MOUNT}/config`, { origin: LISTED }), "access-control-allow-origin")).toBe(LISTED);
  });

  it("O3: an unlisted origin gets no allow-origin header", async () => {
    expect(header(await setup({ cors: policy }).call("GET", `${MOUNT}/config`, { origin: "https://evil.example" }), "access-control-allow-origin")).toBeNull();
  });

  it("O4: an unlisted origin's response still varies by origin", async () => {
    expect(header(await setup({ cors: policy }).call("GET", `${MOUNT}/config`, { origin: "https://evil.example" }), "vary")).toContain("Origin");
  });

  it("a request with no origin header also declares that it varies by origin", async () => {
    expect(header(await setup({ cors: policy }).call("GET", `${MOUNT}/config`), "vary")).toContain("Origin");
  });

  it("O5: credentials allowed by the policy are declared to a listed origin", async () => {
    expect(header(await setup({ cors: { ...policy, credentials: true } }).call("GET", `${MOUNT}/config`, { origin: LISTED }), "access-control-allow-credentials")).toBe("true");
  });

  it("credentials are not declared to an unlisted origin", async () => {
    expect(header(await setup({ cors: { ...policy, credentials: true } }).call("GET", `${MOUNT}/config`, { origin: "https://evil.example" }), "access-control-allow-credentials")).toBeNull();
  });

  it("O6: without the credentials choice there is no allow-credentials header", async () => {
    expect(header(await setup({ cors: policy }).call("GET", `${MOUNT}/config`, { origin: LISTED }), "access-control-allow-credentials")).toBeNull();
  });

  it("O7: a preflight from a listed origin answers 204", async () => {
    expect((await setup({ cors: policy }).call("OPTIONS", `${MOUNT}/keys/k`, { origin: LISTED })).status).toBe(204);
  });

  it("the preflight answer has no body", async () => {
    expect((await setup({ cors: policy }).call("OPTIONS", `${MOUNT}/keys/k`, { origin: LISTED })).body).toBeUndefined();
  });

  it("O8: a preflight is answered even when the authorization check would deny", async () => {
    expect((await setup({ cors: policy, authorize: () => false }).call("OPTIONS", `${MOUNT}/keys/k`, { origin: LISTED })).status).toBe(204);
  });

  it("O8: the authorization check is never consulted for a preflight", async () => {
    let consulted = false;
    await setup({ cors: policy, authorize: () => ((consulted = true), true) }).call("OPTIONS", `${MOUNT}/keys/k`, { origin: LISTED });
    expect(consulted).toBe(false);
  });

  it("O9: a preflight for the values route allows GET and PUT", async () => {
    expect(header(await setup({ cors: policy }).call("OPTIONS", `${MOUNT}/keys/k`, { origin: LISTED }), "access-control-allow-methods")).toBe("GET, PUT");
  });

  it("a preflight for the usage report route allows POST", async () => {
    expect(header(await setup({ cors: policy }).call("OPTIONS", `${MOUNT}/usage`, { origin: LISTED }), "access-control-allow-methods")).toBe("POST");
  });

  it("O10: a preflight asking about a header has it echoed", async () => {
    const reply = await setup({ cors: policy }).call("OPTIONS", `${MOUNT}/keys/k`, { origin: LISTED, headers: { "access-control-request-headers": "content-type, x-token" } });
    expect(header(reply, "access-control-allow-headers")).toBe("content-type, x-token");
  });

  it("a preflight that asks about no headers allows none", async () => {
    expect(header(await setup({ cors: policy }).call("OPTIONS", `${MOUNT}/keys/k`, { origin: LISTED }), "access-control-allow-headers")).toBeNull();
  });

  it("a preflight names the listed origin", async () => {
    expect(header(await setup({ cors: policy }).call("OPTIONS", `${MOUNT}/keys/k`, { origin: LISTED }), "access-control-allow-origin")).toBe(LISTED);
  });

  it("a preflight for an unknown route is 404 and not a preflight", async () => {
    expect((await setup({ cors: policy }).call("OPTIONS", `${MOUNT}/nope`, { origin: LISTED })).status).toBe(404);
  });

  it("O11: a 400 answer to a listed origin carries the allow-origin header", async () => {
    const reply = await setup({ cors: policy }).call("PUT", `${MOUNT}/keys/k`, { origin: LISTED, body: { locale: "xx", value: "x" } });
    expect([reply.status, header(reply, "access-control-allow-origin")]).toEqual([400, LISTED]);
  });

  it("O12: a 500 answer to a listed origin carries the allow-origin header", async () => {
    const adapter = { ...createMemoryAdapter(), getValues: () => Promise.reject(new Error("x")) };
    const reply = await setup({ cors: policy }, adapter as never).call("GET", `${MOUNT}/keys/k`, { origin: LISTED });
    expect([reply.status, header(reply, "access-control-allow-origin")]).toEqual([500, LISTED]);
  });

  it("a 401 answer to a listed origin carries the allow-origin header", async () => {
    const reply = await setup({ cors: policy, authorize: () => false }).call("GET", `${MOUNT}/config`, { origin: LISTED });
    expect([reply.status, header(reply, "access-control-allow-origin")]).toEqual([401, LISTED]);
  });

  it("a 404 outside the mount point carries the allow-origin header", async () => {
    expect(header(await setup({ cors: policy }).call("GET", "/elsewhere", { origin: LISTED }), "access-control-allow-origin")).toBe(LISTED);
  });

  it("O13: an origin listed as a prefix of the caller's is not matched", async () => {
    expect(header(await setup({ cors: policy }).call("GET", `${MOUNT}/config`, { origin: `${LISTED}.evil.example` }), "access-control-allow-origin")).toBeNull();
  });

  it("matching is case-exact", async () => {
    expect(header(await setup({ cors: policy }).call("GET", `${MOUNT}/config`, { origin: LISTED.toUpperCase() }), "access-control-allow-origin")).toBeNull();
  });

  it("O14: a preflight from an unlisted origin is not answered as a preflight", async () => {
    expect((await setup({ cors: policy }).call("OPTIONS", `${MOUNT}/keys/k`, { origin: "https://evil.example" })).status).toBe(405);
  });

  it("an OPTIONS request with no policy configured is 405", async () => {
    expect((await setup().call("OPTIONS", `${MOUNT}/keys/k`, { origin: LISTED })).status).toBe(405);
  });

  it("a wildcard origin is refused when the handler is built", () => {
    expect(() => createHandler({ config, adapter: createMemoryAdapter(), authorize: () => true, cors: { origins: ["*"] } })).toThrow(/wildcard/i);
  });
});
