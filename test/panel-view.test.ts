// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLog } from "../src/panel-log.js";
import { PANEL_VIEW_TEXT, createPanelView, type PanelView, type PanelViewOptions } from "../src/panel-view.js";
import type { PersistOutcome } from "../src/panel-store.js";
import { schema, values } from "./support/panel.js";

let container: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="panel"></div>';
  container = document.getElementById("panel")!;
});

const one = <T extends Element = HTMLElement>(role: string) => container.querySelector<T>(`[data-role="${role}"]`)!;
const all = <T extends Element = HTMLElement>(role: string) => [...container.querySelectorAll<T>(`[data-role="${role}"]`)];
const control = (locale: string, column = "value") =>
  all<HTMLInputElement>("control").find((item) => item.dataset.locale === locale && item.dataset.column === column)!;
const type = (target: HTMLInputElement | HTMLSelectElement, text: string) => {
  target.value = text;
  target.dispatchEvent(new Event("input", { bubbles: true }));
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function mount(options: Partial<PanelViewOptions> = {}, config: Parameters<PanelView["setConfig"]>[0] | null = { locales: ["en", "da"], sourceLocale: "en" }) {
  const save = vi.fn<PanelViewOptions["save"]>(async (_key, writes) => ({ ok: true, results: Object.fromEntries(Object.keys(writes).map((locale) => [locale, { ok: true }])) }));
  const log = createLog({ now: () => new Date(2026, 0, 10, 9, 5, 3) });
  const view = createPanelView({ container, save, log, ...options });
  if (config !== null) view.setConfig(config);
  return { view, save, log };
}

describe("panel view", () => {
  it("shows a placeholder and no editor until a translation is opened", () => {
    mount();
    expect(one("placeholder").hidden).toBe(false);
    expect(one("selection").hidden).toBe(true);
  });

  it("opening a translation shows its key and one row per Locale, the Current Locale first", () => {
    const { view } = mount();
    view.open("home.title", "da", "Hej");
    expect(one("key").textContent).toBe("home.title");
    expect(all("row").map((row) => row.dataset.locale)).toEqual(["da", "en"]);
    expect(control("da").value).toBe("Hej");
  });

  it("stored values fill the other Locales", () => {
    const { view } = mount();
    view.open("home.title", "da", "Hej");
    view.setValues("home.title", values({ en: { value: "Hello" }, da: { value: "Hej" } }), false);
    expect(control("en").value).toBe("Hello");
  });

  it("the source message becomes the title", () => {
    const { view } = mount();
    view.open("home.title", "da", "Hej");
    view.setValues("home.title", values({ en: { value: "Hello" } }, { sourceMessage: "Hello" }), false);
    expect(one("title").textContent).toBe("Hello");
  });

  it("values for another key are ignored", () => {
    const { view } = mount();
    view.open("home.title", "da", "Hej");
    view.setValues("other", values({ en: { value: "Nope" } }), false);
    expect(control("en").value).toBe("");
  });

  it("Save sends only what changed, with what was loaded beside it", async () => {
    const { view, save } = mount();
    view.open("home.title", "da", "Hej");
    view.setValues("home.title", values({ en: { value: "Hello" }, da: { value: "Hej" } }), false);
    type(control("da"), "Hej verden");
    one("save").click();
    await settle();
    expect(save).toHaveBeenCalledWith("home.title", { da: { value: "Hej verden", expected: { value: "Hej" } } });
    expect(one("status").textContent).toContain("da ✓");
  });

  it("Save with nothing changed sends nothing and says so", async () => {
    const { view, save } = mount();
    view.open("home.title", "da", "Hej");
    one("save").click();
    await settle();
    expect(save).not.toHaveBeenCalled();
    expect(one("status").textContent).toBe("No changes");
  });

  it("no answer at all is shown as a connection error", async () => {
    const { view } = mount({ save: async () => undefined });
    view.open("home.title", "da", "Hej");
    type(control("da"), "Ny");
    one("save").click();
    await settle();
    expect(one("status").dataset.kind).toBe("error");
  });

  it("Cancel puts back what was loaded", () => {
    const { view } = mount();
    view.open("home.title", "da", "Hej");
    type(control("da"), "Ny");
    one("cancel").click();
    expect(control("da").value).toBe("Hej");
  });

  it("typing survives values that arrive late", () => {
    const { view } = mount();
    view.open("home.title", "da", "Hej");
    type(control("da"), "Midt i et ord");
    view.setValues("home.title", values({ en: { value: "Hello" }, da: { value: "Hej" } }), false);
    expect(control("da").value).toBe("Midt i et ord");
  });

  it("a Schema renders its Fields, and an empty required Field blocks Save", () => {
    const { view } = mount({}, { locales: ["en", "da"], schema });
    view.open("home.title", "da", "Hej");
    view.setValues("home.title", values({ da: { value: "Hej" } }), false);
    expect(control("da", "status").tagName).toBe("SELECT");
    expect(one<HTMLButtonElement>("save").disabled).toBe(true);
    type(control("da", "status"), "draft");
    expect(one<HTMLButtonElement>("save").disabled).toBe(false);
  });

  it("a Read-only Field is shown as text, not as a control", () => {
    const { view } = mount({}, { locales: ["da"], schema });
    view.open("home.title", "da", "Hej");
    view.setValues("home.title", values({ da: { value: "Hej", updatedBy: "ann" } }), false);
    expect(one("readonly").textContent).toBe("ann");
    expect(control("da", "updatedBy")).toBeUndefined();
  });

  it("a conflict shows what is stored beside the draft", async () => {
    const save = async (): Promise<PersistOutcome> => ({ ok: false, results: { da: { ok: false, status: 409, current: { value: "Andet" } } } });
    const { view } = mount({ save });
    view.open("home.title", "da", "Hej");
    type(control("da"), "Mit");
    one("save").click();
    await settle();
    expect(all("conflict").find((note) => !note.hidden)?.textContent).toContain("Andet");
  });

  it("the Hidden list shows attribute translations and opens or flashes one", () => {
    const openHidden = vi.fn();
    const flash = vi.fn();
    const { view } = mount({ openHidden, flash });
    expect(one("hidden").hidden).toBe(true);
    view.setHidden([{ id: "a1:alt", attribute: "alt", key: "logo.alt", value: "Logo" }]);
    expect(one("hidden").hidden).toBe(false);
    one("hidden-item").dispatchEvent(new MouseEvent("mouseenter"));
    one("hidden-item").click();
    expect([flash.mock.calls, openHidden.mock.calls]).toEqual([[["a1:alt"]], [["a1:alt"]]]);
  });

  it("Used on lists a key's addresses and follows one", () => {
    const navigate = vi.fn();
    const { view } = mount({ navigate, now: () => Date.parse("2026-01-01T00:10:00Z") });
    view.open("home.title", "da", "Hej");
    expect(one("used-on-state").textContent).toBe("Loading…");
    view.setUsage("home.title", [{ key: "home.title", source: "runtime", url: "https://app.test/da/about", count: 2, lastSeen: "2026-01-01T00:00:00Z" }], false);
    expect(one("usage").textContent).toContain("/da/about");
    one("usage").click();
    expect(navigate).toHaveBeenCalledWith("https://app.test/da/about");
  });

  it("a notice is shown while there is one", () => {
    const { view } = mount();
    expect(one("notice").hidden).toBe(true);
    view.setNotice("The configuration could not be loaded");
    expect([one("notice").hidden, one("notice").textContent]).toEqual([false, "The configuration could not be loaded"]);
    view.setNotice(undefined);
    expect(one("notice").hidden).toBe(true);
  });

  it("text from a store is inserted as text, never as markup", () => {
    const { view } = mount();
    view.open("<img src=x>", "da", "<b>Hej</b>");
    expect(container.querySelector("img, b")).toBeNull();
    expect(one("key").textContent).toBe("<img src=x>");
  });
});

describe("panel view: diagnostics", () => {
  const DIAGNOSTICS = PANEL_VIEW_TEXT.diagnostics;
  const pane = () => one<HTMLDetailsElement>("diagnostics");
  const failing = (outcome: PersistOutcome | undefined | Error) => async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  async function saved(save?: PanelViewOptions["save"], extra: Partial<PanelViewOptions> = {}) {
    const mounted = mount({ ...(save === undefined ? {} : { save }), ...extra });
    mounted.view.open("home.title", "da", "Hej");
    mounted.view.setValues("home.title", values({ en: { value: "Hello" }, da: { value: "Hej" } }), false);
    type(control("da"), "Hej verden");
    one("save").click();
    await settle();
    return mounted;
  }

  it("is a collapsed pane titled Diagnostics, shown with nothing selected", () => {
    mount();
    expect([pane().querySelector("summary")?.textContent, pane().open, pane().closest("[hidden]")]).toEqual(["Diagnostics", false, null]);
  });

  it("invites the Editor to do something while the log is empty", () => {
    mount({}, null);
    expect([one("log").tagName, one("log").textContent]).toEqual(["PRE", DIAGNOSTICS.empty]);
  });

  it("logs a configuration's Locales, Source Locale and whether it has a Schema", () => {
    mount();
    expect(one("log").textContent).toBe("09:05:03  config  languages: en, da; source: en; schema: no");
  });

  it("logs an empty configuration in words", () => {
    expect(mount({}, {}).log.entries()[0]?.text).toBe("languages: (none); source: (unset); schema: no");
  });

  it("logs an opened translation's key and Locale, with the on-page value as detail", () => {
    const { view, log } = mount();
    view.open("home.title", "da", "Hej");
    expect(log.entries().at(-1)).toMatchObject({ channel: "open", text: "home.title (da)", detail: "Hej" });
  });

  it("a Locale the configuration does not list is logged and opens the pane", () => {
    const { view, log } = mount();
    view.open("home.title", "fr", "Salut");
    expect([log.entries().at(-1)?.text, pane().open]).toEqual([expect.stringContaining("fr"), true]);
  });

  it("logs the Locales that have stored rows when values arrive", () => {
    const { view, log } = mount();
    view.open("home.title", "da", "Hej");
    view.setValues("home.title", values({ en: { value: "Hello" }, da: { value: "Hej" } }), false);
    expect(log.entries().at(-1)).toMatchObject({ channel: "values", text: "home.title -> en, da" });
  });

  it("logs that there are no stored rows", () => {
    const { view, log } = mount();
    view.open("home.title", "da", "Hej");
    view.setValues("home.title", values({}), false);
    expect(log.entries().at(-1)?.text).toBe("home.title -> (no stored rows)");
  });

  it("values that fail to load are logged and open the pane", () => {
    const { view, log } = mount();
    view.open("home.title", "da", "Hej");
    view.setValues("home.title", values({}), true);
    expect([log.entries().at(-1)?.text, pane().open]).toEqual(["home.title READ FAILED -- the panel is showing the on-page value only", true]);
  });

  it("logs a sent save's writes, then that it was saved, and stays collapsed", async () => {
    const { log } = await saved();
    const sent = log.entries().find((entry) => entry.text === "PUT home.title");
    expect([JSON.parse(sent?.detail ?? "null"), log.entries().at(-1)?.text, pane().open]).toEqual([{ da: { value: "Hej verden", expected: { value: "Hej" } } }, "saved", false]);
  });

  it("a failed save is logged with why, and opens the pane", async () => {
    const { log } = await saved(failing({ ok: false, results: { da: { ok: false, status: 400, message: "value is too long" } } }));
    expect([log.entries().slice(-2).map((entry) => `${entry.channel}:${entry.text}`), pane().open]).toEqual([["save:FAILED", "why:da: 400 value is too long"], true]);
  });

  it("a save with no answer at all says so", async () => {
    const { log } = await saved(failing(undefined));
    expect(log.text()).toContain("why  The page did not answer.");
  });

  it("a conflict is the website's answer, not a failure: logged as refused, pane left alone", async () => {
    const { log } = await saved(failing({ ok: false, results: { da: { ok: false, status: 409, current: { value: "Andet" } } } }));
    expect([log.entries().at(-1)?.text, pane().open]).toEqual(["refused: changed elsewhere", false]);
  });

  it("a save callback that throws is logged, opens the pane and leaves the panel usable", async () => {
    let calls = 0;
    const { log } = await saved(async (_key, writes) => {
      if (calls++ === 0) throw new Error("port closed");
      return { ok: true, results: Object.fromEntries(Object.keys(writes).map((locale) => [locale, { ok: true }])) };
    });
    expect([log.entries().at(-1), pane().open]).toEqual([expect.objectContaining({ channel: "save", text: "THREW", detail: "port closed" }), true]);
    one("save").click();
    await settle();
    expect(one("status").textContent).toBe("da ✓");
  });

  it("Clear empties the log", async () => {
    const { log } = await saved();
    one("clear").click();
    expect([log.entries(), one("log").textContent]).toEqual([[], DIAGNOSTICS.empty]);
  });

  it("Copy puts the log on the clipboard and says so", async () => {
    const copied: string[] = [];
    const { log } = await saved(undefined, { clipboard: { writeText: async (text) => void copied.push(text) } });
    one("copy").click();
    await settle();
    expect([one("copy").textContent, copied]).toEqual([DIAGNOSTICS.copied, [log.text()]]);
  });

  it("Copy says it could not when the clipboard refuses, or there is none", async () => {
    await saved(undefined, { clipboard: { writeText: () => Promise.reject(new Error("denied")) } });
    one("copy").click();
    await settle();
    const refused = one("copy").textContent;
    await saved(undefined, { clipboard: undefined as never });
    one("copy").click();
    await settle();
    expect([refused, one("copy").textContent]).toEqual([DIAGNOSTICS.copyFailed, DIAGNOSTICS.copyFailed]);
  });

  it("a logged reason containing markup is shown literally", async () => {
    await saved(failing({ ok: false, results: { da: { ok: false, status: 400, message: "<img src=x onerror=alert(1)>" } } }));
    expect([one("log").querySelector("img"), one("log").textContent?.includes("<img src=x onerror=alert(1)>")]).toEqual([null, true]);
  });

  it("the pane is scrolled to the newest entry", () => {
    const { log } = mount();
    Object.defineProperty(one("log"), "scrollHeight", { configurable: true, get: () => 4000 });
    log.add("save", "newest");
    expect(one("log").scrollTop).toBe(4000);
  });
});

describe("panel log", () => {
  it("keeps only the newest entries once it is full", () => {
    const log = createLog({ limit: 2 });
    for (const text of ["one", "two", "three"]) log.add("save", text);
    expect(log.entries().map((entry) => entry.text)).toEqual(["two", "three"]);
  });

  it("indents each line of a detail beneath its entry", () => {
    const log = createLog({ now: () => new Date(2026, 0, 10, 9, 5, 3) });
    log.add("save", "PUT a", "x\ny");
    expect(log.text()).toBe("09:05:03  save  PUT a\n    x\n    y");
  });

  it("tells subscribers about additions and clears until they unsubscribe", () => {
    const log = createLog();
    const heard = vi.fn();
    const stop = log.subscribe(heard);
    log.add("open", "a");
    log.clear();
    stop();
    log.add("open", "b");
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
