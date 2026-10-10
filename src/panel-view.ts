// The built-in panel view: plain DOM over the headless panel store. It exists
// for Hosts that are configured in code and bring no view of their own. A Host
// with its own view binds the store directly and never loads this module.

import { SHARED_NOTICE } from "./classification.js";
import type { FieldDef } from "./config.js";
import { conflictNotice, explainSaveFailure, hiddenErrors, relativeTime, resolveToolbarFilters, shouldRenderToolbar, usagePath, visibleLocales, type PanelWrite, type ResolvedFilter } from "./panel-logic.js";
import { createLog, LOG_EMPTY_TEXT, type Log } from "./panel-log.js";
import { createPanelStore, type PanelConfig, type PanelState, type PersistOutcome } from "./panel-store.js";
import type { SessionSink } from "./session.js";
import { fieldText } from "./wire.js";

/** The default English strings of the built-in panel view. Status text and notices that every view shares are the store's. */
export const PANEL_VIEW_TEXT = {
  placeholder: "Hold Alt (Option on a Mac) and click an outlined translation to edit it.",
  sharedBadge: "Shared",
  currentLocale: "shown now",
  searchPlaceholder: "Search locale or value…",
  searchLabel: "Search locales",
  filterAll: "All",
  selectNone: "Select…",
  required: "Required",
  valueLabel: (locale: string) => `${locale} translation`,
  fieldLabel: (locale: string, label: string) => `${locale} ${label}`,
  hintRequired: (locales: readonly string[]) => `Required field empty in hidden locale(s): ${locales.join(", ")}`,
  hintTags: (locales: readonly string[]) => `Tags do not match the source in hidden locale(s): ${locales.join(", ")}`,
  hintJoin: " · ",
  save: "Save all",
  cancel: "Cancel",
  usedOnTitle: "Used on",
  usedOnLoading: "Loading…",
  usedOnFailed: "Couldn’t load usage",
  usedOnNone: "No pages recorded yet.",
  usedOnCount: (count: number) => `×${count}`,
  hiddenTitle: "Hidden translations",
  hiddenTooltip: (attribute: string, key: string) => `${attribute} · ${key}`,
  /** The diagnostics pane and what is logged in it. */
  diagnostics: {
    title: "Diagnostics",
    copy: "Copy",
    clear: "Clear",
    copied: "Copied",
    copyFailed: "Copy failed",
    empty: LOG_EMPTY_TEXT,
    config: (locales: readonly string[], sourceLocale: string | undefined, hasSchema: boolean) =>
      `languages: ${locales.length > 0 ? locales.join(", ") : "(none)"}; source: ${sourceLocale ?? "(unset)"}; schema: ${hasSchema ? "yes" : "no"}`,
    open: (key: string, locale: string) => `${key} (${locale})`,
    unconfiguredLocale: (locale: string, locales: readonly string[]) => `the Current Locale is "${locale}", which is not one of the configured languages [${locales.join(", ")}]`,
    unconfiguredLocaleDetail: "A save for this Locale is refused. Render in a configured Locale, or add this one to the configured languages.",
    values: (key: string, locales: readonly string[]) => `${key} -> ${locales.length > 0 ? locales.join(", ") : "(no stored rows)"}`,
    valuesFailed: (key: string) => `${key} READ FAILED -- the panel is showing the on-page value only`,
    saveSent: (key: string) => `PUT ${key}`,
    saved: "saved",
    refused: "refused: changed elsewhere",
    failed: "FAILED",
    threw: "THREW",
  },
} as const;

