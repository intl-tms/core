import { describe, expect, it, vi } from "vitest";
import { buildChanges } from "../src/panel-logic.js";
import type { PanelStoreOptions } from "../src/panel-store.js";
import { deferred } from "./support/session-fakes.js";
import { configured, schema, values } from "./support/panel.js";

type Persist = NonNullable<PanelStoreOptions["persist"]>;
const succeeds: Persist = async (changes) => ({ ok: true, results: Object.fromEntries(Object.keys(changes).map((locale) => [locale, { ok: true, status: 200 }])) });

/** An open store with a stored `da` row, `es` row and a persist function. */
function open(persist: Persist = succeeds, config: Parameters<typeof configured>[1] = {}) {
  const spy = vi.fn(persist);
  const store = configured({ persist: spy }, config);
  store.open("k", "da", "Hej");
  store.setValues("k", values({ da: { value: "Hej", status: "draft", updatedBy: "alice" }, es: { value: "Hola", status: "draft" } }), false);
  return { store, persist: spy };
}
const lastChanges = (persist: ReturnType<typeof vi.fn>) => persist.mock.calls.at(-1)?.[0];

describe("save: guards", () => {
  it("V1: with no selection save does not call persist", async () => {
    const persist = vi.fn(succeeds);
    await configured({ persist }).save();
    expect(persist).not.toHaveBeenCalled();
  });

  it("with no persist function save does nothing and does not throw", async () => {
    const store = configured();
    store.open("k", "da", "Hej");
    store.editValue("da", "changed");
    await expect(store.save()).resolves.toBeUndefined();
  });

  it("V2: with nothing changed the status says no changes", async () => {
    const { store, persist } = open();
    await store.save();
    expect([store.getState().status, persist.mock.calls.length]).toEqual([{ text: "No changes", kind: "neutral" }, 0]);
  });

  it("V3: required errors refuse the save and say so", async () => {
    const { store, persist } = open();
    store.editField("da", "status", "");
    await store.save();
    expect([persist.mock.calls.length, store.getState().status]).toEqual([0, { text: "Fill required fields", kind: "error" }]);
  });

  it("V4: tag errors refuse the save and say so", async () => {
    const { store, persist } = open(succeeds, { sourceLocale: "en" });
    store.setValues("k", values({ en: { value: "<a>x</a>", status: "draft" } }), false);
    store.editValue("da", "uden tag");
    await store.save();
    expect([persist.mock.calls.length, store.getState().status]).toEqual([0, { text: "Tags must match the source", kind: "error" }]);
  });

  it("N19: after a source seed with nothing touched, save does not call persist", async () => {
    const persist = vi.fn(succeeds);
    const store = configured({ persist }, { sourceLocale: "en" });
    store.open("k", "da", "Hej");
    store.setValues("k", values({}, { sourceMessage: "Source" }), false);
    await store.save();
    expect(persist).not.toHaveBeenCalled();
  });
});

describe("save: the diff", () => {
  it("V5: a changed value sends that Locale only", async () => {
    const { store, persist } = open();
    store.editValue("da", "Hej!");
    await store.save();
    expect(Object.keys(lastChanges(persist))).toEqual(["da"]);
  });

  it("V6: the write carries only the changed column", async () => {
    const { store, persist } = open();
    store.editValue("da", "Hej!");
    await store.save();
    expect(lastChanges(persist).da).toMatchObject({ value: "Hej!" });
    expect("fields" in lastChanges(persist).da).toBe(false);
  });

  it("V7: the Expected value is the baseline's", async () => {
    const { store, persist } = open();
    store.editValue("da", "Hej!");
    await store.save();
    expect(lastChanges(persist).da.expected).toEqual({ value: "Hej" });
  });

  it("V8: a changed status sends only that field", async () => {
    const { store, persist } = open();
    store.editField("da", "status", "approved");
    await store.save();
    expect(lastChanges(persist).da).toEqual({ fields: { status: "approved" }, expected: { fields: { status: "draft" } } });
  });

  it("V9: the Expected value for a field is the baseline's, as text", async () => {
    const { store, persist } = open();
    store.editField("da", "status", "approved");
    await store.save();
    expect(lastChanges(persist).da.expected.fields).toEqual({ status: "draft" });
  });

  it("V10: a cleared Field is sent as the empty string, never as an absent property", async () => {
    const { store, persist } = open(succeeds, { schema: { fields: [{ type: "text", name: "note" }] } });
    store.setValues("k", values({ da: { value: "Hej", note: "a note" } }), false);
    store.editField("da", "note", "");
    await store.save();
    expect(lastChanges(persist).da.fields).toEqual({ note: "" });
  });

  it("clearing the translation string is sent as the empty string", async () => {
    const { store, persist } = open();
    store.editValue("da", "");
    await store.save();
    expect(lastChanges(persist).da.value).toBe("");
  });

  it("V11: a Field absent in both draft and baseline is not in the write", async () => {
    const { store, persist } = open();
    store.editValue("da", "Hej!");
    await store.save();
    expect(JSON.stringify(lastChanges(persist).da)).not.toContain("note");
  });

  it("a Field that goes from absent to empty is not a change", async () => {
    const { store, persist } = open();
    store.editField("da", "note", "");
    await store.save();
    expect(persist).not.toHaveBeenCalled();
  });

  it("an untouched Field that missing and empty both describe equally is not a change", async () => {
    const { store } = open();
    store.editField("da", "note", "");
    expect(store.getState().dirty.count).toBe(0);
  });

  it("V12: a Read-only Field that differs is never in a write", () => {
    const changes = buildChanges({
      schema,
      draft: { da: { value: "x", updatedBy: "bob" } },
      baseline: { da: { value: "x", updatedBy: "alice" } },
      order: ["da"],
    });
    expect(changes).toEqual({});
  });

  it("a Read-only Field cannot be edited at all", () => {
    const { store } = open();
    store.editField("da", "updatedBy", "mallory");
    expect(store.getState().draft.da?.updatedBy).toBe("alice");
  });

  it("two Locales changed are both sent, in row order", async () => {
    const { store, persist } = open();
    store.editValue("es", "Hola!");
    store.editValue("da", "Hej!");
    await store.save();
    expect(Object.keys(lastChanges(persist))).toEqual(["da", "es"]);
  });

  it("a Locale with no baseline row sends its value with an empty Expected value", async () => {
    const { store, persist } = open();
    store.editValue("en", "Hello");
    await store.save();
    expect(lastChanges(persist).en).toEqual({ value: "Hello", expected: { value: "" } });
  });

  it("the dirty state counts changed columns", () => {
    const { store } = open();
    store.editValue("da", "Hej!");
    store.editField("da", "status", "approved");
    store.editValue("es", "Hola!");
    expect([store.getState().dirty.count, store.getState().dirty.locales]).toEqual([3, ["da", "es"]]);
  });
});

