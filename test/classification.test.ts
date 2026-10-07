import { describe, expect, it } from "vitest";
import { hasTags, isPlain, isSharedKey, tagMismatch, tagNames } from "../src/classification.js";

describe("tag names", () => {
  it("G1: a paired tag yields its name", () => {
    expect(tagNames("Go to <a>Docs</a>")).toEqual(["a"]);
  });

  it("G2: names are distinct and sorted", () => {
    expect(tagNames("<b>x</b> and <a>y</a>")).toEqual(["a", "b"]);
  });

  it("G3: a repeated tag is listed once", () => {
    expect(tagNames("<b>x</b> <b>y</b>")).toEqual(["b"]);
  });

  it("G4: a self-closing tag counts", () => {
    expect(tagNames("Line<br/>break")).toEqual(["br"]);
  });

  it("a self-closing tag with a space before the slash counts", () => {
    expect(tagNames("Line<br />break")).toEqual(["br"]);
  });

  it("G5: a lone opening tag is prose", () => {
    expect(tagNames("Press <Enter> to continue")).toEqual([]);
  });

  it("G6: a comparison is never a tag", () => {
    expect(tagNames("5 < 6 and 7 > 2")).toEqual([]);
  });

  it("a name may contain digits, underscores and hyphens", () => {
    expect(tagNames("<h1_x-y>t</h1_x-y>")).toEqual(["h1_x-y"]);
  });

  it("a closing tag with no opener is prose", () => {
    expect(tagNames("oops </a>")).toEqual([]);
  });

  it("has tags is true for a message with tag names", () => {
    expect(hasTags("<a>x</a>")).toBe(true);
  });

  it("has tags is false for prose", () => {
    expect(hasTags("Press <Enter>")).toBe(false);
  });
});

describe("plain messages", () => {
  it("G7: simple text is Plain", () => {
    expect(isPlain("Hello")).toBe(true);
  });

  it("G8: a message with an argument is not Plain", () => {
    expect(isPlain("Hello {name}")).toBe(false);
  });

  it("G9: a message with a tag is not Plain", () => {
    expect(isPlain("Go to <a>Docs</a>")).toBe(false);
  });

  it("G10: a doubled apostrophe is not Plain", () => {
    expect(isPlain("It''s")).toBe(false);
  });

  it("G11: a single apostrophe is Plain", () => {
    expect(isPlain("It's fine")).toBe(true);
  });

  it("a closing brace alone is not Plain", () => {
    expect(isPlain("a } b")).toBe(false);
  });

  it("an apostrophe directly before a closing angle bracket is not Plain", () => {
    expect(isPlain("it'>")).toBe(false);
  });

  it("a stray opening angle bracket is conservatively not Plain", () => {
    expect(isPlain("5 < 6")).toBe(false);
  });

  it("an empty message is Plain", () => {
    expect(isPlain("")).toBe(true);
  });
});

describe("tag guard", () => {
  it("G12: the same tag names with different prose is no mismatch", () => {
    expect(tagMismatch("<a>x</a>", "<a>y</a>")).toBeUndefined();
  });

  it("G13: a missing tag is named as missing", () => {
    expect(tagMismatch("x", "<a>y</a>")).toContain("missing <a>");
  });

  it("G14: an unknown tag is named as unknown", () => {
    expect(tagMismatch("<b>x</b>", "<a>y</a>")).toContain("unknown <b>");
  });

  it("G14: the same mismatch also names the missing tag", () => {
    expect(tagMismatch("<b>x</b>", "<a>y</a>")).toContain("missing <a>");
  });

  it("G14: the full reason has the documented shape", () => {
    expect(tagMismatch("<b>x</b>", "<a>y</a>")).toBe("Tags must match the source: unknown <b>; missing <a>");
  });

  it("only the part that applies is present when nothing is unknown", () => {
    expect(tagMismatch("x", "<a>y</a>")).toBe("Tags must match the source: missing <a>");
  });

  it("several names are comma separated", () => {
    expect(tagMismatch("<c>1</c><d>2</d>", "x")).toBe("Tags must match the source: unknown <c>, <d>");
  });

  it("G15: an empty draft is no mismatch", () => {
    expect(tagMismatch("", "<a>y</a>")).toBeUndefined();
  });

  it("G16: an empty reference is no mismatch", () => {
    expect(tagMismatch("<a>x</a>", "")).toBeUndefined();
  });

  it("G17: tag order is free", () => {
    expect(tagMismatch("<a>y</a> then <b>z</b>", "<b>z</b> then <a>y</a>")).toBeUndefined();
  });
});

describe("shared translations", () => {
  it("G18: a key beginning with shared. is Shared", () => {
    expect(isSharedKey("shared.cta")).toBe(true);
  });

  it("G19: a key beginning with shared and no separator is Shared", () => {
    expect(isSharedKey("sharedCta")).toBe(true);
  });

  it("G20: the prefix in a later segment does not make a key Shared", () => {
    expect(isSharedKey("checkout.shared.title")).toBe(false);
  });

  it("a key that merely resembles the prefix is not Shared", () => {
    expect(isSharedKey("share.cta")).toBe(false);
  });
});
