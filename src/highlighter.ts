// Owns everything the editing flow does to the page's DOM: outlines, click
// handling and following mutations.
//
// The page stays the page's: a plain click does what it always did. Holding
// the edit modifier (Alt, Option on a Mac) turns a click on an outline into
// an edit, and keeps that whole gesture from the page.
//
// Highlighting is done with one injected stylesheet keyed on marker attributes,
// never with inline styles. That cannot overwrite a style the page set itself,
// can be removed perfectly, and works under a strict content security policy.

import { scan as scanRoot, type Found } from "./scanner.js";

/** The built-in highlight colours. */
export const DEFAULT_COLORS = { highlight: "#4CAF50", active: "#2196F3" } as const;

/** Attributes whose values are read by users or assistive technology, always scanned. */
export const DEFAULT_SCAN_ATTRIBUTES: readonly string[] = ["aria-label", "alt", "title", "placeholder"];

/** The parts of the served configuration the highlighter reads. */
export interface HighlighterConfig {
  colors?: { highlight?: string; active?: string };
  scanAttributes?: readonly string[];
}

/** The configuration with defaults applied. */
export interface HighlightSettings {
  colors: { highlight: string; active: string };
  scanAttributes: string[];
}

// Colours end up in a stylesheet. Accept hex, functional notation and keywords;
// anything that could close a declaration or a rule is not a colour.
const SAFE_COLOR = /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+|[a-zA-Z]+\([0-9a-zA-Z\s,.%/+-]*\))$/;

/**
 * Maps the served configuration to what the highlighter needs: the Developer's
 * colours over the built-in ones, and the Developer's scan attributes added to
 * the built-in set, never replacing it.
 */
export function highlightSettings(config: HighlighterConfig | undefined): HighlightSettings {
  const pick = (value: string | undefined, fallback: string): string => (value !== undefined && SAFE_COLOR.test(value) ? value : fallback);
  return {
    colors: { highlight: pick(config?.colors?.highlight, DEFAULT_COLORS.highlight), active: pick(config?.colors?.active, DEFAULT_COLORS.active) },
    scanAttributes: [...new Set([...DEFAULT_SCAN_ATTRIBUTES, ...(config?.scanAttributes ?? [])])],
  };
}

/** The attribute names the highlighter puts on elements so hosts and tests can find them. */
export interface MarkerAttributes {
  /** On every element carrying at least one found translation. */
  highlight: string;
  /** Also on an element whose translations are all in attributes (a Hidden translation). */
  attributeOnly: string;
  /** On the active element. */
  active: string;
  /** On an element while it is flashed. */
  flash: string;
  /** On the document's root element while the edit modifier is held. */
  armed: string;
}

const DEFAULT_MARKER_ATTRIBUTES: MarkerAttributes = {
  highlight: "data-tms-hl",
  attributeOnly: "data-tms-hl-attr",
  active: "data-tms-hl-active",
  flash: "data-tms-hl-flash",
  armed: "data-tms-hl-armed",
};

/**
 * Every event of a press that a page may act on. A menu or a native select
 * opens on the press, long before the click.
 */
const GESTURE_EVENTS = ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick", "auxclick"] as const;
/** What tells the highlighter whether the edit modifier is held. */
const MODIFIER_EVENTS = ["keydown", "keyup", "pointermove"] as const;

