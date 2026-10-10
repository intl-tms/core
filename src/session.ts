// The page-side flow as one module. A Host hears from it through a sink and
// drives it through a handful of commands. The flow lives here exactly once:
// two copies of it would drift.

import { encode, strip } from "./codec.js";
import type { Client, LocaleWrite } from "./client.js";
import { isPlain } from "./classification.js";
import { createHighlighter, type HighlighterConfig } from "./highlighter.js";
import { closePicker, openPicker } from "./picker.js";
import type { Found } from "./scanner.js";
import type { HiddenItem, SaveOutcome, SaveResult, Usage, ValuesEnvelope } from "./wire.js";

export type { HiddenItem } from "./wire.js";

/** Where the session puts what an Editor should see. A Host turns each call into its own transport. */
export interface SessionSink {
  /** A translation was clicked, or opened from the Hidden list. Called before any network. */
  open(key: string, locale: string, onPageValue: string): void;
  /** The stored values for the open key arrived, or failed. */
  setValues(key: string, values: ValuesEnvelope, error: boolean): void;
  /** The key's usages arrived, or failed. An unconfigured usage endpoint is an empty list, not an error. */
  setUsage(key: string, usages: Usage[], error: boolean): void;
  /** The page's attribute translations changed. */
  setHidden(items: HiddenItem[]): void;
}

/** What {@link createSession} is built from. */
export interface SessionOptions {
  sink: SessionSink;
  client: Pick<Client, "readValues" | "readUsage" | "save">;
  /** Read freshly each time: the configuration arrives after the session is built. */
  getConfig: () => HighlighterConfig | undefined;
  /** The Current Locale, read at each open and each save. */
  getLocale: () => string;
  /** Told what every completed scan found, for what only one Host does with a scan, such as reporting usage. */
  onScan?: (found: readonly Found[]) => void;
}

/** The session. */
export interface Session {
  /** Scans `root`, outlines what it holds and keeps doing so as it changes. Starting again rescans. */
  start(root: Document | Element): void;
  /**
   * Saves the per-Locale writes for `key` and reports what it did to the page.
   *
   * A save for a key that is not the active translation is refused, because
   * the page holds the selection and a save for another key would be written
   * to the wrong translation. The page shows one Locale, so only the Current
   * Locale's saved value is a candidate for display:
   *
   * - `updated`: it saved, the value is a Plain message, and it was written
   *   into the page (every Occurrence of the key, Marker re-attached).
   * - `stale`: it saved but is not Plain. Only the website's formatter can
   *   render it, so the page keeps the old text and the Host decides what
   *   happens next, typically a reload.
   * - `untouched`: the save did not include the Current Locale, or it failed.
   */
  save(key: string, writes: Record<string, LocaleWrite>): Promise<SaveOutcome>;
  /**
   * Writes `value` into every Occurrence of `key` on the page, Marker kept,
   * and scans again. For a Host that knows a newer value than the page was
   * rendered with. The value must be a Plain message: the page shows exactly
   * the text it is given. Does nothing for a key the page does not hold.
   */
  show(key: string, value: string): void;
  /** Opens a Hidden item for editing, exactly as if it had been clicked. A stale id does nothing. */
  openHidden(id: string): void;
  /** Flashes a Hidden item on the page, to locate something that has no visible text. A stale id does nothing. */
  flashHidden(id: string): void;
  /** Removes every outline, stops following the page, closes any picker and forgets the selection. Tells the sink nothing. */
  stop(): void;
}

const currentValue = (found: Found): string => strip(found.kind === "text" ? found.node.data : (found.element.getAttribute(found.attribute) ?? ""));

