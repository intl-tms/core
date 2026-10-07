import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { config, MOUNT, ORIGIN, setup } from "./support/harness.js";

describe("served capabilities", () => {
  it("without a metadata hook the served capabilities are exactly the resolved ones", async () => {
    expect((await setup().call("GET", `${MOUNT}/config`)).body.capabilities).toEqual([...config.capabilities]);
  });

  it("a metadata hook adds the meta capability", async () => {
    expect((await setup({ metadata: () => undefined }).call("GET", `${MOUNT}/config`)).body.capabilities).toContain("meta");
  });

  it("the served protocol version is the configuration's", async () => {
    expect((await setup().call("GET", `${MOUNT}/config`)).body.protocol).toBe(config.protocol);
  });
});

describe("the handler never rejects", () => {
  const METHODS = ["GET", "PUT", "POST", "DELETE", "OPTIONS", "PATCH", "HEAD"];

  it("answers every method, path and body with a response", async () => {
    const { handler } = setup({ cors: { origins: [ORIGIN] } });
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...METHODS), fc.constantFrom("keys/", "usage/", "usage", "config", "", "x/"), fc.string(), fc.string(), async (method, prefix, tail, body) => {
        const withBody = method === "PUT" || method === "POST";
        const request = new Request(`${ORIGIN}${MOUNT}/${prefix}${encodeURIComponent(tail)}`, { method, headers: { origin: ORIGIN }, ...(withBody ? { body } : {}) });
        return (await handler(request)) instanceof Response;
      }),
      { seed: 20261007, numRuns: 200 },
    );
  });

  it("answers a write with an arbitrary JSON body with a status below 600", async () => {
    const { call } = setup();
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (body) => {
        const reply = await call("PUT", `${MOUNT}/keys/k`, { body });
        return reply.status === 200 || (reply.status >= 400 && reply.status < 500);
      }),
      { seed: 20261007, numRuns: 200 },
    );
  });

  it("never answers a client mistake with a 500", async () => {
    const { call } = setup();
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (body) => (await call("POST", `${MOUNT}/usage`, { body })).status !== 500),
      { seed: 20261007, numRuns: 200 },
    );
  });
});
