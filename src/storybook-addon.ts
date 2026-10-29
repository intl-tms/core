// The component-workbench addon: a Host of the editing session that a
// Developer configures in the workbench's preview file. It needs no browser
// extension and imports nothing from the workbench: a decorator, a toolbar
// switch and a preview-side panel are all plain objects and plain DOM.

import { mapCatalog, markCatalog, type Catalog, type MarkOptions } from "./catalog.js";
import { isPlain } from "./classification.js";
import { createClient, DEFAULT_TIME_LIMIT_MS, type ClientConfig, type RequestFn } from "./client.js";
import { PROTOCOL_VERSION } from "./config.js";
import type { HighlighterConfig } from "./highlighter.js";
import { resolveLocale } from "./locale.js";
import type { Found } from "./scanner.js";
import type { PanelWrite } from "./panel-logic.js";
import type { PanelConfig } from "./panel-store.js";
import { PANEL_CSS } from "./panel-style.js";
import { createPanelView, type PanelView } from "./panel-view.js";
import { createSession } from "./session.js";
import { isHttpUrl } from "./usage.js";
import type { SaveOutcome } from "./wire.js";
import { builtInSignInView, createWorkbenchSignIn, type SignInControls, type SignInView, type WorkbenchSignIn } from "./workbench-sign-in.js";

/** The name of the workbench global that holds the edit-mode switch. Its value is `"on"` or `"off"`. */
export const EDIT_GLOBAL = "tmsEdit";

/** The default English strings of the addon: the toolbar switch, the panel frame, and why a configuration was refused. */
export const STORYBOOK_TEXT = {
  name: "Translations",
  description: "Edit translations on the rendered story",
  off: "Edit translations: off",
  on: "Edit translations: on",
  collapse: "Hide",
  expand: "Show",
  stale: "Saved. This message uses formatting, so the story shows it once it renders with the saved message.",
  configFailed: (reason: string) => `The editing configuration could not be loaded: ${reason}. Outlines work; values cannot be read or saved.`,
  timedOut: (ms: number) => `the website did not answer within ${ms / 1000} seconds`,
  status: (status: number) => `the website answered with status ${status}`,
  notConfiguration: "the address answered with something that is not an editing configuration",
  websiteNewer: "the website speaks a newer editing protocol than this addon; update the package",
  websiteOlder: "the website speaks an older editing protocol than this addon; update the website",
} as const;

/** The parts of a configuration the addon uses. A resolved configuration fits as it is. */
export type StorybookConfig = ClientConfig & HighlighterConfig & PanelConfig;

/** The part of a workbench story context the addon reads. Every workbench renderer's context fits. */
export interface StorybookContext {
  /** The workbench globals: the toolbar's values. */
  globals?: Readonly<Record<string, unknown>>;
  /** The element the story renders into. */
  canvasElement?: unknown;
}

/** One save made from the workbench. */
export interface StorybookSave {
  key: string;
  /** What was sent, per Locale: only the changed columns. */
  writes: Record<string, PanelWrite>;
  /** What the website answered, and what that did to the story. */
  outcome: SaveOutcome;
}

/** What {@link createStorybookAddon} is built from. */
export interface StorybookAddonOptions {
  /**
   * The website's configuration: the address of its configuration endpoint,
   * used exactly as written, or the resolved configuration itself when the
   * workbench can import it.
   */
  config: string | StorybookConfig;
  /**
   * How requests are made. Defaults to the platform's `fetch`. A request
   * handler can be called directly here, so a workbench needs no server at
   * all. The editing token is added to what this is given, for requests to
   * the website only.
   */
  request?: RequestFn;
  /**
   * Draws the sign-in area of the panel: given an empty element and the
   * sign-in's state and actions, it returns a function that cleans up.
   * Without one, the addon shows its own sign-in line. Signing in always goes
   * through the website's pop-up.
   */
  signInView?: SignInView;
  /** The time limit of every request, the configuration fetch included. */
  timeoutMs?: number;
  /**
   * The Locale a story is rendered in. Defaults to the workbench global named
   * `locale`, then the document's language, then the Source Locale.
   */
  locale?: (context: StorybookContext) => string | undefined;
  /** Whether edit mode starts switched on. Defaults to off. */
  editing?: boolean;
  /** The edge of the preview the panel is docked to. Defaults to `right`. */
  placement?: "right" | "left" | "bottom";
  /**
   * Told about every save that got an answer. A story renders the messages the
   * workbench bundled, so this is where a Developer who wants saved values to
   * outlive a re-render updates them.
   */
  onSaved?: (save: StorybookSave) => void;
  /** Where the reason a configuration failed is written. */
  console?: Pick<Console, "error">;
}

