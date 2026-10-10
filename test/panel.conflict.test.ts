import { describe, expect, it, vi } from "vitest";
import type { PanelStoreOptions } from "../src/panel-store.js";
import { configured, values } from "./support/panel.js";

type Persist = NonNullable<PanelStoreOptions["persist"]>;

const THEIRS = { value: "theirs", status: "approved" };
const conflictOnDa: Persist = async () => ({ ok: false, results: { da: { ok: false, status: 409, message: "conflict", current: THEIRS } } });

/** A store that has loaded da { Hej, draft }, typed "mine" into the value, and had that save refused as a conflict. */
async function conflicted(persist: Persist = conflictOnDa) {
  const spy = vi.fn(persist);
  const store = configured({ persist: spy });
  store.open("k", "da", "Hej");
  store.setValues("k", values({ da: { value: "Hej", status: "draft" } }), false);
  store.editValue("da", "mine");
  await store.save();
  return { store, persist: spy };
}

describe("write conflicts", () => {
  it("K1: the baseline for the Locale becomes the stored row that came back", async () => {
    const { store } = await conflicted();
    expect(store.getState().baseline.da).toEqual(THEIRS);
  });

  it("K2: the draft still holds what the Editor typed", async () => {
    const { store } = await conflicted();
    expect(store.getState().draft.da?.value).toBe("mine");
  });

  it("K3: a column the Editor did not touch takes the stored value", async () => {
    const { store } = await conflicted();
    expect(store.getState().draft.da?.status).toBe("approved");
  });

  it("K4: the conflicts for the Locale list the column in conflict", async () => {
    const { store } = await conflicted();
    expect(store.getState().conflicts).toEqual({ da: ["value"] });
  });

  it("PNL-82: a column whose stored value equals what the save carried is not in conflict", async () => {
    const spy = vi.fn<Persist>(async () => ({ ok: false, results: { da: { ok: false, status: 409, message: "conflict", current: { value: "theirs", status: "approved" } } } }));
    const store = configured({ persist: spy });
    store.open("k", "da", "Hej");
    store.setValues("k", values({ da: { value: "Hej", status: "draft" } }), false);
    store.editValue("da", "mine");
    store.editField("da", "status", "approved");
    await store.save();
    expect(store.getState().conflicts).toEqual({ da: ["value"] });
  });

  it("K5: the status token says changed elsewhere", async () => {
    const { store } = await conflicted();
    expect(store.getState().status).toEqual({ text: "da ⚠ changed elsewhere", kind: "error" });
  });

  it("the Locale stays dirty after a conflict", async () => {
    const { store } = await conflicted();
    expect(store.getState().dirty.locales).toEqual(["da"]);
  });

  it("K6: saving again sends the stored row as the Expected values, so it overwrites knowingly", async () => {
    const { store, persist } = await conflicted();
    await store.save();
    expect(persist.mock.calls[1]?.[0].da?.expected).toEqual({ value: "theirs" });
  });

  it("K6: and the second save carries the Editor's text", async () => {
    const { store, persist } = await conflicted();
    await store.save();
    expect(persist.mock.calls[1]?.[0].da?.value).toBe("mine");
  });

  it("K6: and does not resend the column the Editor never touched", async () => {
    const { store, persist } = await conflicted();
    await store.save();
    expect(persist.mock.calls[1]?.[0].da?.fields).toBeUndefined();
  });

  it("K7: cancelling takes the stored value", async () => {
    const { store } = await conflicted();
    store.cancel();
    expect(store.getState().draft.da).toEqual(THEIRS);
  });

  it("K7: and clears the conflict", async () => {
    const { store } = await conflicted();
    store.cancel();
    expect(store.getState().conflicts).toEqual({});
  });

  it("K8: typing back to the stored value removes the conflict", async () => {
    const { store } = await conflicted();
    store.editValue("da", "theirs");
    expect(store.getState().conflicts).toEqual({});
  });

  it("K8: a column leaves the list on its own, the others stay", async () => {
    const spy = vi.fn<Persist>(async () => ({ ok: false, results: { da: { ok: false, status: 409, message: "conflict", current: { value: "theirs", status: "approved" } } } }));
    const store = configured({ persist: spy });
    store.open("k", "da", "Hej");
    store.setValues("k", values({ da: { value: "Hej", status: "draft" } }), false);
    store.editValue("da", "mine");
    store.editField("da", "status", "draft");
    await store.save();
    store.editField("da", "status", "approved");
    expect(store.getState().conflicts).toEqual({ da: ["value"] });
  });

  it("K9: a successful save of the Locale removes the conflict", async () => {
    const outcomes: Persist[] = [conflictOnDa, async () => ({ ok: true, results: { da: { ok: true, status: 200 } } })];
    const { store } = await conflicted((changes) => outcomes.shift()!(changes));
    await store.save();
    expect(store.getState().conflicts).toEqual({});
  });

  it("K9: and after that save there is nothing left to save", async () => {
    const outcomes: Persist[] = [conflictOnDa, async () => ({ ok: true, results: { da: { ok: true, status: 200 } } })];
    const { store } = await conflicted((changes) => outcomes.shift()!(changes));
    await store.save();
    expect(store.getState().dirty.count).toBe(0);
  });

  it("a conflict on one Locale does not stop another Locale committing", async () => {
    const spy = vi.fn<Persist>(async () => ({
      ok: false,
      results: { da: { ok: false, status: 409, message: "conflict", current: THEIRS }, es: { ok: true, status: 200 } },
    }));
    const store = configured({ persist: spy });
    store.open("k", "da", "Hej");
    store.setValues("k", values({ da: { value: "Hej", status: "draft" }, es: { value: "Hola", status: "draft" } }), false);
    store.editValue("da", "mine");
    store.editValue("es", "Hola!");
    await store.save();
    expect([store.getState().status.text, store.getState().baseline.es?.value]).toEqual(["da ⚠ changed elsewhere  es ✓", "Hola!"]);
  });

  it("a 409 that came back without a usable row is an ordinary failure", async () => {
    const { store } = await conflicted(async () => ({ ok: false, results: { da: { ok: false, status: 409, message: "conflict" } } }));
    expect([store.getState().status.text, store.getState().conflicts]).toEqual(["da ✗ (409)", {}]);
  });

  it("the stored row that came back counts as a loaded row for required Fields", async () => {
    const { store } = await conflicted(async () => ({ ok: false, results: { da: { ok: false, status: 409, message: "conflict", current: { value: "theirs" } } } }));
    expect(store.getState().requiredErrors).toEqual({ da: ["status"] });
  });

  it("opening another translation forgets the conflict", async () => {
    const { store } = await conflicted();
    store.open("k2", "da", "Anden");
    expect(store.getState().conflicts).toEqual({});
  });
});
