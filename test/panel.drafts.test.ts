import { describe, expect, it, vi } from "vitest";
import type { PanelStoreOptions } from "../src/panel-store.js";
import { deferred } from "./support/session-fakes.js";
import { configured, values } from "./support/panel.js";

type Persist = NonNullable<PanelStoreOptions["persist"]>;
const succeeds: Persist = async (changes) => ({ ok: true, results: Object.fromEntries(Object.keys(changes).map((l) => [l, { ok: true, status: 200 }])) });

describe("drafts survive a change of selection", () => {
  it("I1: an edit to k1, then k2 opened, then k1 reopened: the k1 draft is restored", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.editValue("da", "typed in k1");
    store.open("k2", "da", "Anden");
    store.open("k1", "da", "Hej");
    expect(store.getState().draft.da?.value).toBe("typed in k1");
  });

  it("I1: the restored key is still dirty, with its baseline intact", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.editValue("da", "typed in k1");
    store.open("k2", "da", "Anden");
    store.open("k1", "da", "Hej");
    expect([store.getState().baseline.da?.value, store.getState().dirty.locales]).toEqual(["Hej", ["da"]]);
  });

  it("I2: the key with the unsaved draft is listed", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.editValue("da", "typed in k1");
    store.open("k2", "da", "Anden");
    expect(store.getState().unsavedKeys).toEqual(["k1"]);
  });

  it("the open key is listed too once it is dirty", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.editValue("da", "typed");
    expect(store.getState().unsavedKeys).toEqual(["k1"]);
  });

  it("a key with nothing changed is not listed", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.open("k2", "da", "Anden");
    expect(store.getState().unsavedKeys).toEqual([]);
  });

  it("the open key is not listed twice", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.editValue("da", "typed");
    store.open("k2", "da", "Anden");
    store.editValue("da", "typed too");
    expect(store.getState().unsavedKeys).toEqual(["k1", "k2"]);
  });

  it("returning to a key removes it from the stashed list", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.editValue("da", "typed");
    store.open("k2", "da", "Anden");
    store.open("k1", "da", "Hej");
    expect(store.getState().unsavedKeys).toEqual(["k1"]);
  });

  it("the other key's draft is not visible while another key is open", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.editValue("da", "typed in k1");
    store.open("k2", "da", "Anden");
    expect(store.getState().draft.da?.value).toBe("Anden");
  });

  it("a stashed draft keeps what the Editor typed when values then arrive for the restored key", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.setValues("k1", values({ da: { value: "Stored", status: "draft" } }), false);
    store.editValue("da", "typed in k1");
    store.open("k2", "da", "Anden");
    store.open("k1", "da", "Hej");
    store.setValues("k1", values({ da: { value: "Stored", status: "draft" } }), false);
    expect(store.getState().draft.da?.value).toBe("typed in k1");
  });

  it("a restored draft is judged against a baseline that stays the stored value", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.setValues("k1", values({ da: { value: "Stored", status: "draft" } }), false);
    store.editValue("da", "typed in k1");
    store.open("k2", "da", "Anden");
    store.open("k1", "da", "Hej");
    store.setValues("k1", values({ da: { value: "Stored", status: "draft" } }), false);
    expect(store.getState().baseline.da?.value).toBe("Stored");
  });

  it("a key that was saved clean is not restored with stale text", () => {
    const store = configured({ persist: succeeds });
    store.open("k1", "da", "Hej");
    store.editValue("da", "typed");
    store.open("k2", "da", "Anden");
    store.open("k1", "da", "Hej");
    return store.save().then(() => {
      store.open("k2", "da", "Anden");
      expect(store.getState().unsavedKeys).toEqual([]);
    });
  });

  it("cancelling a restored key leaves nothing unsaved", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.editValue("da", "typed");
    store.open("k2", "da", "Anden");
    store.open("k1", "da", "Hej");
    store.cancel();
    expect(store.getState().unsavedKeys).toEqual([]);
  });

  it("reopening the same key keeps its draft too", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.editValue("da", "typed");
    store.open("k1", "da", "Hej");
    expect(store.getState().draft.da?.value).toBe("typed");
  });

  it("a restored key whose page now shows another Locale is seeded for that Locale as well", () => {
    const store = configured();
    store.open("k1", "da", "Hej");
    store.editValue("da", "typed");
    store.open("k2", "es", "Otro");
    store.open("k1", "es", "Hola");
    expect([store.getState().draft.da?.value, store.getState().draft.es?.value]).toEqual(["typed", "Hola"]);
  });

  it("a save still in flight when the Editor leaves does not lose the stashed draft", async () => {
    const pending = deferred<Awaited<ReturnType<Persist>>>();
    const store = configured({ persist: () => pending.promise });
    store.open("k1", "da", "Hej");
    store.editValue("da", "typed");
    const saving = store.save();
    store.open("k2", "da", "Anden");
    pending.resolve({ ok: true, results: { da: { ok: true, status: 200 } } });
    await saving;
    expect(store.getState().unsavedKeys).toEqual(["k1"]);
  });
});

describe("can-save", () => {
  const ready = (persist: Persist | null = succeeds) => {
    const store = configured(persist === null ? {} : { persist });
    store.open("k", "da", "Hej");
    store.setValues("k", values({ da: { value: "Hej", status: "draft" } }), false);
    return store;
  };

  it("I3: with nothing dirty can-save is false with the reason nothing-changed", () => {
    expect(ready().getState().canSave).toEqual({ ok: false, reason: "nothing-changed" });
  });

  it("with a change it is true and carries no reason", () => {
    const store = ready();
    store.editValue("da", "Hej!");
    expect(store.getState().canSave).toEqual({ ok: true });
  });

  it("with no selection the reason is no-selection", () => {
    expect(configured({ persist: succeeds }).getState().canSave).toEqual({ ok: false, reason: "no-selection" });
  });

  it("with no persist function the reason is no-persist", () => {
    const store = ready(null);
    store.editValue("da", "Hej!");
    expect(store.getState().canSave).toEqual({ ok: false, reason: "no-persist" });
  });

  it("while a save is in flight the reason is saving", async () => {
    const pending = deferred<Awaited<ReturnType<Persist>>>();
    const store = ready(() => pending.promise);
    store.editValue("da", "Hej!");
    const saving = store.save();
    expect(store.getState().canSave).toEqual({ ok: false, reason: "saving" });
    pending.resolve({ ok: true, results: { da: { ok: true } } });
    await saving;
  });

  it("a required error gives the reason required-fields", () => {
    const store = ready();
    store.editField("da", "status", "");
    expect(store.getState().canSave).toEqual({ ok: false, reason: "required-fields" });
  });

  it("a tag error gives the reason tag-errors", () => {
    const store = configured({ persist: succeeds }, { sourceLocale: "en" });
    store.open("k", "da", "Hej");
    store.setValues("k", values({ en: { value: "<a>x</a>", status: "draft" }, da: { value: "<a>Hej</a>", status: "draft" } }), false);
    store.editValue("da", "uden tag");
    expect(store.getState().canSave).toEqual({ ok: false, reason: "tag-errors" });
  });

  it("can-save agrees with what save does", async () => {
    const persist = vi.fn(succeeds);
    const store = ready(persist);
    store.editValue("da", "Hej!");
    const allowed = store.getState().canSave.ok;
    await store.save();
    expect([allowed, persist.mock.calls.length]).toEqual([true, 1]);
  });
});
