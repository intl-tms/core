import { describe, expect, it } from "vitest";
import { decode, detect, encode, strip } from "../src/codec.js";

describe("codec round trip", () => {
  it("C1: decoding an encoded string yields the key", () => {
    expect(decode(encode("Hello", "nav.home"))?.key).toBe("nav.home");
  });

  it("C2: decoding an encoded string yields the clean value", () => {
    expect(decode(encode("Hello", "nav.home"))?.value).toBe("Hello");
  });

  it("C3: an encoded string ends with the visible value unchanged", () => {
    expect(encode("Hello", "nav.home").endsWith("Hello")).toBe(true);
  });
});

describe("codec detect, strip and plain strings", () => {
  it("C4: stripping an encoded string equals the original value", () => {
    expect(strip(encode("Hello", "nav.home"))).toBe("Hello");
  });

  it("C5: an empty value, encoded, is detected", () => {
    expect(detect(encode("", "k"))).toBe(true);
  });

  it("C6: an empty value, encoded then decoded, has an empty clean value", () => {
    expect(decode(encode("", "k"))?.value).toBe("");
  });

  it("C7: a plain string is not detected", () => {
    expect(detect("Hello")).toBe(false);
  });

  it("C8: decoding a plain string returns nothing", () => {
    expect(decode("Hello")).toBeUndefined();
  });

  it("C11: stripping two messages back to back returns both visible values joined", () => {
    expect(strip(encode("a", "k1") + encode("b", "k2"))).toBe("ab");
  });

  it("C12: text before a frame, then the frame, then text: only the frame is removed", () => {
    const frame = encode("", "k");
    expect(decode(`before ${frame}after`)?.value).toBe("before after");
  });
});

const PAYLOAD_BASE = 0xfe00;
const START_CHAR = String.fromCodePoint(0x2063);

/** Replaces the payload character at `index` (0 is the version unit) with another nibble. */
function withPayloadChar(framed: string, index: number, nibble: number): string {
  const at = framed.indexOf(START_CHAR) + 1 + index;
  return framed.slice(0, at) + String.fromCodePoint(PAYLOAD_BASE + nibble) + framed.slice(at + 1);
}

function payloadLength(framed: string): number {
  return framed.indexOf(String.fromCodePoint(0x2064)) - framed.indexOf(START_CHAR) - 1;
}

describe("codec keys and damage", () => {
  it("C9: a key with non-Latin characters and emoji round-trips exactly", () => {
    expect(decode(encode("x", "ключ.キー.🔑"))?.key).toBe("ключ.キー.🔑");
  });

  it("C10: a key containing dots, slashes and spaces round-trips exactly", () => {
    expect(decode(encode("x", "a.b/c d"))?.key).toBe("a.b/c d");
  });

  it("C13: a frame with its end sentinel cut off decodes to nothing", () => {
    const framed = encode("x", "k");
    expect(decode(framed.slice(0, framed.indexOf("x") - 1))).toBeUndefined();
  });

  it("C14: everything in an encoded string beyond the value is a default-ignorable character", () => {
    const frame = encode("Hello", "nav.home").slice(0, -"Hello".length);
    expect(/^\p{Default_Ignorable_Code_Point}+$/u.test(frame)).toBe(true);
  });

  it("C15: a 30-byte key costs at most 60 payload characters plus a small constant", () => {
    expect(payloadLength(encode("x", "k".repeat(30)))).toBeLessThanOrEqual(60 + 4);
  });

  it("C16: altering any one payload character decodes to nothing, never a different key", () => {
    const framed = encode("x", "nav.home");
    const decoded = [...Array(payloadLength(framed)).keys()].map((i) =>
      decode(withPayloadChar(framed, i, (framed.codePointAt(framed.indexOf(START_CHAR) + 1 + i)! - PAYLOAD_BASE + 1) % 16)),
    );
    expect(decoded.every((d) => d === undefined)).toBe(true);
  });

  it("C17: a frame with an unknown version decodes to nothing", () => {
    expect(decode(withPayloadChar(encode("x", "k"), 0, 7))).toBeUndefined();
  });

  it("C20: encoding an already-encoded string with the same key carries exactly one frame", () => {
    const once = encode("Hello", "k");
    expect(encode(once, "k")).toBe(once);
  });

  it("C20: encoding an already-encoded string with another key replaces the frame", () => {
    expect(strip(encode(encode("Hello", "a"), "b"))).toBe("Hello");
  });

  it("C20: the replaced frame is the new key's", () => {
    expect(decode(encode(encode("Hello", "a"), "b"))?.key).toBe("b");
  });
});
