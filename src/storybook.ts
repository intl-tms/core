/**
 * The entry a component workbench's preview file imports: an addon that hosts
 * the editing session inside the preview, with a toolbar switch and a built-in
 * panel. It needs no browser extension and imports nothing from the workbench.
 * Like the editing-tool entry it changes with what it hosts, and it contains
 * no server code.
 */
export { EDIT_GLOBAL, STORYBOOK_TEXT, createStorybookAddon } from "./storybook-addon.js";
export type {
  StorybookAddon,
  StorybookAddonOptions,
  StorybookConfig,
  StorybookContext,
  StorybookGlobalType,
  StorybookSave,
  StorybookToolbarItem,
} from "./storybook-addon.js";
export { PANEL_VIEW_TEXT, createPanelView } from "./panel-view.js";
export type { PanelView, PanelViewOptions } from "./panel-view.js";
export { createLog } from "./panel-log.js";
export type { Log, LogEntry, LogOptions } from "./panel-log.js";
export { PANEL_CSS } from "./panel-style.js";
