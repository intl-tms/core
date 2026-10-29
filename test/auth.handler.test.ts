import { describe, expect, it } from "vitest";
import { sessionCheck, type Identity } from "../src/auth.js";
import { ConfigError } from "../src/config.js";
import { createMemoryAdapter, type StorageContext } from "../src/storage.js";
import { MOUNT, ORIGIN, setup, type TestConfig } from "./support/harness.js";

const editor: Identity = { id: "u-1", name: "Ada" };

describe("the authorization outcome", () => {
  it("true allows", async () => {
    expect((await setup({ authorize: () => true }).call("GET", `${MOUNT}/config`)).status).toBe(200);
  });

  it("an identity allows", async () => {
    expect((await setup({ authorize: () => ({ identity: editor }) }).call("GET", `${MOUNT}/config`)).status).toBe(200);
  });

  it("forbidden answers 403 with code forbidden", async () => {
    const reply = await setup({ authorize: () => "forbidden" }).call("GET", `${MOUNT}/config`);
    expect(reply.status).toBe(403);
    expect(reply.body).toEqual({ error: "forbidden", code: "forbidden" });
  });

  it("false answers 401 with code unauthorized", async () => {
    const reply = await setup({ authorize: () => false }).call("GET", `${MOUNT}/config`);
    expect(reply.status).toBe(401);
    expect(reply.body.code).toBe("unauthorized");
  });

  it.each([undefined, null, "yes", 1, {}, { identity: "u-1" }, { identity: { name: "no id" } }])("a check that answers %j is not authenticated", async (answer) => {
    const reply = await setup({ authorize: () => answer as never }).call("GET", `${MOUNT}/config`);
    expect(reply.status).toBe(401);
  });

  it("a hand-written check that declares nothing gives a descriptor naming no way", async () => {
    expect((await setup({ authorize: () => false }).call("GET", `${MOUNT}/config`)).body).toEqual({ error: "unauthorized", code: "unauthorized", auth: {} });
  });

  it("the origin check still comes before the check", async () => {
    let asked = false;
    const reply = await setup({ authorize: () => ((asked = true), "forbidden") }).call("PUT", `${MOUNT}/keys/k`, { origin: "https://evil.test", body: { locale: "da", value: "x" } });
    expect(reply.body.code).toBe("forbidden-origin");
    expect(asked).toBe(false);
  });

  it("a forbidden caller never reaches the adapter", async () => {
    let touched = false;
    const adapter = { ...createMemoryAdapter<TestConfig>(), getValues: () => ((touched = true), {}) };
    await setup({ authorize: () => "forbidden" }, adapter).call("GET", `${MOUNT}/keys/k`);
    expect(touched).toBe(false);
  });
});

describe("the sign-in descriptor", () => {
  const signedOut = sessionCheck({ user: () => null, may: () => true, signIn: "/editors/sign-in" });

  it("a 401 names the session and the sign-in address, resolved against the base path's origin", async () => {
    const reply = await setup({ authorize: signedOut }).call("GET", `${MOUNT}/keys/k`);
    expect(reply.body).toEqual({ error: "unauthorized", code: "unauthorized", auth: { session: { signIn: `${ORIGIN}/editors/sign-in` } } });
  });

  it("an absolute sign-in address is kept as it is", async () => {
    const check = sessionCheck({ user: () => null, may: () => true, signIn: "https://login.app.test/editors" });
    expect((await setup({ authorize: check }).call("GET", `${MOUNT}/config`)).body.auth.session.signIn).toBe("https://login.app.test/editors");
  });

  it("says when requests must include credentials", async () => {
    const check = sessionCheck({ user: () => null, may: () => true, signIn: "/in", credentials: true });
    expect((await setup({ authorize: check }).call("GET", `${MOUNT}/config`)).body.auth.session).toEqual({ signIn: `${ORIGIN}/in`, credentials: true });
  });

  it("never depends on what the request carried", async () => {
    const plain = await setup({ authorize: signedOut }).call("GET", `${MOUNT}/config`);
    const odd = await setup({ authorize: signedOut }).call("GET", `${MOUNT}/config`, { headers: { cookie: "x=1", referer: "https://elsewhere.test/" } });
    expect(odd.body).toEqual(plain.body);
  });

  it("is on every route", async () => {
    const { call } = setup({ authorize: signedOut });
    for (const [method, path] of [["GET", `${MOUNT}/config`], ["GET", `${MOUNT}/keys/k`], ["PUT", `${MOUNT}/keys/k`], ["POST", `${MOUNT}/usage`], ["GET", `${MOUNT}/usage/k`]] as const) {
      const reply = await call(method, path, method === "GET" ? {} : { body: { locale: "da", value: "x" } });
      expect([method, path, reply.status, reply.body.auth?.session?.signIn]).toEqual([method, path, 401, `${ORIGIN}/editors/sign-in`]);
    }
  });

  it.each(["", "editors/sign-in", "javascript:alert(1)", "ftp://app.test/in", "//evil.test/in"])("a sign-in address %j throws at boot", (signIn) => {
    expect(() => sessionCheck({ user: () => null, may: () => true, signIn })).toThrow(ConfigError);
  });
});

