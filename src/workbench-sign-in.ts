// The workbench addon's sign-in: pairing from the workbench's side. It opens
// the website's pop-up, takes the one-time code it hands over, exchanges it
// with the proof for an editing token, keeps the token in this tab only, and
// sends it with every request to the website. The Developer may draw the
// sign-in area; every step that handles the code, the proof or the token stays
// here.

import type { RequestFn } from "./client.js";
import { EDITING_TOKEN_HEADER, EDITING_TOKEN_PREFIX, PAIRING_MESSAGE_TYPE, readHelpText, readSignInDescriptor } from "./sign-in.js";
import { isHttpUrl } from "./usage.js";

/**
 * Where signing in stands:
 *
 * - `signed-out`: nobody is signed in here.
 * - `signing-in`: the pop-up is open.
 * - `popup-blocked`: the browser blocked the pop-up.
 * - `not-permitted`: signed in, but the website says this Editor may not edit.
 * - `expired`: was signed in, and the website no longer accepts it.
 * - `signed-in`: requests carry an editing token the website accepts.
 */
export type SignInStatus = "signed-out" | "signing-in" | "popup-blocked" | "not-permitted" | "expired" | "signed-in";

/** What a sign-in view is told. The name and help text come from the website: show them as text. */
export interface SignInState {
  status: SignInStatus;
  /** The Editor's name, when signed in and the website gives one. */
  name?: string;
  /** The website's own words for someone who is not signed in, or who may not edit. */
  help?: string;
}

/** What a sign-in view may do. It never receives the token, the proof or the code. */
export interface SignInControls {
  /** The state when the view is drawn. */
  readonly state: SignInState;
  /** Opens the website's sign-in pop-up. Call it directly in a click handler, before any wait, or the browser blocks the pop-up. */
  signIn(): void;
  /** Forgets the editing token here and ends it at the website. */
  signOut(): void;
  /** Tells `listener` every change of state. Returns a function that stops it. */
  onChange(listener: (state: SignInState) => void): () => void;
}

/**
 * Draws the sign-in area of the workbench panel into `element`, an empty
 * element, and returns a function that cleans up. Plain DOM, React through
 * `createRoot`, or any other library.
 */
export type SignInView = (element: HTMLElement, controls: SignInControls) => (() => void) | void;

/** The default English words of the addon's own sign-in line. */
export const SIGN_IN_TEXT = {
  signedOut: "Sign in to read and save translations.",
  signingIn: "Signing in. Finish in the pop-up.",
  popupBlocked: "The browser blocked the sign-in pop-up. Allow pop-ups for this page, then press Sign in again.",
  notPermitted: "You are signed in, but may not edit translations here. Ask whoever manages your access to this website.",
  expired: "Your sign-in has ended. Sign in again to save; what you typed is kept.",
  signedIn: "Signed in",
  editingAs: (name: string) => `Editing as ${name}`,
  signIn: "Sign in",
  signOut: "Sign out",
} as const;

/** Where the token is kept: this tab's session storage, under the workbench's origin. */
const STORAGE_KEY = "intl-tms.editing-token";

/** How often the pop-up is checked for having been closed without signing in. */
const CLOSED_POLL_MS = 500;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const originOf = (address: string): string | undefined => {
  try {
    return new URL(address).origin;
  } catch {
    return undefined;
  }
};

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** What the sign-in needs from the addon. */
export interface WorkbenchSignInOptions {
  /** The workbench's window: its pop-ups, messages, timers and session storage. */
  window: Window;
  /** The request function every request goes through, before the token is added. */
  request: RequestFn;
  /** Told when an Editor has signed in, so the addon reads again what it could not. */
  onSignedIn: () => void;
  /** Told every change of state, and whether signing in is possible at all. */
  onChange: () => void;
}

/** The addon's half of pairing. */
export interface WorkbenchSignIn {
  /** The request function to give the client: it adds the token for the website and notices refusals. */
  request: RequestFn;
  /** The current state. */
  state(): SignInState;
  /** Whether this website offers signing in from a workbench, or a token is held. Until then there is nothing to show. */
  available(): boolean;
  /** The name the configuration gave, once it loaded. */
  setName(name: string | undefined): void;
  controls(): SignInControls;
}

type Held = { token: string; address: string };