/** What {@link createPanelView} is built from. */
export interface PanelViewOptions {
  /** The element the view renders into. Everything in it is replaced. */
  container: HTMLElement;
  /** Saves a key's writes. Resolves with the result, or with nothing when there was no answer at all. */
  save: (key: string, writes: Record<string, PanelWrite>) => Promise<PersistOutcome | undefined>;
  /** Follows a "Used on" address. Without it the addresses are listed and do nothing. */
  navigate?: (url: string) => void;
  /** Flashes a Hidden item on the page. */
  flash?: (id: string) => void;
  /** Opens a Hidden item for editing, as if it had been clicked. */
  openHidden?: (id: string) => void;
  /** The clock used for "last seen" times. */
  now?: () => number;
  /** The diagnostic log. Defaults to a new one. */
  log?: Log;
  /** Where Copy puts the log. Defaults to the browser's clipboard. */
  clipboard?: { writeText(text: string): Promise<void> };
}

/** The view's inbound calls: an editing session's sink, plus the configuration and a notice line. */
export interface PanelView extends SessionSink {
  /** The parts of the served configuration the panel uses. May arrive at any time, or never. */
  setConfig(config: PanelConfig): void;
  /** Shows one line above the editor, for what an Editor must know and no status covers. Nothing hides it. */
  setNotice(text: string | undefined): void;
  /** Logs something that went wrong outside the view, such as a configuration that would not load, and opens the diagnostics pane. */
  logFailure(channel: string, text: string, detail?: string): void;
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const VALUE = "value";

/**
 * Creates the built-in panel view in `container` and returns its inbound calls.
 *
 * The view is a thin layer over the panel store, which owns the selection, the
 * draft and baseline, the save diff, validation, conflicts, row order and
 * status text. What the view owns is repainting without disturbing someone who
 * is typing: its own state is exactly the toolbar's search text and filter
 * choices, and which control has focus during a repaint.
 *
 * Everything from a website, a store or a configuration is inserted as text,
 * and a control is found by walking the rendered controls and comparing their
 * data, never by composing a selector from a Locale code or a Field name. It
 * brings no styles: pair it with the built-in stylesheet or your own.
 */
export function createPanelView(options: PanelViewOptions): PanelView {
  const { container } = options;
  const document = container.ownerDocument;
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? createLog();
  const TEXT = PANEL_VIEW_TEXT;
  const DIAGNOSTICS = TEXT.diagnostics;
  let ids = 0;
  const nextId = () => `tms-${++ids}`;

  // View state: never reaches the store, a draft, a save or a validation.
  let search = "";
  let selected: Record<string, string> = {};
  let filters: ResolvedFilter[] = [];

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, role?: string, text?: string): HTMLElementTagNameMap[K] {
    const created = document.createElement(tag);
    if (role !== undefined) created.dataset.role = role;
    if (text !== undefined) created.textContent = text;
    return created;
  }

  // ---------------------------------------------------------------------
  // Saving: the one seam that sees both the store's writes and the answer.
  // ---------------------------------------------------------------------

  const failure = (): void => {
    diagnostics.open = true;
  };

  async function persist(changes: Record<string, PanelWrite>): Promise<PersistOutcome | undefined> {
    const savedKey = store.getState().selection?.key ?? "";
    log.add("save", DIAGNOSTICS.saveSent(savedKey), JSON.stringify(changes, null, 2));
    let outcome: PersistOutcome | undefined;
    try {
      outcome = await options.save(savedKey, changes);
    } catch (error) {
      log.add("save", DIAGNOSTICS.threw, error instanceof Error ? error.message : String(error));
      failure();
      // The store owns the connection-error status; swallowing the throw would change what the Editor sees.
      throw error;
    }
    const detail = outcome === undefined ? "(no reply)" : JSON.stringify(outcome, null, 2);
    const why = explainSaveFailure(outcome);
    if (outcome?.ok === true) {
      log.add("save", DIAGNOSTICS.saved, detail);
    } else if (why === undefined) {
      // A Write conflict is the website's answer, shown beside the draft. It is not a failure.
      log.add("save", DIAGNOSTICS.refused, detail);
    } else {
      log.add("save", DIAGNOSTICS.failed, detail);
      log.add("why", why);
      failure();
    }
    return outcome;
  }

  const store = createPanelStore({ persist });

