// The editing panel as a headless store. It owns the panel's whole state and
// lifecycle: a clicked translation opens it, stored values and usages stream
// in, the Editor edits a draft, and Save diffs the draft against a baseline so
// only what changed is written.
//
// It has no DOM, no view framework and no transport. Every panel view is a
// thin binding over this one store.

import type { SchemaDef } from "./config.js";
import { isSharedKey } from "./classification.js";
import { buildChanges, changedColumns, PANEL_TEXT, requiredErrorsOf, tagErrorsOf, type PanelWrite } from "./panel-logic.js";
import type { HiddenItem, KeyMeta, SaveResult, Usage, ValuesEnvelope } from "./wire.js";
import { conflictingColumns, fieldText } from "./wire.js";

/** One Locale's row: the translation string plus one property per stored Field. */
export type PanelRow = Readonly<Record<string, unknown>>;
/** Rows by Locale. */
export type PanelRows = Readonly<Record<string, PanelRow>>;

/** The one-line status. */
export interface PanelStatus {
  text: string;
  kind: "neutral" | "success" | "error";
}

/** The open key and the Locale that was on the page when it was clicked. */
export interface PanelSelection {
  /** Distinct for every opening, even of the same key, so late answers can be matched to the selection they belong to. */
  id: number;
  key: string;
  locale: string;
}

/** The parts of the served configuration the panel uses. Any may be missing: the configuration may not have arrived. */
export interface PanelConfig {
  locales?: readonly string[] | undefined;
  schema?: SchemaDef | undefined;
  sourceLocale?: string | undefined;
}

/** Which columns of which Locales differ from their baseline. */
export interface PanelDirty {
  /** The Locales with at least one changed column, in row order. */
  locales: readonly string[];
  /** The changed columns per dirty Locale (`value` and Field names). */
  columns: Readonly<Record<string, readonly string[]>>;
  /** The total number of changed columns. */
  count: number;
}

/** The panel's whole state. Immutable: every change produces a new object. */
export interface PanelState {
  selection: PanelSelection | undefined;
  locales: readonly string[];
  schema: SchemaDef | undefined;
  sourceLocale: string | undefined;
  meta: KeyMeta | undefined;
  /** What the inputs show, per Locale. */
  draft: PanelRows;
  /** The last loaded or saved rows, per Locale: the diff target for Save and the revert target for Cancel. */
  baseline: PanelRows;
  usages: readonly Usage[];
  usagesLoading: boolean;
  usagesError: boolean;
  hidden: readonly HiddenItem[];
  status: PanelStatus;
  saving: boolean;
  /** The Current Locale first, then the configured Locales in order, then any Locale that appears only in the loaded values. */
  rowOrder: readonly string[];
  dirty: PanelDirty;
  /** The source message when there is one, otherwise the key. */
  title: string;
  /** Whether the open key is a Shared translation. */
  shared: boolean;
  /** Per loaded Locale, the required Fields that are empty. */
  requiredErrors: Readonly<Record<string, readonly string[]>>;
  /** Per changed Locale, why its draft cannot be saved. */
  tagErrors: Readonly<Record<string, string>>;
  /**
   * Per Locale, the columns whose save was refused because someone else changed
   * them after this panel loaded them, and that still differ from the stored
   * value. A column leaves the list as soon as its draft equals the stored value
   * again: there is nothing left to choose between.
   */
  conflicts: Readonly<Record<string, readonly string[]>>;
  /**
   * The keys with unsaved drafts: those set aside when the Editor moved to
   * another translation, and the open key if it is dirty. Silently discarding
   * typing on a stray click is the most damaging thing a panel can do, so a
   * draft is kept and restored when its key is opened again.
   */
  unsavedKeys: readonly string[];
  /** Whether Save would do anything, and if not, why. */
  canSave: CanSave;
}

/** Why Save is not allowed. */
export type CannotSaveReason = "no-selection" | "no-persist" | "saving" | "nothing-changed" | "required-fields" | "tag-errors";

/** Whether Save would do anything, with a reason when it would not. */
export type CanSave = { ok: true } | { ok: false; reason: CannotSaveReason };

/** What persisting returns: a save's per-Locale result. */
export type PersistOutcome = Pick<SaveResult, "ok" | "error" | "results">;

