import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, DEFAULT_TIME_LIMIT_MS } from "../src/client.js";
import { clientConfig, fakeRequest, jsonResponse } from "./support/fakes.js";

afterEach(() => vi.useRealTimers());

/** A request function that never answers and ignores the abort signal. */
const silent = () => fakeRequest(() => new Promise<Response>(() => undefined));

describe("client: time limit", () => {
  it("the default time limit is ten seconds", () => {
    expect(DEFAULT_TIME_LIMIT_MS).toBe(10_000);
  });

  it("T24: a save unanswered past the limit fails with the time-limit message", async () => {
    vi.useFakeTimers();
    const { request } = silent();
    const pending = createClient({ getConfig: () => clientConfig, request, timeoutMs: 1000 }).save("k", { da: { value: "a" } });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).results.da).toEqual({ ok: false, message: "no answer after 1000 ms", failure: "timeout" });
  });

  it("the promise does not settle before the limit", async () => {
    vi.useFakeTimers();
    const { request } = silent();
    let settled = false;
    void createClient({ getConfig: () => clientConfig, request, timeoutMs: 1000 }).save("k", { da: { value: "a" } }).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
  });

  it("a read unanswered past the limit is an error with the time-limit reason", async () => {
    vi.useFakeTimers();
    const { request } = silent();
    const pending = createClient({ getConfig: () => clientConfig, request, timeoutMs: 1000 }).readValues("k");
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).failure).toEqual({ class: "timeout", reason: "no answer after 1000 ms" });
  });

  it("a usage read unanswered past the limit is an error", async () => {
    vi.useFakeTimers();
    const { request } = silent();
    const pending = createClient({ getConfig: () => clientConfig, request, timeoutMs: 1000 }).readUsage("k");
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).error).toBe(true);
  });

  it("with no configured limit the default ten seconds applies", async () => {
    vi.useFakeTimers();
    const { request } = silent();
    const pending = createClient({ getConfig: () => clientConfig, request }).readValues("k");
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).failure?.reason).toBe("no answer after 10000 ms");
  });

  it("CLI-4: the limit covers reading the body, not only receiving headers", async () => {
    vi.useFakeTimers();
    const stalled = { ok: true, status: 200, text: () => new Promise<string>(() => undefined) } as unknown as Response;
    const { request } = fakeRequest(() => stalled);
    const pending = createClient({ getConfig: () => clientConfig, request, timeoutMs: 1000 }).readValues("k");
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).failure?.class).toBe("timeout");
  });

  it("the request is handed an abort signal that is aborted at the limit", async () => {
    vi.useFakeTimers();
    const { request, calls } = silent();
    const pending = createClient({ getConfig: () => clientConfig, request, timeoutMs: 1000 }).readValues("k");
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(calls[0]?.init.signal?.aborted).toBe(true);
  });

  it("a request that answers in time leaves no timer behind", async () => {
    vi.useFakeTimers();
    const { request } = fakeRequest(() => jsonResponse(200, { locales: {} }));
    await createClient({ getConfig: () => clientConfig, request, timeoutMs: 1000 }).readValues("k");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a request that fails in time leaves no timer behind", async () => {
    vi.useFakeTimers();
    const { request } = fakeRequest(() => Promise.reject(new TypeError("Failed to fetch")));
    await createClient({ getConfig: () => clientConfig, request, timeoutMs: 1000 }).readValues("k");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an answer that arrives just before the limit wins", async () => {
    vi.useFakeTimers();
    const { request } = fakeRequest(() => new Promise<Response>((resolve) => setTimeout(() => resolve(jsonResponse(200, { locales: {} })), 900)));
    const pending = createClient({ getConfig: () => clientConfig, request, timeoutMs: 1000 }).readValues("k");
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).error).toBe(false);
  });
});

describe("client: credentials mode", () => {
  it("T25: a credentials mode is carried by every request", async () => {
    const { request, calls } = fakeRequest(() => jsonResponse(200, { locales: {} }));
    const client = createClient({ getConfig: () => clientConfig, request, credentials: "include" });
    await client.readValues("k");
    await client.readUsage("k");
    await client.save("k", { da: { value: "a" } });
    expect(calls.map((c) => c.init.credentials)).toEqual(["include", "include", "include"]);
  });

  it("left unset, no credentials mode is sent and same-origin behaviour applies", async () => {
    const { request, calls } = fakeRequest(() => jsonResponse(200, { locales: {} }));
    await createClient({ getConfig: () => clientConfig, request }).readValues("k");
    expect("credentials" in calls[0]!.init).toBe(false);
  });
});
