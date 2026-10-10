import fc from "fast-check";
import { describe, it } from "vitest";
import { decode, encode, strip } from "../src/codec.js";

/** Replaces lone surrogates, which UTF-8 cannot carry, so any generated string is a legal key. */
const wellFormed = (s: string): string => Array.from(s, (ch) => (/[\ud800-\udfff]/.test(ch) ? "\ufffd" : ch)).join("");

const SEED = { seed: 20261007, numRuns: 300 };
const PAYLOAD_BASE = 0xfe00;
const START_CHAR = String.fromCodePoint(0x2063);

describe("codec properties", () => {
  it("C19: any key and any value round-trip the key", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }).map(wellFormed), fc.string({ unit: "binary" }).map(wellFormed), (key, value) => {
        const wellFormedKey = key;
        return decode(encode(value, wellFormedKey))?.key === wellFormedKey;
      }),
      SEED,
    );
  });

  it("C19: any key and any value round-trip the value", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }).map(wellFormed), fc.string({ unit: "binary" }).map(wellFormed), (key, value) => {
        return decode(encode(value, key))?.value === value;
      }),
      SEED,
    );
  });

  it("C19: stripping is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }).map(wellFormed), fc.string(), (key, value) => {
        const once = strip(encode(value, key));
        return strip(once) === once;
      }),
      SEED,
    );
  });

  it("C19: stripping an encoded string returns the value", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }).map(wellFormed), fc.string(), (key, value) => {
        return strip(encode(value, key)) === value;
      }),
      SEED,
    );
  });

  it("C19: one altered payload character never yields a different key", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.nat(), fc.integer({ min: 1, max: 15 }), (key, position, shift) => {
        const framed = encode("v", key);
        const payloadLength = framed.indexOf(String.fromCodePoint(0x2064)) - framed.indexOf(START_CHAR) - 1;
        const at = framed.indexOf(START_CHAR) + 1 + (position % payloadLength);
        const nibble = (framed.charCodeAt(at) - PAYLOAD_BASE + shift) % 16;
        const damaged = framed.slice(0, at) + String.fromCharCode(PAYLOAD_BASE + nibble) + framed.slice(at + 1);
        return decode(damaged) === undefined;
      }),
      SEED,
    );
  });

  it("C19: a frame truncated anywhere never yields a key", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.nat(), (key, cut) => {
        const framed = encode("", key);
        return decode(framed.slice(0, cut % framed.length)) === undefined;
      }),
      SEED,
    );
  });
});