/** One item of the toolbar switch. */
export interface StorybookToolbarItem {
  value: "off" | "on";
  title: string;
}

/** The declaration of the edit-mode switch, in the shape a workbench preview's `globalTypes` takes. */
export interface StorybookGlobalType {
  description: string;
  toolbar: { title: string; icon: "edit"; items: StorybookToolbarItem[]; dynamicTitle: boolean };
}

/** The addon: what a Developer spreads into the workbench preview, and two helpers for marking messages. */
export interface StorybookAddon {
  /**
   * Add to the preview's `decorators`. It renders nothing and returns the
   * story untouched; while edit mode is on it keeps the editing session and
   * the panel running in the preview.
   */
  decorator: <Rendered>(story: () => Rendered, context: StorybookContext) => Rendered;
  /** Spread into the preview's `globalTypes`: the toolbar switch. */
  globalTypes: Record<typeof EDIT_GLOBAL, StorybookGlobalType>;
  /** Spread into the preview's `initialGlobals`: the switch's starting position. */
  initialGlobals: Record<typeof EDIT_GLOBAL, "off" | "on">;
  /** Whether edit mode is on for the story being rendered. */
  isEditing(context: StorybookContext): boolean;
  /**
   * Marks a Catalog while edit mode is on, and returns the very same object
   * while it is off. Call it where the preview hands messages to the i18n
   * library, with the Catalog of the Locale the story is rendered in.
   *
   * What the store holds is laid over the Catalog first: the values read for
   * the keys the preview has shown, and what was saved from it. So a story
   * that renders again shows what an Editor saved and not what the workbench
   * bundled. Nothing is laid over while edit mode is off.
   */
  mark<T extends Catalog>(catalog: T, context: StorybookContext, options?: MarkOptions): T;
  /** Switches edit mode off in this preview: removes the panel and every outline. The switch itself is the workbench's. */
  stop(): void;
}

/** How many keys' stored values are read at once. A story can hold hundreds of keys and each is one request. */
export const STORED_READ_LIMIT = 6;

type ConfigLoad = { ok: true; config: StorybookConfig } | { ok: false; reason: string; unauthenticated?: boolean };

const TAG = "[intl-tms]";
const HOST_ATTRIBUTE = "data-tms-panel";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The Editor's name a served configuration gives, when it gives one as text. */
function nameIn(config: unknown): string | undefined {
  if (!isObject(config) || !isObject(config.access)) return undefined;
  const name = config.access.name;
  return typeof name === "string" && name !== "" ? name : undefined;
}

/** Whether a parsed response has the shape of a served configuration. */
function isConfiguration(value: unknown): value is StorybookConfig & { protocol?: unknown } {
  return (
    isObject(value) &&
    Array.isArray(value.locales) &&
    value.locales.every((locale) => typeof locale === "string") &&
    isObject(value.endpoints) &&
    typeof value.endpoints.values === "string" &&
    (value.schema === undefined || isObject(value.schema)) &&
    (value.sourceLocale === undefined || typeof value.sourceLocale === "string")
  );
}

/**
 * Creates the addon. Nothing happens at construction and nothing happens while
 * edit mode is off: no request, no element, no stylesheet.
 *
 * It contains no editing logic. Scanning, outlining, the click flow, reading,
 * saving and writing back into the story are the editing session's; this
 * module supplies only what a workbench knows: the switch, the Locale a story
 * is rendered in, the configuration, and a place to put the panel.
 *
 * Usage is never reported from a workbench: a story's address is not a page
 * of the website, and reporting it would fill "Used on" with addresses no
 * Editor can visit.
 */
