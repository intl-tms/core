// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decode, encode, strip } from "../src/codec.js";
import { resolveConfig } from "../src/config.js";
import { createHandler } from "../src/handler.js";
import { createMemoryAdapter } from "../src/storage.js";
import { EDIT_GLOBAL, createStorybookAddon, type StorybookAddon, type StorybookAddonOptions } from "../src/storybook.js";

const BASE = "https://app.test/api/tms";
const config = resolveConfig({ locales: ["en", "da"], basePath: BASE, sourceLocale: "en" });

const on = (globals: Record<string, unknown> = {}) => ({ globals: { [EDIT_GLOBAL]: "on", ...globals } });
const off = { globals: { [EDIT_GLOBAL]: "off" } };
const host = () => document.querySelector<HTMLElement>("[data-tms-panel]");
const inPanel = <T extends Element = HTMLElement>(role: string) => host()!.shadowRoot!.querySelector<T>(`[data-role="${role}"]`)!;
const rows = () => [...host()!.shadowRoot!.querySelectorAll<HTMLElement>('[data-role="row"]')];
const control = (locale: string) => [...host()!.shadowRoot!.querySelectorAll<HTMLInputElement>('[data-role="control"]')].find((item) => item.dataset.locale === locale)!;
const altClick = (target: Element) => target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }));
const until = async (condition: () => boolean) => {
  for (let i = 0; i < 400 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 2));
};
/** Long enough for an answer that is on its way to have arrived. */
const idle = () => new Promise((resolve) => setTimeout(resolve, 30));
const story = (key = "greeting", text = "Hej") => {
  document.body.innerHTML = `<div id="storybook-root"><p id="p">${encode(text, key)}</p></div>`;
  return document.getElementById("p")!;
};

let addon: StorybookAddon | undefined;
const errors = vi.fn();
beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("lang");
  errors.mockClear();
});
afterEach(() => addon?.stop());

function boot(options: Partial<StorybookAddonOptions> = {}) {
  const adapter = createMemoryAdapter<typeof config>();
  const handler = createHandler({ config, adapter, authorize: () => true, onError: () => undefined });
  const request = vi.fn((url: string, init?: RequestInit) => handler(new Request(url, init)));
  addon = createStorybookAddon({ config, request, console: { error: errors }, ...options });
  return { adapter, request, addon };
}

describe("storybook addon: what a Developer puts in the preview", () => {
  it("declares one toolbar switch with an Off and an On item", () => {
    const { addon } = boot();
    expect(Object.keys(addon.globalTypes)).toEqual([EDIT_GLOBAL]);
    expect(addon.globalTypes[EDIT_GLOBAL].toolbar.items.map((item) => item.value)).toEqual(["off", "on"]);
  });

  it("starts switched off, and on when the Developer says so", () => {
    expect(boot().addon.initialGlobals).toEqual({ [EDIT_GLOBAL]: "off" });
    expect(boot({ editing: true }).addon.initialGlobals).toEqual({ [EDIT_GLOBAL]: "on" });
  });

  it("editing is on only when the switch says on", () => {
    const { addon } = boot();
    expect([addon.isEditing(on()), addon.isEditing(off), addon.isEditing({}), addon.isEditing({ globals: { [EDIT_GLOBAL]: "yes" } })]).toEqual([true, false, false, false]);
  });

  it("mark returns the very same Catalog while editing is off", () => {
    const { addon } = boot();
    const catalog = { a: "x" };
    expect(addon.mark(catalog, off)).toBe(catalog);
  });

  it("mark attaches Markers while editing is on", () => {
    const { addon } = boot();
    expect(decode(addon.mark({ a: { b: "x" } }, on()).a.b)?.key).toBe("a.b");
  });
});

