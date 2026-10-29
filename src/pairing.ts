// Pairing: how a workbench addon on another site signs an Editor in with the
// website's own login. A pop-up on the website hands the addon a one-time
// code; the addon exchanges it, together with a proof only it holds, for a
// short-lived editing token. The Core issues and checks tokens; the records
// live in the Developer's store, and who may edit is still the Developer's
// check.

import { judge, type Authorize, type Identity } from "./auth.js";
import { EDITING_TOKEN_HEADER, EDITING_TOKEN_PREFIX, PAIRING_MESSAGE_TYPE } from "./sign-in.js";
import type { MaybePromise } from "./storage.js";
import { isHttpUrl } from "./usage.js";

/** How long a one-time code may wait to be exchanged. */
export const PAIRING_CODE_LIFETIME_MS = 60_000;

/** An editing token ends this long after the sign-in it came from, at the latest. */
export const EDITING_TOKEN_LIFETIME_MS = 10 * 60 * 60 * 1000;

/** How often an editing token's account and role are checked with the identity provider again. */
export const EDITING_TOKEN_RECHECK_MS = 60 * 60 * 1000;

/**
 * One code or token, as the Developer's store keeps it. Only the digest of the
 * code or token is kept, never the code or token itself.
 */
export interface PairingRecord<U extends Identity = Identity> {
  /** The code's or token's SHA256 digest, lowercase hexadecimal. */
  digest: string;
  kind: "code" | "token";
  /** The Developer's user, as their login for Editors gave it, for their check to judge. Kept as JSON. */
  user: U;
  /** What the identity provider needs to check this user again. */
  grant: string;
  /** When the sign-in this came from happened, in milliseconds since the epoch. */
  signedInAt: number;
  /** When the account and role were last checked with the identity provider. */
  checkedAt: number;
  /** When this ends. A record past its end may be deleted at any time. */
  endsAt: number;
  /** A code's challenge: the digest of the workbench's proof. */
  challenge?: string;
  /** The origin a code was handed to. */
  origin?: string;
}

/** Where the records live: the website's own database. The Core stores nothing. */
export interface PairingStore<U extends Identity = Identity> {
  save(record: PairingRecord<U>): MaybePromise<void>;
  find(digest: string): MaybePromise<PairingRecord<U> | null | undefined>;
  update(record: PairingRecord<U>): MaybePromise<void>;
  /** Deletes a record and says whether it was there, so a code is used once even when two exchanges race. */
  delete(digest: string): MaybePromise<boolean>;
  /** Deletes every record of an identity. */
  deleteAllOf(id: string): MaybePromise<void>;
}

/** The Editor signed in to the website's login, as the pop-up's request carries it. */
export interface PairingSession<U extends Identity> {
  user: U;
  /** What the identity provider needs to check this user again, as the session keeps it. */
  grant: string;
  /** When the Editor signed in. */
  signedInAt: number;
  /** When the session last checked the account with the identity provider. Defaults to now. */
  checkedAt?: number;
}

/** What re-checking says: the account is gone or disabled, or the user as they are now and the grant to use next time. */
export type PairingRecheck<U extends Identity> = { active: false } | { active: true; user: U; grant: string };

/** What {@link createPairing} is built from. */
export interface PairingOptions<U extends Identity> {
  /** Where codes and tokens are kept. */
  store: PairingStore<U>;
  /**
   * The sign-in address of the login for Editors, with a way back: after
   * signing in, send the Editor to `returnTo`, a path on this website. An
   * absolute `http` or `https` address, or a path.
   */
  signIn: (returnTo: string) => string;
  /** Who is signed in to the login for Editors on this request, or nothing. Read only that login's session. */
  session: (request: Request) => MaybePromise<PairingSession<U> | null | undefined>;
  /** The re-check the website's sessions use: whether the account is still active, and the user as they are now. */
  recheck: (user: U, grant: string) => MaybePromise<PairingRecheck<U>>;
  /** Defaults to 10 hours from sign-in. */
  lifetimeMs?: number;
  /** Defaults to one hour. */
  recheckEveryMs?: number;
  /** The clock. Defaults to `Date.now`. */
  now?: () => number;
}

/** Pairing, ready to hand to the request handler and to read in the website's check. */
export interface Pairing<U extends Identity = Identity> {
  /**
   * The user an editing token on this request belongs to, or nothing. A token
   * past its end, or whose account the re-check finds gone, is deleted. Use it
   * in the check beside the session: `user: (r) => pairing.user(r) ?? session(r)`.
   */
  user(request: Request): Promise<U | undefined>;
  /** Ends every editing token of an identity at once: the emergency stop for one Editor, and part of signing out. */
  endAllOf(id: string): Promise<void>;
}