  // ---------------------------------------------------------------------
  // Skeleton: built once. Repaints fill it.
  // ---------------------------------------------------------------------

  const editor = element("section", "editor");
  editor.className = "editor";
  const notice = element("p", "notice");
  notice.className = "notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  const placeholder = element("p", "placeholder", TEXT.placeholder);
  placeholder.className = "placeholder";
  const selection = element("div", "selection");
  selection.hidden = true;

  const title = element("h2", "title");
  const key = element("code", "key");
  const shared = element("p", "shared");
  shared.className = "shared";
  shared.append(element("span", "shared-badge", TEXT.sharedBadge), " ", element("span", "shared-notice", SHARED_NOTICE));
  const toolbar = element("div", "toolbar");
  toolbar.className = "toolbar";
  const toolbarHint = element("p", "toolbar-hint");
  toolbarHint.className = "hint";
  const rows = element("div", "rows");
  rows.className = "rows";

  const actions = element("div");
  actions.className = "actions";
  const saveButton = element("button", "save", TEXT.save);
  saveButton.type = "button";
  saveButton.className = "primary";
  const cancelButton = element("button", "cancel", TEXT.cancel);
  cancelButton.type = "button";
  actions.append(saveButton, cancelButton);

  const status = element("p", "status");
  status.className = "status";
  status.setAttribute("role", "status");

  const usedOn = element("section", "used-on");
  usedOn.className = "used-on";
  const usedOnBody = element("div", "used-on-body");
  usedOn.append(element("h3", undefined, TEXT.usedOnTitle), usedOnBody);

  selection.append(title, key, shared, toolbar, toolbarHint, rows, actions, status, usedOn);
  editor.append(notice, placeholder, selection);

  const hidden = element("section", "hidden");
  hidden.className = "hidden-list";
  hidden.hidden = true;
  const hiddenBody = element("ul");
  hidden.append(element("h3", undefined, TEXT.hiddenTitle), hiddenBody);

  const diagnostics = element("details", "diagnostics");
  diagnostics.className = "diagnostics";
  const copyButton = element("button", "copy", DIAGNOSTICS.copy);
  copyButton.type = "button";
  const clearButton = element("button", "clear", DIAGNOSTICS.clear);
  clearButton.type = "button";
  const logButtons = element("div");
  logButtons.className = "log-actions";
  logButtons.append(copyButton, clearButton);
  const logPane = element("pre", "log");
  logPane.tabIndex = 0;
  diagnostics.append(element("summary", undefined, DIAGNOSTICS.title), logButtons, logPane);

  container.replaceChildren(editor, hidden, diagnostics);

  // ---------------------------------------------------------------------
  // Rows
  // ---------------------------------------------------------------------

  const controls = (): Control[] => [...rows.querySelectorAll<Control>('[data-role="control"]')];
  const findControl = (locale: string, column: string) => controls().find((control) => control.dataset.locale === locale && control.dataset.column === column);

  /**
   * Pushes every rendered control into the store. The store is the single
   * source of truth and the rendered controls are only its visible slice, so
   * this runs before any repaint that could otherwise drop typed text. A
   * control that shows what the store already holds is left alone: harvesting
   * must never turn something the Editor did not type into an edit.
   */
  function harvest(): void {
    for (const control of controls()) {
      const { locale, column } = control.dataset;
      if (locale === undefined || column === undefined) continue;
      if (control.value === fieldText(store.getState().draft[locale]?.[column])) continue;
      if (column === VALUE) store.editValue(locale, control.value);
      else store.editField(locale, column, control.value);
    }
  }

  function push(control: Control): void {
    const { locale, column } = control.dataset;
    if (locale === undefined || column === undefined) return;
    if (column === VALUE) store.editValue(locale, control.value);
    else store.editField(locale, column, control.value);
    // Never a full repaint on a keystroke: focus would leave the control mid-word.
    paintGuard();
  }

