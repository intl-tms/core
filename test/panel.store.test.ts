import { describe, expect, it, vi } from "vitest";
import { createPanelStore } from "../src/panel-store.js";
import { configured, values } from "./support/panel.js";

describe("panel store: the contract", () => {
  it("N1: a fresh store has no selection", () => {
    expect(createPanelStore().getState().selection).toBeUndefined();
  });

  it("N2: a change notifies subscribers", () => {
    const store = configured();
    const listener = vi.fn();
    store.subscribe(listener);
    store.open("k", "da", "Hej");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("N3: after unsubscribing there is no further notification", () => {
    const store = configured();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.open("k", "da", "Hej");
    expect(listener).not.toHaveBeenCalled();
  });

  it("N4: with no change between two reads the state is the same object", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    expect(store.getState()).toBe(store.getState());
  });

  it("PNL-2: every change produces a new state object", () => {
    const store = configured();
    const before = store.getState();
    store.open("k", "da", "Hej");
    expect(store.getState()).not.toBe(before);
  });

  it("PNL-3: read and subscribe work when passed around as bare functions", () => {
    const { getState, subscribe, open } = configured();
    const listener = vi.fn();
    subscribe(listener);
    open("k", "da", "Hej");
    expect(getState().selection?.key).toBe("k");
  });

  it("the inbound and action calls also work detached", () => {
    const { open, editValue, getState } = configured();
    open("k", "da", "Hej");
    editValue("da", "Hej!");
    expect(getState().draft.da?.value).toBe("Hej!");
  });

  it("a call that changes nothing does not notify", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    const listener = vi.fn();
    store.subscribe(listener);
    store.setValues("other", values({}), false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("a listener may unsubscribe itself while being notified", () => {
    const store = configured();
    const calls: string[] = [];
    const stop = store.subscribe(() => (calls.push("a"), stop()));
    store.subscribe(() => calls.push("b"));
    store.open("k", "da", "Hej");
    expect(calls).toEqual(["a", "b"]);
  });

  it("the state is immutable: its rows cannot be changed in place", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    expect(() => {
      (store.getState().draft as Record<string, unknown>).da = {};
    }).toThrow();
  });
});

describe("panel store: opening a translation", () => {
  it("N5: the draft for the Current Locale is the on-page value", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    expect(store.getState().draft.da?.value).toBe("Hej");
  });

  it("N6: the baseline for the Current Locale is the on-page value", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    expect(store.getState().baseline.da?.value).toBe("Hej");
  });

  it("the selection holds the key and the Locale that was on the page", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    expect(store.getState().selection).toMatchObject({ key: "k", locale: "da" });
  });

  it("N7: usages are marked loading", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    expect(store.getState().usagesLoading).toBe(true);
  });

  it("PNL-13: each opening is a distinct selection, even of the same key", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    const first = store.getState().selection?.id;
    store.open("k", "da", "Hej");
    expect(store.getState().selection?.id).not.toBe(first);
  });

  it("N8: opening a second key after metadata arrived for the first clears the metadata", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.setValues("k1", values({}, { sourceMessage: "First" }), false);
    store.open("k2", "da", "Hej");
    expect(store.getState().meta).toBeUndefined();
  });

  it("PNL-12: opening clears the previous key's usages", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.setUsage("k1", [{ key: "k1", source: "runtime", url: "https://x.test/", count: 1, lastSeen: "2026-01-01T00:00:00.000Z" }], false);
    store.open("k2", "da", "Hej");
    expect(store.getState().usages).toEqual([]);
  });

  it("PNL-12: opening clears the status", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.setValues("k1", values({}), true);
    store.open("k2", "da", "Hej");
    expect(store.getState().status).toEqual({ text: "", kind: "neutral" });
  });

  it("PNL-12: opening clears any usage error", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.setUsage("k1", [], true);
    store.open("k2", "da", "Hej");
    expect(store.getState().usagesError).toBe(false);
  });
});

