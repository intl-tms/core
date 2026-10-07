# Decisions

Choices made where the specification was silent or left the answer to the
builder. Each says what was chosen and why.

## Marker alphabet and frame (M1)

- **Frame:** `START · version · key bytes · check byte · END`. Every byte is two
  payload characters (one per nibble); the version is one payload character.
- **Start sentinel** U+2063 INVISIBLE SEPARATOR, **end sentinel** U+2064
  INVISIBLE PLUS, **payload** U+FE00..U+FE0F (VARIATION SELECTOR-1..16).
- **Why these:** all are default-ignorable, single UTF-16 code units, not
  whitespace, not joining or bidi controls, and survive JSON, URI, UTF-8,
  Unicode normalisation and HTML text/attribute round trips. Rejected: U+200B
  (a line-break opportunity could split a word), U+2060 (glues across the break
  opportunity after a space), U+200C/D (joining controls), U+200E/F and the
  embedding/isolate marks (bidi), U+FEFF (stripped by `trim()`), U+3164 (has
  width in some fonts). The matrix is `test/codec.survivability.test.ts`.
- **Payload after a base character:** a variation selector attaches to a
  preceding base character. In a frame a payload character only ever follows
  the start sentinel (a Control for grapheme purposes), so no variation
  sequence forms. Because the payload alphabet overlaps the variation
  selectors that genuine emoji text contains, Strip only removes payload
  characters that follow a start sentinel.
- **Density:** two invisible characters per key byte plus four (version, two
  check characters, and one sentinel pair counted separately).
- **Integrity:** CRC-8 (polynomial 0x07) over version and key bytes. Any single
  altered character and any truncation is always rejected; the odd-length rule
  rejects any single deleted character. Arbitrary multi-character damage is
  rejected with probability 255/256, not certainty.
- **Memoisation:** frames are memoised per key in a map capped at 50,000
  entries (cleared when full) so a long-lived server cannot grow it without
  bound.
- **Re-encoding:** encoding a string that already starts with a valid frame
  replaces that frame (same key: returns the string unchanged).
- **Real-browser rendering** of the alphabet (shaping, line breaking) cannot be
  proven in a simulated DOM; those rows of the matrix carry a recorded reason.
  A real-browser run is deferred (TST-10).
