import { describe, expect, it } from "vitest";
import { resolveLocale } from "../src/locale.js";

describe("locale resolution", () => {
  it("T39: en-GB resolves against ['en-gb'] to the configuration's spelling", () => {
    expect(resolveLocale("en-GB", ["en-gb"])).toBe("en-gb");
  });

  it("T40: en_GB resolves against ['en-GB'] to en-GB", () => {
    expect(resolveLocale("en_GB", ["en-GB"])).toBe("en-GB");
  });

  it("T41: a bare language does not match a regional Locale", () => {
    expect(resolveLocale("en", ["en-gb"])).toBe("en");
  });

  it("a regional page does not match a bare configured language", () => {
    expect(resolveLocale("en-GB", ["en"])).toBe("en-GB");
  });

  it("an exact match returns the configuration's spelling", () => {
    expect(resolveLocale("da", ["en", "da"])).toBe("da");
  });

  it("matching ignores case", () => {
    expect(resolveLocale("DA", ["da"])).toBe("da");
  });

  it("underscore and hyphen are the same", () => {
    expect(resolveLocale("pt-br", ["pt_BR"])).toBe("pt_BR");
  });

  it("LOC-4: a value that matches nothing comes back unchanged", () => {
    expect(resolveLocale("xx-YY", ["en", "da"])).toBe("xx-YY");
  });

  it("the first configured match wins", () => {
    expect(resolveLocale("en-gb", ["en-GB", "en_gb"])).toBe("en-GB");
  });

  it("an empty value comes back unchanged", () => {
    expect(resolveLocale("", ["en"])).toBe("");
  });

  it("no configured Locales leaves the value unchanged", () => {
    expect(resolveLocale("en", [])).toBe("en");
  });
});