describe("storybook addon: the decorator", () => {
  it("returns exactly what the story returned", () => {
    const { addon } = boot();
    const rendered = { type: "story" };
    expect([addon.decorator(() => rendered, off), addon.decorator(() => rendered, on())]).toEqual([rendered, rendered]);
  });

  it("with editing off it touches nothing: no panel, no outline, no stylesheet, no request", () => {
    const { addon, request } = boot();
    const p = story();
    addon.decorator(() => undefined, off);
    expect([host(), p.hasAttribute("data-tms-hl"), document.head.children.length, request.mock.calls.length]).toEqual([null, false, 0, 0]);
  });

  it("with editing on it outlines marked text and mounts the panel in a shadow root", () => {
    const { addon } = boot();
    const p = story();
    addon.decorator(() => undefined, on());
    expect([p.hasAttribute("data-tms-hl"), host()?.shadowRoot === null, inPanel("placeholder").hidden]).toEqual([true, false, false]);
  });

  it("the panel carries the diagnostics pane, with the configuration logged", () => {
    const { addon } = boot();
    story();
    addon.decorator(() => undefined, on());
    expect([inPanel("diagnostics").tagName, inPanel("log").textContent]).toEqual(["DETAILS", expect.stringContaining("config  languages: en, da; source: en; schema: no")]);
  });

  it("rendering more stories mounts no second panel", () => {
    const { addon } = boot();
    story();
    addon.decorator(() => undefined, on());
    addon.decorator(() => undefined, on());
    expect(document.querySelectorAll("[data-tms-panel]")).toHaveLength(1);
  });

  it("switching off removes the panel and every outline", () => {
    const { addon } = boot();
    const p = story();
    addon.decorator(() => undefined, on());
    addon.decorator(() => undefined, off);
    expect([host(), p.hasAttribute("data-tms-hl")]).toEqual([null, false]);
  });

  it("the panel's own text is never scanned as a translation", async () => {
    const { addon } = boot();
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    altClick(p);
    await until(() => rows().length > 0);
    expect(document.querySelectorAll("[data-tms-hl]")).toHaveLength(1);
  });

  it("typing in the panel does not reach the workbench's keyboard shortcuts", () => {
    const { addon } = boot();
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    altClick(p);
    const heard = vi.fn();
    document.addEventListener("keydown", heard);
    control("da").dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true, composed: true }));
    document.removeEventListener("keydown", heard);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe("storybook addon: editing", () => {
  it("an Alt-click opens the translation in the panel with a row per Locale", async () => {
    const { addon, adapter } = boot();
    await adapter.saveValue("greeting", { locale: "en", value: "Hello" });
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    altClick(p);
    await until(() => control("en")?.value === "Hello");
    expect([inPanel("key").textContent, rows().map((row) => row.dataset.locale), control("da").value, control("en").value]).toEqual(["greeting", ["da", "en"], "Hej", "Hello"]);
  });

  it("Save stores the value and writes it into the story, Marker kept", async () => {
    const { addon, adapter } = boot();
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    altClick(p);
    await until(() => rows().length > 0);
    control("da").value = "Hej verden";
    control("da").dispatchEvent(new Event("input", { bubbles: true }));
    inPanel("save").click();
    await until(() => inPanel("status").textContent !== "" && inPanel("status").textContent !== "Saving...");
    expect([(await adapter.getValues("greeting")).da?.value, strip(p.textContent!), decode(p.textContent!)?.key, inPanel("status").textContent]).toEqual(["Hej verden", "Hej verden", "greeting", "da ✓"]);
  });

  it("tells the Developer about every save", async () => {
    const onSaved = vi.fn();
    const { addon } = boot({ onSaved });
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    altClick(p);
    await until(() => rows().length > 0);
    control("da").value = "Ny";
    control("da").dispatchEvent(new Event("input", { bubbles: true }));
    inPanel("save").click();
    await until(() => onSaved.mock.calls.length > 0);
    expect(onSaved.mock.calls[0]?.[0]).toMatchObject({ key: "greeting", writes: { da: { value: "Ny" } }, outcome: { ok: true, page: "updated" } });
  });

  it("a hook that throws does not turn a save into a failure", async () => {
    const { addon } = boot({
      onSaved: () => {
        throw new Error("boom");
      },
    });
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    altClick(p);
    await until(() => rows().length > 0);
    control("da").value = "Ny";
    control("da").dispatchEvent(new Event("input", { bubbles: true }));
    inPanel("save").click();
    await until(() => inPanel("status").textContent === "da ✓");
    expect(inPanel("status").textContent).toBe("da ✓");
  });

  it("a saved message the story cannot show without its formatter is said to be so", async () => {
    const { addon } = boot();
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    altClick(p);
    await until(() => rows().length > 0);
    control("da").value = "Hej {name}";
    control("da").dispatchEvent(new Event("input", { bubbles: true }));
    inPanel("save").click();
    await until(() => !inPanel("notice").hidden);
    expect([strip(p.textContent!), inPanel("notice").textContent]).toEqual(["Hej", expect.stringContaining("Saved")]);
  });

  async function saveGreeting(addon: StorybookAddon, text: string) {
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    altClick(p);
    await until(() => rows().length > 0);
    control("da").value = text;
    control("da").dispatchEvent(new Event("input", { bubbles: true }));
    inPanel("save").click();
    await until(() => inPanel("status").textContent === "da ✓");
  }

  it("a saved value is what mark hands the next render of that Locale, so a re-render does not undo the save", async () => {
    const { addon } = boot();
    await saveGreeting(addon, "Hej {name}");
    const bundled = { greeting: "Hej", other: "Andet" };
    const marked = addon.mark(bundled, on({ locale: "da" }));
    expect([strip(marked.greeting), decode(marked.greeting)?.key, strip(marked.other), bundled.greeting]).toEqual(["Hej {name}", "greeting", "Andet", "Hej"]);
  });

  it("a saved value is laid over its own Locale only", async () => {
    const { addon } = boot();
    await saveGreeting(addon, "Hej verden");
    expect(strip(addon.mark({ greeting: "Hello" }, on({ locale: "en" })).greeting)).toBe("Hello");
  });

  it("a saved value is never laid over while editing is off", async () => {
    const { addon } = boot();
    await saveGreeting(addon, "Hej verden");
    const bundled = { greeting: "Hej" };
    expect(addon.mark(bundled, { globals: { [EDIT_GLOBAL]: "off", locale: "da" } })).toBe(bundled);
  });

  it("mark hands back the same object until something is saved, so a render is not a new Catalog", async () => {
    const { addon } = boot();
    const bundled = { greeting: "Hej" };
    const before = addon.mark(bundled, on({ locale: "da" }));
    expect(addon.mark(bundled, on({ locale: "da" }))).toBe(before);
    await saveGreeting(addon, "Hej verden");
    const after = addon.mark(bundled, on({ locale: "da" }));
    expect([after === before, addon.mark(bundled, on({ locale: "da" })) === after]).toEqual([false, true]);
  });

  it("a save that was refused is not laid over", async () => {
    const { addon } = boot({ request: async () => new Response("{}", { status: 500 }) });
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    altClick(p);
    await until(() => rows().length > 0);
    control("da").value = "Nej";
    control("da").dispatchEvent(new Event("input", { bubbles: true }));
    inPanel("save").click();
    await until(() => inPanel("status").dataset.kind === "error");
    expect(strip(addon.mark({ greeting: "Hej" }, on({ locale: "da" })).greeting)).toBe("Hej");
  });

  it("never reports usage: a workbench address is not a page of the website", async () => {
    const { addon, request } = boot();
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    altClick(p);
    await until(() => rows().length > 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([]);
  });
});

describe("storybook addon: the Current Locale", () => {
  async function openedIn(context: object, options: Partial<StorybookAddonOptions> = {}) {
    const { addon } = boot(options);
    const p = story();
    addon.decorator(() => undefined, context);
    altClick(p);
    await until(() => rows().length > 0);
    return rows()[0]?.dataset.locale;
  }

  it("is the workbench's locale global, spelled as configured", async () => {
    expect(await openedIn(on({ locale: "DA" }))).toBe("da");
  });

  it("is what the Developer's function answers, when given", async () => {
    expect(await openedIn(on({ locale: "en", language: "da" }), { locale: (context) => String(context.globals?.language) })).toBe("da");
  });

  it("falls back to the document's language", async () => {
    document.documentElement.lang = "da";
    expect(await openedIn(on())).toBe("da");
  });

  it("and then to the Source Locale", async () => {
    expect(await openedIn(on())).toBe("en");
  });
});

describe("storybook addon: a configuration given as an address", () => {
  const served = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  it("is fetched once, from exactly that address, however many stories render", async () => {
    const { addon, request } = boot({ config: `${BASE}/config` });
    story();
    addon.decorator(() => undefined, on());
    addon.decorator(() => undefined, on());
    await until(() => request.mock.calls.length > 0);
    expect(request.mock.calls.map(([url]) => url)).toEqual([`${BASE}/config`]);
  });

  it("drives the panel once it has arrived", async () => {
    const { addon } = boot({ config: `${BASE}/config` });
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    await idle();
    altClick(p);
    await until(() => rows().length === 2);
    expect(rows().map((row) => row.dataset.locale)).toEqual(["da", "en"]);
  });

  it("that cannot be loaded leaves outlines on, says why in the panel and in the console", async () => {
    const { addon } = boot({ config: `${BASE}/config`, request: served({ error: "no" }, 401) });
    const p = story();
    addon.decorator(() => undefined, on());
    await until(() => !inPanel("notice").hidden);
    expect([p.hasAttribute("data-tms-hl"), inPanel("notice").textContent, errors.mock.calls[0]?.[0]]).toEqual([true, expect.stringContaining("401"), expect.stringContaining("[intl-tms]")]);
  });

  it("that cannot be loaded is in the panel's diagnostics too, with the pane opened", async () => {
    const { addon } = boot({ config: `${BASE}/config`, request: served({ error: "no" }, 401) });
    story();
    addon.decorator(() => undefined, on());
    await until(() => !inPanel("notice").hidden);
    expect([inPanel("log").textContent, inPanel<HTMLDetailsElement>("diagnostics").open]).toEqual([expect.stringMatching(/config {2}FAILED\n[\s\S]*401/), true]);
  });

  it("that is not a configuration is refused", async () => {
    const { addon } = boot({ config: `${BASE}/config`, request: served({ hello: "world" }) });
    story();
    addon.decorator(() => undefined, on());
    await until(() => !inPanel("notice").hidden);
    expect(inPanel("notice").textContent).toContain("not an editing configuration");
  });

  it("from a website that speaks a newer protocol is refused", async () => {
    const { addon } = boot({ config: `${BASE}/config`, request: served({ ...config, protocol: config.protocol + 1 }) });
    story();
    addon.decorator(() => undefined, on());
    await until(() => !inPanel("notice").hidden);
    expect(inPanel("notice").textContent).toContain("newer");
  });

  it("is asked for again the next time editing is switched on after a failure", async () => {
    const request = served({}, 500);
    const { addon } = boot({ config: `${BASE}/config`, request });
    story();
    addon.decorator(() => undefined, on());
    await until(() => !inPanel("notice").hidden);
    addon.decorator(() => undefined, off);
    addon.decorator(() => undefined, on());
    await until(() => request.mock.calls.length === 2);
    expect(request.mock.calls).toHaveLength(2);
  });
});

describe("storybook addon: values that were saved somewhere else", () => {
  const reads = (request: { mock: { calls: [string, RequestInit?][] } }, key: string) =>
    request.mock.calls.filter(([url, init]) => url.endsWith(`/keys/${key}`) && (init?.method ?? "GET") === "GET").length;
  const shown = (p: Element) => strip(p.textContent!);

  it("a stored value replaces the bundled text of the story, Marker kept", async () => {
    const { addon, adapter } = boot();
    await adapter.saveValue("greeting", { locale: "da", value: "Hej fra butikken" });
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    await until(() => shown(p) !== "Hej");
    expect([shown(p), decode(p.textContent!)?.key]).toEqual(["Hej fra butikken", "greeting"]);
  });

  it("only the Locale the story is rendered in is shown", async () => {
    const { addon, adapter, request } = boot();
    await adapter.saveValue("greeting", { locale: "en", value: "Hello from the store" });
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    await until(() => reads(request, "greeting") > 0);
    await idle();
    expect(shown(p)).toBe("Hej");
  });

  it("each key is read once, however often the story is scanned or rendered", async () => {
    const { addon, adapter, request } = boot();
    await adapter.saveValue("greeting", { locale: "da", value: "Hej fra butikken" });
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    await until(() => shown(p) !== "Hej");
    addon.decorator(() => undefined, on({ locale: "da" }));
    p.after(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(reads(request, "greeting")).toBe(1);
  });

  it("mark hands the next render the stored value, in every Locale that has one", async () => {
    const { addon, adapter } = boot();
    await adapter.saveValue("greeting", { locale: "da", value: "Hej fra butikken" });
    await adapter.saveValue("greeting", { locale: "en", value: "Hello from the store" });
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    await until(() => shown(p) !== "Hej");
    expect([strip(addon.mark({ greeting: "Hej" }, on({ locale: "da" })).greeting), strip(addon.mark({ greeting: "Hello" }, on({ locale: "en" })).greeting)]).toEqual(["Hej fra butikken", "Hello from the store"]);
  });

  it("a story the framework renders again with the bundled text is corrected again, without another read", async () => {
    const { addon, adapter, request } = boot();
    await adapter.saveValue("greeting", { locale: "da", value: "Hej fra butikken" });
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    await until(() => shown(p) !== "Hej");
    p.textContent = encode("Hej", "greeting");
    await until(() => shown(p) !== "Hej");
    expect([shown(p), reads(request, "greeting")]).toEqual(["Hej fra butikken", 1]);
  });

  it("a stored message only the formatter can render is not written into the story, but mark has it for the next render", async () => {
    const { addon, adapter, request } = boot();
    await adapter.saveValue("greeting", { locale: "da", value: "Hej {name}" });
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    await until(() => reads(request, "greeting") > 0);
    await idle();
    expect([shown(p), strip(addon.mark({ greeting: "Hej" }, on({ locale: "da" })).greeting)]).toEqual(["Hej", "Hej {name}"]);
  });

  it("a bundled message only the formatter can render is never overwritten in place: the story shows part of it", async () => {
    const { addon, adapter, request } = boot();
    await adapter.saveValue("nav", { locale: "da", value: "Til dokumentationen" });
    addon.mark({ nav: "Gå til <a>Docs</a>" }, on({ locale: "da" }));
    const p = story("nav", "Gå til ");
    addon.decorator(() => undefined, on({ locale: "da" }));
    await until(() => reads(request, "nav") > 0);
    await idle();
    expect(shown(p)).toBe("Gå til ");
  });

  it("a read that fails leaves the story as bundled and is not repeated on every scan", async () => {
    const failing = vi.fn(async () => new Response("{}", { status: 500 }));
    const { addon } = boot({ request: failing });
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    await until(() => failing.mock.calls.length > 0);
    p.after(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect([shown(p), failing.mock.calls.length]).toEqual(["Hej", 1]);
  });

  it("a read that failed is tried again the next time editing is switched on", async () => {
    const failing = vi.fn(async () => new Response("{}", { status: 500 }));
    const { addon } = boot({ request: failing });
    story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    await until(() => failing.mock.calls.length > 0);
    addon.decorator(() => undefined, off);
    addon.decorator(() => undefined, on({ locale: "da" }));
    await until(() => failing.mock.calls.length > 1);
    expect(failing.mock.calls).toHaveLength(2);
  });

  it("with a configuration given as an address, values are read once it has arrived", async () => {
    const { addon, adapter } = boot({ config: `${BASE}/config` });
    await adapter.saveValue("greeting", { locale: "da", value: "Hej fra butikken" });
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    await until(() => shown(p) !== "Hej");
    expect(shown(p)).toBe("Hej fra butikken");
  });

  it("a story with many keys is read a few at a time", async () => {
    let inFlight = 0;
    let most = 0;
    const slow = vi.fn(async () => {
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight--;
      return new Response(JSON.stringify({ locales: {} }), { status: 200 });
    });
    const { addon } = boot({ request: slow });
    document.body.innerHTML = Array.from({ length: 20 }, (_, i) => `<p>${encode("x", `k${i}`)}</p>`).join("");
    addon.decorator(() => undefined, on({ locale: "da" }));
    await until(() => slow.mock.calls.length === 20 && inFlight === 0);
    expect([slow.mock.calls.length, most <= 6]).toEqual([20, true]);
  });

  it("saving a key that already had a stored value shows the new value at once, not the one read earlier", async () => {
    const { addon, adapter } = boot();
    await adapter.saveValue("greeting", { locale: "da", value: "Hej fra butikken" });
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    await until(() => shown(p) !== "Hej");
    altClick(p);
    await until(() => control("da")?.value === "Hej fra butikken");
    control("da").value = "Nyeste";
    control("da").dispatchEvent(new Event("input", { bubbles: true }));
    inPanel("save").click();
    await until(() => inPanel("status").textContent === "da ✓");
    await idle();
    expect([shown(p), (await adapter.getValues("greeting")).da?.value]).toEqual(["Nyeste", "Nyeste"]);
  });

  it("a save that is refused leaves the story showing what the store holds", async () => {
    const { addon, adapter } = boot();
    await adapter.saveValue("greeting", { locale: "da", value: "Hej fra butikken" });
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    await until(() => shown(p) !== "Hej");
    altClick(p);
    await until(() => control("da")?.value === "Hej fra butikken");
    await adapter.saveValue("greeting", { locale: "da", value: "Ændret af en anden" });
    control("da").value = "Mit";
    control("da").dispatchEvent(new Event("input", { bubbles: true }));
    inPanel("save").click();
    await until(() => inPanel("status").textContent !== "" && inPanel("status").textContent !== "Saving...");
    await idle();
    expect(shown(p)).toBe("Hej fra butikken");
  });

  it("a value the Editor saves wins over what was read earlier", async () => {
    const { addon, adapter } = boot();
    await adapter.saveValue("greeting", { locale: "da", value: "Hej fra butikken" });
    const p = story();
    addon.decorator(() => undefined, on({ locale: "da" }));
    await until(() => shown(p) !== "Hej");
    altClick(p);
    await until(() => control("da")?.value === "Hej fra butikken");
    control("da").value = "Nyeste";
    control("da").dispatchEvent(new Event("input", { bubbles: true }));
    inPanel("save").click();
    await until(() => inPanel("status").textContent === "da ✓");
    p.textContent = encode("Hej", "greeting");
    await until(() => shown(p) !== "Hej");
    expect(shown(p)).toBe("Nyeste");
  });
});
