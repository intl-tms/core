// Marker codec. Alphabet characters are built from code points, never typed as
// literals: they are invisible and a literal can be silently mangled.
//
// Frame:  START  version  key-bytes...  check-byte  END
// Every byte is two payload characters (one per nibble). The version is one
// payload character. The check byte is a CRC-8 over the version and key bytes.

const START = String.fromCodePoint(0x2063);
const END = String.fromCodePoint(0x2064);
const PAYLOAD_BASE = 0xfe00;
const FORMAT_VERSION = 1;
const MAX_MEMOISED_FRAMES = 50_000;

const NIBBLE = Array.from({ length: 16 }, (_, i) => String.fromCodePoint(PAYLOAD_BASE + i));
const BYTE_TO_CHARS = Array.from({ length: 256 }, (_, b) => NIBBLE[b >> 4]! + NIBBLE[b & 15]!);
/**
 * The characters a frame is built from, exposed so the survivability matrix
 * test can measure them. Not part of either public entry.
 */
export const FRAME_ALPHABET = { start: START, end: END, payload: NIBBLE as readonly string[] };

const PAYLOAD_RANGE = `${NIBBLE[0]}-${NIBBLE[15]}`;

const FRAME_SHAPE = new RegExp(`${START}[${PAYLOAD_RANGE}]+${END}`);
const RECOGNISABLE = new RegExp(`${START}[${PAYLOAD_RANGE}]*${END}?|${END}`, "g");

const CRC8 = Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let bit = 0; bit < 8; bit++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  return crc;
});

function checkByte(version: number, keyBytes: Uint8Array): number {
  let crc = CRC8[version]!;
  for (const byte of keyBytes) crc = CRC8[crc ^ byte]!;
  return crc;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const frames = new Map<string, string>();

function frameFor(key: string): string {
  let frame = frames.get(key);
  if (frame === undefined) {
    const bytes = encoder.encode(key);
    let payload = NIBBLE[FORMAT_VERSION]!;
    for (const byte of bytes) payload += BYTE_TO_CHARS[byte]!;
    payload += BYTE_TO_CHARS[checkByte(FORMAT_VERSION, bytes)]!;
    frame = START + payload + END;
    if (frames.size >= MAX_MEMOISED_FRAMES) frames.clear();
    frames.set(key, frame);
  }
  return frame;
}

/** A well-formed frame found at a position in a string. */
interface ParsedFrame {
  key: string;
  /** Index of the end sentinel. */
  end: number;
}

function parseFrameAt(text: string, start: number): ParsedFrame | undefined {
  const end = text.indexOf(END, start);
  if (end === -1) return undefined;
  const length = end - start - 1;
  // version (1) + key bytes (2 each) + check byte (2): always odd and at least 3
  if (length < 3 || length % 2 === 0) return undefined;
  const nibbles = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    const n = text.charCodeAt(start + 1 + i) - PAYLOAD_BASE;
    if (n < 0 || n > 15) return undefined;
    nibbles[i] = n;
  }
  const version = nibbles[0]!;
  if (version !== FORMAT_VERSION) return undefined;
  const keyBytes = new Uint8Array((length - 3) / 2);
  for (let i = 0; i < keyBytes.length; i++) keyBytes[i] = (nibbles[1 + 2 * i]! << 4) | nibbles[2 + 2 * i]!;
  const check = (nibbles[length - 2]! << 4) | nibbles[length - 1]!;
  if (check !== checkByte(version, keyBytes)) return undefined;
  try {
    return { key: decoder.decode(keyBytes), end };
  } catch {
    return undefined;
  }
}

/** The decoded parts of a marked string. */
export interface Decoded {
  /** The translation key the frame encodes. */
  key: string;
  /** The string with that frame removed. */
  value: string;
}

/**
 * Attaches a Marker for `key` to the front of `value`. Encoding a string that
 * already starts with a Marker replaces that Marker, so composing message
 * sources can never stack frames.
 */
export function encode(value: string, key: string): string {
  if (value.startsWith(START)) {
    const existing = parseFrameAt(value, 0);
    if (existing !== undefined) {
      if (existing.key === key) return value;
      value = value.slice(existing.end + 1);
    }
  }
  return frameFor(key) + value;
}

/**
 * Finds the first well-formed frame in `text` and returns its key and the text
 * without it. A truncated, corrupted or unknown-version frame decodes to
 * nothing and never throws: a wrong key is worse than no key, because the
 * Editor would save into another translation.
 */
export function decode(text: string): Decoded | undefined {
  let start = text.indexOf(START);
  while (start !== -1) {
    const frame = parseFrameAt(text, start);
    if (frame !== undefined) return { key: frame.key, value: text.slice(0, start) + text.slice(frame.end + 1) };
    start = text.indexOf(START, start + 1);
  }
  return undefined;
}

/**
 * Whether `text` contains a frame. Cheap enough to run on every text node of a
 * page: a string without the start sentinel is rejected by one scan.
 */
export function detect(text: string): boolean {
  return text.includes(START) && FRAME_SHAPE.test(text);
}

/**
 * Removes every frame and returns the visible text. Damaged frames are removed
 * as far as they are recognisable. Payload characters are only removed when
 * they follow a start sentinel, because they are also the variation selectors
 * that genuine emoji text contains.
 */
export function strip(text: string): string {
  return text.includes(START) || text.includes(END) ? text.replace(RECOGNISABLE, "") : text;
}