describe("save: the outcome", () => {
  it("V13: while in flight the saving flag is set and the status says saving", async () => {
    const pending = deferred<Awaited<ReturnType<Persist>>>();
    const { store } = open(() => pending.promise);
    store.editValue("da", "Hej!");
    const saving = store.save();
    expect([store.getState().saving, store.getState().status]).toEqual([true, { text: "Saving...", kind: "neutral" }]);
    pending.resolve({ ok: true, results: { da: { ok: true } } });
    await saving;
  });

  it("V14: saving again while one is in flight calls persist once", async () => {
    const pending = deferred<Awaited<ReturnType<Persist>>>();
    const { store, persist } = open(() => pending.promise);
    store.editValue("da", "Hej!");
    const first = store.save();
    await store.save();
    pending.resolve({ ok: true, results: { da: { ok: true } } });
    await first;
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("V15: when every Locale succeeds the status kind is success", async () => {
    const { store } = open();
    store.editValue("da", "Hej!");
    await store.save();
    expect(store.getState().status.kind).toBe("success");
  });

  it("V16: the status line has a success token per Locale, two spaces apart", async () => {
    const { store } = open();
    store.editValue("da", "Hej!");
    store.editValue("es", "Hola!");
    await store.save();
    expect(store.getState().status.text).toBe("da ✓  es ✓");
  });

  it("the saving flag is clear again once the answer arrives", async () => {
    const { store } = open();
    store.editValue("da", "Hej!");
    await store.save();
    expect(store.getState().saving).toBe(false);
  });

  it("V17: a saved Locale is committed into the baseline, so saving again says no changes", async () => {
    const { store, persist } = open();
    store.editValue("da", "Hej!");
    await store.save();
    await store.save();
    expect([persist.mock.calls.length, store.getState().status.text]).toEqual([1, "No changes"]);
  });

  it("the baseline takes exactly what was sent", async () => {
    const { store } = open();
    store.editValue("da", "Hej!");
    await store.save();
    expect(store.getState().baseline.da).toEqual({ value: "Hej!", status: "draft", updatedBy: "alice" });
  });

  it("typing that happens while a save is in flight stays dirty", async () => {
    const pending = deferred<Awaited<ReturnType<Persist>>>();
    const { store } = open(() => pending.promise);
    store.editValue("da", "first");
    const saving = store.save();
    store.editValue("da", "first, and more");
    pending.resolve({ ok: true, results: { da: { ok: true } } });
    await saving;
    expect([store.getState().draft.da?.value, store.getState().dirty.locales]).toEqual(["first, and more", ["da"]]);
  });

  const failsOnDa: Persist = async () => ({ ok: false, results: { da: { ok: false, status: 500, message: "boom" }, es: { ok: true, status: 200 } } });

  it("V18: a failure's token shows its status", async () => {
    const { store } = open(failsOnDa);
    store.editValue("da", "Hej!");
    store.editValue("es", "Hola!");
    await store.save();
    expect(store.getState().status).toEqual({ text: "da ✗ (500)  es ✓", kind: "error" });
  });

  it("V19: after a failure, saving again sends only the failed Locale", async () => {
    const { store, persist } = open(failsOnDa);
    store.editValue("da", "Hej!");
    store.editValue("es", "Hola!");
    await store.save();
    await store.save();
    expect(Object.keys(lastChanges(persist))).toEqual(["da"]);
  });

  it("a failed Locale keeps its draft", async () => {
    const { store } = open(failsOnDa);
    store.editValue("da", "Hej!");
    await store.save();
    expect(store.getState().draft.da?.value).toBe("Hej!");
  });

  it("a Locale with no result counts as a failure", async () => {
    const { store } = open(async () => ({ ok: false, results: {} }));
    store.editValue("da", "Hej!");
    await store.save();
    expect(store.getState().status).toEqual({ text: "da ✗", kind: "error" });
  });

  it("a failure with no status has a bare mark", async () => {
    const { store } = open(async () => ({ ok: false, results: { da: { ok: false, message: "TypeError: Failed to fetch" } } }));
    store.editValue("da", "Hej!");
    await store.save();
    expect(store.getState().status.text).toBe("da ✗");
  });

  it("V20: a persist function that resolves to nothing is a connection error", async () => {
    const { store } = open(async () => undefined);
    store.editValue("da", "Hej!");
    await store.save();
    expect(store.getState().status).toEqual({ text: "Connection error", kind: "error" });
  });

  it("V21: a persist function that rejects is a connection error", async () => {
    const { store } = open(() => Promise.reject(new Error("down")));
    store.editValue("da", "Hej!");
    await store.save();
    expect(store.getState().status).toEqual({ text: "Connection error", kind: "error" });
  });

  it("a connection error leaves the draft untouched and clears the saving flag", async () => {
    const { store } = open(async () => undefined);
    store.editValue("da", "Hej!");
    await store.save();
    expect([store.getState().draft.da?.value, store.getState().saving]).toEqual(["Hej!", false]);
  });

  it("V22: a save refused as a stale selection tells the Editor to click again", async () => {
    const { store } = open(async () => ({ ok: false, error: "stale-selection", results: {} }));
    store.editValue("da", "Hej!");
    await store.save();
    expect(store.getState().status).toEqual({ text: "Selection changed -- click the text again", kind: "error" });
  });

  it("V23: an answer arriving after another translation was opened changes nothing", async () => {
    const pending = deferred<Awaited<ReturnType<Persist>>>();
    const { store } = open(() => pending.promise);
    store.editValue("da", "Hej!");
    const saving = store.save();
    store.open("k2", "da", "Anden");
    const before = store.getState();
    pending.resolve({ ok: true, results: { da: { ok: true, status: 200 } } });
    await saving;
    expect(store.getState()).toBe(before);
  });

  it("V23: the discarded answer does not become the new key's revert target", async () => {
    const pending = deferred<Awaited<ReturnType<Persist>>>();
    const { store } = open(() => pending.promise);
    store.editValue("da", "old key's text");
    const saving = store.save();
    store.open("k2", "da", "Anden");
    pending.resolve({ ok: true, results: { da: { ok: true, status: 200 } } });
    await saving;
    expect(store.getState().baseline.da?.value).toBe("Anden");
  });

  it("V24: opening another translation while a save is in flight clears the saving flag", async () => {
    const pending = deferred<Awaited<ReturnType<Persist>>>();
    const { store } = open(() => pending.promise);
    store.editValue("da", "Hej!");
    const saving = store.save();
    store.open("k2", "da", "Anden");
    expect(store.getState().saving).toBe(false);
    pending.resolve({ ok: true, results: {} });
    await saving;
  });

  it("opening the same key again also discards an in-flight answer", async () => {
    const pending = deferred<Awaited<ReturnType<Persist>>>();
    const { store } = open(() => pending.promise);
    store.editValue("da", "Hej!");
    const saving = store.save();
    store.open("k", "da", "Hej");
    pending.resolve({ ok: true, results: { da: { ok: true, status: 200 } } });
    await saving;
    expect(store.getState().status.text).toBe("");
  });
});

describe("cancel", () => {
  it("V25: cancelling after an edit reverts the draft to the baseline", () => {
    const { store } = open();
    store.editValue("da", "Hej!");
    store.editField("da", "status", "approved");
    store.cancel();
    expect(store.getState().draft).toEqual(store.getState().baseline);
  });

  it("V26: cancelling clears the status", async () => {
    const { store } = open();
    store.editField("da", "status", "");
    await store.save();
    store.cancel();
    expect(store.getState().status).toEqual({ text: "", kind: "neutral" });
  });

  it("cancelling leaves nothing dirty", () => {
    const { store } = open();
    store.editValue("da", "Hej!");
    store.cancel();
    expect(store.getState().dirty.count).toBe(0);
  });

  it("cancelling with no selection does nothing", () => {
    expect(() => configured().cancel()).not.toThrow();
  });
});
