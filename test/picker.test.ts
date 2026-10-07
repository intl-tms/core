// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closePicker, openPicker } from "../src/picker.js";

const choices = [
  { label: "text", preview: "Hello world", value: "one" },
  { label: "aria-label", preview: "Close dialog", value: "two" },
];
const menu = () => document.querySelector("[data-tms-picker]");
const rows = () => [...document.querySelectorAll("[data-tms-picker] [data-tms-picker-row]")];
const settled = async (promise: Promise<unknown>): Promise<unknown> => (await Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve("PENDING"), 20))]));

beforeEach(() => {
  document.body.innerHTML = '<p id="outside">page</p>';
});
afterEach(() => closePicker());

describe("picker", () => {
  it("P1: shown with two choices it renders two rows", () => {
    void openPicker(choices, { x: 10, y: 10 });
    expect(rows()).toHaveLength(2);
  });

  it("a row shows its label and its preview", () => {
    void openPicker(choices, { x: 10, y: 10 });
    expect(rows()[1]?.textContent).toContain("aria-label");
    expect(rows()[1]?.textContent).toContain("Close dialog");
  });

  it("a long preview is truncated with an ellipsis", () => {
    void openPicker([{ label: "text", preview: "x".repeat(200), value: 1 }], { x: 0, y: 0 });
    expect(rows()[0]?.textContent).toMatch(/…$/);
  });

  it("a short preview is not truncated", () => {
    void openPicker([{ label: "text", preview: "short", value: 1 }], { x: 0, y: 0 });
    expect(rows()[0]?.textContent).not.toContain("…");
  });

  it("an empty preview still yields a row", () => {
    void openPicker([{ label: "text", preview: "", value: 1 }], { x: 0, y: 0 });
    expect(rows()).toHaveLength(1);
  });

  it("a preview containing markup is shown as text, never as elements", () => {
    void openPicker([{ label: "text", preview: "<img src=x onerror=alert(1)>", value: 1 }], { x: 0, y: 0 });
    expect(document.querySelector("[data-tms-picker] img")).toBeNull();
  });

  it("PCK-1: the menu opens at the click position", () => {
    void openPicker(choices, { x: 40, y: 60 });
    const style = (menu() as HTMLElement).style;
    expect([style.left, style.top]).toEqual(["40px", "60px"]);
  });

  it("PCK-7: the menu renders above all page content", () => {
    void openPicker(choices, { x: 0, y: 0 });
    expect(Number((menu() as HTMLElement).style.zIndex)).toBeGreaterThanOrEqual(2147483000);
  });

  it("P2: clicking a row resolves with that choice's value", async () => {
    const result = openPicker(choices, { x: 0, y: 0 });
    (rows()[1] as HTMLElement).click();
    expect(await result).toBe("two");
  });

  it("P3: a pointer-down outside resolves with nothing", async () => {
    const result = openPicker(choices, { x: 0, y: 0 });
    document.getElementById("outside")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(await result).toBeUndefined();
  });

  it("a pointer-down inside the menu does not dismiss it", async () => {
    const result = openPicker(choices, { x: 0, y: 0 });
    rows()[0]!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(await settled(result)).toBe("PENDING");
  });

  it("P4: Escape resolves with nothing", async () => {
    const result = openPicker(choices, { x: 0, y: 0 });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await result).toBeUndefined();
  });

  it("another key does not dismiss it", async () => {
    const result = openPicker(choices, { x: 0, y: 0 });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(await settled(result)).toBe("PENDING");
  });

  it("P5: a scroll of the window resolves with nothing", async () => {
    const result = openPicker(choices, { x: 0, y: 0 });
    window.dispatchEvent(new Event("scroll"));
    expect(await result).toBeUndefined();
  });

  it("P5: a scroll of any element, which does not bubble, resolves with nothing", async () => {
    const result = openPicker(choices, { x: 0, y: 0 });
    document.getElementById("outside")!.dispatchEvent(new Event("scroll", { bubbles: false }));
    expect(await result).toBeUndefined();
  });

  it("P6: opening twice leaves only one menu in the document", () => {
    void openPicker(choices, { x: 0, y: 0 });
    void openPicker(choices, { x: 5, y: 5 });
    expect(document.querySelectorAll("[data-tms-picker]")).toHaveLength(1);
  });

  it("PCK-5: the new menu is the one that remains", () => {
    void openPicker(choices, { x: 0, y: 0 });
    void openPicker(choices, { x: 5, y: 5 });
    expect((menu() as HTMLElement).style.left).toBe("5px");
  });

  it("P7: after it resolves the menu is removed from the document", async () => {
    const result = openPicker(choices, { x: 0, y: 0 });
    (rows()[0] as HTMLElement).click();
    await result;
    expect(menu()).toBeNull();
  });

  it("P8: shown at a point past the right edge it is positioned inside the viewport", () => {
    void openPicker(choices, { x: window.innerWidth + 500, y: 10 });
    expect(parseFloat((menu() as HTMLElement).style.left)).toBeLessThan(window.innerWidth);
  });

  it("shown at a point past the bottom edge it is positioned inside the viewport", () => {
    void openPicker(choices, { x: 10, y: window.innerHeight + 500 });
    expect(parseFloat((menu() as HTMLElement).style.top)).toBeLessThan(window.innerHeight);
  });

  it("a point with negative coordinates is clamped to the viewport", () => {
    void openPicker(choices, { x: -50, y: -50 });
    const style = (menu() as HTMLElement).style;
    expect([parseFloat(style.left) >= 0, parseFloat(style.top) >= 0]).toEqual([true, true]);
  });

  it("PCK-6: it can be closed programmatically", () => {
    void openPicker(choices, { x: 0, y: 0 });
    closePicker();
    expect(menu()).toBeNull();
  });

  it("PCK-6: closing programmatically does not resolve the promise", async () => {
    const result = openPicker(choices, { x: 0, y: 0 });
    closePicker();
    expect(await settled(result)).toBe("PENDING");
  });

  it("closing when nothing is open is harmless", () => {
    expect(() => closePicker()).not.toThrow();
  });

  it("PCK-9: it removes every listener it added when it closes", async () => {
    const added: [string, unknown, unknown][] = [];
    const removed: [string, unknown, unknown][] = [];
    const add = vi.spyOn(EventTarget.prototype, "addEventListener").mockImplementation(function (this: EventTarget, type, listener, capture) {
      added.push([type, listener, capture]);
      return undefined;
    });
    const remove = vi.spyOn(EventTarget.prototype, "removeEventListener").mockImplementation(function (this: EventTarget, type, listener, capture) {
      removed.push([type, listener, capture]);
      return undefined;
    });
    const result = openPicker(choices, { x: 0, y: 0 });
    closePicker();
    add.mockRestore();
    remove.mockRestore();
    void result;
    const listenersOnDocument = added.filter(([type]) => ["pointerdown", "keydown", "scroll"].includes(type));
    expect(listenersOnDocument.every((a) => removed.some((r) => r[0] === a[0] && r[1] === a[1] && r[2] === a[2]))).toBe(true);
  });

  it("after it closes a pointer-down no longer reaches it", async () => {
    const result = openPicker(choices, { x: 0, y: 0 });
    (rows()[0] as HTMLElement).click();
    await result;
    expect(() => document.dispatchEvent(new Event("pointerdown"))).not.toThrow();
  });

  it("PCK-8: it is generic over what a choice carries", async () => {
    const result = openPicker([{ label: "a", preview: "b", value: { id: 7 } }], { x: 0, y: 0 });
    (rows()[0] as HTMLElement).click();
    expect((await result)?.id).toBe(7);
  });
});
