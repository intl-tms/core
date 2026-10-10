import { describe, expectTypeOf, it } from "vitest";
import { resolveConfig } from "../src/config.js";
import type { HandlerOptions } from "../src/handler.js";
import type { StorageAdapter } from "../src/storage.js";

export const statusAB = resolveConfig({
  locales: ["en", "da"],
  basePath: "https://x.test/api",
  schema: { fields: [{ type: "select", name: "status", options: [{ label: "Draft", value: "draft" }, { label: "Approved", value: "approved" }] }] },
});
export const statusXY = resolveConfig({
  locales: ["en", "da"],
  basePath: "https://x.test/api",
  schema: { fields: [{ type: "select", name: "status", options: [{ label: "X", value: "x" }, { label: "Y", value: "y" }] }] },
});
export const otherLocales = resolveConfig({
  locales: ["en", "fr"],
  basePath: "https://x.test/api",
  schema: { fields: [{ type: "select", name: "status", options: [{ label: "Draft", value: "draft" }, { label: "Approved", value: "approved" }] }] },
});
export const noSchema = resolveConfig({ locales: ["en", "da"], basePath: "https://x.test/api" });

/** Whether a handler built for configuration `C` takes adapter `A`. */
type Accepts<C extends typeof statusAB | typeof noSchema, A> = A extends HandlerOptions<C>["adapter"] ? true : false;

describe("adapter and handler configuration typing", () => {
  it("an adapter typed for the same configuration is accepted", () => {
    expectTypeOf<Accepts<typeof statusAB, StorageAdapter<typeof statusAB>>>().toEqualTypeOf<true>();
  });

  it("F23: an adapter typed for another Schema is rejected", () => {
    expectTypeOf<Accepts<typeof statusAB, StorageAdapter<typeof statusXY>>>().toEqualTypeOf<false>();
  });

  it("an adapter typed for other Locales is rejected", () => {
    expectTypeOf<Accepts<typeof statusAB, StorageAdapter<typeof otherLocales>>>().toEqualTypeOf<false>();
  });

  it("an untyped adapter fits a configuration with a Schema", () => {
    expectTypeOf<Accepts<typeof statusAB, StorageAdapter>>().toEqualTypeOf<true>();
  });

  it("an untyped adapter fits a configuration with no Schema", () => {
    expectTypeOf<Accepts<typeof noSchema, StorageAdapter>>().toEqualTypeOf<true>();
  });

  it("an adapter typed for a Schema is rejected by a handler whose Schema is open", () => {
    expectTypeOf<Accepts<typeof noSchema, StorageAdapter<typeof statusAB>>>().toEqualTypeOf<false>();
  });
});
