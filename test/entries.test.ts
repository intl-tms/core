import { describe, expect, it } from "vitest";
import * as website from "../src/website.js";
import * as tools from "../src/tools.js";
import * as storybook from "../src/storybook.js";

describe("package entries", () => {
  it("Z1: the website entry's public names equal the pinned list", () => {
    expect(Object.keys(website).sort()).toEqual(
      [
        "ConfigError",
        "EDITING_TOKEN_HEADER",
        "EDITING_TOKEN_LIFETIME_MS",
        "EDITING_TOKEN_PREFIX",
        "EDITING_TOKEN_RECHECK_MS",
        "HELP_TEXT_MAX_LENGTH",
        "PAIRING_CODE_LIFETIME_MS",
        "PAIRING_TEXT",
        "createMemoryPairingStore",
        "createPairing",
        "PROTOCOL_VERSION",
        "allowAll",
        "anyOf",
        "isEditingRequest",
        "sessionCheck",
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
        "HELP_TEXT_MAX_LENGTH",
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
        "isHelpText",
        "isHttpUrl",
        "isSharedKey",
        "openPicker",
        "readHelpText",
        "readSignInDescriptor",
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
    expect(Object.keys(storybook).sort()).toEqual(["EDIT_GLOBAL", "PANEL_CSS", "PANEL_VIEW_TEXT", "SIGN_IN_TEXT", "STORYBOOK_TEXT", "createLog", "createPanelView", "createStorybookAddon"].sort());
  });
});
