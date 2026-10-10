import { describe, expect, it } from "vitest";
import { configured, values } from "./support/panel.js";

const TAGGED = "<a>x</a>";

describe("derived: row order, title and Shared", () => {
  it("D1: the Current Locale comes first, then the configured Locales in order", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    expect(store.getState().rowOrder).toEqual(["da", "en", "es"]);
  });

  it("D2: a Locale that appears only in the loaded values is last", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    store.setValues("k", values({ fr: { value: "Bonjour" } }), false);
    expect(store.getState().rowOrder).toEqual(["da", "en", "es", "fr"]);
  });

  it("nothing the store returned silently disappears, and nothing repeats", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    store.setValues("k", values({ da: { value: "Hej" }, en: { value: "Hi" }, fr: { value: "Bonjour" } }), false);
    expect(store.getState().rowOrder).toEqual(["da", "en", "es", "fr"]);
  });

  it("a Current Locale that is not configured is still first", () => {
    const store = configured();
    store.open("k", "fr-CA", "Bonjour");
    expect(store.getState().rowOrder[0]).toBe("fr-CA");
  });

  it("D3: with a source message the title is the source message", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    store.setValues("k", values({}, { sourceMessage: "Source text" }), false);
    expect(store.getState().title).toBe("Source text");
  });

  it("D4: with no source message the title is the key", () => {
    const store = configured();
    store.open("nav.home", "da", "Hej");
    expect(store.getState().title).toBe("nav.home");
  });

  it("an empty source message leaves the key as the title", () => {
    const store = configured();
    store.open("nav.home", "da", "Hej");
    store.setValues("nav.home", values({}, { sourceMessage: "" }), false);
    expect(store.getState().title).toBe("nav.home");
  });

  it("with nothing open the title is empty", () => {
    expect(configured().getState().title).toBe("");
  });

  it("D5: the key shared.cta is Shared", () => {
    const store = configured();
    store.open("shared.cta", "da", "Hej");
    expect(store.getState().shared).toBe(true);
  });

  it("an ordinary key is not Shared", () => {
    const store = configured();
    store.open("checkout.shared.title", "da", "Hej");
    expect(store.getState().shared).toBe(false);
  });
});

describe("derived: required errors", () => {
  const loaded = (rows: Record<string, Record<string, unknown>>, config?: Parameters<typeof configured>[1]) => {
    const store = configured({}, config);
    store.open("k", "da", "Hej");
    store.setValues("k", values(rows), false);
    return store;
  };

  it("D6: a required Field that is empty in a loaded Locale is an error for that Locale", () => {
    expect(loaded({ da: { value: "Hej" } }).getState().requiredErrors).toEqual({ da: ["status"] });
  });

  it("a required Field that has a value is no error", () => {
    expect(loaded({ da: { value: "Hej", status: "draft" } }).getState().requiredErrors).toEqual({});
  });

  it("D7: a configured Locale with no row has no error, so a required Field cannot disable Save for ever", () => {
    expect(loaded({ da: { value: "Hej", status: "draft" } }).getState().requiredErrors.es).toBeUndefined();
  });

  it("the Current Locale seeded from the page alone is not a loaded Locale", () => {
    const store = configured();
    store.open("k", "da", "Hej");
    expect(store.getState().requiredErrors).toEqual({});
  });

  it("D8: a Read-only Field marked required never counts", () => {
    const readonlyRequired = { fields: [{ type: "readonly", name: "by", required: true } as never] };
    expect(loaded({ da: { value: "Hej" } }, { schema: readonlyRequired }).getState().requiredErrors).toEqual({});
  });

  it("clearing a required Select back to the placeholder is an error again", () => {
    const store = loaded({ da: { value: "Hej", status: "draft" } });
    store.editField("da", "status", "");
    expect(store.getState().requiredErrors).toEqual({ da: ["status"] });
  });

  it("the error clears when the Field is filled", () => {
    const store = loaded({ da: { value: "Hej" } });
    store.editField("da", "status", "approved");
    expect(store.getState().requiredErrors).toEqual({});
  });

  it("a Locale loaded through a stored row counts even when the Editor has not touched it", () => {
    expect(Object.keys(loaded({ da: { value: "Hej", status: "draft" }, es: { value: "Hola" } }).getState().requiredErrors)).toEqual(["es"]);
  });

  it("a text Field marked required with no value is an error", () => {
    const required = { fields: [{ type: "text", name: "note", required: true } as const] };
    expect(loaded({ da: { value: "Hej" } }, { schema: required }).getState().requiredErrors).toEqual({ da: ["note"] });
  });

  it("with no Schema there is nothing to require", () => {
    expect(loaded({ da: { value: "Hej" } }, { schema: undefined }).getState().requiredErrors).toEqual({});
  });
});

