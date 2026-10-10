import { describe, expect, it } from "vitest";
import { ConfigError, PROTOCOL_VERSION, resolveConfig, type ConfigInput } from "../src/config.js";

const BASE = "https://x.test/api/tms";

describe("configuration resolution", () => {
  it("F1: Locales and a Base path alone resolve", () => {
    expect(resolveConfig({ locales: ["en", "da"], basePath: BASE }).locales).toEqual(["en", "da"]);
  });

  it("F2: the values template derives from the Base path", () => {
    expect(resolveConfig({ locales: ["en"], basePath: BASE }).endpoints.values).toBe(`${BASE}/keys/{key}`);
  });

  it("F3: the usage-report template derives from the Base path", () => {
    expect(resolveConfig({ locales: ["en"], basePath: BASE }).endpoints.usageReport).toBe(`${BASE}/usage`);
  });

  it("F4: the usage-read template derives from the Base path", () => {
    expect(resolveConfig({ locales: ["en"], basePath: BASE }).endpoints.usageRead).toBe(`${BASE}/usage/{key}`);
  });

  it("F5: a trailing slash on the Base path is normalised away", () => {
    expect(resolveConfig({ locales: ["en"], basePath: `${BASE}/` }).basePath).toBe(BASE);
  });

  it("F5: several trailing slashes are all removed", () => {
    expect(resolveConfig({ locales: ["en"], basePath: `${BASE}///` }).basePath).toBe(BASE);
  });

  it("F6: an explicit values template beside a Base path is kept", () => {
    const values = "https://x.test/elsewhere/{key}";
    expect(resolveConfig({ locales: ["en"], basePath: BASE, endpoints: { values } }).endpoints.values).toBe(values);
  });

  it("F6: the other templates still derive when only values is explicit", () => {
    const resolved = resolveConfig({ locales: ["en"], basePath: BASE, endpoints: { values: "https://x.test/e/{key}" } });
    expect(resolved.endpoints.usageReport).toBe(`${BASE}/usage`);
  });

  it("F7: an explicit values template without a Base path resolves", () => {
    expect(resolveConfig({ locales: ["en"], endpoints: { values: "https://x.test/e/{key}" } }).endpoints.values).toBe("https://x.test/e/{key}");
  });

  it("F7: and has no usage-report template", () => {
    expect(resolveConfig({ locales: ["en"], endpoints: { values: "https://x.test/e/{key}" } }).endpoints.usageReport).toBeUndefined();
  });

  it("F7: and has no usage-read template", () => {
    expect(resolveConfig({ locales: ["en"], endpoints: { values: "https://x.test/e/{key}" } }).endpoints.usageRead).toBeUndefined();
  });

  it("F20: the resolved configuration survives JSON with nothing lost", () => {
    const resolved = resolveConfig({
      locales: ["en", "da"],
      basePath: BASE,
      sourceLocale: "en",
      colors: { highlight: "#111", active: "#222" },
      scanAttributes: ["data-tooltip"],
      schema: { fields: [{ type: "text", name: "note" }] },
    });
    expect(JSON.parse(JSON.stringify(resolved))).toEqual(resolved);
  });

  it("F20: omitted members are absent rather than present and undefined", () => {
    expect(Object.keys(resolveConfig({ locales: ["en"], basePath: BASE })).sort()).toEqual(["basePath", "capabilities", "endpoints", "locales", "protocol"]);
  });

  it("the served configuration carries the protocol version", () => {
    expect(resolveConfig({ locales: ["en"], basePath: BASE }).protocol).toBe(PROTOCOL_VERSION);
  });

  it("the capabilities say usage is available when usage endpoints exist", () => {
    expect(resolveConfig({ locales: ["en"], basePath: BASE }).capabilities).toContain("usage");
  });

  it("the capabilities omit usage when no usage endpoint exists", () => {
    expect(resolveConfig({ locales: ["en"], endpoints: { values: "https://x.test/e/{key}" } }).capabilities).not.toContain("usage");
  });

  it("the capabilities say conflicts are checked", () => {
    expect(resolveConfig({ locales: ["en"], basePath: BASE }).capabilities).toContain("conflicts");
  });

  it("the Developer's input is not mutated", () => {
    const input = { locales: ["en"], basePath: `${BASE}/` };
    resolveConfig(input);
    expect(input).toEqual({ locales: ["en"], basePath: `${BASE}/` });
  });

  it("the source locale, colours, scan attributes and schema pass through as written", () => {
    const resolved = resolveConfig({ locales: ["en", "da"], basePath: BASE, sourceLocale: "da", colors: { active: "#222" }, scanAttributes: ["data-t"] });
    expect([resolved.sourceLocale, resolved.colors, resolved.scanAttributes]).toEqual(["da", { active: "#222" }, ["data-t"]]);
  });
});

const failure = (input: ConfigInput): string => {
  try {
    resolveConfig(input);
  } catch (error) {
    return error instanceof ConfigError ? error.message : `not a ConfigError: ${String(error)}`;
  }
  return "did not throw";
};

const statusField = { type: "select", name: "status", options: [{ label: "Draft", value: "draft" }] } as const;

