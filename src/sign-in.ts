// How a refusal tells an editing tool to sign in. Shared by the website, which
// writes it, and the editing tools, which read it as untrusted input.

import { isHttpUrl } from "./usage.js";

/** The longest help text a website may declare and an editing tool will show. */
export const HELP_TEXT_MAX_LENGTH = 200;

/**
 * What a `401` says about signing in. Every member is optional: a website
 * that declares nothing sends an empty descriptor, and a tool then says only
 * that the website refused.
 */
export interface SignInDescriptor {
  /** The website accepts a session from its login for Editors. */
  session?: {
    /** Where an Editor signs in. An absolute `http` or `https` address. */
    signIn: string;
    /** Requests must include credentials, because the session cookie travels to another origin of the same site. */
    credentials?: boolean;
  };
  /** Where a workbench addon signs in by pairing. */
  pair?: { address: string };
  /** The website's own words for someone who is not signed in. Plain text, to be shown as text only. */
  help?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Whether a value is acceptable as a help text: a non-empty string of at most
 * 200 characters with no line break or other control character.
 */
export function isHelpText(value: unknown): value is string {
  if (typeof value !== "string" || value === "" || value.length > HELP_TEXT_MAX_LENGTH) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // C0 and C1 controls, which include every line break, and the two Unicode line and paragraph separators.
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) return false;
  }
  return true;
}

/** A help text received from a website, or `undefined` when it is not one. Never shortened. */
export function readHelpText(value: unknown): string | undefined {
  return isHelpText(value) ? value : undefined;
}

/**
 * The sign-in descriptor in a refusal body, validated and rebuilt, or
 * `undefined` when the body carries none. A member that is not valid is
 * dropped, never repaired: an address must be `http` or `https`, and a help
 * text must be within its limits.
 */
export function readSignInDescriptor(body: unknown): SignInDescriptor | undefined {
  if (!isRecord(body) || !isRecord(body.auth)) return undefined;
  const { session, pair, help } = body.auth;
  const descriptor: SignInDescriptor = {};
  if (isRecord(session) && typeof session.signIn === "string" && isHttpUrl(session.signIn)) {
    descriptor.session = typeof session.credentials === "boolean" ? { signIn: session.signIn, credentials: session.credentials } : { signIn: session.signIn };
  }
  if (isRecord(pair) && typeof pair.address === "string" && isHttpUrl(pair.address)) descriptor.pair = { address: pair.address };
  const text = readHelpText(help);
  if (text !== undefined) descriptor.help = text;
  return descriptor;
}