describe("derived: tag errors", () => {
  const withSource = (rows: Record<string, Record<string, unknown>>, meta?: { sourceMessage?: string }, config: Parameters<typeof configured>[1] = { sourceLocale: "en" }) => {
    const store = configured({}, config);
    store.open("k", "da", "Hej");
    store.setValues("k", values(rows, meta), false);
    return store;
  };

  it("D9: with a source message, a draft that drops the tag is an error for that Locale", () => {
    const store = withSource({ da: { value: "Hej <a>x</a>" } }, { sourceMessage: TAGGED });
    store.editValue("da", "Hej uden tag");
    expect(store.getState().tagErrors.da).toBe("Tags must match the source: missing <a>");
  });

  it("D10: a Locale stored without the tag and left untouched is not flagged when another is edited", () => {
    const store = withSource({ da: { value: "Hej uden tag" }, es: { value: "<a>Hola</a>" } }, { sourceMessage: TAGGED });
    store.editValue("es", "<a>Hola!</a>");
    expect(store.getState().tagErrors).toEqual({});
  });

  it("D11: with no metadata the Source Locale's baseline is the reference", () => {
    const store = withSource({ en: { value: TAGGED }, da: { value: "<a>Hej</a>" } });
    store.editValue("da", "Hej uden tag");
    expect(store.getState().tagErrors.da).toContain("missing <a>");
  });

  it("D12: the Source Locale itself is judged against its baseline, not against its own draft", () => {
    const store = withSource({ en: { value: TAGGED }, da: { value: "Hej" } });
    store.editValue("en", "no tag now");
    expect(store.getState().tagErrors.en).toContain("missing <a>");
  });

  it("D12: an edit to the Source Locale that keeps its tags is fine", () => {
    const store = withSource({ en: { value: TAGGED }, da: { value: "Hej" } });
    store.editValue("en", "<a>reworded</a>");
    expect(store.getState().tagErrors).toEqual({});
  });

  it("D13: with no metadata and no Source Locale a Locale's own baseline is the reference", () => {
    const store = withSource({ da: { value: "Hej <a>x</a>" } }, undefined, {});
    store.editValue("da", "Hej uden tag");
    expect(store.getState().tagErrors.da).toContain("missing <a>");
  });

  it("D14: a changed draft cleared to empty is not a tag error", () => {
    const store = withSource({ da: { value: "Hej <a>x</a>" } }, { sourceMessage: TAGGED });
    store.editValue("da", "");
    expect(store.getState().tagErrors).toEqual({});
  });

  it("the source message is preferred to the Source Locale's baseline", () => {
    const store = withSource({ en: { value: "<a>y</a>" }, da: { value: "<b>x</b>" } }, { sourceMessage: "<b>x</b>" });
    store.editValue("da", "<b>edited</b>");
    expect(store.getState().tagErrors).toEqual({});
  });

  it("an unknown tag is named", () => {
    const store = withSource({ da: { value: "<a>x</a>" } }, { sourceMessage: TAGGED });
    store.editValue("da", "<a>x</a> <b>y</b>");
    expect(store.getState().tagErrors.da).toBe("Tags must match the source: unknown <b>");
  });

  it("a Locale where only a Field changed is not checked, because the write would carry no value", () => {
    const store = withSource({ da: { value: "Hej uden tag", status: "draft" } }, { sourceMessage: TAGGED });
    store.editField("da", "status", "approved");
    expect(store.getState().tagErrors).toEqual({});
  });

  it("a reference with no tags and a draft with no tags is no error", () => {
    const store = withSource({ da: { value: "Hej" } }, { sourceMessage: "Plain source" });
    store.editValue("da", "Hej verden");
    expect(store.getState().tagErrors).toEqual({});
  });

  it("a tag added where the reference has none is an unknown tag", () => {
    const store = withSource({ da: { value: "Hej" } }, { sourceMessage: "Plain source" });
    store.editValue("da", "Hej <b>x</b>");
    expect(store.getState().tagErrors.da).toBe("Tags must match the source: unknown <b>");
  });
});