describe("boot validation", () => {
  it("F8: a relative Base path throws a ConfigError containing the value", () => {
    expect(failure({ locales: ["en"], basePath: "/api/tms" })).toContain('"/api/tms"');
  });

  it("F8: a Base path with a non-http scheme is rejected", () => {
    expect(failure({ locales: ["en"], basePath: "ftp://x.test/tms" })).toContain('"ftp://x.test/tms"');
  });

  it("F8: the message says tools fetch the URL verbatim", () => {
    expect(failure({ locales: ["en"], basePath: "/api/tms" })).toContain("verbatim");
  });

  it("F9: neither a Base path nor a values template throws", () => {
    expect(failure({ locales: ["en"] })).toContain("basePath");
  });

  it("F9: the message names the alternative", () => {
    expect(failure({ locales: ["en"] })).toContain("endpoints.values");
  });

  it("F10: a values template without the placeholder throws, quoting the template", () => {
    expect(failure({ locales: ["en"], endpoints: { values: "https://x.test/keys" } })).toContain('"https://x.test/keys"');
  });

  it("F10: the message states the literal placeholder", () => {
    expect(failure({ locales: ["en"], endpoints: { values: "https://x.test/keys" } })).toContain("{key}");
  });

  it("F11: a usage-read template without the placeholder throws, quoting the template", () => {
    expect(failure({ locales: ["en"], basePath: BASE, endpoints: { usageRead: "https://x.test/u" } })).toContain('"https://x.test/u"');
  });

  it("F12: an empty Locale list throws and explains the panel renders one row per Locale", () => {
    expect(failure({ locales: [] })).toContain("one row per Locale");
  });

  it("F13: a Source Locale outside the list throws, quoting it", () => {
    expect(failure({ locales: ["en", "da"], basePath: BASE, sourceLocale: "fr" as "en" })).toContain('"fr"');
  });

  it("F13: the message lists the configured Locales", () => {
    expect(failure({ locales: ["en", "da"], basePath: BASE, sourceLocale: "fr" as "en" })).toContain("en, da");
  });

  it("F14: two Fields named alike throw, quoting the name", () => {
    expect(failure({ locales: ["en"], basePath: BASE, schema: { fields: [{ type: "text", name: "note" }, { type: "textarea", name: "note" }] } })).toContain('"note"');
  });

  it("F14: the message says a Field name is its stored column", () => {
    expect(failure({ locales: ["en"], basePath: BASE, schema: { fields: [{ type: "text", name: "note" }, { type: "text", name: "note" }] } })).toContain("stored column");
  });

  it("F15: a Select with no options throws, quoting the Field name", () => {
    expect(failure({ locales: ["en"], basePath: BASE, schema: { fields: [{ type: "select", name: "status", options: [] }] } })).toContain('"status"');
  });

  it("F15: the message says it would render an empty dropdown", () => {
    expect(failure({ locales: ["en"], basePath: BASE, schema: { fields: [{ type: "select", name: "status", options: [] }] } })).toContain("empty dropdown");
  });

  it("F16: a filter on an undeclared Field throws, quoting the name", () => {
    expect(failure({ locales: ["en"], basePath: BASE, schema: { fields: [statusField], toolbar: { filters: [{ field: "nope" }] } } })).toContain('"nope"');
  });

  it("F16: the message lists the declared Field names", () => {
    expect(failure({ locales: ["en"], basePath: BASE, schema: { fields: [statusField], toolbar: { filters: [{ field: "nope" }] } } })).toContain("status");
  });

  it("F17: a filter on a text Field throws, naming its type", () => {
    expect(failure({ locales: ["en"], basePath: BASE, schema: { fields: [{ type: "text", name: "note" }], toolbar: { filters: [{ field: "note" }] } } })).toContain('"text"');
  });

  it("F17: the message says a filter needs a Select", () => {
    expect(failure({ locales: ["en"], basePath: BASE, schema: { fields: [{ type: "text", name: "note" }], toolbar: { filters: [{ field: "note" }] } } })).toContain("Select");
  });

  it.each(["value", "locale", "expected", "fields", "revision"])("F24: a Field named %s throws", (name) => {
    expect(failure({ locales: ["en"], basePath: BASE, schema: { fields: [{ type: "text", name }] } })).toContain(`"${name}"`);
  });

  it("F24: the message lists the reserved names", () => {
    expect(failure({ locales: ["en"], basePath: BASE, schema: { fields: [{ type: "text", name: "value" }] } })).toContain("value, locale, expected, fields, revision");
  });

  it.each([
    ["relative Base path", { locales: ["en"], basePath: "/api/tms" }, "/api/tms"],
    ["missing endpoints", { locales: ["en"] }, "basePath"],
    ["values template without placeholder", { locales: ["en"], endpoints: { values: "https://x.test/k" } }, "https://x.test/k"],
    ["empty locales", { locales: [] }, "locales"],
    ["unknown Source Locale", { locales: ["en"], basePath: BASE, sourceLocale: "fr" as "en" }, "fr"],
  ] as [string, ConfigInput, string][])("every boot error carries the offending value and the fix: %s", (_name, input, value) => {
    const message = failure(input);
    expect([message.includes(value), message.includes("Fix:")]).toEqual([true, true]);
  });

  it("a valid configuration with a Select, a filter on it and every Field type resolves", () => {
    expect(() =>
      resolveConfig({
        locales: ["en"],
        basePath: BASE,
        schema: {
          fields: [statusField, { type: "text", name: "note" }, { type: "textarea", name: "ctx" }, { type: "readonly", name: "by" }],
          toolbar: { search: true, filters: [{ field: "status" }] },
        },
      }),
    ).not.toThrow();
  });
});
