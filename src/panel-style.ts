// The stylesheet of the built-in panel. It is written for a shadow root: the
// tokens live on the host, so nothing leaks into the page and the page's own
// rules do not reach the panel.

/**
 * The built-in panel's stylesheet, for a shadow root whose host is the panel's
 * frame. The host is docked to an edge of the viewport by its
 * `data-tms-placement` attribute (`right`, `left` or `bottom`) and reduced to
 * its header by `data-tms-collapsed`.
 */
export const PANEL_CSS = `
:host {
  all: initial;
  color-scheme: light dark;
  --surface: #ffffff;
  --surface-raised: #f6f7f9;
  --surface-sunken: #eceef2;
  --surface-inverse: #1c2028;
  --border: #c6cbd3;
  --text: #1c2028;
  --text-muted: #565e6b;
  --text-inverse: #f4f5f7;
  --accent: #1a66d6;
  --accent-tint: #e8f0fc;
  --primary: #1a5fc4;
  --danger: #b3261e;
  --success: #1c6e3c;
  --warning: #8a5300;
  --warning-tint: #fff4dc;
  --font-ui: system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --size-base: 14px;
  --size-small: 12px;
  --size-smallest: 11px;
  --control-height: 32px;
  --radius-control: 4px;
  --radius-row: 8px;

  position: fixed;
  z-index: 2147483000;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font: var(--size-base) / 1.4 var(--font-ui);
  box-shadow: 0 4px 24px rgb(0 0 0 / 0.18);
}

@media (prefers-color-scheme: dark) {
  :host {
    --surface: #171a20;
    --surface-raised: #20242c;
    --surface-sunken: #2a2f39;
    --surface-inverse: #0d0f13;
    --border: #454c59;
    --text: #eceef2;
    --text-muted: #a9b1be;
    --accent: #7fb0ff;
    --accent-tint: #1d2b44;
    --primary: #2f6fd0;
    --danger: #ff8a80;
    --success: #6fd49a;
    --warning: #f0b75a;
    --warning-tint: #3a2e14;
  }
}

:host([data-tms-placement="right"]) { top: 0; right: 0; bottom: 0; width: min(360px, 100vw); border-width: 0 0 0 1px; }
:host([data-tms-placement="left"]) { top: 0; left: 0; bottom: 0; width: min(360px, 100vw); border-width: 0 1px 0 0; }
:host([data-tms-placement="bottom"]) { left: 0; right: 0; bottom: 0; height: min(45vh, 420px); border-width: 1px 0 0 0; }

:host([data-tms-collapsed]) { top: auto; left: auto; right: 0; bottom: 0; width: auto; height: auto; border-width: 1px 0 0 1px; border-top-left-radius: var(--radius-row); }
:host([data-tms-collapsed]) .panel { display: none; }

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 6px 6px 12px;
  border-bottom: 1px solid var(--border);
}
:host([data-tms-collapsed]) .bar { border-bottom: 0; }
.bar h1 { font-size: var(--size-base); font-weight: 600; }
.bar button { height: 26px; padding: 0 8px; font-size: var(--size-small); }

.panel { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }

h1, h2, h3, p, ul { margin: 0; }
ul { padding: 0; list-style: none; }

.editor { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; }
.placeholder { color: var(--text-muted); }

.notice {
  margin: 0 0 10px;
  padding: 6px 8px;
  border-left: 3px solid var(--warning);
  background: var(--warning-tint);
  color: var(--warning);
  font-size: var(--size-small);
  overflow-wrap: anywhere;
}

[data-role="title"] { font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
code, .status { font-family: var(--font-mono); }

.key-chip, .key-small { display: inline-block; max-width: 100%; overflow-wrap: anywhere; font-size: var(--size-small); }
.key-chip { padding: 2px 6px; border-radius: var(--radius-control); background: var(--surface-sunken); }
.key-small { color: var(--text-muted); font-size: var(--size-smallest); }

.shared { margin-top: 6px; font-size: var(--size-small); color: var(--text-muted); }
[data-role="shared-badge"] {
  padding: 1px 6px;
  border: 1px solid var(--warning);
  border-radius: var(--radius-control);
  background: var(--warning-tint);
  color: var(--warning);
  font-weight: 600;
}

.toolbar { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.toolbar input { flex: 1 1 120px; }
.toolbar select { flex: 0 1 auto; width: auto; }

.rows { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.row { padding: 8px; border: 1px solid var(--border); border-radius: var(--radius-row); background: var(--surface-raised); }
.row[data-current="true"] { border-color: var(--accent); background: var(--accent-tint); }
.row-head { display: flex; align-items: baseline; gap: 6px; margin-bottom: 6px; }

[data-role="locale"] { padding: 1px 6px; border-radius: var(--radius-control); background: var(--surface-sunken); font-size: var(--size-small); }
.row[data-current="true"] [data-role="locale"] { background: var(--accent); color: var(--surface); }
[data-role="current-cue"] { color: var(--text-muted); font-size: var(--size-smallest); }

input, select, textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--text);
  font: inherit;
}
input, select { height: var(--control-height); }
textarea { padding: 6px 8px; resize: vertical; }
[aria-invalid="true"] { border-color: var(--danger); }

button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.field { margin-top: 6px; }
.field label { display: block; margin-bottom: 2px; color: var(--text-muted); font-size: var(--size-small); }

[data-role="readonly"] {
  min-height: 1.4em;
  padding: 4px 8px;
  border-radius: var(--radius-control);
  background: var(--surface-sunken);
  font-size: var(--size-small);
  overflow-wrap: anywhere;
}

.error, .hint { margin-top: 4px; color: var(--danger); font-size: var(--size-small); }
.conflict {
  margin-top: 4px;
  padding: 4px 8px;
  border-left: 3px solid var(--warning);
  background: var(--warning-tint);
  color: var(--warning);
  font-size: var(--size-small);
  overflow-wrap: anywhere;
}

.actions { display: flex; gap: 8px; margin-top: 12px; }

button {
  height: var(--control-height);
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface-raised);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
button.primary { border-color: var(--primary); background: var(--primary); color: var(--text-inverse); font-weight: 600; }
button:disabled { opacity: 0.55; cursor: not-allowed; }

.status { min-height: 1.4em; margin-top: 8px; font-size: var(--size-small); overflow-wrap: anywhere; }
.status[data-kind="success"] { color: var(--success); }
.status[data-kind="error"] { color: var(--danger); }

h3 { margin-bottom: 4px; color: var(--text-muted); font-size: var(--size-small); font-weight: 600; }

.used-on { margin-top: 14px; }
.used-on ul { max-height: 160px; overflow-y: auto; }
[data-role="used-on-state"] { color: var(--text-muted); font-size: var(--size-small); }

[data-role="usage"], [data-role="hidden-item"] {
  display: block;
  width: 100%;
  height: auto;
  min-height: 28px;
  padding: 4px 6px;
  border: 0;
  background: none;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-role="usage"]:hover, [data-role="hidden-item"]:hover { background: var(--surface-raised); }
[data-role="usage-path"] { color: var(--accent); text-decoration: underline; }
[data-role="usage-count"], [data-role="usage-time"], [data-role="hidden-key"] { color: var(--text-muted); font-size: var(--size-smallest); }

.hidden-list { padding: 8px 12px; border-top: 1px solid var(--border); }
.hidden-list ul { max-height: 160px; overflow-y: auto; }
[data-role="hidden-attribute"] { padding: 0 4px; border-radius: var(--radius-control); background: var(--surface-sunken); font-size: var(--size-smallest); }

.diagnostics { border-top: 1px solid var(--border); padding: 6px 12px; }
.diagnostics summary { color: var(--text-muted); font-size: var(--size-small); cursor: pointer; }
.log-actions { display: flex; gap: 6px; margin: 6px 0; }
.log-actions button { height: 26px; font-size: var(--size-small); }
[data-role="log"] {
  max-height: 200px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  border-radius: var(--radius-control);
  background: var(--surface-inverse);
  color: var(--text-inverse);
  font-family: var(--font-mono);
  font-size: var(--size-smallest);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
summary:focus-visible, [data-role="log"]:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

[hidden] { display: none !important; }
`;
