import { describe, expect, it } from "vitest";
import { fieldText, isEmptyPatch, writePatch } from "../src/wire.js";

describe("field text", () => {
  it("B20: null is the empty string", () => {
    expect(fieldText(null)).toBe("");
  });

  it("undefined is the empty string", () => {
    expect(fieldText(undefined)).toBe("");
  });

  it("a string is itself", () => {
    expect(fieldText("abc")).toBe("abc");
  });

  it("the empty string is itself", () => {
    expect(fieldText("")).toBe("");
  });

  it("B21: an object is its JSON", () => {
    expect(fieldText({ a: 1 })).toBe('{"a":1}');
  });

  it("a number is its JSON", () => {
    expect(fieldText(3)).toBe("3");
  });

  it("false is its JSON, not empty", () => {
    expect(fieldText(false)).toBe("false");
  });

  it("an array is its JSON", () => {
    expect(fieldText([1, "a"])).toBe('[1,"a"]');
  });
});

describe("write patch", () => {
  it("A6: absent properties are dropped and empty strings are kept", () => {
    expect(writePatch({ locale: "da", value: "", fields: { a: "x", b: undefined } })).toEqual({ value: "", a: "x" });
  });

  it("a value-only write patches only the value", () => {
    expect(writePatch({ locale: "da", value: "x" })).toEqual({ value: "x" });
  });

  it("a field-only write has no value column", () => {
    expect(writePatch({ locale: "da", fields: { status: "draft" } })).toEqual({ status: "draft" });
  });

  it("a write with only a locale is an empty patch", () => {
    expect(isEmptyPatch(writePatch({ locale: "da" }))).toBe(true);
  });

  it("a write clearing a value is not empty", () => {
    expect(isEmptyPatch(writePatch({ locale: "da", value: "" }))).toBe(false);
  });

  it("a field named like an object prototype member is an ordinary column", () => {
    expect(writePatch({ locale: "da", fields: { constructor: "x" } })).toEqual({ constructor: "x" });
  });
});
