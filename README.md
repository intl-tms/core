# @intl-tms/core

The **Core** of an in-context translation management system: the library-agnostic
package that sits on both sides of the seam between a website and the editing
tools that work on it.

A website renders translated text. The Core makes every rendered string carry an
invisible identifier of the translation key it came from. An editing tool running
on the page (a browser extension, a component-workbench addon) decodes those
identifiers, lets an Editor Alt-click any text, edit it in every Locale, and save it.
The website stores the change through a storage adapter **you** write.

- **Call sites never change.** Marking happens once, on the assembled message
  Catalog, before your i18n library sees it.
- **No runtime dependencies.** Web-standard APIs only; no platform module is
  imported anywhere.
- **You own storage and authorization.** The Core defines the seam and never
  crosses it. Neither has a default.
- **Off means off.** With editing switched off your output is byte-for-byte what
  it would be without the Core.

It contains no storage code and no i18n-library code. The website and
editing-tool entries contain no view code either; the one view the package
ships is the plain-DOM panel of the [Storybook addon](#storybook), on its own
entry.

## Quick start

Three steps: describe the setup, mark the Catalog, serve the endpoints.

<!-- quickstart:start -->
```ts
import { createHandler, createMemoryAdapter, markCatalog, resolveConfig } from "@intl-tms/core";

// 1. Describe your setup. Locales and one absolute base path are a complete,
//    working configuration. Mistakes throw here, at boot, naming the value.
export const config = resolveConfig({
  locales: ["en", "da"],
  basePath: "https://app.example.com/api/tms",
  sourceLocale: "en",
});

// 2. Mark the merged message Catalog, for editing sessions only. Your i18n
//    library then formats marked strings as if they were plain.
export function messagesFor(catalog: Record<string, unknown>, isEditingSession: boolean) {
  return isEditingSession ? markCatalog(catalog) : catalog;
}

// 3. Serve the endpoints. The handler is one function from a web Request to a
//    web Response, so mounting it is a re-export on any modern framework.
const EDITOR_TOKEN = "replace-me"; // your real check goes here: a session, a role
export const handler = createHandler({
  config,
  adapter: createMemoryAdapter(), // for tests and spikes only: write your own
  authorize: ({ request }) => request.headers.get("x-editor-token") === EDITOR_TOKEN,
});
```
<!-- quickstart:end -->

Mount `handler` at the path of your base path (`/api/tms` above). In a framework
that speaks standard requests that is one line, for example
`export const GET = handler; export const PUT = handler; export const POST = handler;`.

Then, in the editing tool, wire a session to a panel store (the Core ships both;
the views are yours):

```ts
import { createClient, createPanelStore, createSession } from "@intl-tms/core/tools";

const client = createClient({ getConfig: () => served /* GET {basePath}/config */ });
const panel = createPanelStore({ persist: (changes) => session.save(panel.getState().selection!.key, changes) });
const session = createSession({ sink: panel, client, getConfig: () => served, getLocale: () => document.documentElement.lang });
session.start(document);
```

The panel store is the session's sink directly. Render `panel.getState()` however
you like and subscribe with `panel.subscribe`.

## Storybook

Translations can be edited in Storybook as well, with no browser extension. The
addon is configured in code, in `.storybook/preview.ts`, and imports nothing
from Storybook, so it works with every renderer and adds no dependency.

```tsx
import { NextIntlClientProvider } from "next-intl";
import { createStorybookAddon } from "@intl-tms/core/storybook";
import en from "../messages/en.json";
import da from "../messages/da.json";

const messages = { en, da };

const tms = createStorybookAddon({
  // The address of your handler's configuration endpoint, or the resolved configuration itself.
  config: "https://app.example.com/api/tms/config",
});

export default {
  globalTypes: {
    locale: { toolbar: { title: "Locale", icon: "globe", items: ["en", "da"] } },
    ...tms.globalTypes, // the "Edit translations" switch in the toolbar
  },
  initialGlobals: { locale: "en", ...tms.initialGlobals },
  decorators: [
    // Yours: hand your i18n library the messages, marked while edit mode is on.
    (Story, context) => (
      <NextIntlClientProvider locale={context.globals.locale} messages={tms.mark(messages[context.globals.locale], context)}>
        <Story />
      </NextIntlClientProvider>
    ),
    tms.decorator, // the editing session and the panel
  ],
};
```

Switch **Edit translations** on in the toolbar, hold Alt and click an outlined
text. The panel is docked inside the preview, and saves go to the same
endpoints the website serves.

| Option | Meaning |
| --- | --- |
| `config` | Required. The configuration endpoint's address, used exactly as written, or a resolved configuration object. |
| `request` | How requests are made; defaults to `fetch`. Add a token header here, or call a handler directly: `(url, init) => handler(new Request(url, init))` needs no server. |
| `credentials` | `"include"` sends the website's cookies from Storybook's origin. |
| `locale` | `(context) => string`, the Locale a story is rendered in. Defaults to the `locale` global, then `<html lang>`, then the Source Locale. |
| `editing` | Start switched on. Defaults to off. |
| `placement` | `"right"` (default), `"left"` or `"bottom"`. |
| `onSaved` | Called with `{ key, writes, outcome }` after every save that got an answer. |
| `timeoutMs` | The time limit of every request. |

Things to know:

- **Storybook is another origin.** List it in the handler's cross-origin policy,
  `cors: { origins: ["http://localhost:6006"] }`, or writes are refused with
  `403` and reads are blocked by the browser. `authorize` still decides who may
  read and write: give the addon a `request` that carries what it checks.
- **Off means off here too.** With the switch off, `tms.mark` returns the very
  same Catalog, and no request, element or stylesheet is created.
- **A story shows what the store holds, not only what Storybook bundled.** While
  edit mode is on, the addon reads the stored values of every key a story
  shows (one request per key, each key once, six at a time), writes a value
  that differs into the story, and `tms.mark` lays them over the Catalog for
  later renders. A message that needs the formatter (an argument, a plural,
  tags) is not replaced in place; it shows on the story's next render. With
  edit mode off a story is exactly the bundled messages.
- **Usage is never reported from Storybook.** A story's address is not a page
  of the website. "Used on" still lists the website's pages and opens them in a
  new tab.
- **Diagnostics.** The panel ends with a collapsed Diagnostics pane that logs
  the configuration, every opened key, every read and every save with what
  was sent and answered. It opens by itself when something fails, including a
  configuration that would not load.
- The panel lives in a shadow root in the preview, so story styles and panel
  styles cannot reach each other, and it works in docs mode as well.

### Your storage adapter

Four operations are the whole required surface. Prove yours with one test file:

```ts
import { runAdapterConformance } from "@intl-tms/core";

const report = await runAdapterConformance(myAdapter, { locale: "en", fieldName: "status" });
expect(report.failures).toEqual([]);
```

| Operation | Contract |
| --- | --- |
| `getValues(key)` | Every stored Locale for the key. **Sparse**: a Locale with no row is absent. Empty when nothing is stored. |
| `saveValue(key, write)` | Upsert one (key, Locale) as a **partial merge** of the supplied columns. A new row starts with an empty `value`. An empty string is a real value. Use `writePatch(write)`; an empty patch means do nothing. |
| `getUsage(key)` | A key's usages, most recently seen first. Empty when none. |
| `reportUsage(report)` | Upsert each (key, URL), overwriting count and last-seen. **Never prune.** |

An adapter typed for one configuration is a compile error to hand to a handler
built for another; an untyped adapter fits any configuration.

## The wire contract

Relative to the mount point. A key is only ever the path segment after a prefix,
so a key named `config` or `usage` is still just a key.

| Method | Path | Operation | Answers |
| --- | --- | --- | --- |
| GET | `/config` | read | The resolved configuration |
| GET | `/keys/{key}` | read | `{ meta?, locales }`, with only the Locales that have a stored row |
| PUT | `/keys/{key}` | write | One Locale's partial write; `{ ok: true }` |
| POST | `/usage` | write | One page's sightings; `{ ok: true, count }` |
| GET | `/usage/{key}` | read | Where a key is used, most recent first; `[]` when none |

A write is `{ locale, value?, fields?, expected? }`. With `expected` (what the
sender loaded for each column it names) the write is *checked*: a column whose
stored value differs from what was expected **and** from what is being written
answers `409 { error: "conflict", current }` and nothing is written.

Every error is `{ error, code }`. Statuses: `400` invalid body or path, `401`
authorization denied, `403` origin not allowed, `404` no such route, `405` wrong method (with `Allow`),
`409` write conflict, `415` write not sent as JSON, `500` fixed generic body. The real cause of a 500 goes to
your `onError` hook, never to the response.

## Security

**Read this before you ship.**

- **The Toggle protects nothing.** The cookie `tms-edit=1` is a user-interface
  switch that tells your website to mark its Catalog. Anyone can set a cookie.
  Protection lives in `authorize`, never in the Toggle.
- **`authorize` is required and has no default.** It receives the request and the
  operation (`read` for GET, `write` for PUT and POST) and must answer `true`
  to allow. Anything else, including `undefined`, denies. It is *not* consulted
  for a CORS preflight, because a preflight carries no credentials.
- **The configuration endpoint publishes every other endpoint by design.**
  Anyone who may read it learns where everything is.
- **Deny writes to anyone who may not translate.** Gate reads too, unless your
  translations and page URLs are public.
- **All network input is validated and rebuilt** before it reaches your adapter:
  it never receives an undeclared field, an unlisted Locale, a Read-only Field, a
  Select value outside its options, or an object where a string belongs.
- **Cross-origin access is off unless configured**, by an explicit list of exact
  origins. There is no wildcard (building the handler with `*` throws). Cookies
  and credentials are a separate explicit choice. Every response to a listed
  origin names it, errors included, and every response declares
  `Vary: Origin`.
- **Stored usage URLs must be http or https**, checked where they enter.
  Tools that follow one should check again with `isHttpUrl`.
- **Text is only ever inserted into the page as text**, never as markup.
- **Cross-site request protection for writes.** Every write (PUT and POST)
  must be sent as `application/json`, which a cross-site HTML form cannot do
  without a preflight, and a write whose `Origin` is neither the website's own
  nor listed in your cross-origin policy is refused with `403` **before
  authorization runs**. "The website's own" is the origin of the request URL or
  of your base path, so a proxy that rewrites the URL is fine. A request with no
  `Origin` header (a server, a script) is allowed: it carries no ambient
  cookies to abuse. If a browser extension or a Storybook talks to your
  endpoints from its own origin, list that origin in `cors.origins`. Reads are not origin-checked; the
  cross-origin policy decides who may read the answer.
- **The highlighter injects one `<style>` element.** It never writes inline
  styles, but a page whose content security policy forbids inline `<style>`
  elements needs `style-src` to allow it for editing sessions.

## What marking does to your strings

These are properties of the approach, not defects.

- A marked string is **longer** than its visible text; length checks,
  truncation and `maxlength` see the marker.
- A marked string is **not equal** to its unmarked form: string comparison,
  `switch` on translated text and snapshot tests will differ.
- Marked text must never reach **emails, logs, analytics, search indexes,
  structured data or the document head**. `strip(text)` removes every marker.
- An accessible name built from a marked attribute contains the marker
  characters. Editing sessions are not production sessions, which is what the
  Toggle is for.
- Empty strings are marked too, so a missing translation is something an Editor
  can find and fill.
- Marking is memoised by Catalog object: treat a Catalog you have passed to
  `markCatalog` as immutable.

A marker is `U+2063 · version · key bytes · CRC-8 · U+2064`, each byte as two
variation-selector characters (`U+FE00`–`U+FE0F`): two invisible characters per
key byte plus a small constant. A damaged marker decodes to nothing rather than to
a wrong key.

## Entry points

Three audiences, three entries. Only the website entry carries a stability
promise; the editing-tool and Storybook entries change with the tools that
consume them, so pin an exact version if you build on them.

### `@intl-tms/core` (website)

| Group | Exports |
| --- | --- |
| Marker codec | `encode`, `decode`, `detect`, `strip` |
| Catalog | `markCatalog` |
| Toggle | `TOGGLE_COOKIE_NAME`, `TOGGLE_ON_VALUE` |
| Message classification | `tagNames`, `hasTags`, `isPlain`, `tagMismatch`, `isSharedKey`, `SHARED_NOTICE` |
| Configuration | `resolveConfig`, `ConfigError`, `PROTOCOL_VERSION`, `resolveEndpoint` |
| Wire helpers | `fieldText`, `writePatch`, `isEmptyPatch`, `conflictingColumns` |
| Usage helpers | `normalizeUrl`, `usageSignature` |
| Storage | `createMemoryAdapter`, `detectAdapterCapabilities`, `runAdapterConformance` |
| Handler | `createHandler` |

### `@intl-tms/core/tools` (editing tools)

| Group | Exports |
| --- | --- |
| Scanner | `scan` |
| Highlighter | `createHighlighter`, `highlightSettings`, `DEFAULT_COLORS`, `DEFAULT_SCAN_ATTRIBUTES` |
| Picker | `openPicker`, `closePicker` |
| Editing session | `createSession` |
| Client | `createClient`, `DEFAULT_TIME_LIMIT_MS`, `USAGE_COOLDOWN_MS` |
| Locale | `resolveLocale` |
| Usage helpers | `aggregateUsage`, `isHttpUrl` |
| Panel store | `createPanelStore` |
| Panel logic | `buildChanges`, `changedColumns`, `shouldRenderToolbar`, `resolveToolbarFilters`, `visibleLocales`, `hiddenErrors`, `usagePath`, `relativeTime`, `conflictNotice`, `explainSaveFailure`, `fieldText`, `PANEL_TEXT` |
| Shared rule | `isSharedKey`, `SHARED_NOTICE` |

### `@intl-tms/core/storybook` (Storybook addon)

| Group | Exports |
| --- | --- |
| Addon | `createStorybookAddon`, `EDIT_GLOBAL`, `STORYBOOK_TEXT` |
| Built-in panel | `createPanelView`, `createLog`, `PANEL_CSS`, `PANEL_VIEW_TEXT` |

`createPanelView` is the addon's panel on its own: plain DOM over
`createPanelStore`, for a Host that wants a working panel without writing a
view. It is a session's sink directly, and it carries the same Diagnostics
pane as the Extension's panel: a log of every open, read and save, opened
automatically when something fails, with Copy and Clear. `createLog` is that
log, for a Host that wants to add entries of its own.

The list of public names on each entry is pinned by a test.

## Configuration

```ts
resolveConfig({
  locales: ["en", "da", "es"],                 // required, ordered, at least one
  basePath: "https://app.example.com/api/tms", // absolute; required unless endpoints.values is given
  sourceLocale: "en",                          // optional; must be one of the locales
  endpoints: { values, usageReport, usageRead }, // optional overrides; key templates need {key}
  schema: {
    valueField: { type: "textarea" },          // "text" (default) | "textarea"
    fields: [                                  // text | textarea | select | readonly
      { type: "select", name: "status", required: true, options: [{ label: "Draft", value: "draft" }] },
    ],
    toolbar: { search: true, filters: [{ field: "status" }] },
  },
  colors: { highlight: "#4CAF50", active: "#2196F3" },
  scanAttributes: ["data-tooltip"],            // added to aria-label, alt, title, placeholder
});
```

The Locale list keeps its literal type, a Locale's row type is derived from the
Schema (a Select narrows to its option values), and an adapter typed for another
configuration is a compile error. Reserved Field names (`value`, `locale`,
`expected`, `fields`, `revision`) are rejected at boot.

## Not built yet

The baseline is complete. These improvements are specified but deliberately left
for later: lazy and excluded Catalog marking, the gate helper, batch writes,
atomic conflicts, size limits on bodies, keys and values, incremental and time-sliced scanning, bulk read and prefetch,
request cancellation, server-side message guards, rate limits, the diagnostics
endpoint, localisable panel text, undo, per-row save state, and real-browser
tests. `DECISIONS.md` lists every choice made where the specification was silent.

## Development

```
npm test          # unit, contract, end-to-end and type-level tests
npm run typecheck # strict TypeScript, no unchecked index access
npm run lint      # eslint plus repository checks (platform imports, doc comments)
npm run build     # emits ESM and type declarations to dist/
npm run check     # all of the above
```
