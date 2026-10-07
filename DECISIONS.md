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

## Panel logic and store (M9)

- **State shape:** `selection { id, key, locale }`, `locales`, `schema`,
  `sourceLocale`, `meta`, `draft`, `baseline`, `usages`, `usagesLoading`,
  `usagesError`, `hidden`, `status { text, kind }`, `saving`, plus derived
  `rowOrder`, `title`, `shared`, `requiredErrors`, `tagErrors`, `conflicts`,
  `dirty { locales, columns, count }`, `unsavedKeys` and `canSave`.
- **The store satisfies the session's sink structurally** (`open`,
  `setValues`, `setUsage`, `setHidden`), so a Host can hand the store to the
  session directly. `setConfig` is the one extra inbound call.
- **Immutability:** inputs are cloned where they enter, the state is deep
  frozen once, and parts that did not change keep their identity between
  states (a keystroke in one row leaves the other rows' objects alone).
- **"Loaded" Locale** (for required Fields) means the store returned a row for
  it, or a save of it succeeded or came back as a conflict. The Current
  Locale's page seed and the Source Locale's source-message seed do not count,
  so seeds cannot block Save.
- **Values for a Locale absent from the stored rows** leave that Locale's draft
  and baseline alone, so the on-page seed is never wiped by a late read.
- **Tag guard** checks a Locale only when its translation string changed (a
  Field-only change would not put the string in the write).
- **Guard order in `save`:** nothing changed, then required Fields, then the
  tag guard. `canSave` reports the same order, preceded by no-selection,
  no-persist and saving.
- **Status tokens** follow the Locales in row order (the order of the diff),
  joined by two spaces: `da ✓`, `da ✗ (500)`, `da ✗`, `da ⚠ changed elsewhere`.
  A conflict needs the stored row in the result; a 409 without one is an
  ordinary failure.
- **What a save commits** is what was sent, not the draft at answer time, so
  typing during a save stays dirty.
- **Conflicts** record the conflicting columns with the server's own
  `conflictingColumns`; the list shown is derived (columns still different from
  the stored value), so typing back or cancelling clears it.
- **Drafts across keys** live in the store (open question 5): leaving a dirty
  key sets its draft, baseline, stored list and conflicts aside; opening it
  puts them back. Reopening the key that is already open keeps its draft too.
- **`explainSaveFailure`** returns `undefined` for success and for
  conflict-only results.
- **Not built (deferred):** memoised selectors (PNL-115), undo/redo, per-row
  save state, retry, save-all, structured status codes, snapshot/restore.

## End to end and release readiness (M10)

- **Package name** is `@intl-tms/core` (confirmed) with two entries, `.`
  (website) and `./tools` (editing tools).
- **Entry exports are pinned** in `test/entries.test.ts`, and the readme's two
  export tables are tested against the same runtime exports
  (`test/readme.test.ts`), so neither can drift.
- **The quick start is executed**: the readme's code block is extracted, its
  import rewritten to the source, and run against a real request.
- **Module-graph checks** (`test/package.test.ts`) follow relative imports from
  each entry. The website graph must contain no DOM module and mention no DOM
  global in code; the editing-tool graph must contain no server module; every
  source module must belong to an entry. Each guard was shown to fail on a
  deliberate violation.
- **Definition-of-done guards:** every exported declaration has a doc comment,
  no shipped doc comment references anything outside the package, no source file
  imports a non-relative module, the source never evaluates strings or injects
  markup, and no lint or type suppression exists anywhere.
- **Browser-grade rendering is unproven.** Everything here runs in a simulated
  DOM. Shaping, line breaking, overlay positioning and real clipboard behaviour
  of the Marker alphabet need the real-browser run the specification lists as an
  improvement (TST-10).

## Deferred (specified, deliberately not built)

Baseline requirements are all built. Improvements (▲) not built, by the plan's
rule of building only those a milestone lists:

- Catalog: lazy marking, exclusion, key mapping (CAT-21, 23, 24, 25); the gate
  helper (TGL-4).
- Codec: decode-all and compact mode (MRK-25, 26).
- Configuration: collect-all validation, stricter Locale/colour/attribute
  validation, richer Schema, highlight style options (VAL-21 to 26, SCH-30 to
  37, CFG-22 to 24, CFG-35 to 37).
- Server: 403 versus 401, route/key/Locale and identity in authorization,
  request identifiers, no-store, size limits, stored row and revision on writes, batch write, delete, audit and rate-limit
  hooks, atomic conflicts, bulk read, static usage ingestion, expiry,
  pagination, preflight max-age (SRV-26/27, AUT-4 to 6, RD-8 to 10, WR-30 to
  40, CON-20 to 23, USG-20 to 27, COR-8, COR-9).
- Page: shadow roots and frames, incremental and time-sliced scanning,
  visibility, overlay and range highlight, keyboard access, pass-through
  modifier, hover and badges, pause, observation re-establishment, accessible
  and themed picker, live preview, soft refresh, cancellation, prefetch, page
  inventory, navigation awareness (SCN-20 to 27, HL-61 to 71, PCK-10 to 14,
  SES-41 to 49).
- Client: batch and concurrent saves, cancellation signals, retries, read cache,
  de-duplication, bounded usage signatures, idle batching, back-off, fetching
  the configuration, request hook (CLI-70 to 81).
- Panel: memoised selectors, save all, per-column revert, undo and redo,
  structured status and localisable text, per-Locale save state, retry failed,
  per-column conflict resolution, value loading states, retained error reasons,
  completeness, copy from source, suggestion hook, companion toolbar store,
  richer live guards, length feedback, snapshot and restore, event stream
  (PNL-103 to 120).
- Quality: finer entries with size budgets, benchmarks, property tests beyond
  the codec, real-browser tests, machine-readable contract, recipes,
  self-check and diagnostics endpoint, authorization helpers, development
  warnings.

## Cross-site request protection (after M10)

- **Content type (WR-32):** a PUT or POST must declare `application/json`
  (parameters such as `charset` are ignored, matching is case-insensitive).
  Anything else, or nothing, is `415` with code `unsupported-media-type`. It is
  judged at the start of body reading, after authorization, like the rest of
  body validation.
- **Origin check (COR-9):** for writes only, after the method check and before
  authorization, a request carrying an `Origin` header is refused with `403` and
  code `forbidden-origin` unless that origin equals the request URL's origin,
  the origin of the configured base path (or values template), or a listed
  cross-origin origin. The base path origin is accepted so a proxy that rewrites
  the request URL does not break same-site saves.
- **No `Origin` header is allowed.** Browsers send it on every cross-site write;
  its absence means a non-browser caller with no ambient cookies. A deployment
  that must refuse those too can do so in `authorize`.
- **`Origin: null` is refused** (sandboxed frames and some privacy-stripped
  form posts).
- **Reads are not origin-checked**; the cross-origin policy decides who may read
  the answer.
- **Order:** method (405), origin (403), authorization (401), content type
  (415), JSON (400). A forged cross-site form post therefore never reaches
  authorization, storage or the body rules.