  function describe(control: Control, ...notes: HTMLElement[]): void {
    control.setAttribute("aria-describedby", notes.map((note) => note.id).join(" "));
  }

  function note(role: string, column: string, className: string): HTMLElement {
    const created = element("p", role);
    created.id = nextId();
    created.dataset.column = column;
    created.className = className;
    created.hidden = true;
    return created;
  }

  function fieldControl(field: Exclude<FieldDef, { type: "readonly" }>, text: string): Control {
    if (field.type === "select") {
      const select = element("select");
      const none = element("option", undefined, TEXT.selectNone);
      none.value = "";
      select.append(none);
      for (const choice of field.options) {
        const option = element("option", undefined, choice.label);
        option.value = choice.value;
        select.append(option);
      }
      if (text !== "" && !field.options.some((choice) => choice.value === text)) {
        // A stored value outside the declared options is kept, so showing the row never changes it.
        const stray = element("option", undefined, text);
        stray.value = text;
        select.append(stray);
      }
      select.value = text;
      return select;
    }
    if (field.type === "textarea") {
      const area = element("textarea");
      area.rows = 2;
      area.value = text;
      return area;
    }
    const input = element("input");
    input.type = "text";
    input.value = text;
    return input;
  }

  function buildRow(state: PanelState, locale: string): HTMLElement {
    const draft = state.draft[locale];
    const row = element("div", "row");
    row.className = "row";
    row.dataset.locale = locale;
    const current = locale === state.selection?.locale;
    row.dataset.current = String(current);

    const head = element("div");
    head.className = "row-head";
    head.append(element("code", "locale", locale));
    if (current) head.append(element("span", "current-cue", TEXT.currentLocale));
    row.append(head);

    const value = state.schema?.valueField?.type === "textarea" ? element("textarea") : element("input");
    if ("rows" in value) value.rows = 2;
    else value.type = "text";
    value.value = fieldText(draft?.[VALUE]);
    value.dataset.role = "control";
    value.dataset.locale = locale;
    value.dataset.column = VALUE;
    value.setAttribute("aria-label", TEXT.valueLabel(locale));
    // Always rendered, hidden while empty, so they can be filled and cleared in place without rebuilding the row.
    const tagError = note("tag-error", VALUE, "error");
    const valueConflict = note("conflict", VALUE, "conflict");
    describe(value, tagError, valueConflict);
    row.append(value, tagError, valueConflict);

    for (const field of state.schema?.fields ?? []) {
      const label = field.label ?? field.name;
      const wrap = element("div");
      wrap.className = "field";
      const labelElement = element("label", "field-label", label);
      if (field.type === "readonly") {
        // No control: a Read-only Field is never harvested.
        wrap.append(labelElement, element("div", "readonly", fieldText(draft?.[field.name])));
        row.append(wrap);
        continue;
      }
      const control = fieldControl(field, fieldText(draft?.[field.name]));
      control.id = nextId();
      labelElement.htmlFor = control.id;
      control.dataset.role = "control";
      control.dataset.locale = locale;
      control.dataset.column = field.name;
      control.setAttribute("aria-label", TEXT.fieldLabel(locale, label));
      const required = note("required", field.name, "error");
      required.textContent = TEXT.required;
      const conflict = note("conflict", field.name, "conflict");
      describe(control, required, conflict);
      wrap.append(labelElement, control, required, conflict);
      row.append(wrap);
    }
    return row;
  }

  const visible = (state: PanelState): string[] =>
    visibleLocales({ order: state.rowOrder, current: state.selection?.locale, rows: state.draft, search, selected, filters });

  /** The focused element as the view's own tree sees it: inside a shadow root the document only names the host. */
  function focusedElement(): Element | null {
    const root = container.getRootNode();
    return "activeElement" in root ? (root as Document | ShadowRoot).activeElement : document.activeElement;
  }