/** What the handler needs from pairing to serve its routes. */
export interface PairingRoutes {
  page(request: Request, context: PairingPageContext): Promise<Response>;
  exchange(request: Request, body: Record<string, unknown>): Promise<Response>;
  end(request: Request): Promise<Response>;
}

/** What the pop-up needs from the handler. */
export interface PairingPageContext {
  authorize: Authorize;
  /** The origins a code may be handed to: the handler's cross-origin list. */
  origins: ReadonlySet<string>;
  /** The website's public origin, for resolving the sign-in address. */
  ownOrigin: string;
  /** The website's help text for someone who may not edit. */
  forbiddenHelp?: string;
}

const routes = new WeakMap<object, PairingRoutes>();

/** The routes behind a pairing, for the handler. */
export function pairingRoutes(pairing: object): PairingRoutes | undefined {
  return routes.get(pairing);
}

/** The English words of the pop-up. */
export const PAIRING_TEXT = {
  title: "Sign in to edit translations",
  signedIn: "Signed in. You can close this pop-up.",
  noOpener: "Signed in, but this pop-up cannot reach the workbench. Close it and press Sign in in the workbench again.",
  forbidden: "You are signed in, but may not edit translations here. Ask whoever manages your access to this website.",
  unknownOrigin: "This sign-in was not asked for by a workbench this website knows. Nothing was handed over.",
  badChallenge: "This sign-in address is incomplete. Press Sign in in the workbench again.",
  noSession: "The website's login did not say who is signed in. Nothing was handed over.",
} as const;

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const TOKEN = new RegExp(`^${EDITING_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`);

const randomText = (): string => base64url(crypto.getRandomValues(new Uint8Array(32)));

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const sha256 = async (text: string): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

