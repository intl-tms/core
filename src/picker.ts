// A small floating menu for choosing among the several translations one
// element can carry: visible text plus a tooltip, or several attributes.

/** One row of the picker. `T` is whatever the caller wants back. */
export interface PickerChoice<T> {
  /** What kind of translation this is: `text`, or the attribute name. */
  label: string;
  /** The current value, truncated with an ellipsis when long. */
  preview: string;
  value: T;
}

const PREVIEW_LIMIT = 48;
const VIEWPORT_MARGIN = 8;
const ASSUMED_WIDTH = 240;
const ASSUMED_ROW_HEIGHT = 32;

let current: { close: () => void } | undefined;

const truncate = (text: string): string => (text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 1)}…` : text);

const clamp = (value: number, size: number, viewport: number): number =>
  Math.max(0, Math.min(value, viewport - size - VIEWPORT_MARGIN));

/**
 * Closes the open picker, if any, without resolving it: the promise it
 * returned never settles, because whoever closed it already knows.
 */
export function closePicker(): void {
  current?.close();
}

/**
 * Opens a picker at `point`, clamped to stay inside the viewport, and resolves
 * with the chosen row's value, or with nothing when the Editor dismisses it
 * (a click outside, Escape or any scroll). Opening a picker closes any picker
 * already open. Rows are filled in as text, never as markup.
 */
export function openPicker<T>(choices: readonly PickerChoice<T>[], point: { x: number; y: number }, document: Document = globalThis.document): Promise<T | undefined> {
  closePicker();
  const view = document.defaultView as Window;
  const menu = document.createElement("div");
  menu.setAttribute("data-tms-picker", "");
  menu.setAttribute("role", "menu");
  Object.assign(menu.style, {
    position: "fixed",
    zIndex: "2147483647",
    minWidth: "160px",
    maxWidth: "320px",
    background: "#fff",
    color: "#111",
    border: "1px solid #888",
    borderRadius: "6px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
    font: "13px system-ui, sans-serif",
    padding: "4px",
  });

  return new Promise<T | undefined>((resolve) => {
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      view.removeEventListener("scroll", onScroll, true);
      menu.remove();
      if (current?.close === close) current = undefined;
    };
    const dismiss = (): void => {
      close();
      resolve(undefined);
    };
    const onPointerDown = (event: Event): void => {
      if (!menu.contains(event.target as Node)) dismiss();
    };
    const onKeyDown = (event: Event): void => {
      if ((event as KeyboardEvent).key === "Escape") dismiss();
    };
    const onScroll = (): void => dismiss();

    for (const choice of choices) {
      const row = document.createElement("div");
      row.setAttribute("data-tms-picker-row", "");
      row.setAttribute("role", "menuitem");
      row.style.cssText = "display:flex;gap:8px;padding:6px 8px;cursor:pointer;white-space:nowrap";
      const label = document.createElement("strong");
      label.textContent = choice.label;
      const preview = document.createElement("span");
      preview.textContent = truncate(choice.preview);
      row.append(label, preview);
      row.addEventListener("click", () => {
        close();
        resolve(choice.value);
      });
      menu.appendChild(row);
    }

    document.body.appendChild(menu);
    const box = menu.getBoundingClientRect();
    const width = box.width || ASSUMED_WIDTH;
    const height = box.height || choices.length * ASSUMED_ROW_HEIGHT;
    menu.style.left = `${clamp(point.x, width, view.innerWidth)}px`;
    menu.style.top = `${clamp(point.y, height, view.innerHeight)}px`;

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    view.addEventListener("scroll", onScroll, true);
    current = { close };
  });
}
