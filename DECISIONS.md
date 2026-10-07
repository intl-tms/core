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

## Scanner, highlighter and picker (M6)

- **Marker attributes** default to `data-tms-hl` (highlighted),
  `data-tms-hl-attr` (attribute-only), `data-tms-hl-active` (active) and a
  fourth, `data-tms-hl-flash`, because a flash needs its own state that must
  not disturb the active one. All four are configurable.
- **Highlighting is a stylesheet**, one `<style data-tms-hl-style>` element in
  the head, with the colours inside its rules. A colour change rewrites that
  one element. No inline style is ever written, and clear removes the element.
  Strict content-security-policy support (a nonce, or constructable
  stylesheets) is deferred.
- **Colours are sanitised** before they enter the stylesheet: only hex,
  functional notation and keywords pass, anything else falls back to the
  default, so a served configuration cannot inject CSS.
- **Attribute selectors:** names are validated, de-duplicated, and a colon is
  escaped. A namespaced attribute (SVG `xlink:href`) is matched by its local
  name in any namespace and then verified by its qualified name, because a CSS
  attribute selector never matches a namespaced attribute by qualified name.
- **Order within one element:** an element's attribute translations precede its
  own text.
- **Self-mutation:** the observer filters on the scanned attribute names (so
  marker attributes are invisible to it), ignores changes inside its own
  stylesheet, and `silently(write)` drains the queue around a write.
  Mutations that happened before the write still schedule a rescan.
- **Picker `closePicker`** leaves the promise unsettled (the spec's "without
  resolving"); user dismissal resolves with `undefined`. The menu opens exactly
  at the click position unless that would leave the viewport.
- **Picker rows** carry `role="menuitem"` and no keyboard navigation yet
  (accessibility and style isolation are deferred).
- **Timers** are injectable on the highlighter; by default they look up the
  platform's `setTimeout` at each use so fake timers installed later apply.

## Client (M7)

- **`readValues` result:** `{ values, error, failure? }`. `values` is always an
  envelope (empty on failure). `failure` is `{ class, reason?, status? }`, so a
  tool branches on `class` and shows `reason`.
- **Failure classes:** `config-not-loaded`, `offline`, `timeout`, `network`,
  `unauthenticated`, `forbidden`, `invalid`, `conflict`, `not-found`, `server`,
  `unknown`. A cross-origin block cannot be told apart from an unreachable
  server in a browser (both are a `TypeError`), so both are `network`; only
  `navigator.onLine === false` is reported as `offline`.
- **Time limit** races the whole round trip, headers and body, against one
  timer, aborts the request and ignores a late answer. A request function that
  ignores the abort signal still cannot hang the caller. Timers are looked up
  on `globalThis` at each use unless injected.
- **Saves are sequential**, in the caller's order, so results and status tokens
  come back in save order. Concurrency (and the batch endpoint) are deferred.
- **A conflict's `current`** is accepted only when it is an object with a
  string `value`.
- **Usage reporting** remembers one accepted signature (not a bounded set).
  The URL is signed and sent exactly as the caller gives it; the client does
  not normalise it. A reset bumps an epoch so a late answer from before the
  reset cannot repopulate the state.
- **With no configuration** a usage read is "not configured" rather than an
  error (the configuration arriving late is a normal state), whereas a values
  read or a save with no configuration fails.
- **`resolveLocale`** returns the configured spelling, or the input unchanged;
  it does not report whether it matched.

## Editing session (M8)

- **Stable identity** is added to every finding (`id`): `t<n>` for a text node,
  `a<n>:<attribute>` for an attribute, numbered per node by a module-level
  `WeakMap`. Hidden items are addressed by it, never by list position.
- **Client calls follow the announcement synchronously.** `sink.open` is called
  first, then the values and usage reads are started together. A client that
  throws or rejects is reported to the sink as empty data with the error flag.
- **Late answers are dropped by the session** (not only by the panel): each
  open takes a selection token, and an answer for an earlier token, or one
  that arrives after `stop`, is not forwarded. This is redundant with the
  panel's own key check but costs one integer.
- **The Hidden list** starts "sent" as the empty list, so a page with no
  attribute translations tells the sink nothing, and a list that becomes empty
  is sent once.
- **A save is judged against the Locale at completion**, i.e. the Current
  Locale is read after the client answers, because the effect is on the page
  the Editor is looking at now.
- **A save that carries only Fields for the Current Locale** leaves the page
  `untouched`: there is no value to show.
- **Writing into the page** replaces the whole text node (or attribute) with
  the re-marked value for every Occurrence of the key found by the last scan,
  inside `silently`, then rescans immediately. A save that fails inside the
  client (it should not) is reported as `error: "save-failed"`.
- **A refused stale save** is `{ ok: false, error: "stale-selection", results:
  {}, page: "untouched" }`.
