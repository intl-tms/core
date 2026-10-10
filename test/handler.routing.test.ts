import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";
import { createHandler } from "../src/handler.js";
import { createMemoryAdapter } from "../src/storage.js";
import { config, MOUNT, setup } from "./support/harness.js";

describe("request handler routing", () => {
  it("H1: GET /config answers 200", async () => {
    expect((await setup().call("GET", `${MOUNT}/config`)).status).toBe(200);
  });

  it("H2: the body is the resolved configuration", async () => {
    expect((await setup().call("GET", `${MOUNT}/config`)).body).toEqual(JSON.parse(JSON.stringify(config)));
  });

  it("H3: a path outside the mount point is 404", async () => {
    expect((await setup().call("GET", "/elsewhere/config")).status).toBe(404);
  });

  it("H4: an unknown route under the mount point is 404", async () => {
    expect((await setup().call("GET", `${MOUNT}/nope`)).status).toBe(404);
  });

  it("H5: a key path with extra segments is 404", async () => {
    expect((await setup().call("GET", `${MOUNT}/keys/a/b/c`)).status).toBe(404);
  });

  it("H6: malformed percent-encoding is 400", async () => {
    expect((await setup().call("GET", `${MOUNT}/keys/%E0%A4%A`)).status).toBe(400);
  });

  it("H7: an unsupported method on a known route is 405", async () => {
    expect((await setup().call("DELETE", `${MOUNT}/keys/a`)).status).toBe(405);
  });

  it("H8: the 405 names the allowed methods", async () => {
    expect((await setup().call("DELETE", `${MOUNT}/keys/a`)).headers.get("allow")).toBe("GET, PUT");
  });

  it("H9: a key named like a route is still a key", async () => {
    const { adapter, call } = setup();
    await adapter.saveValue("config", { locale: "da", value: "Hej" });
    expect((await call("GET", `${MOUNT}/keys/config`)).body).toEqual({ locales: { da: { value: "Hej" } } });
  });

  it("H10: the same request on another origin is routed identically", async () => {
    expect((await setup().call("GET", `https://preview.example.dev${MOUNT}/config`)).status).toBe(200);
  });

  it("H11: a percent-encoded slash in a key reaches the adapter decoded", async () => {
    const asked: string[] = [];
    const adapter = createMemoryAdapter<typeof config>();
    const spy = { ...adapter, getValues: (key: string) => (asked.push(key), adapter.getValues(key)) };
    await setup({}, spy).call("GET", `${MOUNT}/keys/a%2Fb`);
    expect(asked).toEqual(["a/b"]);
  });

  it("H12: building from a values template without the standard suffix and no Base path throws", () => {
    const odd = resolveConfig({ locales: ["en"], endpoints: { values: "https://app.test/api/translations/{key}" } });
    expect(() => createHandler({ config: odd, adapter: createMemoryAdapter(), authorize: () => true })).toThrow(/keys\/\{key\}/);
  });

  it("H12: a values template with the standard suffix and no Base path infers the mount point", async () => {
    const inferred = resolveConfig({ locales: ["en"], endpoints: { values: "https://app.test/api/tms/keys/{key}" } });
    const handler = createHandler({ config: inferred, adapter: createMemoryAdapter(), authorize: () => true });
    expect((await handler(new Request("https://app.test/api/tms/keys/a"))).status).toBe(200);
  });

  it("H13: a sibling path that merely starts with the mount point is 404", async () => {
    expect((await setup().call("GET", "/api/tmsx/config")).status).toBe(404);
  });

  it("a request to the mount point itself is 404", async () => {
    expect((await setup().call("GET", MOUNT)).status).toBe(404);
  });

  it("an empty key segment is 404", async () => {
    expect((await setup().call("GET", `${MOUNT}/keys/`)).status).toBe(404);
  });

  it("a handler mounted at the origin root routes /config", async () => {
    const root = resolveConfig({ locales: ["en"], basePath: "https://app.test" });
    const handler = createHandler({ config: root, adapter: createMemoryAdapter(), authorize: () => true });
    expect((await handler(new Request("https://app.test/config"))).status).toBe(200);
  });

  it("usage routes are 404 when the usage endpoints are not configured", async () => {
    const noUsage = resolveConfig({ locales: ["en"], endpoints: { values: "https://app.test/api/tms/keys/{key}" } });
    const handler = createHandler({ config: noUsage, adapter: createMemoryAdapter(), authorize: () => true });
    expect((await handler(new Request("https://app.test/api/tms/usage/k"))).status).toBe(404);
  });
});
