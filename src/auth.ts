// Who may read and save, as the request handler asks it: the authorization
// check's answer, the checks the Core ships, and the gate that marks pages only
// for Editors. The Core owns no session; it reads what the website's
// authentication library says.

import { ConfigError } from "./config.js";
import { isHelpText } from "./sign-in.js";
import type { MaybePromise } from "./storage.js";
import { TOGGLE_COOKIE_NAME, TOGGLE_ON_VALUE } from "./toggle.js";

/** Whether a request reads or changes translations. */
export type Operation = "read" | "write";

/** What the authorization check receives. */
export interface AuthorizeContext {
  request: Request;
  /** `read` for a GET, `write` for a PUT or POST. */
  operation: Operation;
}

/** Who the website says the caller is. */
export interface Identity {
  /** Stable: the same person always has the same identifier. */
  id: string;
  /** For showing who is editing. */
  name?: string;
}

/**
 * What an authorization check answers:
 *
 * - `true`, or `{ identity }`: allow. The identity is passed to storage, so a
 *   change can be stored with who made it.
 * - `"forbidden"`: signed in, but not permitted. The answer is `403`.
 * - anything else, including `false` and nothing: not authenticated. The
 *   answer is `401`. A check that forgets to answer fails closed.
 */
export type AuthAnswer = boolean | "forbidden" | { identity: Identity } | null | undefined;

/** A website's own words for a refused caller. Plain text, at most 200 characters, no line breaks. */
export interface HelpTexts {
  /** Shown to someone who is not signed in, for example "Sign in with your company account". */
  unauthenticated?: string;
  /** Shown to someone signed in without permission, for example "Ask IT for the Editor role". */
  forbidden?: string;
}

/** What a check tells a refused caller about signing in. Fixed when the check is built. */
export interface AuthDeclaration {
  /** Requests must include credentials, because the session cookie travels to another origin of the same site. */
  credentials?: boolean;
  help?: HelpTexts;
}

/**
 * Decides whether a request may proceed. It is evaluated on every request
 * except a preflight, and must not read the request body.
 *
 * A hand-written function is a check. The checks the Core builds also carry
 * what they declare about signing in, which a refusal passes on.
 */
export interface Authorize {
  (context: AuthorizeContext): MaybePromise<AuthAnswer>;
  /** What a refused caller is told about signing in. */
  readonly declares?: AuthDeclaration;
}

/** An answer, judged. */
export type Judgement = { allow: true; identity?: Identity } | { allow: false; reason: "unauthenticated" | "forbidden" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The identifier and name of a value shaped like an identity, and nothing else of it. */
function identityOf(value: unknown): Identity | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || value.id === "") return undefined;
  return typeof value.name === "string" && value.name !== "" ? { id: value.id, name: value.name } : { id: value.id };
}

/** Judges a check's answer. Anything that is not an allow or a forbid is not authenticated. */
export function judge(answer: unknown): Judgement {
  if (answer === true) return { allow: true };
  if (answer === "forbidden") return { allow: false, reason: "forbidden" };
  if (isRecord(answer)) {
    const identity = identityOf(answer.identity);
    if (identity !== undefined) return { allow: true, identity };
  }
  return { allow: false, reason: "unauthenticated" };
}

function checkHelp(help: HelpTexts | undefined): void {
  for (const name of ["unauthenticated", "forbidden"] as const) {
    const text: unknown = help?.[name];
    if (text === undefined || isHelpText(text)) continue;
    throw new ConfigError(
      `help.${name} is ${JSON.stringify(text)}`,
      "editing tools show it as one short line of plain text, and drop one that is not",
      "give a non-empty text of at most 200 characters with no line breaks",
    );
  }
}

