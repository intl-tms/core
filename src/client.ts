// The client half of the wire contract, as editing tools use it. No operation
// throws: every failure is a returned value.

import { resolveEndpoint } from "./endpoints.js";
import { readHelpText, readSignInDescriptor, type SignInDescriptor } from "./sign-in.js";
import { usageSignature } from "./usage.js";
import type { ExpectedValues, FailureClass, LocaleSaveResult, SaveResult, Usage, UsageReport, ValuesEnvelope, WireRow } from "./wire.js";

/** A request function with the shape of `fetch`. Injectable, so tests need no network. */
export type RequestFn = (url: string, init?: RequestInit) => Promise<Response>;

/** The parts of the served configuration the client reads. */
export interface ClientConfig {
  endpoints: { values: string; usageReport?: string | undefined; usageRead?: string | undefined };
  sourceLocale?: string | undefined;
}

/** What {@link createClient} is built from. */
export interface ClientOptions {
  /** Read freshly on every call: the configuration arrives after the client is built. */
  getConfig: () => ClientConfig | undefined;
  /** Defaults to the platform's `fetch`, looked up at each call. */
  request?: RequestFn;
  /**
   * How long to wait for an answer, in milliseconds, before the request is
   * aborted and fails like any other. Defaults to ten seconds. It covers
   * reading the body as well as receiving headers: a website that accepts a
   * connection and then says nothing must not leave a promise that never
   * settles.
   */
  timeoutMs?: number;
  /** `include` sends cookies cross-origin, which the website must allow in its cross-origin policy. Unset means same-origin behaviour. */
  credentials?: RequestCredentials;
  /** The clock used for the usage-report cool-down. Defaults to `Date.now`. */
  now?: () => number;
  /** Injectable timers, so a test never sleeps. Defaults to the platform's, looked up at each use. */
  timers?: { setTimeout(callback: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
}

/** How long a failed usage report is held back before the same report is tried again, in milliseconds. */
export const USAGE_COOLDOWN_MS = 30_000;

/** What happened to a usage report. */
export type UsageOutcome = "sent" | "skipped" | "failed" | "unconfigured";

/** The default request time limit, in milliseconds. */
export const DEFAULT_TIME_LIMIT_MS = 10_000;

/** Why a request failed. */
export interface Failure {
  class: FailureClass;
  /** For display. Tools branch on `class`. */
  reason?: string;
  status?: number;
  /** How to sign in, on a `401` whose body carries a valid sign-in descriptor. */
  auth?: SignInDescriptor;
  /** The website's help text, on a `403` that carries a valid one. */
  help?: string;
}

/** The answer to {@link Client.readValues}. */
export interface ReadValuesResult {
  values: ValuesEnvelope;
  error: boolean;
  failure?: Failure;
}

/** The answer to {@link Client.readUsage}. */
export interface ReadUsageResult {
  usages: Usage[];
  error: boolean;
  /** False when no usage-read endpoint exists: the feature is off, which is not an error. */
  configured: boolean;
  failure?: Failure;
}

/** One Locale's write, with what the sender loaded for the columns it names. */
export interface LocaleWrite {
  value?: string;
  fields?: Record<string, string>;
  expected?: ExpectedValues;
}

/** The client. */
export interface Client {
  /**
   * Reads a key's envelope. `fallback` is the on-page value for the Current
   * Locale: the rendered page is the freshest source for that Locale, so when
   * the store has no row for it the fallback seeds one. A stored row always
   * wins.
   */
  readValues(key: string, fallback?: { locale: string; value: string }): Promise<ReadValuesResult>;
  /** Reads where a key is used. With no usage-read endpoint no request is made. */
  readUsage(key: string): Promise<ReadUsageResult>;
  /**
   * Sends one write per Locale and reports each. The overall result is ok only
   * when every Locale succeeded, and one Locale's failure never stops the
   * others.
   */
  save(key: string, writes: Record<string, LocaleWrite>): Promise<SaveResult>;
  /**
   * Reports one page's sightings in a single batched request. Designed to be
   * called after every scan, and it never throws: a failed report must never
   * block highlighting.
   *
   * It is skipped when there is nothing to report, or when an identical report
   * was already accepted, is still in flight, or failed recently (a restless
   * page scans twice a second, and a website that is down must not be asked
   * that often). A report is remembered as accepted only once the server
   * accepted it, so one that failed is retried.
   */
  reportUsage(report: UsageReport): Promise<UsageOutcome>;
  /** Forgets every remembered report, so a new page reports fresh. */
  resetUsage(): void;
}

const MAX_REASON_LENGTH = 300;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function classifyStatus(status: number): FailureClass {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 409) return "conflict";
  if (status === 404) return "not-found";
  if (status === 400 || status === 413 || status === 415 || status === 422) return "invalid";
  if (status >= 500) return "server";
  return "unknown";
}

/**
 * The reason a body states: its `error` string, else its `message` string,
 * else the raw body (an HTML error page, plain text). Empty bodies and empty
 * JSON containers are not a reason. Length-capped, because it goes in a log
 * pane, not a crash dump.
 */
function reasonFrom(body: string): string | undefined {
  const text = body.trim();
  if (text === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text.slice(0, MAX_REASON_LENGTH);
  }
  if (isRecord(parsed)) {
    if (typeof parsed.error === "string" && parsed.error !== "") return parsed.error.slice(0, MAX_REASON_LENGTH);
    if (typeof parsed.message === "string" && parsed.message !== "") return parsed.message.slice(0, MAX_REASON_LENGTH);
    return Object.keys(parsed).length === 0 ? undefined : text.slice(0, MAX_REASON_LENGTH);
  }
  if (Array.isArray(parsed)) return parsed.length === 0 ? undefined : text.slice(0, MAX_REASON_LENGTH);
  return parsed === null ? undefined : text.slice(0, MAX_REASON_LENGTH);
}

/**
 * What a refusal says beyond its reason: the sign-in descriptor of a `401`,
 * the help text of a `403`. Both are untrusted and validated; whatever is not
 * valid is left out.
 */
function refusalDetails(status: number, body: string): Pick<Failure, "auth" | "help"> {
  if (status !== 401 && status !== 403) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {};
  }
  if (status === 401) {
    const auth = readSignInDescriptor(parsed);
    return auth === undefined ? {} : { auth };
  }
  const help = isRecord(parsed) ? readHelpText(parsed.help) : undefined;
  return help === undefined ? {} : { help };
}

