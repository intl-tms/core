import { KEY_PLACEHOLDER } from "./endpoints.js";

/**
 * The version of the wire contract. It is served in the configuration so an
 * editing tool that does not understand it can say so in plain words instead
 * of failing in a way that looks like a network error.
 */
export const PROTOCOL_VERSION = 1;

/** What a server can do, as advertised in the served configuration. */
export type Capability = "usage" | "conflicts" | "conflicts-atomic" | "batch-write" | "bulk-read" | "meta" | "delete" | "static-usage";

/** One option of a Select Field. */
export interface SelectOption<V extends string = string> {
  label: string;
  value: V;
}

/** A single-line text Field. */
export interface TextField {
  type: "text";
  /** The stored column name. */
  name: string;
  /** Display label; defaults to the name. */
  label?: string;
  /** A required Field with no value blocks Save in the panel. The server does not enforce it. */
  required?: boolean;
}

/** A multi-line text Field. */
export interface TextareaField {
  type: "textarea";
  name: string;
  label?: string;
  required?: boolean;
}

/** A dropdown Field. A Select with no stored value shows an empty placeholder; no option is pre-selected. */
export interface SelectField<V extends string = string> {
  type: "select";
  name: string;
  label?: string;
  required?: boolean;
  options: readonly SelectOption<V>[];
}

/** A display-only Field whose value comes only from the website. It is never written. */
export interface ReadonlyField {
  type: "readonly";
  name: string;
  label?: string;
}

/** Any Field of a Schema. */
export type FieldDef = TextField | TextareaField | SelectField | ReadonlyField;

/** A filter in the Toolbar. It names a Select Field. */
export interface ToolbarFilter {
  field: string;
  label?: string;
}

/** Search and filter controls that narrow which Locale rows the panel shows. */
export interface ToolbarDef {
  search?: boolean;
  filters?: readonly ToolbarFilter[];
}

/** What the editing panel shows per Locale beyond the translation string. */
export interface SchemaDef<F extends readonly FieldDef[] = readonly FieldDef[]> {
  /** Input type of the translation string itself. Defaults to single-line. */
  valueField?: { type: "text" | "textarea" };
  fields?: F;
  toolbar?: ToolbarDef;
}

/** Endpoint templates. Those that address a key contain the literal `{key}`. */
export interface EndpointsInput {
  values?: string;
  usageReport?: string;
  usageRead?: string;
}

/** The configuration as the Developer writes it. */
export interface ConfigInput<L extends string = string, F extends readonly FieldDef[] = readonly FieldDef[]> {
  /** The ordered Locales the website has. At least one. */
  locales: readonly L[];
  /** One absolute URL; every endpoint derives from it. Required unless `endpoints.values` is given. */
  basePath?: string;
  endpoints?: EndpointsInput;
  /** The Locale whose wording lives in the website's code. Must be one of the Locales. */
  sourceLocale?: NoInfer<L>;
  schema?: SchemaDef<F>;
  colors?: { highlight?: string; active?: string };
  /** Attribute names to search for Markers, added to the built-in defaults. */
  scanAttributes?: readonly string[];
}

/** The configuration after resolution: what the handler routes on and what is served to editing tools. */
export interface ResolvedConfig<L extends string = string, F extends readonly FieldDef[] = readonly FieldDef[]> {
  protocol: number;
  capabilities: readonly Capability[];
  locales: readonly L[];
  basePath?: string;
  sourceLocale?: L;
  endpoints: { values: string; usageReport?: string; usageRead?: string };
  schema?: SchemaDef<F>;
  colors?: { highlight?: string; active?: string };
  scanAttributes?: readonly string[];
}

/**
 * Thrown at boot when a configuration cannot work. Every message says what was
 * found, why it cannot work and what to change, with the offending value in
 * it: a configuration mistake that surfaced in the browser would be nearly
 * impossible to debug from there.
 */
export class ConfigError extends Error {
  constructor(found: string, why: string, fix: string) {
    super(`${found}. ${why}. Fix: ${fix}.`);
    this.name = "ConfigError";
  }
}

/**
 * Field names the wire contract itself uses. A Field with one of these names
 * would silently overwrite the translation string or another contract member
 * in a flattened write.
 */
export const RESERVED_FIELD_NAMES: readonly string[] = ["value", "locale", "expected", "fields", "revision"];

function isAbsoluteHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function validate(input: ConfigInput): void {
  const { locales, basePath, endpoints, sourceLocale, schema } = input;
  if (locales.length === 0) {
    throw new ConfigError("locales is empty", "the editing panel renders one row per Locale, so it would show nothing", "list at least one Locale, for example locales: [\"en\"]");
  }
  if (basePath !== undefined && !isAbsoluteHttpUrl(basePath)) {
    throw new ConfigError(
      `basePath is "${basePath}"`,
      "editing tools run on other origins and fetch endpoint URLs verbatim, prefixing no origin, so a relative or non-http(s) path cannot be reached",
      'give an absolute http(s) URL such as "https://app.example.com/api/tms"',
    );
  }
  if (basePath === undefined && endpoints?.values === undefined) {
    throw new ConfigError("neither basePath nor endpoints.values is set", "there is nowhere to read or save translations", "set basePath, or set endpoints.values explicitly");
  }
  for (const [name, template] of [["endpoints.values", endpoints?.values], ["endpoints.usageRead", endpoints?.usageRead]] as const) {
    if (template !== undefined && !template.includes(KEY_PLACEHOLDER)) {
      throw new ConfigError(`${name} is "${template}"`, `it addresses a key but does not contain the literal placeholder ${KEY_PLACEHOLDER}`, `add ${KEY_PLACEHOLDER} where the key belongs in the URL`);
    }
  }
  if (sourceLocale !== undefined && !locales.includes(sourceLocale)) {
    throw new ConfigError(`sourceLocale is "${sourceLocale}"`, `it is not one of the configured Locales (${locales.join(", ")})`, "use one of those Locales, or remove sourceLocale");
  }
  const fields = schema?.fields ?? [];
  const names = new Set<string>();
  for (const field of fields) {
    if (RESERVED_FIELD_NAMES.includes(field.name)) {
      throw new ConfigError(`Field "${field.name}" uses a reserved name`, `the wire contract already uses ${RESERVED_FIELD_NAMES.join(", ")}, so the Field would overwrite it`, "rename the Field");
    }
    if (names.has(field.name)) {
      throw new ConfigError(`Field "${field.name}" is declared twice`, "a Field name is its stored column, so two Fields would share one column", "give each Field a unique name");
    }
    names.add(field.name);
    if (field.type === "select" && field.options.length === 0) {
      throw new ConfigError(`Select Field "${field.name}" has no options`, "it would render an empty dropdown", "add at least one { label, value } option");
    }
  }
  for (const filter of schema?.toolbar?.filters ?? []) {
    const target = fields.find((field) => field.name === filter.field);
    if (target === undefined) {
      throw new ConfigError(`Toolbar filter names "${filter.field}"`, `no such Field is declared (declared: ${fields.map((f) => f.name).join(", ") || "none"})`, "name a declared Select Field, or declare it");
    }
    if (target.type !== "select") {
      throw new ConfigError(`Toolbar filter names "${filter.field}", a Field of type "${target.type}"`, "a filter offers a Select's options, so it needs a Select", "filter on a Select Field, or change the Field to a Select");
    }
  }
}

function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

/**
 * Resolves and returns the configuration with every derivable endpoint filled
 * in. The result is plain data, serialisable as JSON with nothing lost.
 */
export function resolveConfig<const L extends string, const F extends readonly FieldDef[] = readonly FieldDef[]>(
  input: ConfigInput<L, F>,
): ResolvedConfig<L, F> {
  validate(input);
  const basePath = input.basePath === undefined ? undefined : trimTrailingSlashes(input.basePath);
  const derive = (suffix: string): string | undefined => (basePath === undefined ? undefined : `${basePath}${suffix}`);
  const values = input.endpoints?.values ?? derive(`/keys/${KEY_PLACEHOLDER}`) ?? "";
  const usageReport = input.endpoints?.usageReport ?? derive("/usage");
  const usageRead = input.endpoints?.usageRead ?? derive(`/usage/${KEY_PLACEHOLDER}`);

  const endpoints: ResolvedConfig["endpoints"] = { values };
  if (usageReport !== undefined) endpoints.usageReport = usageReport;
  if (usageRead !== undefined) endpoints.usageRead = usageRead;

  const capabilities: Capability[] = [];
  if (usageReport !== undefined || usageRead !== undefined) capabilities.push("usage");
  capabilities.push("conflicts");

  const resolved: ResolvedConfig<L, F> = { protocol: PROTOCOL_VERSION, capabilities, locales: input.locales, endpoints };
  if (basePath !== undefined) resolved.basePath = basePath;
  if (input.sourceLocale !== undefined) resolved.sourceLocale = input.sourceLocale;
  if (input.schema !== undefined) resolved.schema = input.schema;
  if (input.colors !== undefined) resolved.colors = input.colors;
  if (input.scanAttributes !== undefined) resolved.scanAttributes = input.scanAttributes;
  return resolved;
}

// ---------------------------------------------------------------------------
// Type inference. The configuration is the single source of truth for types as
// well as behaviour: nothing here needs an annotation from the Developer.
// ---------------------------------------------------------------------------

/** The union of Locales a resolved configuration declares. */
export type LocaleOf<C> = C extends { locales: readonly (infer L)[] } ? L & string : never;

/** The Field list of a resolved configuration, or the wide list when it is not known statically. */
export type FieldsOf<C> = C extends ResolvedConfig<string, infer F> ? F : readonly FieldDef[];

/**
 * `any`, spelled through the return type of `JSON.parse`. A value of an open
 * row must be assignable to every Field's narrower type, so that an untyped
 * adapter fits every configuration.
 */
type AnyValue = ReturnType<typeof JSON.parse>;

/** A stored row when Fields are not known statically: the string plus anything. */
export interface OpenRow {
  value: string;
  [field: string]: AnyValue;
}

type FieldValue<D> = D extends { type: "select"; options: readonly { value: infer V }[] } ? V | "" : string;
type WritableFieldDef<F extends readonly FieldDef[]> = Exclude<F[number], { type: "readonly" }>;
type ReadonlyFieldDef<F extends readonly FieldDef[]> = Extract<F[number], { type: "readonly" }>;
type IsOpen<F extends readonly FieldDef[]> = number extends F["length"] ? true : false;

/**
 * The columns a write may carry: the translation string plus one optional
 * property per writable Field. A Select is narrowed to its option values plus
 * empty, so a typo in a status is a compile error. Open when the Fields are
 * not known statically.
 */
export type WritableRowOf<C> = IsOpen<FieldsOf<C>> extends true
  ? OpenRow
  : { value: string } & { [D in WritableFieldDef<FieldsOf<C>> as D["name"]]?: FieldValue<D> };

/**
 * The shape of a Locale's stored row: the writable columns plus any Read-only
 * Field, whose value only the website produces and so is unconstrained.
 */
export type RowOf<C> = IsOpen<FieldsOf<C>> extends true
  ? OpenRow
  : WritableRowOf<C> & { [D in ReadonlyFieldDef<FieldsOf<C>> as D["name"]]?: unknown };