  /** Rebuilds the rows from the store, keeping focus and the caret where the Editor had them. */
  function paintRows(): void {
    const state = store.getState();
    const active = focusedElement() as HTMLElement | null;
    const focused =
      active !== null && rows.contains(active) && active.dataset?.role === "control"
        ? {
            locale: active.dataset.locale,
            column: active.dataset.column,
            start: "selectionStart" in active ? (active as HTMLInputElement).selectionStart : null,
            end: "selectionEnd" in active ? (active as HTMLInputElement).selectionEnd : null,
          }
        : undefined;

    rows.replaceChildren(...visible(state).map((locale) => buildRow(state, locale)));

    // Focus is restored, never taken: nothing happens when nothing in the rows had it.
    if (focused?.locale !== undefined && focused.column !== undefined) {
      const again = findControl(focused.locale, focused.column);
      if (again !== undefined) {
        again.focus();
        if (focused.start !== null && focused.end !== null && "setSelectionRange" in again) {
          try {
            again.setSelectionRange(focused.start, focused.end);
          } catch {
            // The control type has no caret.
          }
        }
      }
    }
    paintGuard();
  }

  /** Updates the Save button, the inline errors, the conflict notices and the toolbar hint. Touches no input's value. */
  function paintGuard(): void {
    const state = store.getState();
    const fields = state.schema?.fields ?? [];
    saveButton.disabled = state.saving || Object.keys(state.requiredErrors).length > 0 || Object.keys(state.tagErrors).length > 0;

    for (const row of rows.querySelectorAll<HTMLElement>('[data-role="row"]')) {
      const locale = row.dataset.locale ?? "";
      const invalid = new Set<string>();
      for (const item of row.querySelectorAll<HTMLElement>("[data-role=tag-error], [data-role=required], [data-role=conflict]")) {
        const column = item.dataset.column ?? "";
        if (item.dataset.role === "tag-error") {
          const reason = state.tagErrors[locale];
          item.textContent = reason ?? "";
          item.hidden = reason === undefined;
          if (reason !== undefined) invalid.add(column);
        } else if (item.dataset.role === "required") {
          const missing = state.requiredErrors[locale]?.includes(column) === true;
          item.hidden = !missing;
          if (missing) invalid.add(column);
        } else {
          const conflicting = state.conflicts[locale]?.includes(column) === true;
          item.textContent = conflicting
            ? conflictNotice(
                state.baseline[locale]?.[column],
                fields.find((field) => field.name === column),
              )
            : "";
          item.hidden = !conflicting;
        }
      }
      for (const control of row.querySelectorAll<HTMLElement>('[data-role="control"]')) {
        if (invalid.has(control.dataset.column ?? "")) control.setAttribute("aria-invalid", "true");
        else control.removeAttribute("aria-invalid");
      }
    }

    // A disabled button always has an on-screen cause: name the Locales the toolbar is hiding.
    const shown = visible(state);
    const sentences = [
      ...[hiddenErrors(state.requiredErrors, shown)].filter((locales) => locales.length > 0).map(TEXT.hintRequired),
      ...[hiddenErrors(state.tagErrors, shown)].filter((locales) => locales.length > 0).map(TEXT.hintTags),
    ];
    toolbarHint.textContent = sentences.join(TEXT.hintJoin);
    toolbarHint.hidden = sentences.length === 0;
  }

  // ---------------------------------------------------------------------
  // Everything else
  // ---------------------------------------------------------------------

  function paintStatus(): void {
    const state = store.getState();
    status.textContent = state.status.text;
    status.dataset.kind = state.status.kind;
    // Announced politely for success and assertively for failure.
    status.setAttribute("aria-live", state.status.kind === "error" ? "assertive" : "polite");
  }

  function paintHeading(): void {
    const state = store.getState();
    const open = state.selection !== undefined;
    placeholder.hidden = open;
    selection.hidden = !open;
    // The source message is the title: an Editor should see "Deploy now", not a hash.
    const titled = open && state.title !== state.selection?.key;
    title.textContent = titled ? state.title : "";
    title.hidden = !titled;
    key.textContent = state.selection?.key ?? "";
    key.className = titled ? "key-small" : "key-chip";
    shared.hidden = !state.shared;
  }