describe("panel store: values arriving", () => {
  const open = () => {
    const store = configured();
    store.open("k", "da", "Hej");
    return store;
  };

  it("N9: values for another key leave the state unchanged", () => {
    const store = open();
    const before = store.getState();
    store.setValues("other", values({ da: { value: "x" } }), false);
    expect(store.getState()).toBe(before);
  });

  it("N10: the baseline carries the stored rows", () => {
    const store = open();
    store.setValues("k", values({ en: { value: "Hello" }, da: { value: "Hej", status: "draft" } }), false);
    expect(store.getState().baseline).toEqual({ en: { value: "Hello" }, da: { value: "Hej", status: "draft" } });
  });

  it("N11: with nothing typed the draft carries the stored rows", () => {
    const store = open();
    store.setValues("k", values({ en: { value: "Hello" }, da: { value: "Stored da" } }), false);
    expect(store.getState().draft).toEqual({ en: { value: "Hello" }, da: { value: "Stored da" } });
  });

  it("N12: what the Editor typed survives values arriving late", () => {
    const store = open();
    store.editValue("da", "typed");
    store.setValues("k", values({ da: { value: "Stored da" } }), false);
    expect(store.getState().draft.da?.value).toBe("typed");
  });

  it("N13: the baseline for a Locale the Editor typed in is still the stored value", () => {
    const store = open();
    store.editValue("da", "typed");
    store.setValues("k", values({ da: { value: "Stored da" } }), false);
    expect(store.getState().baseline.da?.value).toBe("Stored da");
  });

  it("N14: the Editor typed the value only; the stored status is taken into the draft", () => {
    const store = open();
    store.editValue("da", "typed");
    store.setValues("k", values({ da: { value: "Stored da", status: "draft" } }), false);
    expect(store.getState().draft.da).toEqual({ value: "typed", status: "draft" });
  });

  it("a Field the Editor typed survives while the value is taken from the store", () => {
    const store = open();
    store.editField("da", "note", "my note");
    store.setValues("k", values({ da: { value: "Stored da", note: "their note" } }), false);
    expect(store.getState().draft.da).toEqual({ value: "Stored da", note: "my note" });
  });

  it("PNL-24: an untouched Field absent on both sides does not become a change", () => {
    const store = open();
    store.setValues("k", values({ da: { value: "Hej" } }), false);
    expect(store.getState().dirty.locales).toEqual([]);
  });

  it("an Editor who typed back to exactly the old baseline counts as not having typed", () => {
    const store = open();
    store.editValue("da", "changed");
    store.editValue("da", "Hej");
    store.setValues("k", values({ da: { value: "Stored da" } }), false);
    expect(store.getState().draft.da?.value).toBe("Stored da");
  });

  it("N15: values that fail set the load-error status", () => {
    const store = open();
    store.setValues("k", values({}), true);
    expect(store.getState().status).toEqual({ text: "Could not load other locales", kind: "error" });
  });

  it("N16: and leave the draft unchanged", () => {
    const store = open();
    const draft = store.getState().draft;
    store.setValues("k", values({}), true);
    expect(store.getState().draft).toBe(draft);
  });

  it("the on-page seed stays editable after a failed load", () => {
    const store = open();
    store.setValues("k", values({}), true);
    store.editValue("da", "still typing");
    expect(store.getState().draft.da?.value).toBe("still typing");
  });

  it("metadata that arrives is kept", () => {
    const store = open();
    store.setValues("k", values({}, { sourceMessage: "Source" }), false);
    expect(store.getState().meta).toEqual({ sourceMessage: "Source" });
  });

  it("the stored rows are not shared with the caller: changing the caller's object changes nothing", () => {
    const store = open();
    const stored = { da: { value: "Stored da" } };
    store.setValues("k", values(stored), false);
    stored.da.value = "tampered";
    expect(store.getState().baseline.da?.value).toBe("Stored da");
  });
});