/** What {@link createHighlighter} is built from. */
export interface HighlighterOptions {
  /** Read freshly at every scan: the served configuration arrives later than the highlighter is built. */
  getConfig?: () => HighlighterConfig | undefined;
  /**
   * Receives every translation the clicked element carries, with the click
   * event. Called only for a click made with the edit modifier held.
   */
  onClick: (translations: readonly Found[], event: MouseEvent) => void;
  /** Receives what every completed scan found, including scans triggered by page mutations. */
  onScan?: (found: readonly Found[]) => void;
  attributes?: Partial<MarkerAttributes>;
  /** Injectable timers, so a test never sleeps. Defaults to the platform's, looked up at each use. */
  timers?: { setTimeout(callback: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
}

/** How long a flash lasts, in milliseconds. */
export const FLASH_DURATION_MS = 700;
/** The quiet period after the last mutation before the page is rescanned, in milliseconds. */
export const RESCAN_DEBOUNCE_MS = 100;
/** The longest a rescan waits under continuous mutation, in milliseconds. */
export const RESCAN_CEILING_MS = 500;

/** The highlighter. */
export interface Highlighter {
  /** Scans `root`, outlines what it holds and returns what it found. */
  scan(root: Document | Element): Found[];
  /** Makes one translation active (or none): its element is recolured in the active colour. */
  setActive(found: Found | undefined): void;
  /** The active translation, if any. */
  active(): Found | undefined;
  /**
   * Rescans `root` whenever it changes: nodes added or removed, text changed,
   * scanned attributes changed. Observing again replaces the previous
   * observation.
   */
  observe(root: Document | Element): void;
  /**
   * Runs `write`, which changes the page on the highlighter's behalf, without
   * the change being mistaken for the page changing. A saved value written
   * back into the page would otherwise trigger a rescan of its own doing.
   */
  silently<T>(write: () => T): T;
  /**
   * Scrolls an element into view (centred, smoothly, best effort) and gives it
   * a thicker active-colour outline for a moment, then restores its proper
   * outline. A second flash of the same element replaces the first's restore,
   * so the first cannot cut the second short.
   */
  flash(element: Element): void;
  /** The elements currently highlighted, with their translations. */
  highlights(): ReadonlyMap<Element, readonly Found[]>;
  /** Removes every outline, attribute and listener, and leaves the document as it was found. */
  clear(): void;
}

/** Creates a highlighter. */
export function createHighlighter(options: HighlighterOptions): Highlighter {
  const names: MarkerAttributes = { ...DEFAULT_MARKER_ATTRIBUTES, ...options.attributes };
  let highlighted = new Map<Element, readonly Found[]>();
  let style: HTMLStyleElement | undefined;
  let appliedColors = "";
  let activeFound: Found | undefined;
  let observation: { root: Document | Element; observer: MutationObserver } | undefined;
  const flashing = new Map<Element, unknown>();
  let debounceTimer: unknown;
  let ceilingTimer: unknown;
  let listening: { root: Document | Element; stop: () => void } | undefined;

  const sameTranslation = (a: Found, b: Found): boolean =>
    a.element === b.element && a.kind === b.kind && a.key === b.key && (a.kind === "text" ? b.kind === "text" && a.node === b.node : b.kind === "attribute" && a.attribute === b.attribute);

  const renderActive = (): void => {
    for (const element of highlighted.keys()) {
      if (activeFound?.element === element) element.setAttribute(names.active, "");
      else element.removeAttribute(names.active);
    }
  };

  /**
   * What an edit click on `element` means. A drop-down's options are drawn by
   * the browser outside the page and can never be clicked, so the select
   * answers for them as well as for itself.
   */
  const translationsAt = (element: Element): readonly Found[] | undefined => {
    const carrier = element.closest(`[${names.highlight}]`);
    const select = element.closest("select");
    if (select === null || (carrier !== null && carrier !== select)) return carrier === null ? undefined : highlighted.get(carrier);
    const all = [select, ...select.querySelectorAll(`[${names.highlight}]`)].flatMap((each) => highlighted.get(each) ?? []);
    return all.length === 0 ? undefined : all;
  };

  /**
   * Delegated listeners on the window handle every edit click, so adding and
   * removing highlighted elements costs nothing and rescans can never stack
   * handlers. They capture at the window, ahead of anything the page put on
   * the document or below, and stop the event where it stands.
   *
   * The press is never prevented at `pointerdown`: that would suppress the
   * `mousedown` whose default (taking focus, opening a select) is the one
   * that has to be prevented.
   */
  const listen = (root: Document | Element): void => {
    if (listening?.root === root) return;
    stopListening();
    const document = root.nodeType === 9 ? (root as Document) : (root.ownerDocument as Document);
    const view: EventTarget = document.defaultView ?? document;
    const arm = (held: boolean): void => {
      if (held) document.documentElement.setAttribute(names.armed, "");
      else document.documentElement.removeAttribute(names.armed);
    };
    const onGesture = (event: Event): void => {
      const press = event as MouseEvent;
      if (!press.altKey) return;
      const target = event.target as Node | null;
      const element = target?.nodeType === 1 ? (target as Element) : target?.parentElement;
      const translations = element === null || element === undefined || !root.contains(element) ? undefined : translationsAt(element);
      if (translations === undefined) return;
      if (!event.type.startsWith("pointer")) event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === "click") options.onClick(translations, press);
    };
    // The key may be pressed while another window (the panel) has focus, so the pointer is asked as well.
    const onModifier = (event: Event): void => arm((event as KeyboardEvent | MouseEvent).altKey);
    // The release will never be heard.
    const onBlur = (): void => arm(false);
    for (const type of GESTURE_EVENTS) view.addEventListener(type, onGesture, true);
    for (const type of MODIFIER_EVENTS) view.addEventListener(type, onModifier, true);
    view.addEventListener("blur", onBlur);
    listening = {
      root,
      stop: () => {
        for (const type of GESTURE_EVENTS) view.removeEventListener(type, onGesture, true);
        for (const type of MODIFIER_EVENTS) view.removeEventListener(type, onModifier, true);
        view.removeEventListener("blur", onBlur);
        arm(false);
      },
    };
  };

  const timers = options.timers ?? {
    setTimeout: (callback: () => void, ms: number): unknown => globalThis.setTimeout(callback, ms),
    clearTimeout: (id: unknown): void => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  };

  const cancelRescan = (): void => {
    if (debounceTimer !== undefined) timers.clearTimeout(debounceTimer);
    if (ceilingTimer !== undefined) timers.clearTimeout(ceilingTimer);
    debounceTimer = undefined;
    ceilingTimer = undefined;
  };

  const rescan = (): void => {
    cancelRescan();
    if (observation !== undefined) scan(observation.root);
  };

  /**
   * A trailing debounce alone never fires on a page that mutates continuously
   * (a clock, a ticker), so the first unscanned mutation also sets a ceiling
   * that later mutations do not move.
   */
  const scheduleRescan = (): void => {
    if (debounceTimer !== undefined) timers.clearTimeout(debounceTimer);
    debounceTimer = timers.setTimeout(rescan, RESCAN_DEBOUNCE_MS);
    ceilingTimer ??= timers.setTimeout(rescan, RESCAN_CEILING_MS);
  };

  const isOwnMutation = (record: MutationRecord): boolean =>
    style !== undefined &&
    (style.contains(record.target) || (record.target === style.parentNode && [...record.addedNodes, ...record.removedNodes].every((node) => node === style)));

  const handleRecords = (records: readonly MutationRecord[]): void => {
    if (records.some((record) => !isOwnMutation(record))) scheduleRescan();
  };

  const observe = (root: Document | Element): void => {
    observation?.observer.disconnect();
    cancelRescan();
    const attributeFilter = highlightSettings(options.getConfig?.()).scanAttributes;
    const observer = new MutationObserver(handleRecords);
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter });
    observation = { root, observer };
  };

  const silently = <T,>(write: () => T): T => {
    if (observation === undefined) return write();
    // Changes the page made before the write still count; the write's own do not.
    handleRecords(observation.observer.takeRecords());
    const result = write();
    observation.observer.takeRecords();
    return result;
  };

  const flash = (element: Element): void => {
    try {
      element.scrollIntoView?.({ block: "center", behavior: "smooth" });
    } catch {
      // Scrolling is best effort.
    }
    element.setAttribute(names.flash, "");
    const pending = flashing.get(element);
    if (pending !== undefined) timers.clearTimeout(pending);
    flashing.set(
      element,
      timers.setTimeout(() => {
        flashing.delete(element);
        element.removeAttribute(names.flash);
      }, FLASH_DURATION_MS),
    );
  };

  const stopListening = (): void => {
    listening?.stop();
    listening = undefined;
  };

  const stylesheet = (colors: HighlightSettings["colors"]): string =>
    [
      `[${names.highlight}] { outline: 2px solid ${colors.highlight}; outline-offset: 2px; }`,
      `[${names.armed}] [${names.highlight}] { outline-width: 3px; cursor: pointer; }`,
      `[${names.attributeOnly}] { outline-style: dashed; }`,
      `[${names.active}] { outline-color: ${colors.active}; }`,
      `[${names.flash}] { outline: 3px solid ${colors.active}; outline-offset: 2px; }`,
      `[${names.flash}][${names.attributeOnly}] { outline-style: dashed; }`,
    ].join("\n");

  const ensureStylesheet = (document: Document, colors: HighlightSettings["colors"]): void => {
    const signature = `${colors.highlight}|${colors.active}`;
    if (style === undefined || !style.isConnected) {
      style = document.createElement("style");
      style.setAttribute("data-tms-hl-style", "");
      (document.head ?? document.documentElement).appendChild(style);
      appliedColors = "";
    }
    // Colours are read fresh at every scan, so a late configuration takes effect.
    if (appliedColors !== signature) {
      style.textContent = stylesheet(colors);
      appliedColors = signature;
    }
  };

  const unhighlight = (element: Element): void => {
    element.removeAttribute(names.highlight);
    element.removeAttribute(names.attributeOnly);
    element.removeAttribute(names.active);
    element.removeAttribute(names.flash);
  };

  const scan = (root: Document | Element): Found[] => {
    const settings = highlightSettings(options.getConfig?.());
    ensureStylesheet(root.nodeType === 9 ? (root as Document) : (root.ownerDocument as Document), settings.colors);
    const found = scanRoot(root, { attributes: settings.scanAttributes });

    const grouped = new Map<Element, Found[]>();
    for (const item of found) {
      const group = grouped.get(item.element);
      if (group === undefined) grouped.set(item.element, [item]);
      else group.push(item);
    }
    for (const element of highlighted.keys()) if (!grouped.has(element)) unhighlight(element);
    for (const [element, translations] of grouped) {
      element.setAttribute(names.highlight, "");
      // Visible text is solid; an element with only attribute translations is dashed.
      if (translations.every((t) => t.kind === "attribute")) element.setAttribute(names.attributeOnly, "");
      else element.removeAttribute(names.attributeOnly);
    }
    highlighted = grouped;
    if (activeFound !== undefined) activeFound = found.find((item) => sameTranslation(item, activeFound!)) ?? activeFound;
    renderActive();
    listen(root);
    options.onScan?.(found);
    return found;
  };

  const setActive = (found: Found | undefined): void => {
    activeFound = found;
    renderActive();
  };

  const clear = (): void => {
    observation?.observer.disconnect();
    observation = undefined;
    cancelRescan();
    for (const [element, timer] of flashing) {
      timers.clearTimeout(timer);
      element.removeAttribute(names.flash);
    }
    flashing.clear();
    stopListening();
    activeFound = undefined;
    for (const element of highlighted.keys()) unhighlight(element);
    highlighted = new Map();
    style?.remove();
    style = undefined;
    appliedColors = "";
  };

  return { scan, observe, silently, flash, setActive, active: () => activeFound, highlights: () => highlighted, clear };
}