  function paintToolbar(): void {
    const state = store.getState();
    filters = resolveToolbarFilters(state.schema, () => undefined);
    // Choices are kept where the same filter still exists.
    selected = Object.fromEntries(filters.map(({ field }) => [field.name, selected[field.name] ?? ""]).filter(([, value]) => value !== ""));
    const parts: HTMLElement[] = [];
    if (shouldRenderToolbar(state.schema)) {
      if (state.schema?.toolbar?.search === true) {
        const box = element("input", "search");
        box.type = "search";
        box.placeholder = TEXT.searchPlaceholder;
        box.setAttribute("aria-label", TEXT.searchLabel);
        box.value = search;
        box.addEventListener("input", () => {
          harvest();
          search = box.value;
          paintRows();
        });
        parts.push(box);
      } else {
        search = "";
      }
      for (const { field, label } of filters) {
        const select = element("select", "filter");
        select.dataset.field = field.name;
        select.setAttribute("aria-label", label);
        const all = element("option", undefined, TEXT.filterAll);
        all.value = "";
        select.append(all);
        for (const choice of field.options) {
          const option = element("option", undefined, choice.label);
          option.value = choice.value;
          select.append(option);
        }
        select.value = selected[field.name] ?? "";
        select.addEventListener("change", () => {
          harvest();
          selected = { ...selected, [field.name]: select.value };
          paintRows();
        });
        parts.push(select);
      }
    } else {
      search = "";
    }
    toolbar.replaceChildren(...parts);
    toolbar.hidden = parts.length === 0;
  }

  function paintUsedOn(): void {
    const state = store.getState();
    const items: HTMLElement[] = [];
    for (const usage of state.usages) {
      // A usage with no address (a source-file reference) is not rendered.
      if (!("url" in usage) || typeof usage.url !== "string" || usage.url === "") continue;
      const url = usage.url;
      const row = element("button", "usage");
      row.type = "button";
      row.title = url;
      row.append(element("span", "usage-path", usagePath(url)));
      if (usage.count > 1) row.append(" ", element("span", "usage-count", TEXT.usedOnCount(usage.count)));
      const seen = relativeTime(usage.lastSeen, now());
      if (seen !== "") row.append(" ", element("span", "usage-time", seen));
      row.addEventListener("click", () => options.navigate?.(url));
      const item = element("li");
      item.append(row);
      items.push(item);
    }
    if (state.usagesLoading || state.usagesError || items.length === 0) {
      const text = state.usagesLoading ? TEXT.usedOnLoading : state.usagesError ? TEXT.usedOnFailed : TEXT.usedOnNone;
      usedOnBody.replaceChildren(element("p", "used-on-state", text));
      return;
    }
    const list = element("ul");
    list.append(...items);
    usedOnBody.replaceChildren(list);
  }

  function paintHidden(): void {
    const items = store.getState().hidden;
    hidden.hidden = items.length === 0;
    hiddenBody.replaceChildren(
      ...items.map((item) => {
        const row = element("button", "hidden-item");
        row.type = "button";
        row.title = TEXT.hiddenTooltip(item.attribute, item.key);
        row.append(element("span", "hidden-attribute", item.attribute), " ", element("span", "hidden-value", item.value), " ", element("code", "hidden-key", item.key));
        // Pointing at a row finds an element that has no visible text.
        row.addEventListener("mouseenter", () => options.flash?.(item.id));
        row.addEventListener("click", () => options.openHidden?.(item.id));
        const entry = element("li");
        entry.append(row);
        return entry;
      }),
    );
  }

  function paintLog(): void {
    logPane.textContent = log.text();
    logPane.scrollTop = logPane.scrollHeight;
    copyButton.textContent = DIAGNOSTICS.copy;
  }

