import { resolveConfig } from "../../src/config.js";
import { createHandler, type HandlerOptions } from "../../src/handler.js";
import { createMemoryAdapter, type StorageAdapter } from "../../src/storage.js";

export const ORIGIN = "https://app.test";
export const MOUNT = "/api/tms";
export const BASE_PATH = `${ORIGIN}${MOUNT}`;

export const config = resolveConfig({
  locales: ["en", "da", "es", "fr"],
  basePath: BASE_PATH,
  schema: {
    fields: [
      { type: "select", name: "status", required: true, options: [{ label: "Draft", value: "draft" }, { label: "Approved", value: "approved" }] },
      { type: "text", name: "note" },
      { type: "readonly", name: "updatedBy" },
    ],
  },
});
export type TestConfig = typeof config;

/** Arbitrary parsed JSON, so a test can read nested members without casting. */
type Json = ReturnType<typeof JSON.parse>;

export interface Reply {
  status: number;
  headers: Headers;
  /** Parsed JSON body, or the raw text when it was not JSON. */
  body: Json;
  response: Response;
}

export function setup(overrides: Partial<HandlerOptions<TestConfig>> = {}, adapter: StorageAdapter<TestConfig> = createMemoryAdapter<TestConfig>({ clock: () => 0 })) {
  const handler = createHandler<TestConfig>({ config, adapter, authorize: () => true, onError: () => undefined, ...overrides });
  const call = async (method: string, path: string, init: { body?: unknown; headers?: Record<string, string>; rawBody?: string; origin?: string } = {}): Promise<Reply> => {
    const headers = new Headers(init.headers);
    if (init.origin !== undefined) headers.set("origin", init.origin);
    const hasBody = init.body !== undefined || init.rawBody !== undefined;
    if (hasBody && !headers.has("content-type")) headers.set("content-type", "application/json");
    const request = new Request(path.startsWith("http") ? path : `${ORIGIN}${path}`, {
      method,
      headers,
      ...(hasBody ? { body: init.rawBody ?? JSON.stringify(init.body) } : {}),
    });
    const response = await handler(request);
    const text = await response.clone().text();
    let body: unknown = text;
    try {
      body = text === "" ? undefined : JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: response.status, headers: response.headers, body, response };
  };
  return { handler, adapter, call };
}