/** What {@link createPanelStore} is built from. */
export interface PanelStoreOptions {
  /**
   * Persists the changed Locales. It resolves to a per-Locale outcome, or to
   * nothing (or rejects) on a connection failure. It is the store's only
   * dependency: transport belongs to the Host.
   */
  persist?: (changes: Record<string, PanelWrite>) => Promise<PersistOutcome | undefined>;
}

/** The store. */
export interface PanelStore {
  getState(): PanelState;
  subscribe(listener: () => void): () => void;
  setConfig(config: PanelConfig): void;
  open(key: string, locale: string, onPageValue: string): void;
  setValues(key: string, values: ValuesEnvelope, error: boolean): void;
  setUsage(key: string, usages: readonly Usage[], error: boolean): void;
  setHidden(items: readonly HiddenItem[]): void;
  editValue(locale: string, value: string): void;
  editField(locale: string, field: string, value: string): void;
  /**
   * Saves what changed. One save at a time: a save while one is in flight does
   * nothing. Required errors and tag errors refuse the save with a status, so
   * every view inherits the guard even if its button is somehow enabled.
   */
  save(): Promise<void>;
  /** Reverts the draft to the baseline and clears the status. */
  cancel(): void;
}

const NO_STATUS: PanelStatus = { text: "", kind: "neutral" };

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const member of Object.values(value)) deepFreeze(member);
  }
  return value;
}

const clone = <T,>(value: T): T => structuredClone(value);

