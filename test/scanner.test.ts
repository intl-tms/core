// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { encode } from "../src/codec.js";
import { scan } from "../src/scanner.js";

const mark = (value: string, key: string) => encode(value, key);

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("scanner: text", () => {
  it("S1: a paragraph with marked text yields one text finding with its key", () => {
    document.body.innerHTML = `<p>${mark("Hello", "nav.home")}</p>`;
    const found = scan(document);
    expect(found.map((f) => [f.kind, f.key])).toEqual([["text", "nav.home"]]);
  });

  it("S2: the finding's value is the clean text", () => {
    document.body.innerHTML = `<p>${mark("Hello", "k")}</p>`;
    expect(scan(document)[0]?.value).toBe("Hello");
  });

  it("S3: the finding's element is the paragraph", () => {
    document.body.innerHTML = `<p id="p">${mark("Hello", "k")}</p>`;
    expect(scan(document)[0]?.element).toBe(document.getElementById("p"));
  });

  it("a text finding carries its text node", () => {
    document.body.innerHTML = `<p id="p">${mark("Hello", "k")}</p>`;
    const first = scan(document)[0];
    expect(first?.kind === "text" && first.node).toBe(document.getElementById("p")?.firstChild);
  });

  it("S4: unmarked text yields no findings", () => {
    document.body.innerHTML = "<p>Hello</p>";
    expect(scan(document)).toEqual([]);
  });

  it("a marker-only string (a missing translation) is still found, with an empty value", () => {
    document.body.innerHTML = `<p>${mark("", "missing.key")}</p>`;
    expect(scan(document).map((f) => [f.key, f.value])).toEqual([["missing.key", ""]]);
  });

  it("a text node with a damaged marker yields no finding", () => {
    document.body.innerHTML = `<p>${mark("Hello", "k").replace("⁤", "")}</p>`;
    expect(scan(document)).toEqual([]);
  });

  it("S13: three marked nodes are found in document order", () => {
    document.body.innerHTML = `<div><p>${mark("a", "k1")}</p><section><span>${mark("b", "k2")}</span></section><p>${mark("c", "k3")}</p></div>`;
    expect(scan(document).map((f) => f.key)).toEqual(["k1", "k2", "k3"]);
  });

  it("S12: an element root scans only its subtree", () => {
    document.body.innerHTML = `<p>${mark("a", "outside")}</p><div id="root"><p>${mark("b", "inside")}</p></div>`;
    expect(scan(document.getElementById("root")!).map((f) => f.key)).toEqual(["inside"]);
  });

  it("two text nodes in one element are two findings", () => {
    document.body.innerHTML = `<p>${mark("a", "k1")}<b>${mark("b", "k2")}</b></p>`;
    expect(scan(document).map((f) => f.key)).toEqual(["k1", "k2"]);
  });

  it("a text node with other frames after the first has all of them stripped from the value", () => {
    document.body.innerHTML = `<p>${mark("a", "k1")}${mark("b", "k2")}</p>`;
    expect(scan(document)[0]?.value).toBe("ab");
  });
});

describe("scanner: elements that never render", () => {
  it("S5: marked text in the title is skipped", () => {
    document.head.innerHTML = `<title>${mark("T", "k")}</title>`;
    expect(scan(document)).toEqual([]);
  });

  it("S6: marked text in a script is skipped", () => {
    document.body.innerHTML = `<script>${mark("x", "k")}</script>`;
    expect(scan(document)).toEqual([]);
  });

  it.each(["style", "noscript"])("marked text in %s is skipped", (tag) => {
    document.body.innerHTML = `<${tag}>${mark("x", "k")}</${tag}>`;
    expect(scan(document)).toEqual([]);
  });

  it("marked text in a meta-bearing head is skipped", () => {
    document.head.innerHTML = `<meta name="d" content="x">${mark("loose", "k")}`;
    expect(scan(document)).toEqual([]);
  });

  it("marked text next to a skipped element is still found", () => {
    document.body.innerHTML = `<script>${mark("x", "skip")}</script><p>${mark("y", "keep")}</p>`;
    expect(scan(document).map((f) => f.key)).toEqual(["keep"]);
  });
});

