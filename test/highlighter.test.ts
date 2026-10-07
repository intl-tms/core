// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "../src/codec.js";
import { createHighlighter, DEFAULT_COLORS, highlightSettings, type Highlighter, type HighlighterOptions } from "../src/highlighter.js";

const mark = (value: string, key: string) => encode(value, key);
const HL = "data-tms-hl";
const HL_ATTR = "data-tms-hl-attr";
const HL_ACTIVE = "data-tms-hl-active";
const HL_FLASH = "data-tms-hl-flash";

let highlighter: Highlighter | undefined;
const make = (options: Partial<HighlighterOptions> = {}): Highlighter => (highlighter = createHighlighter({ onClick: () => undefined, ...options }));
const byId = (id: string) => document.getElementById(id)!;
const styleText = () => document.querySelector("style[data-tms-hl-style]")?.textContent ?? "";
const rule = (selector: string) => new RegExp(`${selector.replace(/[[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(styleText())?.[1] ?? "";

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});
afterEach(() => {
  highlighter?.clear();
  highlighter = undefined;
  vi.useRealTimers();
});

describe("highlighter: highlighting", () => {
  it("L1: a scan over one marked paragraph marks it with the highlighted attribute", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    make().scan(document);
    expect(byId("p").hasAttribute(HL)).toBe(true);
  });

  it("L2: the highlighted rule outlines solid in the resting colour", () => {
    document.body.innerHTML = `<p>${mark("Hi", "k")}</p>`;
    make().scan(document);
    expect(rule(`[${HL}]`)).toContain(`outline: 2px solid ${DEFAULT_COLORS.highlight}`);
  });

  it("the highlighted rule offsets the outline by 2px and shows a pointer", () => {
    document.body.innerHTML = `<p>${mark("Hi", "k")}</p>`;
    make().scan(document);
    expect([rule(`[${HL}]`).includes("outline-offset: 2px"), rule(`[${HL}]`).includes("cursor: pointer")]).toEqual([true, true]);
  });

  it("an element with visible text does not carry the attribute-only marker", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    make().scan(document);
    expect(byId("p").hasAttribute(HL_ATTR)).toBe(false);
  });

  it("L3: an element with only a marked attribute is outlined dashed", () => {
    document.body.innerHTML = `<button id="b" aria-label="${mark("Close", "k")}">x</button>`;
    make().scan(document);
    expect(rule(`[${HL_ATTR}]`)).toContain("outline-style: dashed");
  });

  it("L4: the same element carries the attribute-only marker attribute", () => {
    document.body.innerHTML = `<button id="b" aria-label="${mark("Close", "k")}">x</button>`;
    make().scan(document);
    expect([byId("b").hasAttribute(HL), byId("b").hasAttribute(HL_ATTR)]).toEqual([true, true]);
  });

  it("an element with both visible text and an attribute translation is solid, not attribute-only", () => {
    document.body.innerHTML = `<a id="a" title="${mark("Tip", "k1")}">${mark("Link", "k2")}</a>`;
    make().scan(document);
    expect(byId("a").hasAttribute(HL_ATTR)).toBe(false);
  });

  it("the default attribute set is scanned without any configuration", () => {
    document.body.innerHTML = `<img id="i" alt="${mark("Logo", "k")}">`;
    make().scan(document);
    expect(byId("i").hasAttribute(HL)).toBe(true);
  });

  it("an attribute the configuration adds is scanned as well as the defaults", () => {
    document.body.innerHTML = `<div id="d" data-tooltip="${mark("Tip", "k1")}"></div><img id="i" alt="${mark("Logo", "k2")}">`;
    make({ getConfig: () => ({ scanAttributes: ["data-tooltip"] }) }).scan(document);
    expect([byId("d").hasAttribute(HL), byId("i").hasAttribute(HL)]).toEqual([true, true]);
  });

  it("L5: after a marked node is removed and the page rescanned the old element loses the highlight attribute", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const h = make();
    h.scan(document);
    const old = byId("p");
    old.firstChild!.textContent = "plain";
    h.scan(document);
    expect(old.hasAttribute(HL)).toBe(false);
  });

  it("L6: the removed highlight is no longer in the readable set", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const h = make();
    h.scan(document);
    byId("p").remove();
    h.scan(document);
    expect(h.highlights().size).toBe(0);
  });

  it("the readable set holds each highlighted element with its translations", () => {
    document.body.innerHTML = `<a id="a" title="${mark("Tip", "k1")}">${mark("Link", "k2")}</a>`;
    const h = make();
    h.scan(document);
    expect(h.highlights().get(byId("a"))?.map((f) => f.key)).toEqual(["k1", "k2"]);
  });

  it("scan returns what it found", () => {
    document.body.innerHTML = `<p>${mark("a", "k1")}</p><p>${mark("b", "k2")}</p>`;
    expect(make().scan(document).map((f) => f.key)).toEqual(["k1", "k2"]);
  });

  it("L23: a scan does not modify the inline style of any element", () => {
    document.body.innerHTML = `<p id="p" style="color: red">${mark("Hi", "k")}</p>`;
    make().scan(document);
    expect(byId("p").getAttribute("style")).toBe("color: red");
  });

  it("L23: an element with no inline style gets none", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    make().scan(document);
    expect(byId("p").hasAttribute("style")).toBe(false);
  });

  it("a second scan does not add a second stylesheet", () => {
    document.body.innerHTML = `<p>${mark("Hi", "k")}</p>`;
    const h = make();
    h.scan(document);
    h.scan(document);
    expect(document.querySelectorAll("style[data-tms-hl-style]")).toHaveLength(1);
  });

  it("the marker attribute names are configurable", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    make({ attributes: { highlight: "data-x-hl" } }).scan(document);
    expect(byId("p").hasAttribute("data-x-hl")).toBe(true);
  });
});

describe("highlighter: the stylesheet is valid CSS", () => {
  const sheet = () => {
    document.body.innerHTML = `<p>${mark("Hi", "k")}</p>`;
    make().scan(document);
    return (document.querySelector("style[data-tms-hl-style]") as HTMLStyleElement).sheet!;
  };

  it("a CSS parser reads every rule", () => {
    expect(sheet().cssRules).toHaveLength(5);
  });

  it("the rules select on the marker attributes", () => {
    expect([...sheet().cssRules].map((r) => (r as CSSStyleRule).selectorText)).toEqual([
      `[${HL}]`,
      `[${HL_ATTR}]`,
      `[${HL_ACTIVE}]`,
      `[${HL_FLASH}]`,
      `[${HL_FLASH}][${HL_ATTR}]`,
    ]);
  });

  it("a browser-grade cascade gives a highlighted element the resting outline colour", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    make().scan(document);
    expect(getComputedStyle(byId("p")).outlineColor).not.toBe("");
  });
});

describe("highlight settings", () => {
  it("the defaults apply when nothing is configured", () => {
    expect(highlightSettings(undefined).colors).toEqual({ highlight: "#4CAF50", active: "#2196F3" });
  });

  it("a configured colour overrides one default and keeps the other", () => {
    expect(highlightSettings({ colors: { active: "#ff0000" } }).colors).toEqual({ highlight: "#4CAF50", active: "#ff0000" });
  });

  it("the built-in attribute set is always scanned", () => {
    expect(highlightSettings({ scanAttributes: ["data-tooltip"] }).scanAttributes).toEqual(["aria-label", "alt", "title", "placeholder", "data-tooltip"]);
  });

  it("a configured attribute that is already built in appears once", () => {
    expect(highlightSettings({ scanAttributes: ["alt"] }).scanAttributes).toEqual(["aria-label", "alt", "title", "placeholder"]);
  });

  it("a colour that could break out of a declaration falls back to the default", () => {
    expect(highlightSettings({ colors: { highlight: "red; } body { display: none" } }).colors.highlight).toBe("#4CAF50");
  });

  it.each(["#4CAF50", "rgb(10, 20, 30)", "hsl(120 40% 50% / 0.5)", "rebeccapurple"])("a legitimate colour %s is kept", (colour) => {
    expect(highlightSettings({ colors: { highlight: colour } }).colors.highlight).toBe(colour);
  });
});

const click = (target: Element): MouseEvent => {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe("highlighter: click routing", () => {
  it("L7: two scans then one click fires the callback once", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const onClick = vi.fn();
    const h = make({ onClick });
    h.scan(document);
    h.scan(document);
    click(byId("p"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("L8: a click on a highlighted link has its default prevented", () => {
    document.body.innerHTML = `<a id="a" href="/next">${mark("Go", "k")}</a>`;
    make().scan(document);
    expect(click(byId("a")).defaultPrevented).toBe(true);
  });

  it("a click on a highlighted element does not propagate to the page's own handlers", () => {
    document.body.innerHTML = `<button id="b">${mark("Buy", "k")}</button>`;
    const pageHandler = vi.fn();
    byId("b").addEventListener("click", pageHandler);
    make().scan(document);
    click(byId("b"));
    expect(pageHandler).not.toHaveBeenCalled();
  });

  it("L9: a click on an element with two translations hands over both", () => {
    document.body.innerHTML = `<a id="a" title="${mark("Tip", "k1")}">${mark("Link", "k2")}</a>`;
    const onClick = vi.fn();
    make({ onClick }).scan(document);
    click(byId("a"));
    expect(onClick.mock.calls[0]![0].map((f: { key: string }) => f.key)).toEqual(["k1", "k2"]);
  });

  it("the callback receives the click event", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const onClick = vi.fn();
    make({ onClick }).scan(document);
    const event = click(byId("p"));
    expect(onClick.mock.calls[0]![1]).toBe(event);
  });

  it("a click on an element that is not highlighted is left alone", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p><span id="other">plain</span>`;
    const onClick = vi.fn();
    make({ onClick }).scan(document);
    expect([click(byId("other")).defaultPrevented, onClick.mock.calls.length]).toEqual([false, 0]);
  });

  it("a click on a descendant of a highlighted element routes to it", () => {
    document.body.innerHTML = `<a id="a">${mark("Go ", "k")}<b id="b">now</b></a>`;
    const onClick = vi.fn();
    make({ onClick }).scan(document);
    click(byId("b"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a click on a descendant is prevented as well", () => {
    document.body.innerHTML = `<a id="a" href="/x">${mark("Go ", "k")}<b id="b">now</b></a>`;
    make().scan(document);
    expect(click(byId("b")).defaultPrevented).toBe(true);
  });

  it("after a rescan removes a highlight a click on that element is no longer routed", () => {
    document.body.innerHTML = `<p id="p">${mark("Hi", "k")}</p>`;
    const onClick = vi.fn();
    const h = make({ onClick });
    h.scan(document);
    byId("p").firstChild!.textContent = "plain";
    h.scan(document);
    click(byId("p"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("adds one listener to the root, not one per element", () => {
    document.body.innerHTML = `<p>${mark("a", "k1")}</p><p>${mark("b", "k2")}</p><p>${mark("c", "k3")}</p>`;
    const add = vi.spyOn(Element.prototype, "addEventListener");
    make().scan(document);
    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
  });

  it("a click after clear is no longer intercepted", () => {
    document.body.innerHTML = `<a id="a" href="/x">${mark("Go", "k")}</a>`;
    const h = make();
    h.scan(document);
    h.clear();
    expect(click(byId("a")).defaultPrevented).toBe(false);
  });
});

describe("highlighter: the active translation", () => {
  const two = () => {
    document.body.innerHTML = `<p id="p1">${mark("a", "k1")}</p><p id="p2">${mark("b", "k2")}</p>`;
    const h = make();
    const [first, second] = h.scan(document);
    return { h, first: first!, second: second! };
  };

  it("L10: setting a translation active marks its element active", () => {
    const { h, first } = two();
    h.setActive(first);
    expect(byId("p1").hasAttribute(HL_ACTIVE)).toBe(true);
  });

  it("L10: the active rule recolours in the active colour", () => {
    const { h, first } = two();
    h.setActive(first);
    expect(rule(`[${HL_ACTIVE}]`)).toContain(`outline-color: ${DEFAULT_COLORS.active}`);
  });

  it("HL-12: the active translation is readable", () => {
    const { h, first } = two();
    h.setActive(first);
    expect(h.active()).toBe(first);
  });

  it("with nothing set there is no active translation", () => {
    expect(two().h.active()).toBeUndefined();
  });

  it("L11: activating a second element returns the first to its resting outline", () => {
    const { h, first, second } = two();
    h.setActive(first);
    h.setActive(second);
    expect([byId("p1").hasAttribute(HL_ACTIVE), byId("p2").hasAttribute(HL_ACTIVE)]).toEqual([false, true]);
  });

  it("the previously active element keeps its resting highlight", () => {
    const { h, first, second } = two();
    h.setActive(first);
    h.setActive(second);
    expect(byId("p1").hasAttribute(HL)).toBe(true);
  });

  it("setting nothing active clears the outline", () => {
    const { h, first } = two();
    h.setActive(first);
    h.setActive(undefined);
    expect([byId("p1").hasAttribute(HL_ACTIVE), h.active()]).toEqual([false, undefined]);
  });

  it("HL-13: a rescan preserves the active outline on the active element", () => {
    const { h, first } = two();
    h.setActive(first);
    h.scan(document);
    expect(byId("p1").hasAttribute(HL_ACTIVE)).toBe(true);
  });

  it("HL-13: a rescan keeps the active translation readable", () => {
    const { h, first } = two();
    h.setActive(first);
    h.scan(document);
    expect(h.active()?.key).toBe("k1");
  });

  it("L12: a colour changed between two scans is used by the second scan", () => {
    document.body.innerHTML = `<p>${mark("a", "k1")}</p>`;
    let colors = { highlight: "#111111" };
    const h = make({ getConfig: () => ({ colors }) });
    h.scan(document);
    colors = { highlight: "#222222" };
    h.scan(document);
    expect(rule(`[${HL}]`)).toContain("#222222");
  });

  it("L12: the first scan used the colour configured then", () => {
    document.body.innerHTML = `<p>${mark("a", "k1")}</p>`;
    make({ getConfig: () => ({ colors: { highlight: "#111111" } }) }).scan(document);
    expect(rule(`[${HL}]`)).toContain("#111111");
  });

  it("L12: a configuration that arrives after construction takes effect on the next scan", () => {
    document.body.innerHTML = `<p>${mark("a", "k1")}</p>`;
    const served: { config?: { colors: { highlight: string } } } = {};
    const h = make({ getConfig: () => served.config });
    h.scan(document);
    served.config = { colors: { highlight: "#333333" } };
    h.scan(document);
    expect(rule(`[${HL}]`)).toContain("#333333");
  });
});

describe("highlighter: following the page", () => {
  const setup = (html = '<div id="root"></div>') => {
    vi.useFakeTimers();
    document.body.innerHTML = html;
    const onScan = vi.fn();
    const h = make({ onScan });
    h.observe(document);
    return { h, onScan, root: byId("root") };
  };
  const addMarked = (parent: Element, key: string, id = key) => {
    const p = document.createElement("p");
    p.id = id;
    p.textContent = mark("text", key);
    parent.appendChild(p);
    return p;
  };
  const settle = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  it("L13: a marked node added is highlighted once the quiet period passes", async () => {
    const { root } = setup();
    addMarked(root, "k1", "p1");
    await settle(100);
    expect(byId("p1").hasAttribute(HL)).toBe(true);
  });

  it("a node added is not highlighted before the quiet period passes", async () => {
    const { root } = setup();
    addMarked(root, "k1", "p1");
    await settle(50);
    expect(byId("p1").hasAttribute(HL)).toBe(false);
  });

  it("L15: ten mutations within the quiet period produce one scan", async () => {
    const { root, onScan } = setup();
    for (let i = 0; i < 10; i++) {
      addMarked(root, `k${i}`);
      await settle(5);
    }
    await settle(100);
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("L14: a page that mutates every 50 ms is still scanned once the ceiling passes", async () => {
    const { root, onScan } = setup();
    for (let elapsed = 0; elapsed < 500; elapsed += 50) {
      addMarked(root, `k${elapsed}`);
      await settle(50);
    }
    expect(onScan).toHaveBeenCalled();
  });

  it("L14: and not before the ceiling", async () => {
    const { root, onScan } = setup();
    for (let elapsed = 0; elapsed < 450; elapsed += 50) {
      addMarked(root, `k${elapsed}`);
      await settle(50);
    }
    expect(onScan).not.toHaveBeenCalled();
  });

  it("a continuously mutating page costs a bounded number of scans: the ceiling is not moved by later mutations", async () => {
    const { root, onScan } = setup();
    for (let elapsed = 0; elapsed < 2000; elapsed += 50) {
      addMarked(root, `k${elapsed}`);
      await settle(50);
    }
    expect(onScan.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("L16: a scan triggered by a mutation hands its findings to the callback", async () => {
    const { root, onScan } = setup();
    addMarked(root, "k1");
    await settle(100);
    expect(onScan.mock.calls[0]![0].map((f: { key: string }) => f.key)).toEqual(["k1"]);
  });

  it("L16: a scan the caller asked for hands its findings to the callback as well", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<p>${mark("a", "k1")}</p>`;
    const onScan = vi.fn();
    make({ onScan }).scan(document);
    expect(onScan.mock.calls[0]![0].map((f: { key: string }) => f.key)).toEqual(["k1"]);
  });

  it("changed text triggers a rescan", async () => {
    const { onScan } = setup(`<div id="root"><p id="p">plain</p></div>`);
    byId("p").firstChild!.textContent = mark("now marked", "k1");
    await settle(100);
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("a removed node triggers a rescan", async () => {
    const { onScan } = setup(`<div id="root"><p id="p">${mark("a", "k")}</p></div>`);
    byId("p").remove();
    await settle(100);
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("a change to a scanned attribute triggers a rescan", async () => {
    const { onScan } = setup(`<div id="root"><img id="i" alt="x"></div>`);
    byId("i").setAttribute("alt", mark("Logo", "k"));
    await settle(100);
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("a change to an attribute that is not scanned does not", async () => {
    const { onScan } = setup(`<div id="root"><img id="i" alt="x"></div>`);
    byId("i").setAttribute("data-other", "y");
    await settle(1000);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("HL-34: observing again replaces the previous observation", async () => {
    const { h, onScan, root } = setup(`<div id="root"></div><div id="other"></div>`);
    h.observe(byId("other"));
    addMarked(root, "k1");
    await settle(1000);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("HL-34: the new observation sees its own mutations", async () => {
    const { h, onScan } = setup(`<div id="root"></div><div id="other"></div>`);
    h.observe(byId("other"));
    addMarked(byId("other"), "k1");
    await settle(100);
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("HL-69: the highlighter's own stylesheet write does not start a rescan loop", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="root"></div>';
    let colors = { highlight: "#111111" };
    const onScan = vi.fn();
    const h = make({ onScan, getConfig: () => ({ colors }) });
    h.scan(document);
    h.observe(document);
    onScan.mockClear();
    colors = { highlight: "#222222" };
    addMarked(byId("root"), "k1");
    await settle(5000);
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("L25: a value the highlighter writes does not schedule a rescan", async () => {
    const { h, onScan } = setup(`<div id="root"><p id="p">${mark("old", "k")}</p></div>`);
    h.silently(() => {
      byId("p").firstChild!.textContent = mark("new", "k");
    });
    await settle(1000);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("a page mutation that happened just before a silent write is still rescanned", async () => {
    const { h, onScan, root } = setup(`<div id="root"><p id="p">${mark("old", "k")}</p></div>`);
    addMarked(root, "k2");
    h.silently(() => {
      byId("p").firstChild!.textContent = mark("new", "k");
    });
    await settle(100);
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("silently returns what its function returns", () => {
    expect(setup().h.silently(() => 42)).toBe(42);
  });

  it("L20: clearing with a rescan pending means no scan runs afterwards", async () => {
    const { h, root, onScan } = setup();
    addMarked(root, "k1");
    await settle(10);
    h.clear();
    await settle(2000);
    expect(onScan).not.toHaveBeenCalled();
  });
});

describe("highlighter: flash", () => {
  const setup = () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<p id="p1">${mark("a", "k1")}</p><p id="p2">${mark("b", "k2")}</p>`;
    const h = make();
    const [first, second] = h.scan(document);
    return { h, first: first!, second: second!, p1: byId("p1"), p2: byId("p2") };
  };

  it("an element flashed carries the flash attribute", () => {
    const { h, p1 } = setup();
    h.flash(p1);
    expect(p1.hasAttribute(HL_FLASH)).toBe(true);
  });

  it("the flash rule is a thicker outline in the active colour", () => {
    const { h, p1 } = setup();
    h.flash(p1);
    expect(rule(`[${HL_FLASH}]`)).toContain(`outline: 3px solid ${DEFAULT_COLORS.active}`);
  });

  it("a flash keeps the dashed style of an attribute-only element", () => {
    setup();
    expect(styleText()).toContain(`[${HL_FLASH}][${HL_ATTR}] { outline-style: dashed; }`);
  });

  it("the flash is scrolled into view, centred and smooth", () => {
    const { h, p1 } = setup();
    p1.scrollIntoView = vi.fn();
    h.flash(p1);
    expect(p1.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
  });

  it("an environment that cannot scroll does not break the flash", () => {
    const { h, p1 } = setup();
    p1.scrollIntoView = () => {
      throw new Error("not supported");
    };
    expect(() => h.flash(p1)).not.toThrow();
  });

  it("the flash lasts 700 ms", async () => {
    const { h, p1 } = setup();
    h.flash(p1);
    await vi.advanceTimersByTimeAsync(699);
    expect(p1.hasAttribute(HL_FLASH)).toBe(true);
  });

  it("L17: after the flash duration the resting outline is back", async () => {
    const { h, p1 } = setup();
    h.flash(p1);
    await vi.advanceTimersByTimeAsync(700);
    expect([p1.hasAttribute(HL_FLASH), p1.hasAttribute(HL)]).toEqual([false, true]);
  });

  it("L18: flashing the active element returns it to the active outline", async () => {
    const { h, first, p1 } = setup();
    h.setActive(first);
    h.flash(p1);
    await vi.advanceTimersByTimeAsync(700);
    expect([p1.hasAttribute(HL_FLASH), p1.hasAttribute(HL_ACTIVE)]).toEqual([false, true]);
  });

  it("L19: a second flash of the same element replaces the first's restore", async () => {
    const { h, p1 } = setup();
    h.flash(p1);
    await vi.advanceTimersByTimeAsync(400);
    h.flash(p1);
    await vi.advanceTimersByTimeAsync(300);
    expect(p1.hasAttribute(HL_FLASH)).toBe(true);
  });

  it("L19: and it is restored after the second flash's own duration", async () => {
    const { h, p1 } = setup();
    h.flash(p1);
    await vi.advanceTimersByTimeAsync(400);
    h.flash(p1);
    await vi.advanceTimersByTimeAsync(700);
    expect(p1.hasAttribute(HL_FLASH)).toBe(false);
  });

  it("flashing one element does not cut another's flash short", async () => {
    const { h, p1, p2 } = setup();
    h.flash(p1);
    await vi.advanceTimersByTimeAsync(400);
    h.flash(p2);
    await vi.advanceTimersByTimeAsync(300);
    expect([p1.hasAttribute(HL_FLASH), p2.hasAttribute(HL_FLASH)]).toEqual([false, true]);
  });
});

describe("highlighter: teardown", () => {
  it("L21: clearing leaves no element carrying any marker attribute", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<p id="p1">${mark("a", "k1")}</p><button id="b" title="${mark("t", "k2")}">x</button>`;
    const h = make();
    const [first] = h.scan(document);
    h.setActive(first);
    h.flash(byId("p1"));
    h.clear();
    const marked = document.querySelectorAll(`[${HL}],[${HL_ATTR}],[${HL_ACTIVE}],[${HL_FLASH}]`);
    expect(marked.length).toBe(0);
  });

  it("L22: clearing forgets the active translation", () => {
    document.body.innerHTML = `<p>${mark("a", "k1")}</p>`;
    const h = make();
    h.setActive(h.scan(document)[0]);
    h.clear();
    expect(h.active()).toBeUndefined();
  });

  it("clearing forgets the highlighted set", () => {
    document.body.innerHTML = `<p>${mark("a", "k1")}</p>`;
    const h = make();
    h.scan(document);
    h.clear();
    expect(h.highlights().size).toBe(0);
  });

  it("clearing removes the injected stylesheet", () => {
    document.body.innerHTML = `<p>${mark("a", "k1")}</p>`;
    const h = make();
    h.scan(document);
    h.clear();
    expect(document.querySelector("style[data-tms-hl-style]")).toBeNull();
  });

  it("after clear the document is byte-identical to before the first scan", () => {
    vi.useFakeTimers();
    document.head.innerHTML = '<meta charset="utf-8"><title>T</title>';
    document.body.innerHTML = `<main id="m"><p id="p" style="color: red" class="x">${mark("a", "k1")}</p><img alt="${mark("b", "k2")}"></main>`;
    const before = document.documentElement.outerHTML;
    const h = make();
    h.observe(document);
    const [first] = h.scan(document);
    h.setActive(first);
    h.flash(byId("p"));
    h.clear();
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it("clearing cancels every pending timer: debounce, ceiling and flash restores", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="root"><p id="p">${mark("a", "k1")}</p></div>`;
    const h = make();
    h.observe(document);
    h.scan(document);
    h.flash(byId("p"));
    byId("root").appendChild(document.createElement("i"));
    await vi.advanceTimersByTimeAsync(10);
    h.clear();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clearing twice is harmless", () => {
    const h = make();
    h.clear();
    expect(() => h.clear()).not.toThrow();
  });

  it("clearing before any scan is harmless", () => {
    expect(() => make().clear()).not.toThrow();
  });

  it("the highlighter can be used again after clear", () => {
    document.body.innerHTML = `<p id="p">${mark("a", "k1")}</p>`;
    const h = make();
    h.scan(document);
    h.clear();
    h.scan(document);
    expect(byId("p").hasAttribute(HL)).toBe(true);
  });
});
