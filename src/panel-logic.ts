// Pure functions behind the editing panel: toolbar logic, formatting and
// diagnostics. No DOM, no view framework, no transport.

import { tagMismatch } from "./classification.js";
import type { FieldDef, SchemaDef, SelectField } from "./config.js";
import { fieldText, type ExpectedValues, type SaveResult } from "./wire.js";

/** The default English strings of the panel. */
export const PANEL_TEXT = {
  loadFailed: "Could not load other locales",
  requiredFields: "Fill required fields",
  tagGuard: "Tags must match the source",
  noChanges: "No changes",
  saving: "Saving...",
  connectionError: "Connection error",
  staleSelection: "Selection changed -- click the text again",
  conflictToken: "changed elsewhere",
  changedSince: "Changed since you opened it.",
  empty: "(empty)",
} as const;

// ---------------------------------------------------------------------------
// Toolbar. The search text and selected filter values are transient view state
// held by each view, not by the store: nothing about them reaches a draft, a
// save or a validation.
// ---------------------------------------------------------------------------

/** Whether the Toolbar should render: only if the Schema enables search or declares a filter. */
export function shouldRenderToolbar(schema: SchemaDef | undefined): boolean {
  const toolbar = schema?.toolbar;
  return toolbar?.search === true || (toolbar?.filters?.length ?? 0) > 0;
}

/** A Toolbar filter paired with its Select Field and a display label. */
export interface ResolvedFilter {
  field: SelectField;
  label: string;
}

/**
 * Pairs each declared filter with its Select Field and a display label. A
 * filter naming an unknown or non-Select Field is warned about and skipped, so
 * a configuration that was never validated cannot break the panel.
 */
export function resolveToolbarFilters(schema: SchemaDef | undefined, warn: (message: string) => void = (m) => console.warn(m)): ResolvedFilter[] {
  const fields: readonly FieldDef[] = schema?.fields ?? [];
  const resolved: ResolvedFilter[] = [];
  for (const filter of schema?.toolbar?.filters ?? []) {
    const field = fields.find((f) => f.name === filter.field);
    if (field === undefined || field.type !== "select") {
      warn(`Toolbar filter "${filter.field}" is skipped: ${field === undefined ? "no such Field is declared" : `it is a "${field.type}" Field and a filter needs a Select`}`);
      continue;
    }
    resolved.push({ field, label: filter.label ?? field.label ?? field.name });
  }
  return resolved;
}

/** What {@link visibleLocales} decides from. */
export interface VisibleLocalesInput {
  /** The rows in display order. */
  order: readonly string[];
  /** The Current Locale, which is always visible. */
  current: string | undefined;
  /** Each Locale's row as the Editor sees it. */
  rows: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>;
  /** Case-insensitive substring match against the Locale code and the translation string. */
  search: string;
  /** The selected value per filtered Field name. Empty means "All". */
  selected: Readonly<Record<string, string | undefined>>;
  filters: readonly ResolvedFilter[];
}

/**
 * The Locale rows the Toolbar leaves visible: the Current Locale always, and
 * every other Locale that matches the search and every active filter. Input
 * order is preserved.
 */
export function visibleLocales(input: VisibleLocalesInput): string[] {
  const needle = input.search.toLowerCase();
  return input.order.filter((locale) => {
    if (locale === input.current) return true;
    const row = input.rows[locale];
    if (needle !== "" && !locale.toLowerCase().includes(needle) && !fieldText(row?.value).toLowerCase().includes(needle)) return false;
    return input.filters.every(({ field }) => {
      const wanted = input.selected[field.name];
      return wanted === undefined || wanted === "" || fieldText(row?.[field.name]) === wanted;
    });
  });
}

/**
 * The Locales with errors that the current search and filters hide, so a view
 * can explain a blocked Save instead of leaving a dead button. Works for
 * required errors (lists) and tag errors (strings) alike.
 */
