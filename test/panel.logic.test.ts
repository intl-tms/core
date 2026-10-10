import { describe, expect, it, vi } from "vitest";
import { conflictNotice, explainSaveFailure, hiddenErrors, relativeTime, resolveToolbarFilters, shouldRenderToolbar, usagePath, visibleLocales } from "../src/panel-logic.js";
import { fieldText } from "../src/wire.js";

const status = { type: "select", name: "status", label: "Status", options: [{ label: "Draft", value: "draft" }, { label: "Approved", value: "approved" }] } as const;
const note = { type: "text", name: "note" } as const;

describe("toolbar: should it render", () => {
  it("B1: with no Toolbar it should not render", () => {
    expect(shouldRenderToolbar({ fields: [status] })).toBe(false);
  });

  it("with no Schema it should not render", () => {
    expect(shouldRenderToolbar(undefined)).toBe(false);
  });

  it("B2: with search enabled it should render", () => {
    expect(shouldRenderToolbar({ toolbar: { search: true } })).toBe(true);
  });

  it("with a filter declared it should render", () => {
    expect(shouldRenderToolbar({ fields: [status], toolbar: { filters: [{ field: "status" }] } })).toBe(true);
  });

  it("B3: with an empty filter list and search off it should not render", () => {
    expect(shouldRenderToolbar({ toolbar: { search: false, filters: [] } })).toBe(false);
  });
});

describe("toolbar: resolving filters", () => {
  it("pairs each filter with its Select Field", () => {
    const [filter] = resolveToolbarFilters({ fields: [status], toolbar: { filters: [{ field: "status" }] } });
    expect(filter?.field).toBe(status);
  });

  it("the label defaults to the Field's label", () => {
    expect(resolveToolbarFilters({ fields: [status], toolbar: { filters: [{ field: "status" }] } })[0]?.label).toBe("Status");
  });

  it("the label falls back to the Field's name", () => {
    const bare = { type: "select", name: "tone", options: [{ label: "A", value: "a" }] } as const;
    expect(resolveToolbarFilters({ fields: [bare], toolbar: { filters: [{ field: "tone" }] } })[0]?.label).toBe("tone");
  });

  it("a filter's own label wins", () => {
    expect(resolveToolbarFilters({ fields: [status], toolbar: { filters: [{ field: "status", label: "State" }] } })[0]?.label).toBe("State");
  });

  it("B12: a filter naming a text Field is skipped with a warning", () => {
    const warn = vi.fn();
    const filters = resolveToolbarFilters({ fields: [note], toolbar: { filters: [{ field: "note" }] } }, warn);
    expect([filters, warn.mock.calls.length]).toEqual([[], 1]);
  });

  it("a filter naming an undeclared Field is skipped with a warning", () => {
    const warn = vi.fn();
    expect([resolveToolbarFilters({ fields: [status], toolbar: { filters: [{ field: "nope" }] } }, warn), warn.mock.calls.length]).toEqual([[], 1]);
  });

  it("a valid filter beside an invalid one is kept", () => {
    const filters = resolveToolbarFilters({ fields: [status, note], toolbar: { filters: [{ field: "note" }, { field: "status" }] } }, () => undefined);
    expect(filters.map((f) => f.field.name)).toEqual(["status"]);
  });

  it("no Toolbar means no filters", () => {
    expect(resolveToolbarFilters({ fields: [status] })).toEqual([]);
  });
});