/** The digest a store keeps: SHA256, lowercase hexadecimal. */
const digestOf = async (text: string): Promise<string> => [...(await sha256(text))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** The challenge of a proof: the SHA256 digest of its text, URL-safe base64 without padding. */
const challengeOf = async (proof: string): Promise<string> => base64url(await sha256(proof));

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** JSON that can stand inside a script element. */
const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/**
 * The pop-up's page. When it has something to hand over, its one script posts
 * the message to the exact origin and closes the window. Nothing on it comes
 * from the request except what was checked, and it is written as text.
 *
 * The script reaches the window through its globals (`opener`, `close`, and
 * the line by its id), because this module is server code and names no
 * browser global itself.
 */
function page(status: number, lines: { text: string; help?: string | undefined }, handOver?: { message: Record<string, unknown>; origin: string }): Response {
  const nonce = randomText();
  const help = lines.help === undefined ? "" : `<p>${escapeHtml(lines.help)}</p>`;
  const script =
    handOver === undefined
      ? ""
      : `<script nonce="${nonce}">const message = ${scriptJson(handOver.message)};
if (opener) {
  opener.postMessage(message, ${scriptJson(handOver.origin)});
  close();
} else if (message.code !== undefined) {
  line.textContent = ${scriptJson(PAIRING_TEXT.noOpener)};
}</script>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(PAIRING_TEXT.title)}</title>
<style nonce="${nonce}">body{font:16px/1.5 system-ui,sans-serif;margin:2rem auto;padding:0 1rem;max-width:32rem}</style></head>
<body><h1>${escapeHtml(PAIRING_TEXT.title)}</h1><p id="line">${escapeHtml(lines.text)}</p>${help}${script}</body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    },
  });
}

function refused(reason: string): Response {
  return new Response(JSON.stringify({ error: reason, code: "invalid-request" }), { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/**
 * Sets up pairing for a workbench addon. Hand the result to `createHandler`
 * as `pairing`, and read `pairing.user(request)` in the website's check, so
 * the Developer's own rules (the Editor role, the editing switch) judge a
 * token's user exactly as they judge a session's.
 */
export function createPairing<U extends Identity>(options: PairingOptions<U>): Pairing<U> {
  const { store } = options;
  const now = options.now ?? Date.now;
  const lifetime = options.lifetimeMs ?? EDITING_TOKEN_LIFETIME_MS;
  const recheckEvery = options.recheckEveryMs ?? EDITING_TOKEN_RECHECK_MS;

  const user = async (request: Request): Promise<U | undefined> => {
    const token = request.headers.get(EDITING_TOKEN_HEADER);
    if (token === null || !TOKEN.test(token)) return undefined;
    const digest = await digestOf(token);
    let record = await store.find(digest);
    if (record === null || record === undefined || record.kind !== "token") return undefined;
    const at = now();
    if (at >= record.endsAt) {
      await store.delete(digest);
      return undefined;
    }
    if (at - record.checkedAt >= recheckEvery) {
      const current = await options.recheck(record.user, record.grant);
      if (!current.active) {
        await store.delete(digest);
        return undefined;
      }
      record = { ...record, user: current.user, grant: current.grant, checkedAt: at };
      await store.update(record);
    }
    return record.user;
  };

  const pairing: Pairing<U> = {
    user,
    endAllOf: async (id) => {
      await store.deleteAllOf(id);
    },
  };

  routes.set(pairing, {
    async page(request, context) {
      const url = new URL(request.url);
      const origin = url.searchParams.get("origin") ?? "";
      const challenge = url.searchParams.get("challenge") ?? "";
      // Only to listed origins: otherwise any website could open this pop-up
      // and collect a code for an Editor who is signed in.
      if (!context.origins.has(origin)) return page(400, { text: PAIRING_TEXT.unknownOrigin });
      if (!CHALLENGE.test(challenge)) return page(400, { text: PAIRING_TEXT.badChallenge });
      const judged = judge(await context.authorize({ request, operation: "write" }));
      if (!judged.allow && judged.reason === "unauthenticated") {
        const address = options.signIn(`${url.pathname}${url.search}`);
        const target = address.startsWith("/") && !address.startsWith("//") ? new URL(address, context.ownOrigin).href : address;
        if (!isHttpUrl(target)) throw new Error(`pairing: the sign-in address ${JSON.stringify(address)} is not an http or https address or a path`);
        return new Response(null, { status: 303, headers: { location: target, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
      }
      if (!judged.allow) {
        const message = { type: PAIRING_MESSAGE_TYPE, refused: "forbidden", ...(context.forbiddenHelp === undefined ? {} : { help: context.forbiddenHelp }) };
        return page(403, { text: PAIRING_TEXT.forbidden, help: context.forbiddenHelp }, { message, origin });
      }
      const session = await options.session(request);
      if (session === null || session === undefined) return page(403, { text: PAIRING_TEXT.noSession });
      const code = randomText();
      const at = now();
      await store.save({
        digest: await digestOf(code),
        kind: "code",
        user: session.user,
        grant: session.grant,
        signedInAt: session.signedInAt,
        checkedAt: session.checkedAt ?? at,
        endsAt: at + PAIRING_CODE_LIFETIME_MS,
        challenge,
        origin,
      });
      return page(200, { text: PAIRING_TEXT.signedIn }, { message: { type: PAIRING_MESSAGE_TYPE, code }, origin });
    },

    async exchange(request, body) {
      const { code, proof } = body;
      if (typeof code !== "string" || typeof proof !== "string") return refused("code and proof required");
      const digest = await digestOf(code);
      const record = await store.find(digest);
      if (record === null || record === undefined || record.kind !== "code") return refused("the code is not valid");
      // Used once, whatever happens next: a wrong proof uses the code up.
      if (!(await store.delete(digest))) return refused("the code is not valid");
      const at = now();
      if (at >= record.endsAt || record.origin !== request.headers.get("origin") || (await challengeOf(proof)) !== record.challenge) return refused("the code is not valid");
      const endsAt = record.signedInAt + lifetime;
      if (at >= endsAt) return refused("the sign-in has ended");
      const token = `${EDITING_TOKEN_PREFIX}${randomText()}`;
      await store.save({ digest: await digestOf(token), kind: "token", user: record.user, grant: record.grant, signedInAt: record.signedInAt, checkedAt: record.checkedAt, endsAt });
      const name = typeof record.user.name === "string" && record.user.name !== "" ? { name: record.user.name } : {};
      return new Response(JSON.stringify({ token, ...name }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    },

    async end(request) {
      const token = request.headers.get(EDITING_TOKEN_HEADER);
      if (token !== null && TOKEN.test(token)) await store.delete(await digestOf(token));
      return new Response(null, { status: 204 });
    },
  });

  return pairing;
}

/** A pairing store in memory, for tests and demos. Records are lost on restart and are not shared between servers. */
export interface MemoryPairingStore<U extends Identity> extends PairingStore<U> {
  delete(digest: string): boolean;
  /** How many records it holds. */
  size(): number;
  /** Copies of every record. */
  records(): PairingRecord<U>[];
}

/** Creates a pairing store in memory. A website keeps its records in its database instead. */
export function createMemoryPairingStore<U extends Identity = Identity>(): MemoryPairingStore<U> {
  const records = new Map<string, PairingRecord<U>>();
  return {
    save: (record) => void records.set(record.digest, structuredClone(record)),
    find: (digest) => {
      const record = records.get(digest);
      return record === undefined ? undefined : structuredClone(record);
    },
    update: (record) => {
      if (records.has(record.digest)) records.set(record.digest, structuredClone(record));
    },
    delete: (digest) => records.delete(digest),
    deleteAllOf: (id) => {
      for (const [digest, record] of records) if (record.user.id === id) records.delete(digest);
    },
    size: () => records.size,
    records: () => [...records.values()].map((record) => structuredClone(record)),
  };
}
