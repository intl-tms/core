import { describe, expect, it } from "vitest";
import { sessionCheck, type Identity } from "../src/auth.js";
import { ConfigError } from "../src/config.js";
import { createHandler } from "../src/handler.js";
import { createMemoryPairingStore, createPairing, type PairingOptions, type PairingRecord } from "../src/pairing.js";
import { EDITING_TOKEN_HEADER, EDITING_TOKEN_PREFIX } from "../src/sign-in.js";
import { MOUNT, ORIGIN, config, setup } from "./support/harness.js";

// Pairing (section 9.1): a workbench on another site signs an Editor in with
// the website's own login, through a pop-up that hands it a one-time code,
// which it exchanges with its proof for a short-lived editing token.

const WORKBENCH = "https://workbench.test";
const HOUR = 60 * 60 * 1000;

type User = Identity & { roles: string[] };

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const challengeOf = async (proof: string) => base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proof))));
const newProof = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

/** A website with a login for Editors, a stand-in identity provider, pairing set up and a workbench origin listed. */
function website(overrides: Partial<PairingOptions<User>> = {}) {
  let clock = 1_000_000;
  const accounts = new Map<string, { user: User; active: boolean }>([
    ["ada", { user: { id: "ada", name: "Ada", roles: ["Editor"] }, active: true }],
    ["sam", { user: { id: "sam", name: "Sam", roles: [] }, active: true }],
  ]);
  const signedInAt = new Map<string, number>();
  const sessionOf = (request: Request) => /editor=(\w+)/.exec(request.headers.get("cookie") ?? "")?.[1];
  const store = createMemoryPairingStore<User>();
  const rechecks: string[] = [];
  const pairing = createPairing<User>({
    store,
    signIn: (returnTo) => `/editors/sign-in?return=${encodeURIComponent(returnTo)}`,
    session: (request) => {
      const id = sessionOf(request);
      if (id === undefined) return undefined;
      return { user: structuredClone(accounts.get(id)!.user), grant: `grant-${id}`, signedInAt: signedInAt.get(id) ?? clock };
    },
    recheck: (user, grant) => {
      rechecks.push(grant);
      const account = accounts.get(user.id)!;
      return account.active ? { active: true, user: structuredClone(account.user), grant } : { active: false };
    },
    now: () => clock,
    ...overrides,
  });
  const authorize = sessionCheck<User>({
    user: async (request) => (await pairing.user(request)) ?? (sessionOf(request) === undefined ? undefined : structuredClone(accounts.get(sessionOf(request)!)!.user)),
    may: (user) => user.roles.includes("Editor"),
    help: { forbidden: "Ask IT for the Editor role." },
  });
  const site = setup({ authorize, pairing, cors: { origins: [WORKBENCH] } });

  /** Opens the pop-up as the Editor's browser would, signed in as `account` or not at all. */
  const popUp = (challenge: string, account?: string, origin = WORKBENCH) =>
    site.call("GET", `${MOUNT}/pair?origin=${encodeURIComponent(origin)}&challenge=${challenge}`, account === undefined ? {} : { headers: { cookie: `editor=${account}` } });

  /** The code a pop-up page hands over, read from the page as the browser would run it. */
  const codeIn = (page: string) => /"code":"([\w-]+)"/.exec(page)?.[1];

  const exchange = (code: string | undefined, proof: string, origin = WORKBENCH) => site.call("POST", `${MOUNT}/pair/token`, { origin, body: { code, proof } });

  /** Signs in through the pop-up and exchanges the code: the token, as the workbench would hold it. */
  const pair = async (account = "ada") => {
    const proof = newProof();
    const page = await popUp(await challengeOf(proof), account);
    const reply = await exchange(codeIn(page.body), proof);
    return reply.body.token as string;
  };

  const withToken = (token: string) => ({ origin: WORKBENCH, headers: { [EDITING_TOKEN_HEADER]: token } });

  return {
    ...site,
    pairing,
    store,
    accounts,
    rechecks,
    signedInAt,
    popUp,
    codeIn,
    exchange,
    pair,
    withToken,
    advance: (ms: number) => void (clock += ms),
  };
}