  // ---------------------------------------------------------------------
  // The Editor's input
  // ---------------------------------------------------------------------

  const onEdit = (event: Event): void => {
    const target = event.target as Partial<Control> | null;
    if (target?.dataset?.role === "control") push(target as Control);
  };
  rows.addEventListener("input", onEdit);
  rows.addEventListener("change", onEdit);

  saveButton.addEventListener("click", () => {
    if (store.getState().selection === undefined) return;
    harvest();
    const saving = store.save();
    if (!store.getState().saving) {
      // Nothing was sent: nothing changed, or errors stand. Repaint so the inline errors appear.
      paintRows();
      paintStatus();
      return;
    }
    // What the store set synchronously is painted at once, not when the save settles.
    paintGuard();
    paintStatus();
    void saving.finally(() => {
      // After a conflict the rows are repainted from the store WITHOUT harvesting: the refused
      // Locale's draft took the stored value of every column the Editor had left alone, and the
      // controls still show what was loaded. Harvesting would write those old values back.
      if (Object.keys(store.getState().conflicts).length > 0) paintRows();
      else paintGuard();
      paintStatus();
    });
  });

  cancelButton.addEventListener("click", () => {
    store.cancel();
    paintRows();
    paintStatus();
  });

  copyButton.addEventListener("click", () => {
    const done = (text: string): void => {
      copyButton.textContent = text;
    };
    try {
      const clipboard = "clipboard" in options ? options.clipboard : document.defaultView?.navigator.clipboard;
      if (clipboard === undefined) throw new Error("no clipboard");
      void Promise.resolve(clipboard.writeText(log.text())).then(
        () => done(DIAGNOSTICS.copied),
        () => done(DIAGNOSTICS.copyFailed),
      );
    } catch {
      done(DIAGNOSTICS.copyFailed);
    }
  });
  clearButton.addEventListener("click", () => log.clear());
  log.subscribe(paintLog);

  paintHeading();
  paintLog();

  return {
    open(openedKey, locale, onPageValue) {
      harvest();
      store.open(openedKey, locale, onPageValue);
      log.add("open", DIAGNOSTICS.open(openedKey, locale), onPageValue);
      const { locales } = store.getState();
      // While no configuration has arrived there is nothing to compare against.
      if (locales.length > 0 && !locales.includes(locale)) {
        log.add("open", DIAGNOSTICS.unconfiguredLocale(locale, locales), DIAGNOSTICS.unconfiguredLocaleDetail);
        failure();
      }
      // A fresh key starts with every Locale shown.
      search = "";
      selected = {};
      paintHeading();
      paintToolbar();
      paintRows();
      paintStatus();
      paintUsedOn();
    },

    setValues(valuesKey, values, error) {
      if (store.getState().selection?.key !== valuesKey) return;
      // The store keeps what the Editor changed, and can only keep what it has been told.
      harvest();
      store.setValues(valuesKey, values, error);
      if (error) {
        log.add("values", DIAGNOSTICS.valuesFailed(valuesKey));
        failure();
      } else {
        log.add("values", DIAGNOSTICS.values(valuesKey, Object.keys(values.locales)));
      }
      paintHeading();
      paintRows();
      paintStatus();
    },

    setUsage(usageKey, usages, error) {
      store.setUsage(usageKey, usages, error);
      paintUsedOn();
    },

    setConfig(config) {
      harvest();
      store.setConfig(config);
      log.add("config", DIAGNOSTICS.config(config.locales ?? [], config.sourceLocale, config.schema !== undefined));
      paintToolbar();
      paintRows();
    },

    setHidden(items) {
      store.setHidden(items);
      paintHidden();
    },

    setNotice(text) {
      notice.textContent = text ?? "";
      notice.hidden = text === undefined || text === "";
    },

    logFailure(channel, text, detail) {
      log.add(channel, text, detail);
      failure();
    },
  };
}