/** What {@link sessionCheck} is built from. */
export interface SessionCheckOptions<U extends Identity> {
  /**
   * Who the request is from: the session lookup of the login for Editors, or
   * nothing when nobody is signed in there. Read only the Editors' session,
   * never a customer login's.
   */
  user: (request: Request) => MaybePromise<U | null | undefined>;
  /** Whether that user may do this, for example whether they hold the Editor role. */
  may: (user: U, context: AuthorizeContext) => MaybePromise<boolean>;
  /** Set when the session cookie must travel to another origin of the same site. */
  credentials?: boolean;
  /** The website's own words for a refused caller. */
  help?: HelpTexts;
}

/**
 * A check that authenticates with the website's login for Editors. Nobody
 * signed in is not authenticated (`401`); a user who may not is forbidden
 * (`403`); a user who may is allowed, with their identifier and name as the
 * identity.
 *
 * The help texts are validated here, when the server starts, and throw a
 * `ConfigError` when they cannot work.
 */
export function sessionCheck<U extends Identity>(options: SessionCheckOptions<U>): Authorize {
  checkHelp(options.help);
  const declares: AuthDeclaration = {
    ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
    ...(options.help === undefined ? {} : { help: { ...options.help } }),
  };
  const check = async (context: AuthorizeContext): Promise<AuthAnswer> => {
    const user = await options.user(context.request);
    const identity = identityOf(user);
    if (user === null || user === undefined || identity === undefined) return false;
    return (await options.may(user, context)) === true ? { identity } : "forbidden";
  };
  return Object.assign(check, { declares });
}

/**
 * Checks composed as any-of: the first that allows wins, and later ones are
 * not asked. If none allows, the answer is forbidden when any said so, and
 * otherwise not authenticated. A refusal declares the union of what the checks
 * declare, the first declaration of each member winning.
 */
export function anyOf(...checks: Authorize[]): Authorize {
  const declares: AuthDeclaration = {};
  for (const { declares: declared } of checks) {
    if (declared === undefined) continue;
    if (declares.credentials === undefined && declared.credentials !== undefined) declares.credentials = declared.credentials;
    for (const name of ["unauthenticated", "forbidden"] as const) {
      const text = declared.help?.[name];
      if (text !== undefined && declares.help?.[name] === undefined) declares.help = { ...declares.help, [name]: text };
    }
  }
  const check = async (context: AuthorizeContext): Promise<AuthAnswer> => {
    let forbidden = false;
    for (const candidate of checks) {
      const answer = await candidate(context);
      const judged = judge(answer);
      if (judged.allow) return judged.identity === undefined ? true : { identity: judged.identity };
      if (judged.reason === "forbidden") forbidden = true;
    }
    return forbidden ? "forbidden" : false;
  };
  return Object.assign(check, { declares });
}

/**
 * A check that allows every request while `condition` is true, for local
 * development only, and allows nothing while it is false. It warns once, when
 * it is built, if it allows.
 */
export function allowAll(condition: boolean): Authorize {
  if (condition) console.warn("[intl-tms] allowAll(true): every request may read and save translations. Use this for local development only.");
  return () => condition;
}

/** The value of one cookie in a `Cookie` header, or `undefined`. */
function cookieValue(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  for (const pair of header.split(";")) {
    const at = pair.indexOf("=");
    if (at !== -1 && pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
  }
  return undefined;
}

/**
 * Whether a page request is an editing session, so its Catalog is marked.
 *
 * Without a check, the Toggle alone decides; the Toggle is a user-interface
 * switch that anyone can set and protects nothing. With a check, the page is
 * marked only when the Toggle is set and the check allows reading, so a
 * visitor who sets the Toggle, or a customer signed in to another login, gets
 * unmarked pages. A check that throws marks nothing.
 */
export async function isEditingRequest(request: Request, check?: Authorize): Promise<boolean> {
  if (cookieValue(request.headers.get("cookie"), TOGGLE_COOKIE_NAME) !== TOGGLE_ON_VALUE) return false;
  if (check === undefined) return true;
  try {
    return judge(await check({ request, operation: "read" })).allow;
  } catch {
    return false;
  }
}
