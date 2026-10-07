// The server half of the wire contract: one function from a standard web
// request to a standard web response. Web-standard APIs only.

import { ConfigError, type FieldDef, type ResolvedConfig } from "./config.js";
import type { MaybePromise, StorageAdapter, UntypedStorageAdapter, UntypedWrite } from "./storage.js";
import { isHttpUrl } from "./usage.js";
import { conflictingColumns, isEmptyPatch, writePatch, type ExpectedValues, type KeyMeta, type UsageReport } from "./wire.js";

/** Whether a request reads or changes translations. */
export type Operation = "read" | "write";

/** What the authorization check receives. */
export interface AuthorizeContext {
  request: Request;
  /** `read` for a GET, `write` for a PUT or POST. */
  operation: Operation;
}

/** Answers whether a request may proceed. Anything other than `true` denies it. */
export type Authorize = (context: AuthorizeContext) => MaybePromise<boolean>;

/** The configuration shape a handler accepts. */
export type AnyConfig = ResolvedConfig<string, readonly FieldDef[]>;

/**
 * Cross-origin access. It is off unless configured; unconfigured, the handler
 * serves same-origin callers only and adds no cross-origin headers.
 */
export interface CorsPolicy {
  /**
   * An explicit list of origins, each exactly as a browser sends it
   * (`https://app.example.com`). There is no wildcard and no pattern matching:
   * a wildcard cannot be combined with credentials, and an explicit list is
   * what makes cross-origin access and credentials safe together.
   */
  origins: readonly string[];
  /** Whether cookies and authorization headers are allowed. Off unless set. */
  credentials?: boolean;
}

/** What {@link createHandler} is built from. */
export interface HandlerOptions<C extends AnyConfig> {
  config: C;
  adapter: NoInfer<StorageAdapter<C>> | UntypedStorageAdapter;
  authorize: Authorize;
  /** Key metadata, from somewhere other than the translation store. May be asynchronous and may have nothing for a key. */
  metadata?: (key: string) => MaybePromise<KeyMeta | undefined | null>;
  /** Receives the real cause of a 500 and the request. Defaults to the console. */
  onError?: (error: unknown, request: Request) => void;
  /** Cross-origin access, for a caller on another origin such as a workbench addon. */
  cors?: CorsPolicy;
}

/** One function from a web request to a web response. It never rejects. */
export type Handler = (request: Request) => Promise<Response>;

const VALUES_SUFFIX = "/keys/{key}";

function pathOf(url: string): string {
  const path = new URL(url).pathname;
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end--;
  return path.slice(0, end);
}

function mountPoint(config: AnyConfig): string {
  if (config.basePath !== undefined) return pathOf(config.basePath);
  const template = config.endpoints.values;
  if (!template.endsWith(VALUES_SUFFIX)) {
    throw new ConfigError(
      `endpoints.values is "${template}" and there is no basePath`,
      `the handler can only infer where it is mounted from a template ending in ${VALUES_SUFFIX}, and guessing would answer "not found" to every read and save`,
      `set basePath, or end the values template with ${VALUES_SUFFIX}`,
    );
  }
  return pathOf(template.slice(0, -VALUES_SUFFIX.length) || "/");
}

/** Stable machine-readable codes, so editing tools branch on the code and localise the reason. */
export type ErrorCode =
  | "malformed-path"
  | "invalid-json"
  | "invalid-request"
  | "nothing-to-update"
  | "unauthorized"
  | "not-found"
  | "method-not-allowed"
  | "conflict"
  | "internal-error";

