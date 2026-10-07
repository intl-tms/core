/**
 * The entry a website imports: marker codec, catalog marking, configuration,
 * wire types, request handler, storage seam, usage helpers and message
 * classification. This entry carries the package's stability promise and
 * contains no DOM code.
 */
export { decode, detect, encode, strip } from "./codec.js";
export type { Decoded } from "./codec.js";
export { markCatalog } from "./catalog.js";
export type { Catalog, MarkOptions } from "./catalog.js";
export { TOGGLE_COOKIE_NAME, TOGGLE_ON_VALUE } from "./toggle.js";
export { SHARED_NOTICE, hasTags, isPlain, isSharedKey, tagMismatch, tagNames } from "./classification.js";
export { ConfigError, PROTOCOL_VERSION, resolveConfig } from "./config.js";
export type {
  Capability,
  ConfigInput,
  EndpointsInput,
  FieldDef,
  FieldsOf,
  LocaleOf,
  OpenRow,
  ReadonlyField,
  ResolvedConfig,
  RowOf,
  SchemaDef,
  SelectField,
  SelectOption,
  TextField,
  TextareaField,
  ToolbarDef,
  ToolbarFilter,
  WritableRowOf,
} from "./config.js";
export { resolveEndpoint } from "./endpoints.js";
export { conflictingColumns, fieldText, isEmptyPatch, writePatch } from "./wire.js";
export type {
  ExpectedValues,
  FailureClass,
  FieldsOfWrite,
  HiddenItem,
  IsUntyped,
  KeyMeta,
  KeyReference,
  LocaleSaveResult,
  PageEffect,
  PatchSource,
  RuntimeUsage,
  SaveOutcome,
  SaveResult,
  StaticUsage,
  Usage,
  UsageEntry,
  UsageReport,
  ValuesEnvelope,
  WireRow,
  Write,
  WriteRequest,
} from "./wire.js";
export { normalizeUrl, usageSignature } from "./usage.js";
export { createMemoryAdapter, detectAdapterCapabilities } from "./storage.js";
export type { AdapterLocale, AdapterRow, MaybePromise, MemoryAdapterOptions, StorageAdapter } from "./storage.js";
export { runAdapterConformance } from "./conformance.js";
export type { ConformanceOptions, ConformanceReport, ConformanceResult } from "./conformance.js";
export { createHandler } from "./handler.js";
export type { AnyConfig, Authorize, AuthorizeContext, CorsPolicy, ErrorCode, Handler, HandlerOptions, Operation } from "./handler.js";
export type { ConformanceTarget } from "./conformance.js";
export type { TypedStorageAdapter, UntypedStorageAdapter, UntypedWrite } from "./storage.js";