describe("the pairing address", () => {
  it("is named in the sign-in descriptor of a 401", async () => {
    const site = website();
    const reply = await site.call("GET", `${MOUNT}/config`, { origin: WORKBENCH });
    expect(reply.status).toBe(401);
    expect(reply.body.auth.pair).toEqual({ address: `${ORIGIN}${MOUNT}/pair` });
  });

  it("is not named, and its routes do not exist, without pairing", async () => {
    const site = setup({ authorize: () => false, cors: { origins: [WORKBENCH] } });
    expect((await site.call("GET", `${MOUNT}/config`)).body.auth).toEqual({});
    expect((await site.call("GET", `${MOUNT}/pair?origin=${WORKBENCH}&challenge=x`)).status).toBe(404);
  });

  it("pairing with no listed origin is refused at boot: nothing could ever pair", () => {
    const pairing = createPairing<User>({ store: createMemoryPairingStore(), signIn: () => "/in", session: () => undefined, recheck: () => ({ active: false }) });
    expect(() => createHandler({ config, adapter: setup().adapter, authorize: () => false, pairing })).toThrow(ConfigError);
  });
});

describe("the pop-up", () => {
  it("delivers nothing to an origin that is not listed, and says why", async () => {
    const site = website();
    const page = await site.popUp(await challengeOf(newProof()), "ada", "https://evil.test");
    expect(page.status).toBe(400);
    expect(page.headers.get("content-type")).toMatch(/^text\/html/);
    expect(site.codeIn(page.body)).toBeUndefined();
    expect(page.body).not.toContain("postMessage");
    expect(site.store.size()).toBe(0);
  });

  it("delivers nothing for a challenge that is not one", async () => {
    const site = website();
    for (const challenge of ["", "short", "a".repeat(44), "has space".padEnd(43, "x")]) {
      const page = await site.popUp(encodeURIComponent(challenge), "ada");
      expect(page.status).toBe(400);
      expect(site.codeIn(page.body)).toBeUndefined();
    }
  });

  it("sends someone who is not signed in to the sign-in address, with the pop-up as the way back", async () => {
    const site = website();
    const challenge = await challengeOf(newProof());
    const page = await site.popUp(challenge);
    expect(page.status).toBe(303);
    const location = new URL(page.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(`${ORIGIN}/editors/sign-in`);
    expect(location.searchParams.get("return")).toBe(`${MOUNT}/pair?origin=${encodeURIComponent(WORKBENCH)}&challenge=${challenge}`);
  });

  it("tells someone signed in without permission, with the website's help, and delivers no code", async () => {
    const site = website();
    const page = await site.popUp(await challengeOf(newProof()), "sam");
    expect(page.status).toBe(403);
    expect(page.body).toContain("Ask IT for the Editor role.");
    expect(site.codeIn(page.body)).toBeUndefined();
    expect(site.store.size()).toBe(0);
  });

  it("hands a permitted Editor's code to the exact listed origin by window message, never in an address", async () => {
    const site = website();
    const page = await site.popUp(await challengeOf(newProof()), "ada");
    expect(page.status).toBe(200);
    const code = site.codeIn(page.body);
    expect(code).toMatch(/^[\w-]{43}$/);
    expect(page.body).toContain(`opener.postMessage(message, ${JSON.stringify(WORKBENCH)})`);
    expect(page.headers.get("location")).toBeNull();
  });

  it("cannot be framed, cached or leak its address", async () => {
    const page = await website().popUp(await challengeOf(newProof()), "ada");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("runs only its own script", async () => {
    const page = await website().popUp(await challengeOf(newProof()), "ada");
    const nonce = /script-src 'nonce-([\w+/=-]+)'/.exec(page.headers.get("content-security-policy")!)?.[1];
    expect(nonce).toBeDefined();
    expect(page.body).toContain(`<script nonce="${nonce}">`);
  });

  it("keeps the code only as its digest", async () => {
    const site = website();
    const page = await site.popUp(await challengeOf(newProof()), "ada");
    expect(JSON.stringify(site.store.records())).not.toContain(site.codeIn(page.body));
  });

  it("writes what a website says as text, not markup", async () => {
    const site = website();
    site.accounts.get("ada")!.user.name = "<img src=x onerror=alert(1)>";
    const page = await site.popUp(await challengeOf(newProof()), "ada");
    expect(page.body).not.toContain("<img");
  });
});

describe("exchanging the code", () => {
  it("with its proof gives an editing token and the Editor's name", async () => {
    const site = website();
    const proof = newProof();
    const page = await site.popUp(await challengeOf(proof), "ada");
    const reply = await site.exchange(site.codeIn(page.body), proof);
    expect(reply.status).toBe(200);
    expect(reply.body.token.startsWith(EDITING_TOKEN_PREFIX)).toBe(true);
    expect(reply.body.name).toBe("Ada");
    expect(reply.headers.get("access-control-allow-origin")).toBe(WORKBENCH);
    expect(reply.headers.get("cache-control")).toBe("no-store");
  });

  it("without the proof whose digest was the challenge is refused", async () => {
    const site = website();
    const page = await site.popUp(await challengeOf(newProof()), "ada");
    const reply = await site.exchange(site.codeIn(page.body), newProof());
    expect(reply.status).toBe(400);
    expect(reply.body.token).toBeUndefined();
  });

  it("works once: the second exchange is refused, also with the right proof", async () => {
    const site = website();
    const proof = newProof();
    const code = site.codeIn((await site.popUp(await challengeOf(proof), "ada")).body);
    expect((await site.exchange(code, proof)).status).toBe(200);
    expect((await site.exchange(code, proof)).status).toBe(400);
  });

  it("a wrong proof uses the code up", async () => {
    const site = website();
    const proof = newProof();
    const code = site.codeIn((await site.popUp(await challengeOf(proof), "ada")).body);
    await site.exchange(code, newProof());
    expect((await site.exchange(code, proof)).status).toBe(400);
  });

  it("is refused after 60 seconds", async () => {
    const site = website();
    const proof = newProof();
    const code = site.codeIn((await site.popUp(await challengeOf(proof), "ada")).body);
    site.advance(60_001);
    expect((await site.exchange(code, proof)).status).toBe(400);
  });

  it("is refused from another origin than the one the code was handed to", async () => {
    const site = website();
    const proof = newProof();
    const code = site.codeIn((await site.popUp(await challengeOf(proof), "ada")).body);
    expect((await site.exchange(code, proof, "https://evil.test")).status).toBe(403);
    expect((await site.exchange(code, proof, ORIGIN)).status).toBe(400);
  });

  it.each([{}, { code: 1, proof: "x" }, { code: "x" }, { code: "x", proof: "y" }])("refuses %j", async (body) => {
    const site = website();
    expect((await site.call("POST", `${MOUNT}/pair/token`, { origin: WORKBENCH, body })).status).toBe(400);
  });
});

describe("the editing token", () => {
  it("authorizes reading and saving from the workbench, as the Editor", async () => {
    const site = website();
    const token = await site.pair();
    const config = await site.call("GET", `${MOUNT}/config`, site.withToken(token));
    expect(config.status).toBe(200);
    expect(config.body.access).toEqual({ name: "Ada", write: true });
    const saved = await site.call("PUT", `${MOUNT}/keys/k`, { ...site.withToken(token), body: { locale: "da", value: "Hej" } });
    expect(saved.status).toBe(200);
  });

  it("is accepted only from its header", async () => {
    const site = website();
    const token = await site.pair();
    expect((await site.call("GET", `${MOUNT}/config?token=${token}`, { origin: WORKBENCH })).status).toBe(401);
    expect((await site.call("GET", `${MOUNT}/config`, { origin: WORKBENCH, headers: { cookie: `${EDITING_TOKEN_HEADER}=${token}` } })).status).toBe(401);
    expect((await site.call("GET", `${MOUNT}/config`, { origin: WORKBENCH, headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it.each(["", "tmset_", "nope", `${EDITING_TOKEN_PREFIX}${"a".repeat(43)}`])("%j is not a token", async (token) => {
    expect((await website().call("GET", `${MOUNT}/config`, { origin: WORKBENCH, headers: { [EDITING_TOKEN_HEADER]: token } })).status).toBe(401);
  });

  it("a code is not a token", async () => {
    const site = website();
    const code = site.codeIn((await site.popUp(await challengeOf(newProof()), "ada")).body)!;
    expect((await site.call("GET", `${MOUNT}/config`, site.withToken(`${EDITING_TOKEN_PREFIX}${code}`))).status).toBe(401);
  });

  it("is stored only as its digest, with the identity and when it ends", async () => {
    const site = website();
    const token = await site.pair();
    const records = site.store.records();
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain(token.slice(EDITING_TOKEN_PREFIX.length));
    expect(records[0]!.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(records[0]!.user.id).toBe("ada");
  });

  it("ends 10 hours after the sign-in it came from, and its record is deleted", async () => {
    const site = website();
    site.signedInAt.set("ada", 1_000_000 - 9 * HOUR);
    const token = await site.pair();
    site.advance(HOUR - 1);
    // Re-checked once the hour is up, which still allows.
    expect((await site.call("GET", `${MOUNT}/config`, site.withToken(token))).status).toBe(200);
    site.advance(1);
    expect((await site.call("GET", `${MOUNT}/config`, site.withToken(token))).status).toBe(401);
    expect(site.store.size()).toBe(0);
  });

  it("is re-checked with the identity provider once the interval has passed, with the session's grant", async () => {
    const site = website();
    const token = await site.pair();
    await site.call("GET", `${MOUNT}/config`, site.withToken(token));
    expect(site.rechecks).toEqual([]);
    site.advance(HOUR);
    await site.call("GET", `${MOUNT}/config`, site.withToken(token));
    expect(site.rechecks).toEqual(["grant-ada"]);
  });

  it("a withdrawn role is refused at the next re-check", async () => {
    const site = website();
    const token = await site.pair();
    site.accounts.get("ada")!.user.roles = [];
    expect((await site.call("GET", `${MOUNT}/config`, site.withToken(token))).status).toBe(200);
    site.advance(HOUR);
    const reply = await site.call("GET", `${MOUNT}/config`, site.withToken(token));
    expect(reply.status).toBe(403);
    expect(reply.body.help).toBe("Ask IT for the Editor role.");
  });

  it("a disabled account ends the token at the next re-check", async () => {
    const site = website();
    const token = await site.pair();
    site.accounts.get("ada")!.active = false;
    site.advance(HOUR);
    expect((await site.call("GET", `${MOUNT}/config`, site.withToken(token))).status).toBe(401);
    expect(site.store.size()).toBe(0);
  });

  it("both values are settings", async () => {
    const site = website({ lifetimeMs: 2 * HOUR, recheckEveryMs: 60_000 });
    const token = await site.pair();
    site.advance(60_000);
    await site.call("GET", `${MOUNT}/config`, site.withToken(token));
    expect(site.rechecks).toHaveLength(1);
    site.advance(2 * HOUR);
    expect((await site.call("GET", `${MOUNT}/config`, site.withToken(token))).status).toBe(401);
  });

  it("ending every token of an identity refuses that Editor's next request, and only theirs", async () => {
    const site = website();
    const ada = await site.pair("ada");
    site.accounts.get("sam")!.user.roles = ["Editor"];
    const sam = await site.pair("sam");
    await site.pairing.endAllOf("ada");
    expect((await site.call("GET", `${MOUNT}/config`, site.withToken(ada))).status).toBe(401);
    expect((await site.call("GET", `${MOUNT}/config`, site.withToken(sam))).status).toBe(200);
  });

  it("signing out in the workbench ends it at the website", async () => {
    const site = website();
    const token = await site.pair();
    const reply = await site.call("POST", `${MOUNT}/pair/end`, site.withToken(token));
    expect(reply.status).toBe(204);
    expect((await site.call("GET", `${MOUNT}/config`, site.withToken(token))).status).toBe(401);
    expect(site.store.size()).toBe(0);
  });

  it("needs no credentials allowance from the workbench's origin, and a preflight allows its header", async () => {
    const site = website();
    const preflight = await site.call("OPTIONS", `${MOUNT}/keys/k`, { origin: WORKBENCH, headers: { "access-control-request-method": "PUT", "access-control-request-headers": `content-type, ${EDITING_TOKEN_HEADER}` } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toContain(EDITING_TOKEN_HEADER);
    const token = await site.pair();
    const reply = await site.call("GET", `${MOUNT}/config`, site.withToken(token));
    expect(reply.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("is removed from the request the error hook is given", async () => {
    let seen: Request | undefined;
    const pairing = createPairing<User>({
      store: createMemoryPairingStore(),
      signIn: () => "/in",
      session: () => undefined,
      recheck: () => ({ active: false }),
    });
    const site = setup({
      authorize: () => {
        throw new Error("boom");
      },
      pairing,
      cors: { origins: [WORKBENCH] },
      onError: (_error, request) => void (seen = request),
    });
    await site.call("GET", `${MOUNT}/config`, { origin: WORKBENCH, headers: { [EDITING_TOKEN_HEADER]: `${EDITING_TOKEN_PREFIX}secret`, accept: "application/json" } });
    expect(seen?.headers.has(EDITING_TOKEN_HEADER)).toBe(false);
    expect(seen?.headers.get("accept")).toBe("application/json");
  });
});

describe("the memory store", () => {
  it("deletes a record once, saying whether it was there", () => {
    const store = createMemoryPairingStore<User>();
    const record: PairingRecord<User> = { digest: "d", kind: "token", user: { id: "ada", roles: [] }, grant: "g", signedInAt: 0, checkedAt: 0, endsAt: 1 };
    store.save(record);
    expect(store.delete("d")).toBe(true);
    expect(store.delete("d")).toBe(false);
  });
});