export function createStorybookAddon(options: StorybookAddonOptions): StorybookAddon {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIME_LIMIT_MS;
  const base: RequestFn = options.request ?? ((url, init) => fetch(url, init));
  /** Created with the first document, because it needs the workbench's window. */
  let signIn: WorkbenchSignIn | undefined;
  // Every request goes through the sign-in, which adds the token for the website and notices refusals.
  const request: RequestFn = (url, init) => (signIn?.request ?? base)(url, init);
  const source = typeof options.config === "string" ? options.config : undefined;

  let config: StorybookConfig | undefined = typeof options.config === "string" ? undefined : options.config;
  let loading: Promise<void> | undefined;
  let context: StorybookContext = {};
  /** What the store holds, by Locale and key: read for the keys a story showed, or saved from this preview. */
  const known = new Map<string, Map<string, string>>();
  /** What the workbench bundled, by Locale and key, as far as `mark` has seen it. */
  const bundled = new Map<string, Map<string, string>>();
  /** The Catalogs already built from `known`. Emptied whenever `known` changes. */
  let overlaid = new WeakMap<Catalog, Map<string, Catalog>>();
  /** Keys whose stored values were asked for, those that failed, and those still waiting for a free request. */
  const asked = new Set<string>();
  const failed = new Set<string>();
  const waiting: string[] = [];
  /** What the Editor saved here: a read that answers late must not put an older value back. */
  const savedHere = new Set<string>();
  /** Keys with a save on its way: what is known about them is about to be out of date. */
  const saving = new Set<string>();
  let reading = 0;
  let lastFound: readonly Found[] = [];
  let showing = false;

  const of = (map: Map<string, Map<string, string>>, name: string): Map<string, string> => {
    let values = map.get(name);
    if (values === undefined) map.set(name, (values = new Map()));
    return values;
  };
  let running: { document: Document; host: HTMLElement; view: PanelView; signInArea: HTMLElement; unmountSignIn: () => void } | undefined;
  const notices: { config?: string; save?: string } = {};

  const isEditing = (story: StorybookContext): boolean => story.globals?.[EDIT_GLOBAL] === "on";

  function localeOf(story: StorybookContext): string {
    const global = story.globals?.locale;
    const declared = (options.locale?.(story) ?? (typeof global === "string" ? global : "")).trim() || (documentOf(story)?.documentElement.getAttribute("lang")?.trim() ?? "");
    // A guess, but at a Locale that exists.
    if (declared === "") return config?.sourceLocale ?? config?.locales?.[0] ?? "";
    return resolveLocale(declared, config?.locales ?? []);
  }

  function showNotices(): void {
    const text = [notices.config, notices.save].filter((part) => part !== undefined).join(" ");
    running?.view.setNotice(text === "" ? undefined : text);
  }

  const client = createClient({ getConfig: () => config, request, timeoutMs });

  const session = createSession({
    client,
    getConfig: () => config,
    getLocale: () => localeOf(context),
    onScan: (found) => {
      lastFound = found;
      readStored(found);
      showStored();
    },
    sink: {
      open(key, openedIn, value) {
        // A click on the story is a request to see the panel.
        running?.host.removeAttribute("data-tms-collapsed");
        notices.save = undefined;
        showNotices();
        running?.view.open(key, openedIn, value);
      },
      setValues: (key, values, error) => running?.view.setValues(key, values, error),
      setUsage: (key, usages, error) => running?.view.setUsage(key, usages, error),
      setHidden: (items) => running?.view.setHidden(items),
    },
  });

  /**
   * Puts what the store holds in front of the Editor where the story was
   * rendered with something else. Only where the text can simply be replaced:
   * a message the formatter has to render, stored or bundled, waits for the
   * next render, where `mark` supplies it.
   */
  function showStored(): void {
    // Showing a value scans again, which comes back here.
    if (showing || running === undefined) return;
    const renderedIn = localeOf(context);
    const values = known.get(renderedIn);
    if (values === undefined) return;
    showing = true;
    try {
      const done = new Set<string>();
      for (const found of lastFound) {
        const value = values.get(found.key);
        if (value === undefined || value === found.value || done.has(found.key) || !isPlain(value)) continue;
        // The save writes the new value into the page itself. Until it has answered, the value
        // known here is the old one, and showing it would undo what was just saved.
        if (saving.has(found.key)) continue;
        if (!isPlain(bundled.get(renderedIn)?.get(found.key) ?? "")) continue;
        done.add(found.key);
        session.show(found.key, value);
      }
    } finally {
      showing = false;
    }
  }

  /** Starts as many of the waiting reads as the limit allows. */
  function pump(): void {
    while (reading < STORED_READ_LIMIT && waiting.length > 0) {
      const key = waiting.shift()!;
      reading++;
      void client
        .readValues(key)
        .then(
          (result) => {
            if (result.error) return void failed.add(key);
            for (const [locale, row] of Object.entries(result.values.locales)) {
              if (typeof row?.value !== "string" || savedHere.has(`${locale}\n${key}`)) continue;
              of(known, locale).set(key, row.value);
              // Every Catalog built before this answer is out of date.
              overlaid = new WeakMap();
            }
            showStored();
          },
          () => void failed.add(key),
        )
        .finally(() => {
          reading--;
          pump();
        });
    }
  }

  /**
   * Asks the store, once per key, what it holds for the keys a story shows. A
   * story is rendered from what the workbench bundled, which is not what an
   * Editor last saved.
   */
  function readStored(found: readonly Found[]): void {
    // Without a configuration there is nowhere to ask; its arrival scans again.
    if (config === undefined) return;
    for (const { key } of found) {
      if (asked.has(key)) continue;
      asked.add(key);
      waiting.push(key);
    }
    pump();
  }

  async function save(key: string, writes: Record<string, PanelWrite>): Promise<SaveOutcome> {
    saving.add(key);
    let outcome: SaveOutcome;
    try {
      outcome = await session.save(key, writes);
    } finally {
      saving.delete(key);
    }
    notices.save = outcome.page === "stale" ? STORYBOOK_TEXT.stale : undefined;
    showNotices();
    for (const [savedIn, write] of Object.entries(writes)) {
      if (write.value === undefined || outcome.results[savedIn]?.ok !== true) continue;
      of(known, savedIn).set(key, write.value);
      savedHere.add(`${savedIn}\n${key}`);
      // Every Catalog built before this save is out of date.
      overlaid = new WeakMap();
    }
    showStored();
    try {
      options.onSaved?.({ key, writes, outcome });
    } catch {
      // The Developer's hook must not turn a save that succeeded into a failure.
    }
    return outcome;
  }

  async function fetchConfig(address: string): Promise<ConfigLoad> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<ConfigLoad>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ ok: false, reason: STORYBOOK_TEXT.timedOut(timeoutMs) });
      }, timeoutMs);
    });
    const attempt = async (): Promise<ConfigLoad> => {
      // The address is used verbatim: nothing is appended, nothing is defaulted.
      const response = await request(address, { signal: controller.signal, headers: { accept: "application/json" } });
      if (!response.ok) return { ok: false, reason: STORYBOOK_TEXT.status(response.status), ...(response.status === 401 ? { unauthenticated: true } : {}) };
      let parsed: unknown;
      try {
        parsed = JSON.parse(await response.text());
      } catch {
        return { ok: false, reason: STORYBOOK_TEXT.notConfiguration };
      }
      if (!isConfiguration(parsed)) return { ok: false, reason: STORYBOOK_TEXT.notConfiguration };
      if (typeof parsed.protocol === "number" && parsed.protocol > PROTOCOL_VERSION) return { ok: false, reason: STORYBOOK_TEXT.websiteNewer };
      if (typeof parsed.protocol === "number" && parsed.protocol < PROTOCOL_VERSION) return { ok: false, reason: STORYBOOK_TEXT.websiteOlder };
      return { ok: true, config: parsed };
    };
    try {
      return await Promise.race([attempt(), limit]);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Loads the configuration once. A failure is forgotten when edit mode goes off, so switching on again retries. */
  function loadConfig(address: string): void {
    if (config !== undefined || loading !== undefined) return;
    loading = fetchConfig(address).then((loaded) => {
      if (loaded.ok) {
        config = loaded.config;
        notices.config = undefined;
        signIn?.setName(nameIn(loaded.config));
        if (running !== undefined) {
          running.view.setConfig(config);
          // Colours and scan attributes come from the configuration: scan again with them.
          session.start(running.document);
        }
      } else if (loaded.unauthenticated === true && signIn?.available() === true) {
        // Not signed in, on a website the Editor can sign in to: the sign-in line says so.
        running?.view.logFailure("config", "FAILED", `${address}\n${loaded.reason}`);
      } else {
        notices.config = STORYBOOK_TEXT.configFailed(loaded.reason);
        running?.view.logFailure("config", "FAILED", `${address}\n${loaded.reason}`);
        (options.console ?? console).error(`${TAG} ${notices.config}`);
      }
      showNotices();
    });
  }

  /** Reads again what could not be read before the Editor signed in. */
  function signedIn(): void {
    if (source !== undefined && config === undefined) {
      loading = undefined;
      notices.config = undefined;
      showNotices();
      loadConfig(source);
    }
    for (const key of failed) asked.delete(key);
    failed.clear();
    if (running !== undefined && config !== undefined) session.start(running.document);
  }

  /**
   * Draws the sign-in area: the Developer's view, or the addon's own line. A
   * view that throws, when drawn or when told a change, is removed and the
   * addon's line takes its place; the error goes to the panel's log.
   */
  function mountSignIn(area: HTMLElement, view: PanelView, current: WorkbenchSignIn): () => void {
    const custom = options.signInView;
    if (custom === undefined) return builtInSignInView(area, current.controls());
    const controls = current.controls();
    const stops: (() => void)[] = [];
    let cleanup: (() => void) | void;
    let replaced: (() => void) | undefined;
    const contain = (error: unknown): void => {
      if (replaced !== undefined) return;
      for (const stop of stops.splice(0)) stop();
      try {
        cleanup?.();
      } catch {
        // Already being replaced.
      }
      area.replaceChildren();
      view.logFailure("sign-in", "THREW", error instanceof Error ? (error.stack ?? error.message) : String(error));
      replaced = builtInSignInView(area, current.controls());
    };
    const guarded: SignInControls = {
      state: controls.state,
      signIn: controls.signIn,
      signOut: controls.signOut,
      onChange(listener) {
        const stop = controls.onChange((state) => {
          if (replaced !== undefined) return;
          try {
            listener(state);
          } catch (error) {
            contain(error);
          }
        });
        stops.push(stop);
        return stop;
      },
    };
    try {
      cleanup = custom(area, guarded);
    } catch (error) {
      contain(error);
    }
    return () => {
      if (replaced !== undefined) return replaced();
      for (const stop of stops.splice(0)) stop();
      try {
        cleanup?.();
      } catch {
        // The view is going away either way.
      }
      area.replaceChildren();
    };
  }

  function mount(document: Document): { host: HTMLElement; view: PanelView; signInArea: HTMLElement } {
    const host = document.createElement("div");
    host.setAttribute(HOST_ATTRIBUTE, "");
    host.setAttribute("data-tms-placement", options.placement ?? "right");
    // A shadow root keeps the story's styles out of the panel, the panel's out of
    // the story, and the panel's own text out of the scan.
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;

    const bar = document.createElement("header");
    bar.className = "bar";
    const name = document.createElement("h1");
    name.textContent = STORYBOOK_TEXT.name;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.dataset.role = "collapse";
    toggle.textContent = STORYBOOK_TEXT.collapse;
    toggle.addEventListener("click", () => {
      const collapsed = host.toggleAttribute("data-tms-collapsed");
      toggle.textContent = collapsed ? STORYBOOK_TEXT.expand : STORYBOOK_TEXT.collapse;
    });
    // A click on the story expands the panel without going through the button.
    new MutationObserver(() => {
      toggle.textContent = host.hasAttribute("data-tms-collapsed") ? STORYBOOK_TEXT.expand : STORYBOOK_TEXT.collapse;
    }).observe(host, { attributes: true, attributeFilter: ["data-tms-collapsed"] });
    bar.append(name, toggle);

    // The sign-in area is the Developer's to draw, or the addon's own line. It shows once the
    // website has said it offers signing in from a workbench.
    const signInArea = document.createElement("div");
    signInArea.className = "sign-in";
    signInArea.dataset.role = "sign-in";
    signInArea.hidden = true;

    const container = document.createElement("div");
    container.className = "panel";
    root.append(style, bar, signInArea, container);

    // The workbench listens for single-key shortcuts on the document, and from
    // outside a shadow root a keystroke looks like it came from a plain element.
    for (const type of ["keydown", "keyup", "keypress"]) host.addEventListener(type, (event) => event.stopPropagation());

    const view = createPanelView({
      container,
      save,
      navigate: (url) => {
        // A stored address must be a web address, and it never replaces the workbench.
        if (isHttpUrl(url)) document.defaultView?.open(url, "_blank", "noopener");
      },
      flash: (id) => session.flashHidden(id),
      openHidden: (id) => session.openHidden(id),
    });
    document.body.append(host);
    return { host, view, signInArea };
  }

  function start(document: Document): void {
    if (running?.document === document && running.host.isConnected) return;
    stop();
    const window = document.defaultView;
    if (signIn === undefined && window !== null) {
      signIn = createWorkbenchSignIn({
        window,
        request: base,
        onSignedIn: signedIn,
        onChange: () => {
          if (running !== undefined) running.signInArea.hidden = signIn?.available() !== true;
        },
      });
    }
    const mounted = mount(document);
    const unmountSignIn = signIn === undefined ? () => undefined : mountSignIn(mounted.signInArea, mounted.view, signIn);
    mounted.signInArea.hidden = signIn?.available() !== true;
    running = { document, ...mounted, unmountSignIn };
    if (config !== undefined) running.view.setConfig(config);
    showNotices();
    session.start(document);
    if (source !== undefined) loadConfig(source);
  }

  function stop(): void {
    if (running === undefined) return;
    session.stop();
    running.unmountSignIn();
    running.host.remove();
    running = undefined;
    lastFound = [];
    waiting.length = 0;
    // A read that failed, or never started, is tried again the next time editing is switched on.
    for (const key of asked) if (failed.has(key) || !knownKey(key)) asked.delete(key);
    failed.clear();
    notices.save = undefined;
    if (config === undefined && notices.config !== undefined) {
      notices.config = undefined;
      loading = undefined;
    }
  }

  /** Whether any Locale's stored value is known for `key`: a read that was still waiting when editing stopped left none. */
  function knownKey(key: string): boolean {
    for (const values of known.values()) if (values.has(key)) return true;
    return false;
  }

  function documentOf(story: StorybookContext): Document | undefined {
    const canvas = story.canvasElement;
    if (isObject(canvas) && isObject(canvas.ownerDocument)) return canvas.ownerDocument as unknown as Document;
    return typeof document === "undefined" ? undefined : document;
  }

  return {
    decorator(story, storyContext) {
      const target = documentOf(storyContext);
      if (target !== undefined) {
        if (isEditing(storyContext)) {
          context = storyContext;
          start(target);
        } else {
          stop();
        }
      }
      return story();
    },
    globalTypes: {
      [EDIT_GLOBAL]: {
        description: STORYBOOK_TEXT.description,
        toolbar: {
          title: STORYBOOK_TEXT.name,
          icon: "edit",
          items: [
            { value: "off", title: STORYBOOK_TEXT.off },
            { value: "on", title: STORYBOOK_TEXT.on },
          ],
          dynamicTitle: true,
        },
      },
    },
    initialGlobals: { [EDIT_GLOBAL]: options.editing === true ? "on" : "off" },
    isEditing,
    mark(catalog, storyContext, markOptions) {
      if (!isEditing(storyContext)) return catalog;
      const renderedIn = localeOf(storyContext);
      const values = known.get(renderedIn);
      const seen = of(bundled, renderedIn);
      // Built once per Catalog, Locale and separator: marking is memoised by identity, and a
      // new Catalog on every render would re-render every consumer of the messages.
      const variant = `${renderedIn}\n${markOptions?.separator ?? ""}`;
      let variants = overlaid.get(catalog);
      if (variants === undefined) overlaid.set(catalog, (variants = new Map()));
      let current = variants.get(variant);
      if (current === undefined) variants.set(variant, (current = mapCatalog(catalog, (value, key) => (seen.set(key, value), values?.get(key) ?? value), markOptions)));
      return markCatalog(current as typeof catalog, markOptions);
    },
    stop,
  };
}