describe("panel store: source seeding", () => {
  const sourceStore = () => configured({}, { sourceLocale: "en" });

  it("N17: with a Source Locale, a source message and no row, the draft is seeded from the source message", () => {
    const store = sourceStore();
    store.open("k", "da", "Hej");
    store.setValues("k", values({ da: { value: "Hej" } }, { sourceMessage: "Go to <a>Docs</a>" }), false);
    expect(store.getState().draft.en?.value).toBe("Go to <a>Docs</a>");
  });

  it("N18: the baseline is seeded as well, so the seed is not a change", () => {
    const store = sourceStore();
    store.open("k", "da", "Hej");
    store.setValues("k", values({}, { sourceMessage: "Go to <a>Docs</a>" }), false);
    expect(store.getState().baseline.en?.value).toBe("Go to <a>Docs</a>");
  });

  it("N20: a stored row for the Source Locale is kept", () => {
    const store = sourceStore();
    store.open("k", "da", "Hej");
    store.setValues("k", values({ en: { value: "Stored en" } }, { sourceMessage: "Source" }), false);
    expect(store.getState().baseline.en?.value).toBe("Stored en");
  });

  it("N21: with no Source Locale nothing is seeded", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    store.setValues("k", values({}, { sourceMessage: "Source" }), false);
    expect(store.getState().draft.en).toBeUndefined();
  });

  it("with a Source Locale but no source message nothing is seeded", () => {
    const store = sourceStore();
    store.open("k", "da", "Hej");
    store.setValues("k", values({}), false);
    expect(store.getState().draft.en).toBeUndefined();
  });

  it("an empty source message seeds nothing", () => {
    const store = sourceStore();
    store.open("k", "da", "Hej");
    store.setValues("k", values({}, { sourceMessage: "" }), false);
    expect(store.getState().draft.en).toBeUndefined();
  });

  it("when the Source Locale is the Current Locale its page seed is replaced by the source message", () => {
    const store = sourceStore();
    store.open("k", "en", "Go to ");
    store.setValues("k", values({}, { sourceMessage: "Go to <a>Docs</a>" }), false);
    expect([store.getState().draft.en?.value, store.getState().baseline.en?.value]).toEqual(["Go to <a>Docs</a>", "Go to <a>Docs</a>"]);
  });

  it("an Editor who already typed in the Source Locale keeps what they typed", () => {
    const store = sourceStore();
    store.open("k", "en", "Go to ");
    store.editValue("en", "my edit");
    store.setValues("k", values({}, { sourceMessage: "Go to <a>Docs</a>" }), false);
    expect([store.getState().draft.en?.value, store.getState().baseline.en?.value]).toEqual(["my edit", "Go to <a>Docs</a>"]);
  });
});

describe("panel store: usages and the Hidden list", () => {
  const usage = [{ key: "k", source: "runtime" as const, url: "https://x.test/p", count: 2, lastSeen: "2026-01-01T00:00:00.000Z" }];

  it("N22: usages arriving clear loading and are in state", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    store.setUsage("k", usage, false);
    expect([store.getState().usagesLoading, store.getState().usages]).toEqual([false, usage]);
  });

  it("N23: usages that fail set the usage error flag", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    store.setUsage("k", [], true);
    expect([store.getState().usagesError, store.getState().usagesLoading]).toEqual([true, false]);
  });

  it("PNL-20: usages for a key that is not open are ignored", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    const before = store.getState();
    store.setUsage("other", usage, false);
    expect(store.getState()).toBe(before);
  });

  it("the Hidden list is kept as given", () => {
    const store = configured();
    const items = [{ id: "a1:title", attribute: "title", key: "a.title", value: "Tip" }];
    store.setHidden(items);
    expect(store.getState().hidden).toEqual(items);
  });
});

describe("panel store: configuration", () => {
  it("the Locales, Schema and Source Locale are in state", () => {
    const store = configured({}, { sourceLocale: "en" });
    expect([store.getState().locales, store.getState().sourceLocale, store.getState().schema?.fields?.length]).toEqual([["en", "da", "es"], "en", 3]);
  });

  it("a configuration that has not arrived is a normal state", () => {
    expect(createPanelStore().getState().locales).toEqual([]);
  });

  it("a configuration with parts missing is accepted", () => {
    const store = createPanelStore();
    store.setConfig({});
    expect(store.getState().schema).toBeUndefined();
  });

  it("a late configuration applies to an already open translation", () => {
    const store = createPanelStore();
    store.open("k", "da", "Hej");
    store.setConfig({ locales: ["en", "da"] });
    expect(store.getState().rowOrder).toEqual(["da", "en"]);
  });
});
