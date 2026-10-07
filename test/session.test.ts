// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decode, encode, strip } from "../src/codec.js";
import { createSession, type Session } from "../src/session.js";
import { deferred, fakes, ok } from "./support/session-fakes.js";

const mark = (value: string, key: string) => encode(value, key);
const byId = (id: string) => document.getElementById(id)!;
const click = (target: Element, init: MouseEventInit = {}) => target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let session: Session | undefined;
const build = (parts: ReturnType<typeof fakes>, extra: { getLocale?: () => string; onScan?: (found: readonly unknown[]) => void } = {}) =>
  (session = createSession({ sink: parts.sink, client: parts.client, getConfig: () => undefined, getLocale: extra.getLocale ?? (() => "da"), ...(extra.onScan === undefined ? {} : { onScan: extra.onScan }) }));

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});
afterEach(() => {
  session?.stop();
  session = undefined;
  vi.useRealTimers();
});

describe("session: starting and opening", () => {
  it("E1: started on a root with one marked paragraph, it is highlighted", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    build(fakes()).start(document);
    expect(byId("p").hasAttribute("data-tms-hl")).toBe(true);
  });

  it("E2: clicking that paragraph tells the sink to open its key", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "nav.home")}</p>`;
    const parts = fakes();
    build(parts).start(document);
    click(byId("p"));
    expect(parts.sink.open).toHaveBeenCalledWith("nav.home", "da", "Hi");
  });

  it("E3: it opens with the Current Locale", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const parts = fakes();
    build(parts, { getLocale: () => "es" }).start(document);
    click(byId("p"));
    expect(parts.sink.open.mock.calls[0]?.[1]).toBe("es");
  });

  it("E4: it opens with the on-page value, Markers stripped", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi there", "k")}</p>`;
    const parts = fakes();
    build(parts).start(document);
    click(byId("p"));
    expect(parts.sink.open.mock.calls[0]?.[2]).toBe("Hi there");
  });

  it("opening reads the current text, not the text at scan time", () => {
    document.body.innerHTML = `<p id="p">${mark("old", "k")}</p>`;
    const parts = fakes();
    build(parts).start(document);
    byId("p").firstChild!.textContent = mark("changed since the scan", "k");
    click(byId("p"));
    expect(parts.sink.open.mock.calls[0]?.[2]).toBe("changed since the scan");
  });

  it("opening makes the translation the active one on the page", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    build(fakes()).start(document);
    click(byId("p"));
    expect(byId("p").hasAttribute("data-tms-hl-active")).toBe(true);
  });

  it("E5: the sink is told to open before any client call", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const parts = fakes({ values: new Promise(() => undefined), usage: new Promise(() => undefined) });
    build(parts).start(document);
    click(byId("p"));
    expect(parts.log).toEqual(["sink.open:k", "client.readValues:k", "client.readUsage:k"]);
  });

  it("SES-4: values and usages are requested together, not one after the other", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const parts = fakes({ values: new Promise(() => undefined), usage: new Promise(() => undefined) });
    build(parts).start(document);
    click(byId("p"));
    expect([parts.client.readValues.mock.calls.length, parts.client.readUsage.mock.calls.length]).toEqual([1, 1]);
  });

  it("E10: the read is called with the on-page value as the fallback for the Current Locale", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const parts = fakes();
    build(parts).start(document);
    click(byId("p"));
    expect(parts.client.readValues).toHaveBeenCalledWith("k", { locale: "da", value: "Hi" });
  });

  it("E6: when values resolve the sink receives them for that key", async () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const values = { meta: { sourceMessage: "Hi" }, locales: { da: { value: "Hej" } } };
    const parts = fakes({ values: Promise.resolve(ok(values)) });
    build(parts).start(document);
    click(byId("p"));
    await flush();
    expect(parts.sink.setValues).toHaveBeenCalledWith("k", values, false);
  });

  it("E7: when usages resolve the sink receives them for that key", async () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const usages = [{ key: "k", source: "runtime" as const, url: "https://app.test/p", count: 1, lastSeen: "2026-01-01T00:00:00.000Z" }];
    const parts = fakes({ usage: Promise.resolve({ usages, error: false, configured: true }) });
    build(parts).start(document);
    click(byId("p"));
    await flush();
    expect(parts.sink.setUsage).toHaveBeenCalledWith("k", usages, false);
  });

  it("E8: a values read that errors reaches the sink as empty values with the error flag", async () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const parts = fakes({ values: Promise.resolve({ values: { locales: {} }, error: true }) });
    build(parts).start(document);
    click(byId("p"));
    await flush();
    expect(parts.sink.setValues).toHaveBeenCalledWith("k", { locales: {} }, true);
  });

  it("SES-6: a client that throws reaches the sink as an error, never as an exception", async () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const parts = fakes({ values: Promise.reject(new Error("boom")) });
    build(parts).start(document);
    click(byId("p"));
    await flush();
    expect(parts.sink.setValues).toHaveBeenCalledWith("k", { locales: {} }, true);
  });

  it("a usage read that fails reaches the sink with the error flag", async () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const parts = fakes({ usage: Promise.resolve({ usages: [], error: true, configured: true }) });
    build(parts).start(document);
    click(byId("p"));
    await flush();
    expect(parts.sink.setUsage).toHaveBeenCalledWith("k", [], true);
  });

  it("E9: a usage endpoint that is not configured reaches the sink as an empty list with no error", async () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const parts = fakes({ usage: Promise.resolve({ usages: [], error: false, configured: false }) });
    build(parts).start(document);
    click(byId("p"));
    await flush();
    expect(parts.sink.setUsage).toHaveBeenCalledWith("k", [], false);
  });

  it("an answer for a translation that is no longer open is not forwarded", async () => {
    document.body.innerHTML = `<p id="p1">${mark("a", "k1")}</p><p id="p2">${mark("b", "k2")}</p>`;
    const slow = deferred<ReturnType<typeof ok>>();
    const parts = fakes({ values: slow.promise });
    build(parts).start(document);
    click(byId("p1"));
    click(byId("p2"));
    slow.resolve(ok());
    await flush();
    expect(parts.sink.setValues.mock.calls.map((c) => c[0])).toEqual(["k2"]);
  });

  it("starting again rescans rather than stacking a second highlighter", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const parts = fakes();
    const s = build(parts);
    s.start(document);
    s.start(document);
    click(byId("p"));
    expect(parts.sink.open).toHaveBeenCalledTimes(1);
  });
});

