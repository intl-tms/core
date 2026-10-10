import { describe, expect, expectTypeOf, it } from "vitest";
import { decode, strip } from "../src/codec.js";
import { markCatalog } from "../src/catalog.js";

type Tree = Record<string, unknown>;
const keyOf = (value: unknown): string | undefined => decode(value as string)?.key;

describe("catalog marking", () => {
  it("M1: a top-level leaf decodes to its own name as the key", () => {
    expect(keyOf(markCatalog({ a: "x" }).a)).toBe("a");
  });

  it("M2: a nested leaf decodes to its dotted path", () => {
    expect(keyOf((markCatalog({ a: { b: "x" } }).a as Tree).b)).toBe("a.b");
  });

  it("M3: the deepest leaf of a three-level tree carries its full dotted path", () => {
    const marked = markCatalog({ a: { b: { c: "x" } } });
    expect(keyOf(((marked.a as Tree).b as Tree).c)).toBe("a.b.c");
  });

  it("M4: an empty string is marked", () => {
    expect(keyOf(markCatalog({ a: "" }).a)).toBe("a");
  });

  it("M9: the result is a different object from the input", () => {
    const input = { a: "x" };
    expect(markCatalog(input)).not.toBe(input);
  });

  it("M10: a marked leaf, stripped, equals the original string", () => {
    expect(strip(markCatalog({ a: "Hello" }).a)).toBe("Hello");
  });
});

describe("catalog marking of non-string and unusual entries", () => {
  it("M5: a number is passed through untouched", () => {
    expect(markCatalog({ n: 3 }).n).toBe(3);
  });

  it("M6: null is passed through untouched", () => {
    expect(markCatalog({ n: null }).n).toBeNull();
  });

  it("M7: an array is carried through with its strings unmarked", () => {
    expect(markCatalog({ list: ["x", "y"] }).list).toEqual(["x", "y"]);
  });

  it("M7: an array keeps its identity", () => {
    const list = ["x"];
    expect(markCatalog({ list }).list).toBe(list);
  });

  it("M8: the input is unchanged afterwards", () => {
    const input = { a: "x", b: { c: "y" } };
    markCatalog(input);
    expect(input).toEqual({ a: "x", b: { c: "y" } });
  });

  it("a boolean is passed through untouched", () => {
    expect(markCatalog({ flag: true }).flag).toBe(true);
  });

  it("a class instance is passed through rather than walked", () => {
    const when = new Date(0);
    expect(markCatalog({ when }).when).toBe(when);
  });

  it("a cyclic catalog does not overflow the stack", () => {
    const cyclic: Tree = { a: "x" };
    cyclic.self = cyclic;
    expect(() => markCatalog(cyclic)).not.toThrow();
  });

  it("a __proto__ entry becomes an own property and does not replace the prototype", () => {
    const parsed = JSON.parse('{"__proto__": {"a": "x"}}');
    expect(Object.getPrototypeOf(markCatalog(parsed))).toBe(Object.prototype);
  });
});

describe("catalog marking identity and key ambiguity", () => {
  it("M11: marking the same Catalog object twice returns the same result object", () => {
    const catalog = { a: "x" };
    expect(markCatalog(catalog)).toBe(markCatalog(catalog));
  });

  it("M11: marking an already-seen Catalog reads none of its entries again", () => {
    let reads = 0;
    const catalog = {};
    Object.defineProperty(catalog, "a", { enumerable: true, get: () => (reads++, "x") });
    markCatalog(catalog);
    const afterFirst = reads;
    markCatalog(catalog);
    expect(reads).toBe(afterFirst);
  });

  it("M12: a flat key containing a dot and the equivalent nested path produce different keys", () => {
    const marked = markCatalog({ "a.b": "x", a: { b: "y" } });
    expect(keyOf(marked["a.b"])).not.toBe(keyOf((marked.a as Tree).b));
  });

  it("M12: the nested path keeps the plain dotted key", () => {
    expect(keyOf((markCatalog({ a: { b: "y" } }).a as Tree).b)).toBe("a.b");
  });

  it("M12: a backslash in a segment is escaped so it cannot disguise a separator", () => {
    const marked = markCatalog({ "a\\": { b: "x" }, a: { "\\b": "y" } });
    expect(keyOf((marked["a\\"] as Tree).b)).not.toBe(keyOf((marked.a as Tree)["\\b"]));
  });

  it("a configurable separator joins nested segments", () => {
    expect(keyOf((markCatalog({ a: { b: "x" } }, { separator: "/" }).a as Tree).b)).toBe("a/b");
  });

  it("a flat dotted key stays readable when the separator is not a dot", () => {
    expect(keyOf(markCatalog({ "pricing.title": "x" }, { separator: "/" })["pricing.title"])).toBe("pricing.title");
  });
});

describe("catalog marking: static type", () => {
  it("CAT-7: a typed Catalog stays typed", () => {
    const catalog = { nav: { home: "Home" }, count: 3 };
    expectTypeOf(markCatalog(catalog)).toEqualTypeOf<{ nav: { home: string }; count: number }>();
  });
});
