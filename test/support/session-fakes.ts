import { vi } from "vitest";
import type { Client, ReadUsageResult, ReadValuesResult } from "../../src/client.js";
import type { SessionSink } from "../../src/session.js";
import type { SaveResult } from "../../src/wire.js";

export const ok = (values: ReadValuesResult["values"] = { locales: {} }): ReadValuesResult => ({ values, error: false });

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

/** Records every call in one ordered log so tests can assert sequence. */
export function fakes(options: { values?: Promise<ReadValuesResult>; usage?: Promise<ReadUsageResult>; save?: Promise<SaveResult> } = {}) {
  const log: string[] = [];
  const sink = {
    open: vi.fn<SessionSink["open"]>((key) => void log.push(`sink.open:${key}`)),
    setValues: vi.fn<SessionSink["setValues"]>((key) => void log.push(`sink.setValues:${key}`)),
    setUsage: vi.fn<SessionSink["setUsage"]>((key) => void log.push(`sink.setUsage:${key}`)),
    setHidden: vi.fn<SessionSink["setHidden"]>(() => void log.push("sink.setHidden")),
  } satisfies SessionSink;
  const client = {
    readValues: vi.fn((key: string) => (log.push(`client.readValues:${key}`), options.values ?? Promise.resolve(ok()))),
    readUsage: vi.fn((key: string) => (log.push(`client.readUsage:${key}`), options.usage ?? Promise.resolve({ usages: [], error: false, configured: true }))),
    save: vi.fn((key: string) => (log.push(`client.save:${key}`), options.save ?? Promise.resolve({ ok: true, results: {} }))),
  } satisfies Pick<Client, "readValues" | "readUsage" | "save">;
  return { sink, client, log };
}