describe("session: elements with several translations", () => {
  const two = () => {
    document.body.innerHTML = `<a id="a" title="${mark("Tip", "k.tip")}">${mark("Link", "k.text")}</a>`;
    const parts = fakes();
    build(parts).start(document);
    return parts;
  };
  const menuRows = () => [...document.querySelectorAll("[data-tms-picker] [data-tms-picker-row]")] as HTMLElement[];

  it("E11: clicking it opens a picker and opens nothing yet", () => {
    const parts = two();
    click(byId("a"));
    expect([menuRows().length, parts.sink.open.mock.calls.length]).toEqual([2, 0]);
  });

  it("the picker rows are labelled text and the attribute name", () => {
    two();
    click(byId("a"));
    expect(menuRows().map((row) => row.querySelector("strong")?.textContent)).toEqual(["title", "text"]);
  });

  it("E12: a picker choice opens that translation", async () => {
    const parts = two();
    click(byId("a"));
    menuRows()[0]!.click();
    await flush();
    expect(parts.sink.open).toHaveBeenCalledWith("k.tip", "da", "Tip");
  });

  it("dismissing the picker opens nothing", () => {
    const parts = two();
    click(byId("a"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(parts.sink.open).not.toHaveBeenCalled();
  });

  it("the picker opens at the click position", () => {
    two();
    click(byId("a"), { clientX: 30, clientY: 50 });
    const style = (document.querySelector("[data-tms-picker]") as HTMLElement).style;
    expect([style.left, style.top]).toEqual(["30px", "50px"]);
  });
});

describe("session: Hidden translations", () => {
  const hiddenPage = () => {
    document.body.innerHTML = `<button id="b" aria-label="${mark("Close", "a.close")}">x</button><p id="p">${mark("Hi", "k")}</p><img id="i" alt="${mark("Logo", "a.logo")}">`;
  };
  const lastHidden = (parts: ReturnType<typeof fakes>) => parts.sink.setHidden.mock.calls.at(-1)?.[0];

  it("E13: a root with marked attributes sends the sink a Hidden list in document order", () => {
    hiddenPage();
    const parts = fakes();
    build(parts).start(document);
    expect(lastHidden(parts)?.map(({ attribute, key, value }) => [attribute, key, value])).toEqual([
      ["aria-label", "a.close", "Close"],
      ["alt", "a.logo", "Logo"],
    ]);
  });

  it("the Hidden list holds attribute translations only", () => {
    hiddenPage();
    const parts = fakes();
    build(parts).start(document);
    expect(lastHidden(parts)?.some((item) => item.key === "k")).toBe(false);
  });

  it("a page with no attribute translations tells the sink nothing", () => {
    document.body.innerHTML = `<p>${mark("Hi", "k")}</p>`;
    const parts = fakes();
    build(parts).start(document);
    expect(parts.sink.setHidden).not.toHaveBeenCalled();
  });

  it("E14: a rescan that finds the same Hidden items does not tell the sink again", () => {
    hiddenPage();
    const parts = fakes();
    const s = build(parts);
    s.start(document);
    s.start(document);
    expect(parts.sink.setHidden).toHaveBeenCalledTimes(1);
  });

  it("E15: a Hidden item whose value changed is sent again", () => {
    hiddenPage();
    const parts = fakes();
    const s = build(parts);
    s.start(document);
    byId("b").setAttribute("aria-label", mark("Dismiss", "a.close"));
    s.start(document);
    expect(lastHidden(parts)?.[0]?.value).toBe("Dismiss");
  });

  it("when the last Hidden item disappears the sink is told the list is empty", () => {
    hiddenPage();
    const parts = fakes();
    const s = build(parts);
    s.start(document);
    byId("b").remove();
    byId("i").remove();
    s.start(document);
    expect(lastHidden(parts)).toEqual([]);
  });

  it("SES-14: an item keeps its id across a rescan while its element survives", () => {
    hiddenPage();
    const parts = fakes();
    const s = build(parts);
    s.start(document);
    const before = lastHidden(parts)?.[0]?.id;
    byId("b").setAttribute("aria-label", mark("Dismiss", "a.close"));
    s.start(document);
    expect(lastHidden(parts)?.[0]?.id).toBe(before);
  });

  it("E16: opening a Hidden item opens its key exactly as a click would", () => {
    hiddenPage();
    const parts = fakes();
    const s = build(parts);
    s.start(document);
    s.openHidden(lastHidden(parts)![1]!.id);
    expect(parts.sink.open).toHaveBeenCalledWith("a.logo", "da", "Logo");
  });

  it("SES-14: an id from before a rescan still opens the right item", () => {
    hiddenPage();
    const parts = fakes();
    const s = build(parts);
    s.start(document);
    const id = lastHidden(parts)![1]!.id;
    byId("p").remove();
    s.start(document);
    s.openHidden(id);
    expect(parts.sink.open.mock.calls[0]?.[0]).toBe("a.logo");
  });

  it("an id whose element has gone opens nothing and does not throw", () => {
    hiddenPage();
    const parts = fakes();
    const s = build(parts);
    s.start(document);
    const id = lastHidden(parts)![0]!.id;
    byId("b").remove();
    s.start(document);
    expect(() => s.openHidden(id)).not.toThrow();
    expect(parts.sink.open).not.toHaveBeenCalled();
  });

  it("E17: flashing a Hidden item flashes its element", () => {
    hiddenPage();
    const parts = fakes();
    const s = build(parts);
    s.start(document);
    s.flashHidden(lastHidden(parts)![0]!.id);
    expect(byId("b").hasAttribute("data-tms-hl-flash")).toBe(true);
  });

  it("flashing an id that no longer exists does not throw", () => {
    hiddenPage();
    const s = build(fakes());
    s.start(document);
    expect(() => s.flashHidden("nope")).not.toThrow();
  });
});

describe("session: scans and stopping", () => {
  it("E29: every scan hands the scan callback its findings", () => {
    document.body.innerHTML = `<p>${mark("a", "k1")}</p>`;
    const onScan = vi.fn();
    const s = build(fakes(), { onScan });
    s.start(document);
    s.start(document);
    expect(onScan).toHaveBeenCalledTimes(2);
  });

  it("E29: a scan the page's own mutation triggered is reported too", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="root"></div>`;
    const onScan = vi.fn();
    build(fakes(), { onScan }).start(document);
    onScan.mockClear();
    const p = document.createElement("p");
    p.textContent = mark("new", "k9");
    byId("root").appendChild(p);
    await vi.advanceTimersByTimeAsync(100);
    expect(onScan.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("E30: stopping leaves no element highlighted", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const s = build(fakes());
    s.start(document);
    s.stop();
    expect(document.querySelector("[data-tms-hl]")).toBeNull();
  });

  it("E31: stopping tells the sink nothing", () => {
    document.body.innerHTML = `<button aria-label="${mark("Close", "a")}">x</button><p id="p">${mark("Hi", "k")}</p>`;
    const parts = fakes();
    const s = build(parts);
    s.start(document);
    click(byId("p"));
    const before = [parts.sink.open.mock.calls.length, parts.sink.setHidden.mock.calls.length];
    s.stop();
    expect([parts.sink.open.mock.calls.length, parts.sink.setHidden.mock.calls.length]).toEqual(before);
  });

  it("an answer that arrives after stop is not forwarded", async () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const slow = deferred<ReturnType<typeof ok>>();
    const parts = fakes({ values: slow.promise });
    const s = build(parts);
    s.start(document);
    click(byId("p"));
    s.stop();
    slow.resolve(ok());
    await flush();
    expect(parts.sink.setValues).not.toHaveBeenCalled();
  });

  it("stopping closes an open picker", () => {
    document.body.innerHTML = `<a id="a" title="${mark("Tip", "k1")}">${mark("Link", "k2")}</a>`;
    const s = build(fakes());
    s.start(document);
    click(byId("a"));
    s.stop();
    expect(document.querySelector("[data-tms-picker]")).toBeNull();
  });

  it("after a stop the Hidden list is forgotten, so a restart tells the sink again", () => {
    document.body.innerHTML = `<button aria-label="${mark("Close", "a")}">x</button>`;
    const parts = fakes();
    const s = build(parts);
    s.start(document);
    s.stop();
    s.start(document);
    expect(parts.sink.setHidden).toHaveBeenCalledTimes(2);
  });

  it("stopping twice is harmless", () => {
    const s = build(fakes());
    s.stop();
    expect(() => s.stop()).not.toThrow();
  });
});

describe("session: saving", () => {
  const saved = (...locales: string[]) => Promise.resolve({ ok: true, results: Object.fromEntries(locales.map((l) => [l, { ok: true, status: 200 }])) });
  const failed = (locale: string) => Promise.resolve({ ok: false, results: { [locale]: { ok: false, status: 500, message: "x" } } });
  const textPage = () => {
    document.body.innerHTML = `<p id="p">${mark("Old", "k")}</p>`;
  };
  const openP = (parts: ReturnType<typeof fakes>, getLocale = () => "da") => {
    const s = build(parts, { getLocale });
    s.start(document);
    click(byId("p"));
    return s;
  };

  it("E18: a save for a key that is not the active translation is refused as a stale selection", async () => {
    textPage();
    const s = openP(fakes());
    expect(await s.save("other", { da: { value: "x" } })).toEqual({ ok: false, error: "stale-selection", results: {}, page: "untouched" });
  });

  it("a save before anything is open is refused as a stale selection", async () => {
    textPage();
    const s = build(fakes());
    s.start(document);
    expect((await s.save("k", { da: { value: "x" } })).error).toBe("stale-selection");
  });

  it("E19: a refused save never reaches the client", async () => {
    textPage();
    const parts = fakes();
    await openP(parts).save("other", { da: { value: "x" } });
    expect(parts.client.save).not.toHaveBeenCalled();
  });

  it("SES-22: the writes go through the client with the key", async () => {
    textPage();
    const parts = fakes({ save: saved("da") });
    await openP(parts).save("k", { da: { value: "New" } });
    expect(parts.client.save).toHaveBeenCalledWith("k", { da: { value: "New" } });
  });

  it("the outcome carries the client's per-Locale result", async () => {
    textPage();
    const outcome = await openP(fakes({ save: saved("da") })).save("k", { da: { value: "New" } });
    expect(outcome.results).toEqual({ da: { ok: true, status: 200 } });
  });

  it("E20: a Plain value for the Current Locale that saved updates the page", async () => {
    textPage();
    expect((await openP(fakes({ save: saved("da") })).save("k", { da: { value: "New" } })).page).toBe("updated");
  });

  it("E21: the text node then shows the new value", async () => {
    textPage();
    await openP(fakes({ save: saved("da") })).save("k", { da: { value: "New" } });
    expect(strip(byId("p").textContent!)).toBe("New");
  });

  it("E22: the text node still carries a Marker for the key", async () => {
    textPage();
    await openP(fakes({ save: saved("da") })).save("k", { da: { value: "New" } });
    expect(decode(byId("p").textContent!)?.key).toBe("k");
  });

  it("the saved translation stays outlined and clickable for the next edit", async () => {
    textPage();
    const parts = fakes({ save: saved("da") });
    await openP(parts).save("k", { da: { value: "New" } });
    click(byId("p"));
    expect(parts.sink.open).toHaveBeenLastCalledWith("k", "da", "New");
  });

  it("E23: an attribute translation shows the new value in its attribute, with its Marker", async () => {
    document.body.innerHTML = `<button id="b" aria-label="${mark("Close", "a.close")}">x</button>`;
    const parts = fakes({ save: saved("da") });
    const s = build(parts);
    s.start(document);
    s.openHidden(parts.sink.setHidden.mock.calls[0]![0][0]!.id);
    await s.save("a.close", { da: { value: "Dismiss" } });
    expect([strip(byId("b").getAttribute("aria-label")!), decode(byId("b").getAttribute("aria-label")!)?.key]).toEqual(["Dismiss", "a.close"]);
  });

  it("E24: a value with a tag for the Current Locale is stored but leaves the page stale", async () => {
    textPage();
    expect((await openP(fakes({ save: saved("da") })).save("k", { da: { value: "Go to <a>Docs</a>" } })).page).toBe("stale");
  });

  it("E25: and the page text is unchanged", async () => {
    textPage();
    await openP(fakes({ save: saved("da") })).save("k", { da: { value: "Go to <a>Docs</a>" } });
    expect(strip(byId("p").textContent!)).toBe("Old");
  });

  it("a value with an argument is not written into the page either", async () => {
    textPage();
    const outcome = await openP(fakes({ save: saved("da") })).save("k", { da: { value: "Hello {name}" } });
    expect([outcome.page, strip(byId("p").textContent!)]).toEqual(["stale", "Old"]);
  });

  it("E26: a save of other Locales only leaves the page untouched", async () => {
    textPage();
    expect((await openP(fakes({ save: saved("es") })).save("k", { es: { value: "Hola" } })).page).toBe("untouched");
  });

  it("E27: a save in which the Current Locale failed leaves the page untouched", async () => {
    textPage();
    expect((await openP(fakes({ save: failed("da") })).save("k", { da: { value: "New" } })).page).toBe("untouched");
  });

  it("a failed save does not change the page text", async () => {
    textPage();
    await openP(fakes({ save: failed("da") })).save("k", { da: { value: "New" } });
    expect(strip(byId("p").textContent!)).toBe("Old");
  });

  it("a save of only Fields for the Current Locale leaves the page untouched", async () => {
    textPage();
    expect((await openP(fakes({ save: saved("da") })).save("k", { da: { fields: { status: "draft" } } })).page).toBe("untouched");
  });

  it("a whole-save failure leaves the page untouched", async () => {
    textPage();
    const parts = fakes({ save: Promise.resolve({ ok: false, error: "config-not-loaded", results: {} }) });
    expect((await openP(parts).save("k", { da: { value: "New" } })).page).toBe("untouched");
  });

  it("a client that throws on save is reported as a failed save and never throws", async () => {
    textPage();
    const parts = fakes({ save: Promise.reject(new Error("boom")) });
    const outcome = await openP(parts).save("k", { da: { value: "New" } });
    expect([outcome.ok, outcome.page]).toEqual([false, "untouched"]);
  });

  it("E28: a Hidden item saved with a Plain value is in the next Hidden list the sink receives", async () => {
    document.body.innerHTML = `<button id="b" aria-label="${mark("Close", "a.close")}">x</button>`;
    const parts = fakes({ save: saved("da") });
    const s = build(parts);
    s.start(document);
    s.openHidden(parts.sink.setHidden.mock.calls[0]![0][0]!.id);
    await s.save("a.close", { da: { value: "Dismiss" } });
    expect(parts.sink.setHidden.mock.calls.at(-1)?.[0][0]?.value).toBe("Dismiss");
  });

  it("E32: the Current Locale is read at save time, not at open time", async () => {
    textPage();
    let locale = "da";
    const s = openP(fakes({ save: saved("es") }), () => locale);
    locale = "es";
    expect((await s.save("k", { es: { value: "Hola" } })).page).toBe("updated");
  });

  it("E32: a save for the Locale that was current at open time but is no longer is untouched", async () => {
    textPage();
    let locale = "da";
    const s = openP(fakes({ save: saved("da") }), () => locale);
    locale = "es";
    expect((await s.save("k", { da: { value: "New" } })).page).toBe("untouched");
  });

  it("E33: a key rendered twice has both Occurrences updated when saved Plain", async () => {
    document.body.innerHTML = `<p id="p1">${mark("Old", "k")}</p><footer><p id="p2">${mark("Old", "k")}</p></footer>`;
    const parts = fakes({ save: saved("da") });
    const s = build(parts);
    s.start(document);
    click(byId("p1"));
    await s.save("k", { da: { value: "New" } });
    expect([strip(byId("p1").textContent!), strip(byId("p2").textContent!)]).toEqual(["New", "New"]);
  });

  it("only Occurrences of the saved key are updated", async () => {
    document.body.innerHTML = `<p id="p1">${mark("Old", "k")}</p><p id="p2">${mark("Other", "k2")}</p>`;
    const parts = fakes({ save: saved("da") });
    const s = build(parts);
    s.start(document);
    click(byId("p1"));
    await s.save("k", { da: { value: "New" } });
    expect(strip(byId("p2").textContent!)).toBe("Other");
  });

  it("SES-28: the session rescans straight after writing instead of waiting for the debounce", async () => {
    textPage();
    const onScan = vi.fn();
    const s = build(fakes({ save: saved("da") }), { onScan });
    s.start(document);
    click(byId("p"));
    onScan.mockClear();
    await s.save("k", { da: { value: "New" } });
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("the write itself does not schedule a second rescan", async () => {
    vi.useFakeTimers();
    textPage();
    const onScan = vi.fn();
    const s = build(fakes({ save: saved("da") }), { onScan });
    s.start(document);
    click(byId("p"));
    onScan.mockClear();
    await s.save("k", { da: { value: "New" } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(onScan).toHaveBeenCalledTimes(1);
  });
});