function json(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function fail(status: number, error: string, code: ErrorCode, headers?: Record<string, string>): Response {
  return json(status, { error, code }, headers);
}

/** A Field as the handler validates against it: looked up by name, with its option set ready. */
interface CompiledField {
  type: FieldDef["type"];
  options?: ReadonlySet<string>;
  optionList?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setColumn(target: Record<string, string>, name: string, value: string): void {
  Object.defineProperty(target, name, { value, enumerable: true, writable: true, configurable: true });
}

interface Route {
  methods: string;
  serve: (request: Request) => Promise<Response>;
}

/**
 * Builds the request handler from the resolved configuration, a storage
 * adapter and an authorization check.
 *
 * The adapter and the authorization check are required and have no default:
 * an unauthenticated system must be a written-down decision, never an
 * inherited one.
 *
 * The handler never rejects. A request the caller got wrong is a 4xx; anything
 * thrown while serving is a 500 with a fixed generic body, because a thrown
 * message can contain a connection string. The real cause goes to `onError`.
 */
export function createHandler<C extends AnyConfig>(options: HandlerOptions<C>): Handler {
  const { config } = options;
  // Everything the handler passes on is validated and rebuilt, so the untyped view is true at runtime.
  const adapter = options.adapter as UntypedStorageAdapter;
  const mount = mountPoint(config);
  // Compiled once, so validating a write searches nothing.
  const schema = new Map<string, CompiledField>();
  for (const field of config.schema?.fields ?? []) {
    schema.set(field.name, field.type === "select" ? { type: field.type, options: new Set(field.options.map((o) => o.value)), optionList: field.options.map((o) => o.value).join(", ") } : { type: field.type });
  }
  const locales = new Set<string>(config.locales);
  const localeList = config.locales.join(", ");
  // The capabilities only the handler knows are added once, here, to what is served.
  const served = options.metadata === undefined ? config : { ...config, capabilities: [...config.capabilities, "meta" as const] };
  const cors = options.cors;
  if (cors?.origins.includes("*")) {
    throw new ConfigError("cors.origins contains a wildcard", "a wildcard origin cannot be combined with credentials, so cross-origin access is only allowed for an explicit list", "list each origin exactly as a browser sends it, for example https://app.example.com");
  }
  const corsOrigins = new Set(cors?.origins ?? []);
  const onError = options.onError ?? ((error: unknown) => console.error("[core] request failed", error));

  const report = (error: unknown, request: Request): void => {
    try {
      onError(error, request);
    } catch {
      // A hook that throws must not change the response.
    }
  };

  /** A key's rows and, when a hook supplies it, its metadata, fetched concurrently. */
  const readKey = async (key: string): Promise<Response> => {
    const [locales, meta] = await Promise.all([adapter.getValues(key), options.metadata?.(key)]);
    return json(200, meta === undefined || meta === null ? { locales } : { meta, locales });
  };

  const bad = (reason: string, code: ErrorCode = "invalid-request"): Response => fail(400, reason, code);

  /**
   * Validates a write body and rebuilds it from the validated properties, so
   * nothing else in the body travels with it. Storage is never handed an object
   * where a string belongs: an adapter that builds a query from the Locale
   * would otherwise execute whatever operator the caller put there.
   *
   * "Required" is deliberately not checked here. A write is a partial merge, and
   * one body cannot say whether the stored row is complete; the panel, which
   * holds the whole row, enforces it before saving.
   */
  const validateWrite = (body: Record<string, unknown>): { write: UntypedWrite; expected?: ExpectedValues } | Response => {
    const { locale, value, fields, expected } = body;
    if (locale === undefined || locale === "") return bad("locale required");
    if (typeof locale !== "string") return bad("locale must be a string");
    if (!locales.has(locale)) return bad(`unknown locale "${locale}" -- configured: [${localeList}]`);
    if (value !== undefined && typeof value !== "string") return bad("value must be a string");
    if (fields !== undefined && !isObject(fields)) return bad("fields must be an object");
    const write: UntypedWrite = { locale };
    if (value !== undefined) write.value = value as string;
    if (fields !== undefined) {
      const clean: Record<string, string> = {};
      for (const name of Object.keys(fields)) {
        const declared = schema.get(name);
        if (declared === undefined) return bad(`unknown field "${name}"`);
        if (declared.type === "readonly") return bad(`field "${name}" is readonly`);
        const column = fields[name];
        if (typeof column !== "string") return bad(`field "${name}" must be a string`);
        if (declared.options !== undefined && column !== "" && !declared.options.has(column)) return bad(`field "${name}" must be one of [${declared.optionList}]`);
        setColumn(clean, name, column);
      }
      if (Object.keys(clean).length > 0) write.fields = clean;
    }
    if (isEmptyPatch(writePatch(write))) return bad("nothing to update", "nothing-to-update");
    if (expected === undefined) return { write };

    // Expected values are validated as strictly as the write, with one
    // deliberate difference: a Select is not held to its options, because a
    // stored row may carry a value the Schema has stopped listing and a client
    // that loaded it must be able to say so.
    if (!isObject(expected)) return bad("expected must be an object");
    const checked: ExpectedValues = {};
    if (expected.value !== undefined) {
      if (typeof expected.value !== "string") return bad("expected.value must be a string");
      checked.value = expected.value;
    }
    if (expected.fields !== undefined) {
      if (!isObject(expected.fields)) return bad("expected.fields must be an object");
      const columns: Record<string, string> = {};
      for (const name of Object.keys(expected.fields)) {
        const declared = schema.get(name);
        if (declared === undefined) return bad(`expected: unknown field "${name}"`);
        if (declared.type === "readonly") return bad(`expected: field "${name}" is readonly`);
        const column = expected.fields[name];
        if (typeof column !== "string") return bad(`expected: field "${name}" must be a string`);
        setColumn(columns, name, column);
      }
      checked.fields = columns;
    }
    return { write, expected: checked };
  };

  const writeKey = async (request: Request, key: string): Promise<Response> => {
    const body = await readJsonObject(request);
    if (body instanceof Response) return body;
    const validated = validateWrite(body);
    if (validated instanceof Response) return validated;
    const { write, expected } = validated;
    if (expected !== undefined) {
      // The storage adapter is not involved in conflict detection; a Developer
      // gets it for free. With no stored row there is nothing to overwrite.
      const rows = (await adapter.getValues(key)) as Record<string, Record<string, unknown>>;
      const current = Object.hasOwn(rows, write.locale) ? rows[write.locale] : undefined;
      if (current !== undefined && conflictingColumns(current, expected, write).length > 0) return json(409, { error: "conflict", code: "conflict", current });
    }
    await adapter.saveValue(key, write);
    return json(200, { ok: true });
  };

  const readJsonObject = async (request: Request): Promise<Record<string, unknown> | Response> => {
    let body: unknown;
    try {
      body = JSON.parse(await request.text());
    } catch {
      return bad("body must be JSON", "invalid-json");
    }
    return isObject(body) ? body : bad("body must be a JSON object");
  };

  /** Validates a page's sightings and rebuilds the report from the validated properties. */
  const acceptReport = async (request: Request): Promise<Response> => {
    const body = await readJsonObject(request);
    if (body instanceof Response) return body;
    const { url, title, keys } = body;
    if (url === undefined || !Array.isArray(keys)) return bad("url and keys required");
    // A stored URL is served back and navigated to from another Editor's panel:
    // any scheme but http(s) could execute in their page.
    if (typeof url !== "string" || !isHttpUrl(url)) return bad("url must be an http(s) URL");
    if (title !== undefined && typeof title !== "string") return bad("title must be a string");
    const entries: UsageReport["keys"] = [];
    for (let i = 0; i < keys.length; i++) {
      const entry: unknown = keys[i];
      const valid = isObject(entry) && typeof entry.key === "string" && entry.key !== "" && typeof entry.count === "number" && Number.isInteger(entry.count) && entry.count > 0;
      if (!valid) return bad(`keys[${i}] must be { key: string, count: positive integer }`);
      entries.push({ key: entry.key as string, count: entry.count as number });
    }
    await adapter.reportUsage(title === undefined ? { url, keys: entries } : { url, title, keys: entries });
    return json(200, { ok: true, count: entries.length });
  };

  /** Steps 1 to 3 of the evaluation order: locate, decode, match. */
  const match = (request: Request): Route | Response => {
    const path = pathOf(request.url);
    if (path !== mount && !path.startsWith(`${mount}/`)) return fail(404, "not found", "not-found");
    let segments: string[];
    try {
      segments = path.slice(mount.length).split("/").slice(1).map(decodeURIComponent);
    } catch {
      return fail(400, "malformed percent-encoding in the path", "malformed-path");
    }
    const [first, second] = segments;
    if (segments.length === 1 && first === "config") return { methods: "GET", serve: async () => json(200, served) };
    if (segments.length === 2 && first === "keys" && second !== "") {
      const key = second as string;
      return { methods: "GET, PUT", serve: (request) => (request.method === "PUT" ? writeKey(request, key) : readKey(key)) };
    }
    if (segments.length === 1 && first === "usage" && config.endpoints.usageReport !== undefined) return { methods: "POST", serve: acceptReport };
    if (segments.length === 2 && first === "usage" && second !== "" && config.endpoints.usageRead !== undefined) {
      const key = second as string;
      return { methods: "GET", serve: async () => json(200, await adapter.getUsage(key)) };
    }
    return fail(404, "not found", "not-found");
  };

  const route = async (request: Request): Promise<Response> => {
    const matched = match(request);
    if (matched instanceof Response) return matched;
    // A preflight carries no credentials by design, so authorization is not consulted.
    if (request.method === "OPTIONS" && cors !== undefined && corsOrigins.has(request.headers.get("origin") ?? "")) {
      const asked = request.headers.get("access-control-request-headers");
      return new Response(null, { status: 204, headers: { "access-control-allow-methods": matched.methods, ...(asked === null ? {} : { "access-control-allow-headers": asked }) } });
    }
    if (!matched.methods.split(", ").includes(request.method)) return fail(405, "method not allowed", "method-not-allowed", { allow: matched.methods });
    const operation: Operation = request.method === "GET" ? "read" : "write";
    if ((await options.authorize({ request, operation })) !== true) return fail(401, "unauthorized", "unauthorized");
    return matched.serve(request);
  };

  /**
   * Every response names a listed origin, including 4xx and 500: otherwise the
   * browser withholds the body and the panel cannot show why a save was
   * refused. Every response also varies by origin, so no cache serves one
   * caller's answer to another.
   */
  const withCors = (request: Request, response: Response): Response => {
    if (cors === undefined) return response;
    try {
      response.headers.append("vary", "Origin");
      const origin = request.headers.get("origin");
      if (origin !== null && corsOrigins.has(origin)) {
        response.headers.set("access-control-allow-origin", origin);
        if (cors.credentials === true) response.headers.set("access-control-allow-credentials", "true");
      }
    } catch {
      // Headers that cannot be set must not turn an answer into a rejection.
    }
    return response;
  };

  return async (request) => {
    try {
      return withCors(request, await route(request));
    } catch (error) {
      report(error, request);
      return withCors(request, fail(500, "internal error", "internal-error"));
    }
  };
}
