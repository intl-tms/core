import { describe, expectTypeOf, it } from "vitest";
import { resolveConfig, type LocaleOf, type RowOf, type WritableRowOf } from "../src/config.js";

const typed = resolveConfig({
  locales: ["en", "da"],
  basePath: "https://x.test/api",
  schema: {
    fields: [
      { type: "select", name: "status", options: [{ label: "Draft", value: "draft" }, { label: "Approved", value: "approved" }] },
      { type: "text", name: "note" },
      { type: "readonly", name: "updatedBy" },
    ],
  },
});
type Typed = typeof typed;

const open = resolveConfig({ locales: ["en"], basePath: "https://x.test/api" });
type Open = typeof open;

// Type-only assertions: they fail `tsc`, which the type check runs over the tests.
describe("configuration type inference", () => {
  it("F21: the Locale type is the union of the declared Locales", () => {
    expectTypeOf<LocaleOf<Typed>>().toEqualTypeOf<"en" | "da">();
  });

  it("TYP-1: the resolved Locale list keeps its literal type", () => {
    expectTypeOf(typed.locales).toEqualTypeOf<readonly ("en" | "da")[]>();
  });

  it("F22: a Select property accepts its option values and empty, optionally", () => {
    expectTypeOf<RowOf<Typed>["status"]>().toEqualTypeOf<"draft" | "approved" | "" | undefined>();
  });

  it("F22: a Select property rejects a value that is not an option", () => {
    expectTypeOf<{ value: string; status: "bogus" }>().not.toExtend<RowOf<Typed>>();
  });

  it("TYP-2: a text Field is an optional string property", () => {
    expectTypeOf<RowOf<Typed>["note"]>().toEqualTypeOf<string | undefined>();
  });

  it("TYP-2: the row always carries the translation string", () => {
    expectTypeOf<RowOf<Typed>["value"]>().toEqualTypeOf<string>();
  });

  it("TYP-4: a Read-only property is unconstrained", () => {
    expectTypeOf<RowOf<Typed>["updatedBy"]>().toEqualTypeOf<unknown>();
  });

  it("TYP-5: the writable row excludes Read-only Fields", () => {
    expectTypeOf<keyof WritableRowOf<Typed>>().toEqualTypeOf<"value" | "status" | "note">();
  });

  it("TYP-6: with no Schema the row type is open", () => {
    expectTypeOf<{ value: string; anything: number }>().toExtend<RowOf<Open>>();
  });

  it("TYP-1: a single declared Locale infers as that literal", () => {
    expectTypeOf(open.locales).toEqualTypeOf<readonly "en"[]>();
  });

  it("TYP-8: members the Developer omitted are readable as absent", () => {
    expectTypeOf(typed.sourceLocale).toEqualTypeOf<"en" | "da" | undefined>();
  });
});