export function hiddenErrors(errors: Readonly<Record<string, string | readonly string[]>>, visible: readonly string[]): string[] {
  return Object.keys(errors).filter((locale) => errors[locale]!.length > 0 && !visible.includes(locale));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** A usage URL reduced to its path for display; the raw value if it will not parse. */
export function usagePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** A coarse "time ago" label; empty for a missing or unparseable time. */
export function relativeTime(iso: string | undefined, now: number = Date.now()): string {
  if (iso === undefined) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, (now - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

/**
 * The notice shown under a conflicting column: that it changed since it was
 * opened, and what it holds now. A Select is shown by its option's label, as
 * the Editor sees it in the dropdown; an empty stored value is shown in words.
 */
export function conflictNotice(stored: unknown, field?: FieldDef): string {
  const text = fieldText(stored);
  const label = field?.type === "select" ? field.options.find((option) => option.value === text)?.label : undefined;
  return `${PANEL_TEXT.changedSince} Stored now: ${label ?? (text === "" ? PANEL_TEXT.empty : text)}`;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * Explains a failed save in plain words, for a diagnostics log. Every layer of
 * a save can fail and without care they all collapse into the same bare
 * "failed" mark; this is the one place that tells them apart. Returns nothing
 * when the save succeeded, and nothing when the only failures are Write
 * conflicts, because a conflict is the website's answer, not a fault, and the
 * panel already shows it.
 */
export function explainSaveFailure(outcome: Pick<SaveResult, "ok" | "error" | "results"> | null | undefined): string | undefined {
  if (outcome === undefined || outcome === null) return "The page did not answer. The page-side script may not be running: reload the page and try again.";
  if (outcome.error === "config-not-loaded") return "The configuration never loaded, so there is no endpoint to save to. Check the configured URL.";
  if (outcome.error === "stale-selection") return "The page no longer holds this translation. Click the text again.";
  if (outcome.error === "no-selection") return "No translation is selected. Click a highlighted translation first.";
  if (outcome.error !== undefined) return outcome.error;
  if (outcome.ok) return undefined;
  const failures = Object.entries(outcome.results).filter(([, result]) => !result.ok && result.current === undefined);
  if (failures.length === 0) return Object.keys(outcome.results).length === 0 ? "The save failed without saying why." : undefined;
  return failures
    .map(([locale, result]) =>
      result.status === undefined
        ? `${locale}: the request never reached the server${result.message === undefined ? "" : ` (${result.message})`}`
        : `${locale}: ${result.status}${result.message === undefined ? "" : ` ${result.message}`}`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Draft, baseline and validation
// ---------------------------------------------------------------------------

/** A Locale's row as the panel holds it. */
export type Row = Readonly<Record<string, unknown>>;
/** Rows by Locale. */
export type Rows = Readonly<Record<string, Row | undefined>>;

/** The writable columns: the translation string and every Field that is not Read-only. */
export function writableColumns(schema: SchemaDef | undefined): string[] {
  return ["value", ...(schema?.fields ?? []).filter((field) => field.type !== "readonly").map((field) => field.name)];
}

/**
 * The writable columns whose draft differs from the baseline. Missing and
 * empty compare equal, so an untouched Field (absent on both sides) is not a
 * change.
 */
export function changedColumns(draft: Row | undefined, baseline: Row | undefined, schema: SchemaDef | undefined): string[] {
  return writableColumns(schema).filter((column) => fieldText(draft?.[column]) !== fieldText(baseline?.[column]));
}

/**
 * For each loaded Locale, the required Fields with no value. Read-only Fields
 * never count, and neither do Locales that have no stored row: a required
 * Field must not permanently disable Save because a Locale that has no row yet
 * has not filled it in.
 */
export function requiredErrorsOf(schema: SchemaDef | undefined, draft: Rows, loaded: readonly string[]): Record<string, string[]> {
  const required = (schema?.fields ?? []).filter((field) => field.type !== "readonly" && field.required === true);
  const errors: Record<string, string[]> = {};
  if (required.length === 0) return errors;
  for (const locale of loaded) {
    const empty = required.filter((field) => fieldText(draft[locale]?.[field.name]) === "").map((field) => field.name);
    if (empty.length > 0) errors[locale] = empty;
  }
  return errors;
}

/** What {@link tagErrorsOf} decides from. */
export interface TagErrorInput {
  schema: SchemaDef | undefined;
  draft: Rows;
  baseline: Rows;
  sourceLocale: string | undefined;
  sourceMessage: string | undefined;
  locales: readonly string[];
}

/**
 * For each Locale whose translation string the Editor has changed, why its
 * draft cannot be saved.
 *
 * Only changed Locales are checked: the guard exists to stop a bad write, not
 * to audit the store. A row that had already drifted is live and is not made
 * worse by an edit to a different Locale; flagging it would refuse every other
 * Locale of that key for ever, with nothing the Editor could type to clear it.
 *
 * The reference is, in order: the key's source message (the tags are a
 * contract with the code, and a website that keeps its wording in the code
 * has said what the contract is); the Source Locale's baseline (not its draft,
 * so editing the Source Locale is checked against what was loaded rather than
 * against itself); and the changed Locale's own baseline, so the guard still
 * works with no metadata and no Source Locale at all.
 */
export function tagErrorsOf(input: TagErrorInput): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const locale of input.locales) {
    if (!changedColumns(input.draft[locale], input.baseline[locale], input.schema).includes("value")) continue;
    const reference =
      input.sourceMessage !== undefined && input.sourceMessage !== ""
        ? input.sourceMessage
        : input.sourceLocale !== undefined && fieldText(input.baseline[input.sourceLocale]?.value) !== ""
          ? fieldText(input.baseline[input.sourceLocale]?.value)
          : fieldText(input.baseline[locale]?.value);
    const reason = tagMismatch(fieldText(input.draft[locale]?.value), reference);
    if (reason !== undefined) errors[locale] = reason;
  }
  return errors;
}

/** One dirty Locale's write: only the changed columns, each beside what the baseline held for it. */
export interface PanelWrite {
  value?: string;
  fields?: Record<string, string>;
  /**
   * What this Editor loaded for each changed column, in text form. The server
   * checks the stored row against it, so two Editors on one key cannot silently
   * overwrite each other.
   */
  expected: ExpectedValues;
}

/**
 * The writes a Save would send, in `order`: for each dirty Locale only the
 * changed writable columns. Missing and empty compare equal, so an untouched
 * Field is not a change. A cleared Field is sent as the empty string, never as
 * an absent property, which serialisation would drop and the clear would
 * vanish on the wire. Read-only Fields are never in a write.
 */
export function buildChanges(input: { schema: SchemaDef | undefined; draft: Rows; baseline: Rows; order: readonly string[] }): Record<string, PanelWrite> {
  const changes: Record<string, PanelWrite> = {};
  for (const locale of input.order) {
    const columns = changedColumns(input.draft[locale], input.baseline[locale], input.schema);
    if (columns.length === 0) continue;
    const write: PanelWrite = { expected: {} };
    for (const column of columns) {
      const now = fieldText(input.draft[locale]?.[column]);
      const was = fieldText(input.baseline[locale]?.[column]);
      if (column === "value") {
        write.value = now;
        write.expected.value = was;
      } else {
        (write.fields ??= {})[column] = now;
        (write.expected.fields ??= {})[column] = was;
      }
    }
    changes[locale] = write;
  }
  return changes;
}
