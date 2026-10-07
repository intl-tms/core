import { describe, expect, it, vi } from "vitest";
import { createMemoryAdapter } from "../src/storage.js";
import { config, MOUNT, setup, type TestConfig } from "./support/harness.js";

const throwingAdapter = (error: unknown = new Error("connection string: postgres://user:secret@db")) => {
  const base = createMemoryAdapter<TestConfig>();
  return { ...base, getValues: () => Promise.reject(error) };
};

describe("authorization", () => {
  it("H20: a check that returns false answers 401", async () => {
    expect((await setup({ authorize: () => false }).call("GET", `${MOUNT}/config`)).status).toBe(401);
  });

  it("the 401 body carries a reason and a stable code", async () => {
    expect((await setup({ authorize: () => false }).call("GET", `${MOUNT}/config`)).body).toEqual({ error: "unauthorized", code: "unauthorized" });
  });

  it("a check that returns anything but true denies", async () => {
    expect((await setup({ authorize: () => undefined as unknown as boolean }).call("GET", `${MOUNT}/config`)).status).toBe(401);
  });

  it("H21: a GET gives the check the operation read", async () => {
    const seen: string[] = [];
    await setup({ authorize: ({ operation }) => (seen.push(operation), true) }).call("GET", `${MOUNT}/config`);
    expect(seen).toEqual(["read"]);
  });

  it("H22: a PUT gives the check the operation write", async () => {
    const seen: string[] = [];
    await setup({ authorize: ({ operation }) => (seen.push(operation), true) }).call("PUT", `${MOUNT}/keys/k`, { body: { locale: "da", value: "x" } });
    expect(seen).toEqual(["write"]);
  });

  it("H23: a POST gives the check the operation write", async () => {
    const seen: string[] = [];
    await setup({ authorize: ({ operation }) => (seen.push(operation), true) }).call("POST", `${MOUNT}/usage`, { body: { url: "https://app.test/p", keys: [{ key: "k", count: 1 }] } });
    expect(seen).toEqual(["write"]);
  });

  it("the check receives the request", async () => {
    let seen: Request | undefined;
    await setup({ authorize: ({ request }) => ((seen = request), true) }).call("GET", `${MOUNT}/config`);
    expect(new URL(seen!.url).pathname).toBe(`${MOUNT}/config`);
  });

  it("H24: a check that returns a promise of true is served", async () => {
    expect((await setup({ authorize: async () => true }).call("GET", `${MOUNT}/config`)).status).toBe(200);
  });

  it("a denied request never reaches the adapter", async () => {
    let touched = false;
    const adapter = { ...createMemoryAdapter<TestConfig>(), getValues: () => ((touched = true), {}) };
    await setup({ authorize: () => false }, adapter).call("GET", `${MOUNT}/keys/k`);
    expect(touched).toBe(false);
  });

  it("H30: a wrong method answers 405 even for a denied caller", async () => {
    expect((await setup({ authorize: () => false }).call("DELETE", `${MOUNT}/keys/k`)).status).toBe(405);
  });
});

describe("server errors", () => {
  it("H25: an adapter that throws answers 500", async () => {
    expect((await setup({}, throwingAdapter()).call("GET", `${MOUNT}/keys/k`)).status).toBe(500);
  });

  it("H26: the 500 body is exactly the fixed generic error", async () => {
    expect((await setup({}, throwingAdapter()).call("GET", `${MOUNT}/keys/k`)).body).toEqual({ error: "internal error", code: "internal-error" });
  });

  it("H26: the thrown message never reaches the response", async () => {
    const reply = await setup({}, throwingAdapter()).call("GET", `${MOUNT}/keys/k`);
    expect(JSON.stringify(reply.body)).not.toContain("secret");
  });

  it("H27: the error hook receives the thrown error", async () => {
    const cause = new Error("boom");
    const seen: unknown[] = [];
    await setup({ onError: (error) => void seen.push(error) }, throwingAdapter(cause)).call("GET", `${MOUNT}/keys/k`);
    expect(seen).toEqual([cause]);
  });

  it("H27: the error hook receives the request", async () => {
    const seen: Request[] = [];
    await setup({ onError: (_error, request) => void seen.push(request) }, throwingAdapter()).call("GET", `${MOUNT}/keys/k`);
    expect(new URL(seen[0]!.url).pathname).toBe(`${MOUNT}/keys/k`);
  });

  it("H28: an error hook that throws still leaves a 500", async () => {
    const reply = await setup({ onError: () => { throw new Error("hook broke"); } }, throwingAdapter()).call("GET", `${MOUNT}/keys/k`);
    expect(reply.status).toBe(500);
  });

  it("H29: an authorization check that throws answers 500", async () => {
    expect((await setup({ authorize: () => { throw new Error("auth down"); } }).call("GET", `${MOUNT}/config`)).status).toBe(500);
  });

  it("an authorization check that rejects answers 500", async () => {
    expect((await setup({ authorize: () => Promise.reject(new Error("auth down")) }).call("GET", `${MOUNT}/config`)).status).toBe(500);
  });

  it("a metadata hook that throws answers 500", async () => {
    const reply = await setup({ metadata: () => { throw new Error("no"); } }).call("GET", `${MOUNT}/keys/k`);
    expect(reply.status).toBe(500);
  });

  it("without an error hook the cause goes to the console", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { createHandler } = await import("../src/handler.js");
    const handler = createHandler({ config, adapter: throwingAdapter("db down"), authorize: () => true });
    await handler(new Request(`https://app.test${MOUNT}/keys/k`));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("the handler's promise resolves even when given something that is not a request", async () => {
    const { handler } = setup();
    expect((await handler({} as Request)).status).toBe(500);
  });
});

describe("error bodies", () => {
  it("every error carries a stable machine-readable code beside the reason", async () => {
    const replies = await Promise.all([
      setup().call("GET", `${MOUNT}/nope`),
      setup().call("DELETE", `${MOUNT}/keys/k`),
      setup().call("GET", `${MOUNT}/keys/%E0%A4%A`),
    ]);
    expect(replies.map((r) => r.body)).toEqual([
      { error: "not found", code: "not-found" },
      { error: "method not allowed", code: "method-not-allowed" },
      { error: "malformed percent-encoding in the path", code: "malformed-path" },
    ]);
  });
});