describe("scanner: attributes", () => {
  const attrs = { attributes: ["aria-label", "title"] };

  it("S7: a marked aria-label yields an attribute finding naming the attribute", () => {
    document.body.innerHTML = `<button aria-label="${mark("Close", "a.close")}">x</button>`;
    expect(scan(document, attrs).map((f) => [f.kind, f.kind === "attribute" ? f.attribute : "", f.key, f.value])).toEqual([["attribute", "aria-label", "a.close", "Close"]]);
  });

  it("the attribute finding's element is the element carrying it", () => {
    document.body.innerHTML = `<button id="b" aria-label="${mark("Close", "a.close")}">x</button>`;
    expect(scan(document, attrs)[0]?.element).toBe(document.getElementById("b"));
  });

  it("S8: with no attributes scanned only text is scanned", () => {
    document.body.innerHTML = `<button aria-label="${mark("Close", "a.close")}">x</button>`;
    expect(scan(document)).toEqual([]);
  });

  it("an empty attribute list scans only text", () => {
    document.body.innerHTML = `<button aria-label="${mark("Close", "a.close")}">x</button>`;
    expect(scan(document, { attributes: [] })).toEqual([]);
  });

  it("an unmarked attribute is not a finding", () => {
    document.body.innerHTML = `<button aria-label="Close">x</button>`;
    expect(scan(document, attrs)).toEqual([]);
  });

  it("an attribute that is not in the scanned list is not a finding", () => {
    document.body.innerHTML = `<button data-x="${mark("Close", "k")}">x</button>`;
    expect(scan(document, attrs)).toEqual([]);
  });

  it("S9: an element with marked text and a marked title yields two findings on one element", () => {
    document.body.innerHTML = `<a id="a" title="${mark("Tip", "k.tip")}">${mark("Link", "k.text")}</a>`;
    const found = scan(document, attrs);
    expect([found.length, found[0]?.element === found[1]?.element]).toEqual([2, true]);
  });

  it("an element's attribute finding precedes its own text finding", () => {
    document.body.innerHTML = `<a title="${mark("Tip", "k.tip")}">${mark("Link", "k.text")}</a>`;
    expect(scan(document, attrs).map((f) => f.kind)).toEqual(["attribute", "text"]);
  });

  it("S13: text and attribute findings interleave in document order", () => {
    document.body.innerHTML = `<p>${mark("a", "k1")}</p><button aria-label="${mark("b", "k2")}"></button><p>${mark("c", "k3")}</p>`;
    expect(scan(document, attrs).map((f) => f.key)).toEqual(["k1", "k2", "k3"]);
  });

  it("S10: a duplicate in the attribute list yields one finding, not two", () => {
    document.body.innerHTML = `<button aria-label="${mark("x", "k")}"></button>`;
    expect(scan(document, { attributes: ["aria-label", "aria-label"] })).toHaveLength(1);
  });

  it("S11: an attribute name that is selector syntax is ignored without throwing", () => {
    document.body.innerHTML = `<button aria-label="${mark("x", "k")}" y="${mark("z", "k2")}"></button>`;
    expect(() => scan(document, { attributes: ["x],[y"] })).not.toThrow();
  });

  it("S11: and it finds nothing through the injected selector", () => {
    document.body.innerHTML = `<button y="${mark("z", "k2")}"></button>`;
    expect(scan(document, { attributes: ["x],[y"] })).toEqual([]);
  });

  it("S11: a valid name beside an invalid one is still scanned", () => {
    document.body.innerHTML = `<button aria-label="${mark("x", "k")}"></button>`;
    expect(scan(document, { attributes: ["1bad", "aria-label"] })).toHaveLength(1);
  });

  it("a namespaced attribute name with a colon is legal", () => {
    document.body.innerHTML = `<svg><use id="u" xlink:href="${mark("x", "k")}"></use></svg>`;
    expect(scan(document, { attributes: ["xlink:href"] })).toHaveLength(1);
  });

  it("a legal name whose local part is not a valid selector identifier does not throw", () => {
    document.body.innerHTML = `<div a:1b="${mark("x", "k")}"></div>`;
    expect(() => scan(document, { attributes: ["a:1b"] })).not.toThrow();
  });

  it("a marked attribute inside a script's subtree never renders and is skipped", () => {
    document.head.innerHTML = `<meta name="d" title="${mark("x", "k")}">`;
    expect(scan(document, { attributes: ["title"] })).toEqual([]);
  });

  it("S12: scanning an element root also reads that element's own attributes", () => {
    document.body.innerHTML = `<div id="root" title="${mark("x", "k")}"></div>`;
    expect(scan(document.getElementById("root")!, attrs)).toHaveLength(1);
  });

  it("an attribute with a damaged marker is not a finding", () => {
    document.body.innerHTML = `<button title="${mark("x", "k").replace("\u2064", "")}"></button>`;
    expect(scan(document, attrs)).toEqual([]);
  });

  it("a marker-only attribute is found with an empty value", () => {
    document.body.innerHTML = `<button title="${mark("", "missing")}"></button>`;
    expect(scan(document, attrs).map((f) => f.value)).toEqual([""]);
  });
});

describe("scanner: stable identity", () => {
  it("a finding keeps its identity across rescans while its node survives", () => {
    document.body.innerHTML = `<p>${mark("a", "k1")}</p>`;
    expect(scan(document)[0]?.id).toBe(scan(document)[0]?.id);
  });

  it("two different translations have different identities", () => {
    document.body.innerHTML = `<p>${mark("a", "k1")}</p><p>${mark("b", "k2")}</p>`;
    const [first, second] = scan(document);
    expect(first?.id).not.toBe(second?.id);
  });

  it("two attributes of one element have different identities", () => {
    document.body.innerHTML = `<a title="${mark("t", "k1")}" aria-label="${mark("l", "k2")}"></a>`;
    const [first, second] = scan(document, { attributes: ["title", "aria-label"] });
    expect(first?.id).not.toBe(second?.id);
  });

  it("an attribute finding's identity survives a change of its value", () => {
    document.body.innerHTML = `<a id="a" title="${mark("t", "k1")}"></a>`;
    const before = scan(document, { attributes: ["title"] })[0]?.id;
    document.getElementById("a")!.setAttribute("title", mark("new", "k1"));
    expect(scan(document, { attributes: ["title"] })[0]?.id).toBe(before);
  });

  it("a node replaced by an equivalent one is a new identity", () => {
    document.body.innerHTML = `<p id="p">${mark("a", "k1")}</p>`;
    const before = scan(document)[0]?.id;
    document.getElementById("p")!.replaceWith(Object.assign(document.createElement("p"), { id: "p", textContent: mark("a", "k1") }));
    expect(scan(document)[0]?.id).not.toBe(before);
  });
});
