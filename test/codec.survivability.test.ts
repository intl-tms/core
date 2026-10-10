// @vitest-environment jsdom
//
// Marker alphabet survivability matrix. Every candidate invisible character is
// pushed through the pipelines that can be exercised in-process. The chosen
// alphabet must pass all of them; candidates that were rejected must either
// fail an automated check or carry a recorded reason for properties that only
// a real rendering engine can show (line breaking, shaping).
//
// Chosen alphabet and why (see also the decisions file):
//   start sentinel  U+2063 INVISIBLE SEPARATOR
//   end sentinel    U+2064 INVISIBLE PLUS
//   payload         U+FE00..U+FE0F VARIATION SELECTOR-1..16, one nibble each
// None is a joining control, a bidi control, whitespace or a line-break
// opportunity. A payload character always follows the start sentinel, never a
// base character, so no variation sequence can form.
import { describe, expect, it } from "vitest";
import { FRAME_ALPHABET } from "../src/codec.js";

type Check = (char: string) => boolean;

const sample = (char: string) => `ab ${char}${char} cd`;

const checks: Record<string, Check> = {
  defaultIgnorable: (c) => /^\p{Default_Ignorable_Code_Point}$/u.test(c),
  notWhitespace: (c) => !/\p{White_Space}/u.test(c) && c.trim() === c && !/\s/.test(c),
  notJoinControl: (c) => !/\p{Join_Control}/u.test(c),
  notBidiControl: (c) => !/\p{Bidi_Control}/u.test(c),
  json: (c) => JSON.parse(JSON.stringify(sample(c))) === sample(c),
  normalisation: (c) => (["NFC", "NFD", "NFKC", "NFKD"] as const).every((f) => sample(c).normalize(f) === sample(c)),
  utf8: (c) => new TextDecoder().decode(new TextEncoder().encode(sample(c))) === sample(c),
  uri: (c) => decodeURIComponent(encodeURIComponent(sample(c))) === sample(c),
  htmlText: (c) => {
    const el = document.createElement("p");
    el.innerHTML = sample(c);
    return el.textContent === sample(c) && el.innerHTML === sample(c);
  },
  htmlAttribute: (c) => {
    const el = document.createElement("div");
    el.innerHTML = `<i title="${sample(c)}"></i>`;
    return el.querySelector("i")?.getAttribute("title") === sample(c);
  },
  // Measured in the position a character really occupies: inside a frame, so a
  // payload character follows the start sentinel and never a base character.
  // The visible text on either side must stay in clusters of its own.
  doesNotMergeWithVisibleText: (c) => {
    const framed = `a${FRAME_ALPHABET.start}${c}${FRAME_ALPHABET.end}b`;
    const clusters = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(framed)].map((s) => s.segment);
    return clusters[0] === "a" && clusters[clusters.length - 1] === "b";
  },
};

const failures = (char: string): string[] =>
  Object.entries(checks).filter(([, check]) => !check(char)).map(([name]) => name);

interface Candidate {
  codePoint: number;
  name: string;
  /** For properties only a rendering engine can show. */
  recordedReason?: string;
  /** Automated checks this candidate is expected to fail. */
  expectedFailures?: string[];
}

const REJECTED: Candidate[] = [
  { codePoint: 0x200b, name: "ZERO WIDTH SPACE", recordedReason: "line-break opportunity: a frame could split a word across lines" },
  { codePoint: 0x200c, name: "ZERO WIDTH NON-JOINER", expectedFailures: ["notJoinControl"] },
  { codePoint: 0x200d, name: "ZERO WIDTH JOINER", expectedFailures: ["notJoinControl"] },
  { codePoint: 0x200e, name: "LEFT-TO-RIGHT MARK", expectedFailures: ["notBidiControl"] },
  { codePoint: 0x200f, name: "RIGHT-TO-LEFT MARK", expectedFailures: ["notBidiControl"] },
  { codePoint: 0x2060, name: "WORD JOINER", recordedReason: "glues across the break opportunity after a preceding space, changing wrapping" },
  { codePoint: 0xfeff, name: "ZERO WIDTH NO-BREAK SPACE", expectedFailures: ["notWhitespace"] },
  { codePoint: 0x202a, name: "LEFT-TO-RIGHT EMBEDDING", expectedFailures: ["notBidiControl"] },
  { codePoint: 0x2066, name: "LEFT-TO-RIGHT ISOLATE", expectedFailures: ["notBidiControl"] },
  { codePoint: 0x00a0, name: "NO-BREAK SPACE", expectedFailures: ["defaultIgnorable", "notWhitespace"] },
  { codePoint: 0x3164, name: "HANGUL FILLER", recordedReason: "a letter with advance width in some fonts" },
];

describe("marker alphabet survivability matrix", () => {
  it("the start and end sentinels are distinct from each other", () => {
    expect(FRAME_ALPHABET.start).not.toBe(FRAME_ALPHABET.end);
  });

  it("no sentinel appears among the payload characters", () => {
    expect(FRAME_ALPHABET.payload).not.toContain(FRAME_ALPHABET.start);
    expect(FRAME_ALPHABET.payload).not.toContain(FRAME_ALPHABET.end);
  });

  it("the payload alphabet carries at least four bits per character", () => {
    expect(new Set(FRAME_ALPHABET.payload).size).toBeGreaterThanOrEqual(16);
  });

  it("every chosen character is a single UTF-16 code unit", () => {
    expect([FRAME_ALPHABET.start, FRAME_ALPHABET.end, ...FRAME_ALPHABET.payload].every((c) => c.length === 1)).toBe(true);
  });

  it.each([FRAME_ALPHABET.start, FRAME_ALPHABET.end, ...FRAME_ALPHABET.payload].map((c) => [c.codePointAt(0)!.toString(16), c]))(
    "chosen character U+%s passes every automated check",
    (_hex, char) => {
      expect(failures(char as string)).toEqual([]);
    },
  );

  it.each(REJECTED.map((c) => [c.name, c] as const))("rejected candidate %s is rejected for a recorded reason", (_name, candidate) => {
    const failed = failures(String.fromCodePoint(candidate.codePoint));
    const explained = candidate.expectedFailures
      ? candidate.expectedFailures.every((name) => failed.includes(name))
      : candidate.recordedReason !== undefined;
    expect(explained).toBe(true);
  });
});