/** Creates a session. */
export function createSession(options: SessionOptions): Session {
  const { sink, client } = options;
  let root: Document | Element | undefined;
  let selection = 0;
  let hiddenById = new Map<string, Found>();
  let lastFound: readonly Found[] = [];
  let activeKey: string | undefined;
  const NO_HIDDEN = "[]";
  let lastHidden = NO_HIDDEN;

  const open = (found: Found): void => {
    highlighter.setActive(found);
    activeKey = found.key;
    const locale = options.getLocale();
    const value = currentValue(found);
    // The panel opens with something in it at once, before any network.
    sink.open(found.key, locale, value);
    const mine = ++selection;
    const current = (): boolean => mine === selection;
    const key = found.key;
    // The client never throws, but a Host may hand in one that does: a failed
    // load reaches the sink as empty data with the error flag, never as an exception.
    const attempt = <T>(call: () => Promise<T>, failed: T): Promise<T> => {
      try {
        return call().catch(() => failed);
      } catch {
        return Promise.resolve(failed);
      }
    };
    void attempt(() => client.readValues(key, { locale, value }), { values: { locales: {} }, error: true }).then((result) => current() && sink.setValues(key, result.values, result.error));
    void attempt(() => client.readUsage(key), { usages: [], error: true, configured: true }).then((result) => current() && sink.setUsage(key, result.usages, result.error));
  };

  const onClick = (translations: readonly Found[], event: MouseEvent): void => {
    // The edit gesture is kept from the page, the picker's own dismissal included.
    closePicker();
    if (translations.length === 1) return open(translations[0]!);
    const choices = translations.map((found) => ({ label: found.kind === "text" ? "text" : found.attribute, preview: currentValue(found), value: found }));
    void openPicker(choices, { x: event.clientX, y: event.clientY }).then((chosen) => chosen !== undefined && open(chosen));
  };

  /**
   * After every scan, whoever asked for it, publishes the attribute
   * translations in document order. The list is sent only when it changed, and
   * the value is part of what changed: saving a Hidden translation changes
   * nothing else, and the list must show what was saved.
   */
  const publishHidden = (found: readonly Found[]): void => {
    const hidden = found.filter((item) => item.kind === "attribute");
    hiddenById = new Map(hidden.map((item) => [item.id, item]));
    const items: HiddenItem[] = hidden.map((item) => ({ id: item.id, attribute: item.kind === "attribute" ? item.attribute : "", key: item.key, value: item.value }));
    const signature = JSON.stringify(items);
    if (signature === lastHidden) return;
    lastHidden = signature;
    sink.setHidden(items);
  };

  const highlighter = createHighlighter({
    getConfig: options.getConfig,
    onClick,
    onScan: (found) => {
      lastFound = found;
      publishHidden(found);
      options.onScan?.(found);
    },
  });

  /** Writes `value` into every Occurrence of `key` on the page, keeping the Marker so it stays clickable. */
  const writeIntoPage = (key: string, value: string): void => {
    const marked = encode(value, key);
    highlighter.silently(() => {
      for (const found of lastFound) {
        if (found.key !== key || !found.element.isConnected) continue;
        if (found.kind === "text") found.node.data = marked;
        else found.element.setAttribute(found.attribute, marked);
      }
    });
    // Rescan now rather than waiting for the debounce, so the Hidden list
    // already carries the new value when the Host answers the save.
    if (root !== undefined) highlighter.scan(root);
  };

  const save = async (key: string, writes: Record<string, LocaleWrite>): Promise<SaveOutcome> => {
    if (activeKey !== key) return { ok: false, error: "stale-selection", results: {}, page: "untouched" };
    let result: SaveResult;
    try {
      result = await client.save(key, writes);
    } catch {
      return { ok: false, error: "save-failed", results: {}, page: "untouched" };
    }
    const locale = options.getLocale();
    const value = writes[locale]?.value;
    if (value === undefined || result.results[locale]?.ok !== true) return { ...result, page: "untouched" };
    if (!isPlain(value)) return { ...result, page: "stale" };
    writeIntoPage(key, value);
    return { ...result, page: "updated" };
  };

  return {
    save,
    start(target) {
      root = target;
      highlighter.scan(target);
      highlighter.observe(target);
    },
    show(key, value) {
      if (root !== undefined && lastFound.some((found) => found.key === key)) writeIntoPage(key, value);
    },
    openHidden(id) {
      const found = hiddenById.get(id);
      if (found !== undefined) open(found);
    },
    flashHidden(id) {
      const found = hiddenById.get(id);
      if (found !== undefined) highlighter.flash(found.element);
    },
    stop() {
      highlighter.clear();
      closePicker();
      selection++;
      root = undefined;
      hiddenById = new Map();
      lastFound = [];
      activeKey = undefined;
      lastHidden = NO_HIDDEN;
    },
  };
}