/** Creates a panel store. */
export function createPanelStore(options: PanelStoreOptions = {}): PanelStore {
  /** Everything needed to put a key back as the Editor left it. */
  interface Stashed {
    draft: Record<string, Record<string, unknown>>;
    baseline: Record<string, Record<string, unknown>>;
    stored: readonly string[];
    refused: Readonly<Record<string, readonly string[]>>;
  }

  interface Core {
    selection: PanelSelection | undefined;
    locales: readonly string[];
    schema: SchemaDef | undefined;
    sourceLocale: string | undefined;
    meta: KeyMeta | undefined;
    draft: Record<string, Record<string, unknown>>;
    baseline: Record<string, Record<string, unknown>>;
    usages: readonly Usage[];
    usagesLoading: boolean;
    usagesError: boolean;
    hidden: readonly HiddenItem[];
    status: PanelStatus;
    saving: boolean;
    /** The Locales for which the store returned a row. A page seed or a source seed is not one. */
    stored: readonly string[];
    /** The columns each refused save recorded as conflicting. `conflicts` is what is still unresolved. */
    refused: Readonly<Record<string, readonly string[]>>;
    /** Drafts set aside for keys the Editor has moved away from. */
    stash: Readonly<Record<string, Stashed>>;
  }

  let core: Core = {
    selection: undefined,
    locales: [],
    schema: undefined,
    sourceLocale: undefined,
    meta: undefined,
    draft: {},
    baseline: {},
    usages: [],
    usagesLoading: false,
    usagesError: false,
    hidden: [],
    status: NO_STATUS,
    saving: false,
    stored: [],
    refused: {},
    stash: {},
  };
  let selectionCounter = 0;
  const listeners = new Set<() => void>();

  const derive = (c: Core): PanelState => {
    const current = c.selection?.locale;
    const rowOrder = [...new Set([...(current === undefined ? [] : [current]), ...c.locales, ...Object.keys(c.baseline), ...Object.keys(c.draft)])];
    const columns: Record<string, string[]> = {};
    let count = 0;
    for (const locale of rowOrder) {
      const changed = changedColumns(c.draft[locale], c.baseline[locale], c.schema);
      if (changed.length > 0) {
        columns[locale] = changed;
        count += changed.length;
      }
    }
    // Inputs are cloned where they enter the store, so freezing here never touches
    // a caller's object, and parts that did not change keep their identity.
    const sourceMessage = c.meta?.sourceMessage;
    const dirty: PanelDirty = { locales: Object.keys(columns), columns, count };
    const requiredErrors = requiredErrorsOf(c.schema, c.draft, c.stored);
    const tagErrors = tagErrorsOf({ schema: c.schema, draft: c.draft, baseline: c.baseline, sourceLocale: c.sourceLocale, sourceMessage, locales: rowOrder });
    const canSave: CanSave =
      c.selection === undefined
        ? { ok: false, reason: "no-selection" }
        : options.persist === undefined
          ? { ok: false, reason: "no-persist" }
          : c.saving
            ? { ok: false, reason: "saving" }
            : count === 0
              ? { ok: false, reason: "nothing-changed" }
              : Object.keys(requiredErrors).length > 0
                ? { ok: false, reason: "required-fields" }
                : Object.keys(tagErrors).length > 0
                  ? { ok: false, reason: "tag-errors" }
                  : { ok: true };
    const stashed = Object.keys(c.stash);
    const conflicts: Record<string, string[]> = {};
    for (const locale of Object.keys(c.refused)) {
      const open = c.refused[locale]!.filter((column) => fieldText(c.draft[locale]?.[column]) !== fieldText(c.baseline[locale]?.[column]));
      if (open.length > 0) conflicts[locale] = open;
    }
    return deepFreeze({
      ...c,
      rowOrder,
      dirty,
      title: c.selection === undefined ? "" : sourceMessage !== undefined && sourceMessage !== "" ? sourceMessage : c.selection.key,
      shared: c.selection !== undefined && isSharedKey(c.selection.key),
      requiredErrors,
      tagErrors,
      conflicts,
      unsavedKeys: c.selection !== undefined && count > 0 && !stashed.includes(c.selection.key) ? [...stashed, c.selection.key] : stashed,
      canSave,
    });
  };

  let state = derive(core);

  /** Commits a change. A call that changes nothing keeps the state object and tells nobody. */
  const commit = (next: Core): void => {
    core = next;
    state = derive(core);
    for (const listener of [...listeners]) listener();
  };

  const isOpen = (key: string): boolean => core.selection?.key === key;

  /**
   * Takes stored rows into the baseline whole, and into the draft only where
   * the Editor has not typed: where the draft still equals the baseline it was
   * typed over. The read can take as long as the network likes and the Editor
   * does not wait for it; what they typed in the meantime is theirs.
   */
  const applyStored = (draft: Core["draft"], baseline: Core["baseline"], stored: Readonly<Record<string, PanelRow>>): void => {
    for (const locale of Object.keys(stored)) {
      const row = stored[locale]!;
      const before = baseline[locale];
      const typed = draft[locale];
      const merged: Record<string, unknown> = { ...row };
      if (typed !== undefined) {
        for (const column of new Set([...Object.keys(typed), ...Object.keys(before ?? {}), ...Object.keys(row)])) {
          if (fieldText(typed[column]) !== fieldText(before?.[column])) {
            merged[column] = typed[column];
          } else if (!(column in row)) {
            delete merged[column];
          }
        }
      }
      draft[locale] = merged;
      baseline[locale] = clone(row) as Record<string, unknown>;
    }
  };

  const setStatus = (text: string, kind: PanelStatus["kind"]): void => commit({ ...core, status: { text, kind } });

  const save = async (): Promise<void> => {
    const selection = core.selection;
    if (selection === undefined || options.persist === undefined || core.saving) return;
    const changes = buildChanges({ schema: core.schema, draft: core.draft, baseline: core.baseline, order: state.rowOrder });
    const sent = Object.keys(changes);
    if (sent.length === 0) return setStatus(PANEL_TEXT.noChanges, "neutral");
    if (Object.keys(state.requiredErrors).length > 0) return setStatus(PANEL_TEXT.requiredFields, "error");
    if (Object.keys(state.tagErrors).length > 0) return setStatus(PANEL_TEXT.tagGuard, "error");

    commit({ ...core, saving: true, status: { text: PANEL_TEXT.saving, kind: "neutral" } });
    let outcome: PersistOutcome | undefined;
    try {
      outcome = await options.persist(changes);
    } catch {
      outcome = undefined;
    }
    // The answer is about a selection that is no longer on screen: committing it
    // would make the previous key's text the new key's revert target.
    if (core.selection?.id !== selection.id) return;

    if (outcome === undefined) return commit({ ...core, saving: false, status: { text: PANEL_TEXT.connectionError, kind: "error" } });
    if (outcome.error === "stale-selection") return commit({ ...core, saving: false, status: { text: PANEL_TEXT.staleSelection, kind: "error" } });

    const baseline = { ...core.baseline };
    const draft = { ...core.draft };
    const refused = { ...core.refused };
    const stored = new Set(core.stored);
    const tokens: string[] = [];
    let allOk = true;
    for (const locale of sent) {
      const result = outcome.results[locale];
      if (result?.current !== undefined) {
        // Someone else changed a column after this panel loaded it. The stored row
        // becomes the baseline, and the draft keeps every column the Editor changed
        // and takes the stored value of the rest, by the rule used when stored rows
        // arrive late. Saving again then sends the stored row as the Expected
        // values, so it overwrites knowingly.
        const write = changes[locale]!;
        refused[locale] = conflictingColumns(result.current, write.expected, write);
        applyStored(draft, baseline, { [locale]: result.current });
        stored.add(locale);
        allOk = false;
        tokens.push(`${locale} ⚠ ${PANEL_TEXT.conflictToken}`);
      } else if (result?.ok === true) {
        delete refused[locale];
        stored.add(locale);
        // What was sent is now stored; anything typed since then stays dirty.
        const write = changes[locale]!;
        baseline[locale] = { ...baseline[locale], ...(write.value === undefined ? {} : { value: write.value }), ...write.fields };
        tokens.push(`${locale} ✓`);
      } else {
        allOk = false;
        tokens.push(result?.status === undefined ? `${locale} ✗` : `${locale} ✗ (${result.status})`);
      }
    }
    commit({ ...core, baseline, draft, refused, saving: false, stored: [...stored], status: { text: tokens.join("  "), kind: allOk ? "success" : "error" } });
  };

  return {
    save,
    cancel() {
      if (core.selection === undefined) return;
      commit({ ...core, draft: clone(core.baseline), refused: {}, status: NO_STATUS });
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    setConfig(config) {
      commit({ ...core, locales: clone(config.locales ?? []), schema: config.schema === undefined ? undefined : clone(config.schema), sourceLocale: config.sourceLocale });
    },
    open(key, locale, onPageValue) {
      // Leaving a dirty key sets its draft aside; returning to it puts it back.
      const stash = { ...core.stash };
      if (core.selection !== undefined) {
        if (state.dirty.count > 0) stash[core.selection.key] = { draft: core.draft, baseline: core.baseline, stored: core.stored, refused: core.refused };
        else delete stash[core.selection.key];
      }
      const restored = stash[key];
      delete stash[key];
      const draft: Core["draft"] = { ...restored?.draft };
      const baseline: Core["baseline"] = { ...restored?.baseline };
      // The panel is usable before any network answer: the Current Locale is
      // seeded, in both draft and baseline, with what the page shows.
      if (!(locale in draft)) draft[locale] = { value: onPageValue };
      if (!(locale in baseline)) baseline[locale] = { value: onPageValue };
      commit({
        ...core,
        selection: { id: ++selectionCounter, key, locale },
        meta: undefined,
        draft,
        baseline,
        usages: [],
        usagesLoading: true,
        usagesError: false,
        status: NO_STATUS,
        saving: false,
        stored: restored?.stored ?? [],
        refused: restored?.refused ?? {},
        stash,
      });
    },
    setValues(key, values, error) {
      if (!isOpen(key)) return;
      if (error) return commit({ ...core, status: { text: PANEL_TEXT.loadFailed, kind: "error" } });
      const draft = { ...core.draft };
      const baseline = { ...core.baseline };
      const stored: Record<string, PanelRow> = { ...values.locales };
      const sourceMessage = values.meta?.sourceMessage;
      // Seeded into the baseline as well as the draft: an untouched seeded field
      // is not a change. Seeded into the draft alone, every Save would persist
      // the code's text, and since a stored row wins at runtime the key would
      // silently stop tracking the code from then on.
      if (core.sourceLocale !== undefined && typeof sourceMessage === "string" && sourceMessage !== "" && !(core.sourceLocale in stored)) {
        stored[core.sourceLocale] = { value: sourceMessage };
      }
      applyStored(draft, baseline, stored);
      commit({ ...core, draft, baseline, meta: values.meta === undefined ? undefined : clone(values.meta), stored: [...new Set([...core.stored, ...Object.keys(values.locales)])] });
    },
    setUsage(key, usages, error) {
      if (!isOpen(key)) return;
      commit({ ...core, usages: clone(usages), usagesLoading: false, usagesError: error });
    },
    setHidden(items) {
      commit({ ...core, hidden: clone(items) });
    },
    editValue(locale, value) {
      if (core.selection === undefined) return;
      commit({ ...core, draft: { ...core.draft, [locale]: { ...core.draft[locale], value } } });
    },
    editField(locale, field, value) {
      if (core.selection === undefined) return;
      if (core.schema?.fields?.some((f) => f.name === field && f.type === "readonly")) return;
      commit({ ...core, draft: { ...core.draft, [locale]: { ...core.draft[locale], [field]: value } } });
    },
  };
}
