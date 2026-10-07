import type { RequestFn } from "../../src/client.js";

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

type Responder = (url: string, init: RequestInit) => Response | Promise<Response>;

/** A request function that records every call and answers with `respond`. */
export function fakeRequest(respond: Responder) {
  const calls: RecordedCall[] = [];
  const request: RequestFn = async (url, init = {}) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { request, calls };
}

export const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const textResponse = (status: number, body: string): Response => new Response(body, { status });

export const BASE = "https://app.test/api/tms";

export const clientConfig = {
  endpoints: { values: `${BASE}/keys/{key}`, usageReport: `${BASE}/usage`, usageRead: `${BASE}/usage/{key}` },
  sourceLocale: "en",
} as const;