describe("toolbar: which rows are visible", () => {
  const rows = {
    en: { value: "Hello", status: "approved" },
    da: { value: "Hej skabelon", status: "draft" },
    es: { value: "Hola", status: "draft" },
    fr: { value: "Bonjour" },
  };
  const order = ["en", "da", "es", "fr"];
  const filters = resolveToolbarFilters({ fields: [status], toolbar: { filters: [{ field: "status" }] } });
  const visible = (over: Partial<Parameters<typeof visibleLocales>[0]> = {}) => visibleLocales({ order, current: "en", rows, search: "", selected: {}, filters, ...over });

  it("with no search and no filters every row is visible", () => {
    expect(visible()).toEqual(order);
  });

  it("B4: a search matching a row's value shows that row", () => {
    expect(visible({ search: "sk" })).toContain("da");
  });

  it("B5: a search matches the Locale code, case-insensitively", () => {
    expect(visible({ search: "ES" })).toContain("es");
  });

  it("a search is a case-insensitive substring of the value", () => {
    expect(visible({ search: "BONJ" })).toContain("fr");
  });

  it("B6: a search matching nothing leaves only the Current Locale", () => {
    expect(visible({ search: "zzz" })).toEqual(["en"]);
  });

  it("SCH-25: the Current Locale is visible whatever the search says", () => {
    expect(visible({ current: "fr", search: "zzz" })).toEqual(["fr"]);
  });

  it("B7: a filter shows only matching rows and the Current Locale", () => {
    expect(visible({ selected: { status: "draft" } })).toEqual(["en", "da", "es"]);
  });

  it("a filter hides a row whose Field is absent", () => {
    expect(visible({ selected: { status: "draft" } })).not.toContain("fr");
  });

  it("B8: a filter and a search must both match", () => {
    expect(visible({ selected: { status: "draft" }, search: "hola" })).toEqual(["en", "es"]);
  });

  it("B9: a filter with an empty selection hides nothing", () => {
    expect(visible({ selected: { status: "" } })).toEqual(order);
  });

  it("B10: visible rows keep the input order", () => {
    expect(visible({ order: ["fr", "es", "da", "en"], search: "o" })).toEqual(["fr", "es", "da", "en"]);
  });

  it("a selected value for a Field with no declared filter is ignored", () => {
    expect(visible({ selected: { note: "x" } })).toEqual(order);
  });

  it("B11: an error on a filtered-out Locale is reported as hidden", () => {
    expect(hiddenErrors({ fr: ["status"] }, visible({ selected: { status: "draft" } }))).toEqual(["fr"]);
  });

  it("an error on a visible Locale is not hidden", () => {
    expect(hiddenErrors({ da: ["status"] }, visible({ selected: { status: "draft" } }))).toEqual([]);
  });

  it("a Locale with an empty error list is not an error", () => {
    expect(hiddenErrors({ fr: [] }, ["en"])).toEqual([]);
  });

  it("hidden errors work for tag errors, which are strings", () => {
    expect(hiddenErrors({ fr: "Tags must match the source: missing <a>" }, ["en"])).toEqual(["fr"]);
  });
});

describe("formatting", () => {
  const NOW = Date.parse("2026-01-12T12:00:00.000Z");
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  it("B13: a usage URL is reduced to its path", () => {
    expect(usagePath("https://x.test/a/b?c=1")).toBe("/a/b");
  });

  it("B14: a usage URL that will not parse is returned unchanged", () => {
    expect(usagePath("not a url")).toBe("not a url");
  });

  it("B15: 30 seconds ago is just now", () => {
    expect(relativeTime(ago(30_000), NOW)).toBe("just now");
  });

  it("B16: 5 minutes ago", () => {
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe("5m ago");
  });

  it("B17: 3 hours ago", () => {
    expect(relativeTime(ago(3 * 3_600_000), NOW)).toBe("3h ago");
  });

  it("B18: 2 days ago", () => {
    expect(relativeTime(ago(2 * 86_400_000), NOW)).toBe("2d ago");
  });

  it("B19: an unparseable time is the empty string", () => {
    expect(relativeTime("yesterday-ish", NOW)).toBe("");
  });

  it("a missing time is the empty string", () => {
    expect(relativeTime(undefined, NOW)).toBe("");
  });

  it("a time in the future is just now", () => {
    expect(relativeTime(ago(-60_000), NOW)).toBe("just now");
  });

  it("B20: field text of null is the empty string", () => {
    expect(fieldText(null)).toBe("");
  });

  it("B21: field text of an object is its JSON", () => {
    expect(fieldText({ a: 1 })).toBe('{"a":1}');
  });
});