/** Creates the addon's sign-in. */
export function createWorkbenchSignIn(options: WorkbenchSignInOptions): WorkbenchSignIn {
  const { window: win } = options;
  const listeners = new Set<(state: SignInState) => void>();

  const storage = (): Storage | undefined => {
    try {
      return win.sessionStorage;
    } catch {
      return undefined;
    }
  };

  const readHeld = (): Held | undefined => {
    try {
      const parsed: unknown = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? "null");
      if (isObject(parsed) && typeof parsed.token === "string" && parsed.token.startsWith(EDITING_TOKEN_PREFIX) && typeof parsed.address === "string" && isHttpUrl(parsed.address)) {
        return { token: parsed.token, address: parsed.address };
      }
    } catch {
      // Nothing usable is held.
    }
    return undefined;
  };

  let held = readHeld();
  /** The pairing address, from a refusal or from what is held. */
  let address = held?.address;
  let state: SignInState = held === undefined ? { status: "signed-out" } : { status: "signed-in" };
  /** The help text of a `401`, kept for when the Editor is signed out again. */
  let signedOutHelp: string | undefined;
  let popup: { window: Window; proof: string; poll: unknown } | undefined;

  const set = (next: SignInState): void => {
    state = next;
    for (const listener of [...listeners]) listener({ ...state });
    options.onChange();
  };

  const hold = (next: Held | undefined): void => {
    held = next;
    try {
      if (next === undefined) storage()?.removeItem(STORAGE_KEY);
      else storage()?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Without session storage the token lives as long as this page.
    }
  };

  const signedOut = (status: "signed-out" | "expired"): SignInState => (signedOutHelp === undefined ? { status } : { status, help: signedOutHelp });

  /** Whether a request goes to the website the token is for. The token is never sent anywhere else. */
  const forWebsite = (url: string): boolean => held !== undefined && originOf(url) === originOf(held.address);

  /** Reads what a refusal says, without consuming the body the caller reads. */
  const notice = async (response: Response, carried: boolean): Promise<void> => {
    if (response.status !== 401 && response.status !== 403) return;
    let body: unknown;
    try {
      body = JSON.parse(await response.clone().text());
    } catch {
      return;
    }
    if (response.status === 401) {
      const descriptor = readSignInDescriptor(body);
      if (descriptor?.pair !== undefined && address === undefined) address = descriptor.pair.address;
      signedOutHelp = descriptor?.help ?? signedOutHelp;
      if (carried) {
        hold(undefined);
        set(signedOut("expired"));
      } else if (state.status === "signed-out" || state.status === "expired" || state.status === "signed-in") {
        set(signedOut(state.status === "signed-in" ? "expired" : state.status));
      }
      return;
    }
    if (isObject(body) && body.code === "forbidden" && carried) {
      const help = readHelpText(body.help);
      set(help === undefined ? { status: "not-permitted" } : { status: "not-permitted", help });
    }
  };

  const request: RequestFn = async (url, init) => {
    const token = forWebsite(url) ? held!.token : undefined;
    const headers = new Headers(init?.headers);
    if (token !== undefined) headers.set(EDITING_TOKEN_HEADER, token);
    const response = await options.request(url, { ...init, headers });
    await notice(response, token !== undefined);
    return response;
  };

  const closePopup = (): void => {
    if (popup === undefined) return;
    win.clearInterval(popup.poll as number);
    win.removeEventListener("message", onMessage);
    popup = undefined;
  };

  const exchange = async (code: string, proof: string, pairing: string): Promise<void> => {
    let answer: unknown;
    try {
      const response = await options.request(`${pairing}/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, proof }) });
      answer = response.ok ? JSON.parse(await response.text()) : undefined;
    } catch {
      answer = undefined;
    }
    if (!isObject(answer) || typeof answer.token !== "string" || !answer.token.startsWith(EDITING_TOKEN_PREFIX)) {
      set(signedOut("signed-out"));
      return;
    }
    hold({ token: answer.token, address: pairing });
    set(typeof answer.name === "string" && answer.name !== "" ? { status: "signed-in", name: answer.name } : { status: "signed-in" });
    options.onSignedIn();
  };

  function onMessage(event: MessageEvent): void {
    const current = popup;
    if (current === undefined || address === undefined) return;
    // Only the pop-up this sign-in opened, on the website's origin.
    if (event.source !== current.window || event.origin !== originOf(address)) return;
    const data: unknown = event.data;
    if (!isObject(data) || data.type !== PAIRING_MESSAGE_TYPE) return;
    const pairing = address;
    closePopup();
    if (typeof data.code === "string") {
      void exchange(data.code, current.proof, pairing);
      return;
    }
    if (data.refused === "forbidden") {
      const help = readHelpText(data.help);
      set(help === undefined ? { status: "not-permitted" } : { status: "not-permitted", help });
    }
  }

  const signIn = (): void => {
    if (address === undefined) return;
    if (popup !== undefined && !popup.window.closed) {
      popup.window.focus();
      return;
    }
    closePopup();
    // Opened before anything is awaited, inside the click, or the browser blocks it.
    const opened = win.open("", "intl-tms-sign-in", "popup,width=520,height=680");
    if (opened === null) {
      set({ status: "popup-blocked" });
      return;
    }
    const before = state.status === "expired" ? "expired" : "signed-out";
    const proof = base64url(win.crypto.getRandomValues(new Uint8Array(32)));
    const poll = win.setInterval(() => {
      if (popup?.window !== opened || !opened.closed) return;
      closePopup();
      if (state.status === "signing-in") set(signedOut(before));
    }, CLOSED_POLL_MS);
    popup = { window: opened, proof, poll };
    win.addEventListener("message", onMessage);
    set({ status: "signing-in" });
    const pairing = address;
    void win.crypto.subtle.digest("SHA-256", new TextEncoder().encode(proof)).then((digest) => {
      if (popup?.window !== opened) return;
      const challenge = base64url(new Uint8Array(digest));
      opened.location.href = `${pairing}?origin=${encodeURIComponent(win.location.origin)}&challenge=${challenge}`;
    });
  };

  const signOut = (): void => {
    const was = held;
    hold(undefined);
    closePopup();
    set(signedOut("signed-out"));
    if (was !== undefined) void options.request(`${was.address}/end`, { method: "POST", headers: { [EDITING_TOKEN_HEADER]: was.token } }).catch(() => undefined);
  };

  const controls = (): SignInControls => ({
    state: { ...state },
    signIn,
    signOut,
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  });

  return {
    request,
    state: () => ({ ...state }),
    available: () => address !== undefined,
    setName(name) {
      if (state.status !== "signed-in" || name === undefined || name === state.name) return;
      set({ status: "signed-in", name });
    },
    controls,
  };
}

/** The addon's own sign-in line: plain DOM, every word inserted as text. */
export function builtInSignInView(element: HTMLElement, controls: SignInControls): () => void {
  const document = element.ownerDocument;
  const line = document.createElement("p");
  line.dataset.role = "sign-in-line";
  const help = document.createElement("p");
  help.dataset.role = "sign-in-help";
  help.className = "sign-in-help";
  const button = document.createElement("button");
  button.type = "button";
  element.append(line, help, button);

  const paint = (state: SignInState): void => {
    const signedIn = state.status === "signed-in";
    line.dataset.status = state.status;
    line.textContent =
      state.status === "signed-in"
        ? state.name === undefined
          ? SIGN_IN_TEXT.signedIn
          : SIGN_IN_TEXT.editingAs(state.name)
        : state.status === "signing-in"
          ? SIGN_IN_TEXT.signingIn
          : state.status === "popup-blocked"
            ? SIGN_IN_TEXT.popupBlocked
            : state.status === "not-permitted"
              ? SIGN_IN_TEXT.notPermitted
              : state.status === "expired"
                ? SIGN_IN_TEXT.expired
                : SIGN_IN_TEXT.signedOut;
    help.textContent = state.help ?? "";
    help.hidden = state.help === undefined;
    const signOut = signedIn || state.status === "not-permitted";
    button.dataset.role = signOut ? "sign-out-button" : "sign-in-button";
    button.textContent = signOut ? SIGN_IN_TEXT.signOut : SIGN_IN_TEXT.signIn;
    button.className = signOut ? "" : "primary";
    button.hidden = state.status === "signing-in";
  };

  button.addEventListener("click", () => (button.dataset.role === "sign-out-button" ? controls.signOut() : controls.signIn()));
  paint(controls.state);
  const stop = controls.onChange(paint);
  return () => {
    stop();
    element.replaceChildren();
  };
}
