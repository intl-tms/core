import { createPanelStore, type PanelStore, type PanelStoreOptions } from "../../src/panel-store.js";
import type { SchemaDef } from "../../src/config.js";

export const statusField = { type: "select", name: "status", label: "Status", required: true, options: [{ label: "Draft", value: "draft" }, { label: "Approved", value: "approved" }] } as const;
export const noteField = { type: "text", name: "note" } as const;
export const byField = { type: "readonly", name: "updatedBy" } as const;

export const schema: SchemaDef = { fields: [statusField, noteField, byField] };
export const plainSchema: SchemaDef = { fields: [noteField, { type: "select", name: "tone", options: [{ label: "A", value: "a" }] }] };

/** A store configured with three Locales and (by default) the full test Schema. */
export function configured(options: PanelStoreOptions = {}, config: { schema?: SchemaDef | undefined; sourceLocale?: string | undefined; locales?: readonly string[] } = {}): PanelStore {
  const store = createPanelStore(options);
  store.setConfig({ locales: config.locales ?? ["en", "da", "es"], schema: "schema" in config ? config.schema : schema, sourceLocale: config.sourceLocale });
  return store;
}

export const values = (locales: Record<string, Record<string, unknown>>, meta?: { sourceMessage?: string }) => ({ ...(meta === undefined ? {} : { meta }), locales: locales as never });
