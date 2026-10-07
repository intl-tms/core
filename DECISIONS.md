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

## Catalog marking and classification (M2)

- **Key separator:** a segment containing the separator or a backslash is
  escaped with a backslash, so the flat key `a.b` marks as `a\.b` and the
  nested path `a` → `b` marks as `a.b`. `markCatalog` takes an optional
  `separator`; a Developer whose store uses flat dotted keys can pick another
  separator and keep their keys readable.
- **Memoisation** is keyed by Catalog identity and then by separator string, so
  an inline options object cannot defeat it. A Catalog handed to `markCatalog`
  is treated as immutable afterwards.
- **Only plain objects are walked.** Class instances, dates, maps and cycles are
  carried through untouched rather than flattened or looped on.
- **Toggle cookie name** is `tms-edit`, value `1`.
- **Tag guard result** is the English reason text, or `undefined` when the
  draft can be saved. Structured results (MSG-34) are deferred.
- **Shared rule** is the fixed prefix `shared`, case-sensitive.

## Configuration (M3)

- **Entry point name:** `resolveConfig`. Errors are `ConfigError`, whose
  message always reads `<found>. <why>. Fix: <fix>.`.
- **First error wins.** Collecting every problem at once (VAL-26) is deferred.
- **Capabilities in the resolved configuration** are `usage` (when any usage
  endpoint exists) and `conflicts` (always). The request handler adds the
  capabilities only it knows (`meta`).
- **Colours are not defaulted in the served configuration.** Built-in colours
  apply where the configuration is consumed, so the served object is exactly
  what the Developer wrote plus derived endpoints.
- **Open row.** With no Schema, or Fields not statically known, the row type is
  `OpenRow` with `any` values (spelled through `JSON.parse`'s return type to
  avoid a lint suppression). This is what lets an untyped adapter fit every
  configuration.
- **F23 (adapter versus handler type check)** needs the handler, so its
  type-level test lives with the handler milestone.

## Wire shapes, storage seam and adapter (M4)

- **Seam members are properties, not methods**, so their parameters are
  compared contravariantly. That is what makes an adapter typed for another
  configuration a compile error rather than silently accepted.
- **Untyped adapter.** `StorageAdapter` with no type argument uses string
  Locales and `OpenRow` (with `any` values), so it fits every configuration.
- **Write patch** reads any write-shaped object and keeps only string columns,
  defining them as own properties so a Field named like an object prototype
  member stays an ordinary column.
- **In-memory adapter** orders usages by `lastSeen` and breaks ties by arrival
  order, so two reports in one millisecond still order the later first. A
  report without a title keeps the title already stored for that page. Rows are
  cloned on the way out so a caller cannot mutate the store.
- **Usage URLs are stored exactly as reported.** The client does not
  normalise; `normalizeUrl` is a public helper for a server that wants to
  collapse tracking noise.
- **Conformance suite** returns a report (`failures` empty means pass) and
  depends on no test runner. Ordering of usages needs time to pass: give it
  `advanceTime` to move an injected clock; otherwise it waits 5 real
  milliseconds.
- **Capability detection scaffolding** looks for five optional member names
  (`saveValueIf`, `saveValues`, `getValuesMany`, `deleteValue`,
  `reportStaticUsage`) and maps them to capabilities. None is implemented by
  the Core yet.

## Request handler (M5)

- **Authorization signature:** `authorize({ request, operation })`, a single
  object so route, key, Locale and identity can be added later without
  breaking callers. Anything other than `true` denies, so a check that forgets
  to return a value fails closed. The check must not read the request body.
- **Error hook signature:** `onError(error, request)`; defaults to
  `console.error`. A hook that throws is contained.
- **Error body:** `{ error, code }`. Codes: `malformed-path`, `invalid-json`,
  `invalid-request`, `nothing-to-update`, `unauthorized`, `not-found`,
  `method-not-allowed`, `conflict`, `internal-error`. The 500 body is fixed.
- **Validation order within a field list** is per field: a field is checked
  for being declared, then Read-only, then string, then option, before the
  next field is looked at.
- **A write whose `fields` is empty** and carries no value is "nothing to
  update". `fields` is only present on the write handed to storage when it
  holds at least one column.
- **Usage routes exist only when the usage endpoints are configured**; without
  them they are 404 rather than a disabled feature that answers.
- **Capabilities served** are the resolved ones plus `meta` when a metadata
  hook is installed.
- **CORS:** `cors: { origins, credentials? }`. A wildcard is refused at build
  with a `ConfigError`. `Vary: Origin` is added to every response only when a
  policy is configured, and a preflight is answered only for a listed origin on
  a matched route.
- **Storage is handed an untyped view.** Everything the handler passes on is
  validated and rebuilt, so the cast to the untyped adapter is true at run
  time; the typing exists to catch wiring mistakes at compile time.
- **Metadata and storage are fetched concurrently** (a ▲ item, adopted because
  it is a single `Promise.all`).
