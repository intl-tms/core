import { describe, expect, it } from "vitest";
import * as website from "../src/website.js";
import * as tools from "../src/tools.js";

describe("package entries", () => {
  it("Z1: the website entry's public names equal the pinned list", () => {
    expect(Object.keys(website).sort()).toEqual(
      [
        "ConfigError",
        "PROTOCOL_VERSION",
        "SHARED_NOTICE",
        "TOGGLE_COOKIE_NAME",
        "TOGGLE_ON_VALUE",
        "decode",
        "detect",
        "encode",
        "hasTags",
        "isPlain",
        "isSharedKey",
        "markCatalog",
        "resolveConfig",
        "resolveEndpoint",
        "strip",
        "tagMismatch",
        "tagNames",
      ].sort(),
    );
  });

  it("Z2: the editing-tool entry's public names equal the pinned list", () => {
    expect(Object.keys(tools).sort()).toEqual(["SHARED_NOTICE", "isSharedKey"]);
  });
});
