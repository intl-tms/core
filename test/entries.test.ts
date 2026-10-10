import { describe, expect, it } from "vitest";
import * as website from "../src/website.js";
import * as tools from "../src/tools.js";
import * as storybook from "../src/storybook.js";

describe("package entries", () => {
  it("Z1: the website entry's public names equal the pinned list", () => {
    expect(Object.keys(website).sort()).toEqual(
      [
        "ConfigError",
        "PROTOCOL_VERSION",
        "SHARED_NOTICE",
        "TOGGLE_COOKIE_NAME",
        "TOGGLE_ON_VALUE",
        "conflictingColumns",
        "createHandler",
        "createMemoryAdapter",
        "decode",
        "detect",
        "detectAdapterCapabilities",
        "encode",
        "fieldText",
        "hasTags",
        "isEmptyPatch",
        "isPlain",
        "isSharedKey",
        "markCatalog",
        "normalizeUrl",
        "resolveConfig",
        "resolveEndpoint",
        "runAdapterConformance",
        "strip",
        "tagMismatch",
        "tagNames",
        "usageSignature",
        "writePatch",
      ].sort(),
    );
  });

  it("Z2: the editing-tool entry's public names equal the pinned list", () => {
    expect(Object.keys(tools).sort()).toEqual(
      [
        "DEFAULT_COLORS",
        "DEFAULT_SCAN_ATTRIBUTES",
        "DEFAULT_TIME_LIMIT_MS",
        "PANEL_TEXT",
        "SHARED_NOTICE",
        "USAGE_COOLDOWN_MS",
        "aggregateUsage",
        "buildChanges",
        "changedColumns",
        "closePicker",
        "conflictNotice",
        "createClient",
        "createHighlighter",
        "createPanelStore",
        "createSession",
        "explainSaveFailure",
        "fieldText",
        "hiddenErrors",
        "highlightSettings",
        "isHttpUrl",
        "isSharedKey",
        "openPicker",
        "relativeTime",
        "resolveLocale",
        "resolveToolbarFilters",
        "scan",
        "shouldRenderToolbar",
        "usagePath",
        "visibleLocales",
      ].sort(),
    );
  });

  it("the workbench entry's public names equal the pinned list", () => {
    expect(Object.keys(storybook).sort()).toEqual(["EDIT_GLOBAL", "PANEL_CSS", "PANEL_VIEW_TEXT", "STORYBOOK_TEXT", "createLog", "createPanelView", "createStorybookAddon"].sort());
  });
});