describe("conflict notice", () => {
  it("K10: a Select holding approved shows its label", () => {
    expect(conflictNotice("approved", status)).toBe("Changed since you opened it. Stored now: Approved");
  });

  it("a Select holding a retired option shows the raw value", () => {
    expect(conflictNotice("retired", status)).toBe("Changed since you opened it. Stored now: retired");
  });

  it("K11: an empty stored value is shown in words", () => {
    expect(conflictNotice("", status)).toBe("Changed since you opened it. Stored now: (empty)");
  });

  it("a missing stored value is shown in words", () => {
    expect(conflictNotice(undefined)).toBe("Changed since you opened it. Stored now: (empty)");
  });

  it("a text value is shown as it is", () => {
    expect(conflictNotice("Hej")).toBe("Changed since you opened it. Stored now: Hej");
  });

  it("a non-string value is shown as its JSON", () => {
    expect(conflictNotice({ a: 1 })).toBe('Changed since you opened it. Stored now: {"a":1}');
  });
});

describe("explaining a failed save", () => {
  it("B22: a successful save has nothing to explain", () => {
    expect(explainSaveFailure({ ok: true, results: { da: { ok: true, status: 200 } } })).toBeUndefined();
  });

  it("B23: no answer at all says the page never answered", () => {
    expect(explainSaveFailure(undefined)).toMatch(/page.*(never|did not|didn't).*answer/i);
  });

  it("no answer also tells the Editor to reload", () => {
    expect(explainSaveFailure(null)).toMatch(/reload/i);
  });

  it("B24: configuration never loaded says there is no endpoint to save to", () => {
    expect(explainSaveFailure({ ok: false, error: "config-not-loaded", results: {} })).toMatch(/no endpoint/i);
  });

  it("a stale selection tells the Editor to click the text again", () => {
    expect(explainSaveFailure({ ok: false, error: "stale-selection", results: {} })).toMatch(/click the text again/i);
  });

  it("no selection known to the relay tells the Editor to click a highlighted translation first", () => {
    expect(explainSaveFailure({ ok: false, error: "no-selection", results: {} })).toMatch(/click a highlighted translation first/i);
  });

  it("another named error is that error", () => {
    expect(explainSaveFailure({ ok: false, error: "save-failed", results: {} })).toContain("save-failed");
  });

  it("B25: a 400 with a reason names the Locale, the status and the reason", () => {
    const text = explainSaveFailure({ ok: false, results: { da: { ok: false, status: 400, message: "field status must be one of [draft]" } } });
    expect(text).toContain("da");
    expect(text).toContain("400");
    expect(text).toContain("field status must be one of [draft]");
  });

  it("B26: a failure with no status says the request never reached the server, with the thrown error", () => {
    const text = explainSaveFailure({ ok: false, results: { da: { ok: false, message: "TypeError: Failed to fetch" } } });
    expect(text).toMatch(/never reached the server/i);
    expect(text).toContain("TypeError: Failed to fetch");
  });

  it("a failure reported with no detail says it failed without saying why", () => {
    expect(explainSaveFailure({ ok: false, results: {} })).toMatch(/without saying why/i);
  });

  it("a failed Locale with a status but no reason still has its status", () => {
    expect(explainSaveFailure({ ok: false, results: { da: { ok: false, status: 500 } } })).toContain("500");
  });

  it("K12: a result of only conflicts has no explanation", () => {
    expect(explainSaveFailure({ ok: false, results: { da: { ok: false, status: 409, message: "conflict", current: { value: "x" } } } })).toBeUndefined();
  });

  it("a conflict beside a real failure explains only the failure", () => {
    const text = explainSaveFailure({
      ok: false,
      results: { da: { ok: false, status: 409, message: "conflict", current: { value: "x" } }, es: { ok: false, status: 500, message: "boom" } },
    });
    expect(text).toContain("es");
    expect(text).not.toContain("da");
  });

  it("several failures are all explained", () => {
    const text = explainSaveFailure({ ok: false, results: { da: { ok: false, status: 400, message: "a" }, es: { ok: false, status: 500, message: "b" } } });
    expect([text?.includes("da"), text?.includes("es")]).toEqual([true, true]);
  });
});