describe("help texts", () => {
  const help = { unauthenticated: "Sign in with your company account.", forbidden: "Ask IT at it@example.com for the Editor role." };

  it("the not-authenticated text is part of the descriptor", async () => {
    const check = sessionCheck({ user: () => null, may: () => true, signIn: "/in", help });
    expect((await setup({ authorize: check }).call("GET", `${MOUNT}/config`)).body.auth).toEqual({ session: { signIn: `${ORIGIN}/in` }, help: help.unauthenticated });
  });

  it("the not-permitted text is in the body of a 403", async () => {
    const check = sessionCheck({ user: () => editor, may: () => false, signIn: "/in", help });
    expect((await setup({ authorize: check }).call("GET", `${MOUNT}/config`)).body).toEqual({ error: "forbidden", code: "forbidden", help: help.forbidden });
  });

  it("a text of 200 characters is accepted", () => {
    expect(() => sessionCheck({ user: () => null, may: () => true, signIn: "/in", help: { forbidden: "x".repeat(200) } })).not.toThrow();
  });

  it.each([["too long", "x".repeat(201)], ["a line break", "one\ntwo"], ["a carriage return", "one\rtwo"], ["a control character", "one\u0007two"], ["empty", ""], ["not a string", 42]])("a text that is %s throws at boot", (_, text) => {
    expect(() => sessionCheck({ user: () => null, may: () => true, signIn: "/in", help: { unauthenticated: text as string } })).toThrow(ConfigError);
  });
});

describe("the session check", () => {
  it("nobody signed in is not authenticated", async () => {
    const check = sessionCheck({ user: () => undefined, may: () => true, signIn: "/in" });
    expect(await check({ request: new Request(`${ORIGIN}/`), operation: "read" })).toBe(false);
  });

  it("a user who may is allowed, with their identity", async () => {
    const check = sessionCheck({ user: async () => ({ ...editor, roles: ["Editor"] }), may: (user) => user.roles.includes("Editor"), signIn: "/in" });
    expect(await check({ request: new Request(`${ORIGIN}/`), operation: "read" })).toEqual({ identity: editor });
  });

  it("the identity carries only the identifier and the name", async () => {
    const check = sessionCheck({ user: () => ({ id: "u-2", email: "x@example.com" }), may: () => true, signIn: "/in" });
    expect(await check({ request: new Request(`${ORIGIN}/`), operation: "read" })).toEqual({ identity: { id: "u-2" } });
  });

  it("a user who may not is forbidden", async () => {
    const check = sessionCheck({ user: () => editor, may: () => false, signIn: "/in" });
    expect(await check({ request: new Request(`${ORIGIN}/`), operation: "write" })).toBe("forbidden");
  });

  it("may is given the user and the operation", async () => {
    const seen: unknown[] = [];
    const check = sessionCheck({ user: () => editor, may: (user, { operation }) => (seen.push([user.id, operation]), true), signIn: "/in" });
    await check({ request: new Request(`${ORIGIN}/`), operation: "write" });
    expect(seen).toEqual([["u-1", "write"]]);
  });

  it("a user without an identifier is not authenticated", async () => {
    const check = sessionCheck({ user: () => ({ id: "" }), may: () => true, signIn: "/in" });
    expect(await check({ request: new Request(`${ORIGIN}/`), operation: "read" })).toBe(false);
  });
});

describe("identity and access", () => {
  it("the identity is passed to every storage operation", async () => {
    const seen: [string, StorageContext | undefined][] = [];
    const base = createMemoryAdapter<TestConfig>();
    const adapter = {
      getValues: (key: string, context?: StorageContext) => (seen.push(["getValues", context]), base.getValues(key)),
      saveValue: (key: string, write: Parameters<typeof base.saveValue>[1], context?: StorageContext) => (seen.push(["saveValue", context]), base.saveValue(key, write)),
      getUsage: (key: string, context?: StorageContext) => (seen.push(["getUsage", context]), base.getUsage(key)),
      reportUsage: (report: Parameters<typeof base.reportUsage>[0], context?: StorageContext) => (seen.push(["reportUsage", context]), base.reportUsage(report)),
    };
    const { call } = setup({ authorize: () => ({ identity: editor }) }, adapter);
    await call("GET", `${MOUNT}/keys/k`);
    await call("PUT", `${MOUNT}/keys/k`, { body: { locale: "da", value: "x", expected: { value: "" } } });
    await call("GET", `${MOUNT}/usage/k`);
    await call("POST", `${MOUNT}/usage`, { body: { url: "https://app.test/p", keys: [{ key: "k", count: 1 }] } });
    expect(seen).toEqual([
      ["getValues", { identity: editor }],
      ["getValues", { identity: editor }],
      ["saveValue", { identity: editor }],
      ["getUsage", { identity: editor }],
      ["reportUsage", { identity: editor }],
    ]);
  });

  it("a caller allowed without an identity passes an empty context", async () => {
    let seen: StorageContext | undefined;
    const base = createMemoryAdapter<TestConfig>();
    await setup({ authorize: () => true }, { ...base, getValues: (key: string, context?: StorageContext) => ((seen = context), base.getValues(key)) }).call("GET", `${MOUNT}/keys/k`);
    expect(seen).toEqual({});
  });

  it("the configuration names the caller and says they may write", async () => {
    const reply = await setup({ authorize: () => ({ identity: editor }) }).call("GET", `${MOUNT}/config`);
    expect(reply.body.access).toEqual({ name: "Ada", write: true });
  });

  it("the configuration says a caller may not write when the check refuses a write", async () => {
    const reply = await setup({ authorize: ({ operation }) => (operation === "read" ? { identity: { id: "u-3" } } : "forbidden") }).call("GET", `${MOUNT}/config`);
    expect(reply.body.access).toEqual({ write: false });
  });

  it("asking about writing gives the check the same request", async () => {
    const seen: string[] = [];
    await setup({ authorize: ({ request, operation }) => (seen.push(`${operation} ${new URL(request.url).pathname}`), true) }).call("GET", `${MOUNT}/config`);
    expect(seen).toEqual([`read ${MOUNT}/config`, `write ${MOUNT}/config`]);
  });
});