/** The result of one round trip. */
type Sent = { ok: true; status: number; body: string } | { ok: false; status?: number; body: string; failure: Failure };

/** Creates a client. */
export function createClient(options: ClientOptions): Client {
  const request: RequestFn = options.request ?? ((url, init) => globalThis.fetch(url, init));

  const timers = options.timers ?? {
    setTimeout: (callback: () => void, ms: number): unknown => globalThis.setTimeout(callback, ms),
    clearTimeout: (id: unknown): void => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  };

  /** One round trip, headers and body, under the time limit. It never rejects. */
  const send = async (url: string, init: RequestInit): Promise<Sent> => {
    const limit = options.timeoutMs ?? DEFAULT_TIME_LIMIT_MS;
    const controller = new AbortController();
    let timer: unknown;
    const expired = new Promise<"expired">((resolve) => {
      timer = timers.setTimeout(() => {
        controller.abort();
        resolve("expired");
      }, limit);
    });
    const trip = async (): Promise<Sent> => {
      let response: Response;
      try {
        const credentials = options.credentials === undefined ? {} : { credentials: options.credentials };
        response = await request(url, { ...init, ...credentials, signal: controller.signal });
      } catch (error) {
        const offline = (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine === false;
        return { ok: false, body: "", failure: { class: offline ? "offline" : "network", reason: String(error).slice(0, MAX_REASON_LENGTH) } };
      }
      let body = "";
      try {
        body = await response.text();
      } catch {
        // Diagnosis must never fail the result: the status alone is still reported.
      }
      if (response.ok) return { ok: true, status: response.status, body };
      const reason = reasonFrom(body);
      const failure: Failure = { class: classifyStatus(response.status), status: response.status, ...(reason === undefined ? {} : { reason }) };
      Object.assign(failure, refusalDetails(response.status, body));
      return { ok: false, status: response.status, body, failure };
    };
    try {
      const outcome = await Promise.race([trip(), expired]);
      if (outcome === "expired") return { ok: false, body: "", failure: { class: "timeout", reason: `no answer after ${limit} ms` } };
      return outcome;
    } finally {
      timers.clearTimeout(timer);
    }
  };

  const readValues: Client["readValues"] = async (key, fallback) => {
    const empty = (failure: Failure): ReadValuesResult => ({ values: { locales: {} }, error: true, failure });
    const config = options.getConfig();
    if (config === undefined) return empty({ class: "config-not-loaded", reason: "config-not-loaded" });
    const sent = await send(resolveEndpoint(config.endpoints.values, key), { method: "GET" });
    if (!sent.ok) return empty(sent.failure);
    let parsed: unknown;
    try {
      parsed = JSON.parse(sent.body);
    } catch {
      return empty({ class: "unknown", status: sent.status, reason: "the response was not JSON" });
    }
    if (!isRecord(parsed) || !isRecord(parsed.locales)) return empty({ class: "unknown", status: sent.status, reason: "the response was not a values envelope" });

    const envelope = parsed as unknown as ValuesEnvelope;
    const locales: Record<string, WireRow> = { ...envelope.locales };
    const sourceMessage = envelope.meta?.sourceMessage;
    // A rich message reaches the page as only its first text node with the tags
    // gone. Seeding that into the Source Locale's row would be treated as a
    // loaded row, so the panel would never seed the real source message and
    // would take its tag reference from text with no tags.
    const pageIsTruncatedSource = fallback !== undefined && fallback.locale === config.sourceLocale && typeof sourceMessage === "string" && sourceMessage !== "";
    if (fallback !== undefined && !(fallback.locale in locales) && !pageIsTruncatedSource) locales[fallback.locale] = { value: fallback.value };
    return { values: { ...(envelope.meta === undefined ? {} : { meta: envelope.meta }), locales }, error: false };
  };

  const readUsage: Client["readUsage"] = async (key) => {
    const config = options.getConfig();
    const template = config?.endpoints.usageRead;
    if (template === undefined) return { usages: [], error: false, configured: false };
    const sent = await send(resolveEndpoint(template, key), { method: "GET" });
    if (!sent.ok) return { usages: [], error: true, configured: true, failure: sent.failure };
    try {
      const parsed: unknown = JSON.parse(sent.body);
      if (Array.isArray(parsed)) return { usages: parsed as Usage[], error: false, configured: true };
    } catch {
      // fall through to the shape failure
    }
    return { usages: [], error: true, configured: true, failure: { class: "unknown", status: sent.status, reason: "the response was not a list of usages" } };
  };

  const saveLocale = async (url: string, locale: string, write: LocaleWrite): Promise<LocaleSaveResult> => {
    const payload: Record<string, unknown> = { locale };
    if (write.value !== undefined) payload.value = write.value;
    if (write.fields !== undefined) payload.fields = write.fields;
    if (write.expected !== undefined) payload.expected = write.expected;
    const sent = await send(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (sent.ok) return { ok: true, status: sent.status };
    const result: LocaleSaveResult = { ok: false, failure: sent.failure.class };
    if (sent.status !== undefined) result.status = sent.status;
    if (sent.failure.reason !== undefined) result.message = sent.failure.reason;
    if (sent.failure.auth !== undefined) result.auth = sent.failure.auth;
    if (sent.failure.help !== undefined) result.help = sent.failure.help;
    if (sent.status === 409) {
      // A conflict's stored row is accepted only when it has the shape of a row.
      try {
        const current = (JSON.parse(sent.body) as { current?: unknown }).current;
        if (isRecord(current) && typeof current.value === "string") result.current = current as WireRow;
      } catch {
        // no row
      }
    }
    return result;
  };

  const save: Client["save"] = async (key, writes) => {
    const config = options.getConfig();
    if (config === undefined) return { ok: false, error: "config-not-loaded", results: {} };
    const url = resolveEndpoint(config.endpoints.values, key);
    const results: Record<string, LocaleSaveResult> = {};
    for (const locale of Object.keys(writes)) results[locale] = await saveLocale(url, locale, writes[locale]!);
    return { ok: Object.values(results).every((r) => r.ok), results };
  };

  const now = options.now ?? Date.now;
  let epoch = 0;
  let accepted: string | undefined;
  let inFlight: string | undefined;
  let failed: { signature: string; at: number } | undefined;

  const reportUsage: Client["reportUsage"] = async (report) => {
    const url = options.getConfig()?.endpoints.usageReport;
    if (url === undefined) return "unconfigured";
    if (report.keys.length === 0) return "skipped";
    const signature = usageSignature(report.url, report.keys);
    if (signature === accepted || signature === inFlight) return "skipped";
    if (failed !== undefined && failed.signature === signature && now() - failed.at < USAGE_COOLDOWN_MS) return "skipped";
    const mine = epoch;
    inFlight = signature;
    const sent = await send(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report) });
    if (mine !== epoch) return sent.ok ? "sent" : "failed";
    inFlight = undefined;
    if (sent.ok) {
      accepted = signature;
      failed = undefined;
      return "sent";
    }
    failed = { signature, at: now() };
    return "failed";
  };

  const resetUsage = (): void => {
    epoch++;
    accepted = undefined;
    inFlight = undefined;
    failed = undefined;
  };

  return { readValues, readUsage, save, reportUsage, resetUsage };
}
