// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCheck, type Identity } from "../src/auth.js";
import { encode, strip } from "../src/codec.js";
import { resolveConfig } from "../src/config.js";
import { createHandler } from "../src/handler.js";
import { createMemoryPairingStore, createPairing } from "../src/pairing.js";
import { EDITING_TOKEN_HEADER } from "../src/sign-in.js";
import { createMemoryAdapter } from "../src/storage.js";
import { EDIT_GLOBAL, SIGN_IN_TEXT, createStorybookAddon, type SignInControls, type SignInState, type StorybookAddon, type StorybookAddonOptions } from "../src/storybook.js";

// The workbench signs in by pairing (section 9.1): a website on another origin,
// a pop-up on its login, and a token kept in this tab. The pop-up is the
// browser's part, so it is played here: the page the website serves in it is
// run by reading the message it would post.

const SITE = "https://app.test";
const BASE = `${SITE}/api/tms`;
const config = resolveConfig({ locales: ["en", "da"], basePath: BASE, sourceLocale: "en" });
const WORKBENCH = location.origin;

type User = Identity & { roles: string[] };

const on = { globals: { [EDIT_GLOBAL]: "on" } };
const host = () => document.querySelector<HTMLElement>("[data-tms-panel]");
const inPanel = <T extends Element = HTMLElement>(role: string) => host()?.shadowRoot?.querySelector<T>(`[data-role="${role}"]`) ?? null;
/** The sign-in area shows once the website has said it offers signing in from a workbench. */
const shown = () => inPanel<HTMLElement>("sign-in")?.hidden === false;
const altClick = (target: Element) => target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }));
const until = async (condition: () => boolean) => {
  for (let i = 0; i < 400 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 2));
  expect(condition()).toBe(true);
};
const story = (key = "greeting", text = "Hello") => {
  document.body.innerHTML = `<div id="storybook-root"><p id="p">${encode(text, key)}</p></div>`;
  return document.getElementById("p")!;
};

/** A pop-up as `window.open` returns it, which the website's page then runs in. */
type FakePopup = { closed: boolean; location: { href: string }; focus: () => void; close: () => void };

let addon: StorybookAddon | undefined;
let popup: FakePopup;
let opened: ReturnType<typeof vi.fn>;
const errors = vi.fn();

beforeEach(() => {
  document.body.innerHTML = "";
  sessionStorage.clear();
  localStorage.clear();
  popup = { closed: false, location: { href: "" }, focus: () => undefined, close: () => void (popup.closed = true) };
  opened = vi.fn(() => popup);
  window.open = opened as unknown as typeof window.open;
  errors.mockClear();
});
afterEach(() => addon?.stop());

function website(options: { pairing?: boolean; roles?: string[] } = {}) {
  const roles = options.roles ?? ["Editor"];
  const store = createMemoryPairingStore<User>();
  const pairing = createPairing<User>({
    store,
    signIn: (returnTo) => `/editors/sign-in?return=${encodeURIComponent(returnTo)}`,
    session: (request) => (/editor=ada/.test(request.headers.get("cookie") ?? "") ? { user: { id: "ada", name: "Ada", roles }, grant: "g", signedInAt: Date.now() } : undefined),
    recheck: (user, grant) => ({ active: true, user, grant }),
  });
  const authorize = sessionCheck<User>({
    user: async (request) => (await pairing.user(request)) ?? (/editor=ada/.test(request.headers.get("cookie") ?? "") ? { id: "ada", name: "Ada", roles } : undefined),
    may: (user) => user.roles.includes("Editor"),
    help: { unauthenticated: "Use your company account.", forbidden: "Ask IT for the Editor role." },
  });
  const adapter = createMemoryAdapter<typeof config>();
  const handler = createHandler({ config, adapter, authorize, onError: () => undefined, cors: { origins: [WORKBENCH] }, ...(options.pairing === false ? {} : { pairing }) });
  /** Every request the workbench makes, as the browser sends it: with its origin, and no cookie. */
  const request = vi.fn((url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("origin", WORKBENCH);
    return handler(new Request(url, { ...init, headers }));
  });

  /** What the website's pop-up page posts to the workbench, when the Editor is signed in as Ada there. */
  const popupMessage = async (signedIn = true) => {
    await until(() => popup.location.href !== "");
    const response = await handler(new Request(popup.location.href, { headers: signedIn ? { cookie: "editor=ada" } : {} }));
    const page = await response.text();
    const message = /const message = (.*);/.exec(page)?.[1];
    return message === undefined ? undefined : (JSON.parse(message) as unknown);
  };

  /** The browser delivering the pop-up's message to the workbench's window. */
  const deliver = (data: unknown, from: { origin?: string; source?: unknown } = {}) =>
    window.dispatchEvent(new MessageEvent("message", { data, origin: from.origin ?? SITE, source: (from.source ?? popup) as never }));

  return { handler, adapter, pairing, store, request, popupMessage, deliver };
}

function boot(site: ReturnType<typeof website>, options: Partial<StorybookAddonOptions> = {}) {
  addon = createStorybookAddon({ config: `${BASE}/config`, request: site.request, console: { error: errors }, ...options });
  addon.decorator(() => null, on);
  return addon;
}

/** Signs in the way an Editor does: Sign in, the website's pop-up, and back. */
async function signIn(site: ReturnType<typeof website>) {
  await until(shown);
  inPanel<HTMLButtonElement>("sign-in-button")!.click();
  site.deliver(await site.popupMessage());
  await until(() => inPanel("sign-in-line")?.textContent === SIGN_IN_TEXT.editingAs("Ada"));
}

describe("signed out", () => {
  it("the panel shows the sign-in line, the website's help and Sign in, and no failure notice", async () => {
    const site = website();
    story();
    boot(site);
    await until(shown);
    expect(inPanel("sign-in-line")!.textContent).toBe(SIGN_IN_TEXT.signedOut);
    expect(inPanel("sign-in-help")!.textContent).toBe("Use your company account.");
    expect(inPanel("sign-in-button")!.textContent).toBe(SIGN_IN_TEXT.signIn);
    expect(inPanel<HTMLElement>("notice")?.hidden ?? true).toBe(true);
  });

  it("a website without pairing shows no sign-in area, and the refusal as before", async () => {
    const site = website({ pairing: false });
    story();
    boot(site);
    await until(() => errors.mock.calls.length > 0);
    expect(inPanel<HTMLElement>("sign-in")!.hidden).toBe(true);
    expect(errors.mock.calls[0]![0]).toContain("status 401");
  });
});

describe("signing in", () => {
  it("Sign in opens the pop-up within the click, then on the pairing address with this origin and a challenge", async () => {
    const site = website();
    story();
    boot(site);
    await until(shown);
    inPanel<HTMLButtonElement>("sign-in-button")!.click();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(inPanel("sign-in-line")!.textContent).toBe(SIGN_IN_TEXT.signingIn);
    await until(() => popup.location.href !== "");
    const address = new URL(popup.location.href);
    expect(address.origin + address.pathname).toBe(`${BASE}/pair`);
    expect(address.searchParams.get("origin")).toBe(WORKBENCH);
    expect(address.searchParams.get("challenge")).toMatch(/^[\w-]{43}$/);
  });

  it("then reads and saves as the Editor, and names them", async () => {
    const site = website();
    await site.adapter.saveValue("greeting", { locale: "en", value: "Hi there" });
    const text = story();
    boot(site);
    await signIn(site);
    await until(() => strip(text.textContent!) === "Hi there");
    altClick(text);
    const control = () => host()!.shadowRoot!.querySelector<HTMLInputElement>('[data-role="control"][data-locale="en"]')!;
    await until(() => control()?.value === "Hi there");
    control().value = "Welcome";
    control().dispatchEvent(new Event("input", { bubbles: true }));
    inPanel<HTMLButtonElement>("save")!.click();
    let stored: string | undefined;
    await until(() => {
      void Promise.resolve(site.adapter.getValues("greeting")).then((rows) => (stored = rows.en?.value));
      return stored === "Welcome";
    });
  });

  it("keeps the token in this tab's session storage only, and sends it only to the website", async () => {
    const site = website();
    story();
    boot(site);
    await signIn(site);
    expect(sessionStorage.length).toBe(1);
    expect(localStorage.length).toBe(0);
    const sent = site.request.mock.calls.filter(([url]) => (url as string).startsWith(BASE)).at(-1)!;
    expect(new Headers((sent[1] as RequestInit).headers).get(EDITING_TOKEN_HEADER)).toMatch(/^tmset_/);
  });

  it("a reload keeps the sign-in", async () => {
    const site = website();
    story();
    boot(site);
    await signIn(site);
    addon!.stop();
    boot(site);
    await until(() => inPanel("sign-in-line")?.textContent === SIGN_IN_TEXT.editingAs("Ada"));
  });

  it("ignores a message from another origin or another window", async () => {
    const site = website();
    story();
    boot(site);
    await until(shown);
    inPanel<HTMLButtonElement>("sign-in-button")!.click();
    const message = await site.popupMessage();
    site.deliver(message, { origin: "https://evil.test" });
    site.deliver(message, { source: {} });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(inPanel("sign-in-line")!.textContent).toBe(SIGN_IN_TEXT.signingIn);
    expect(site.request.mock.calls.some(([url]) => (url as string).endsWith("/pair/token"))).toBe(false);
  });

  it("a blocked pop-up says so, and Sign in stays", async () => {
    const site = website();
    window.open = (() => null) as unknown as typeof window.open;
    story();
    boot(site);
    await until(shown);
    inPanel<HTMLButtonElement>("sign-in-button")!.click();
    expect(inPanel("sign-in-line")!.textContent).toBe(SIGN_IN_TEXT.popupBlocked);
    expect(inPanel("sign-in-button")).not.toBeNull();
  });

  it("closing the pop-up without signing in goes back to signed out", async () => {
    const site = website();
    story();
    boot(site);
    await until(shown);
    inPanel<HTMLButtonElement>("sign-in-button")!.click();
    popup.closed = true;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(inPanel("sign-in-line")!.textContent).toBe(SIGN_IN_TEXT.signedOut);
  });

  it("a message that arrives just after the pop-up closed still signs in", async () => {
    const site = website();
    story();
    boot(site);
    await until(shown);
    inPanel<HTMLButtonElement>("sign-in-button")!.click();
    const message = await site.popupMessage();
    popup.closed = true;
    await new Promise((resolve) => setTimeout(resolve, 600));
    site.deliver(message);
    await until(() => inPanel("sign-in-line")?.textContent === SIGN_IN_TEXT.editingAs("Ada"));
  });

  it("someone without the Editor role is told so, with the website's help", async () => {
    const site = website({ roles: [] });
    story();
    boot(site);
    await until(shown);
    inPanel<HTMLButtonElement>("sign-in-button")!.click();
    site.deliver(await site.popupMessage());
    await until(() => inPanel("sign-in-line")?.textContent === SIGN_IN_TEXT.notPermitted);
    expect(inPanel("sign-in-help")!.textContent).toBe("Ask IT for the Editor role.");
  });
});

describe("when the token ends", () => {
  it("a refused save says sign in again, shows Sign in, and keeps the draft", async () => {
    const site = website();
    const text = story();
    boot(site);
    await signIn(site);
    altClick(text);
    const control = () => host()!.shadowRoot!.querySelector<HTMLInputElement>('[data-role="control"][data-locale="en"]')!;
    await until(() => control() !== null);
    await site.pairing.endAllOf("ada");
    control().value = "Welcome";
    control().dispatchEvent(new Event("input", { bubbles: true }));
    inPanel<HTMLButtonElement>("save")!.click();
    await until(() => inPanel("sign-in-line")?.textContent === SIGN_IN_TEXT.expired);
    expect(inPanel("sign-in-button")).not.toBeNull();
    expect(control().value).toBe("Welcome");
    expect(sessionStorage.length).toBe(0);
  });

  it("signing out forgets the token and ends it at the website", async () => {
    const site = website();
    story();
    boot(site);
    await signIn(site);
    inPanel<HTMLButtonElement>("sign-out-button")!.click();
    expect(inPanel("sign-in-line")!.textContent).toBe(SIGN_IN_TEXT.signedOut);
    expect(sessionStorage.length).toBe(0);
    await until(() => site.store.size() === 0);
  });
});

describe("a sign-in view of the Developer's own", () => {
  it("is drawn in the sign-in area, told every state, and its words replace the addon's", async () => {
    const site = website();
    const states: SignInState[] = [];
    let given: SignInControls | undefined;
    story();
    boot(site, {
      signInView: (element, controls) => {
        given = controls;
        const button = element.ownerDocument.createElement("button");
        button.dataset.role = "my-sign-in";
        button.textContent = "Log on";
        button.addEventListener("click", () => controls.signIn());
        element.append(button);
        states.push(controls.state);
        return controls.onChange((state) => states.push(state));
      },
    });
    await until(shown);
    expect(states[0]!.status).toBe("signed-out");
    expect(inPanel("sign-in-line")).toBeNull();
    inPanel<HTMLButtonElement>("my-sign-in")!.click();
    site.deliver(await site.popupMessage());
    await until(() => states.at(-1)?.status === "signed-in");
    expect(states.map((state) => state.status)).toEqual(expect.arrayContaining(["signed-out", "signing-in", "signed-in"]));
    expect(states.at(-1)!.name).toBe("Ada");
    expect(JSON.stringify([states, given])).not.toMatch(/tmset_|proof|code/);
  });

  it("one that throws is replaced by the addon's line, the error is logged, and signing in still works", async () => {
    const site = website();
    story();
    boot(site, {
      signInView: () => {
        throw new Error("view broke");
      },
    });
    await until(shown);
    expect(host()!.shadowRoot!.textContent).toContain("view broke");
    await signIn(site);
  });

  it("one whose listener throws later is replaced too", async () => {
    const site = website();
    story();
    boot(site, {
      signInView: (element, controls) => {
        element.textContent = "mine";
        return controls.onChange(() => {
          throw new Error("listener broke");
        });
      },
    });
    // The first change of state is the website's refusal, which the configuration fetch brings.
    await until(shown);
    expect(host()!.shadowRoot!.textContent).toContain("listener broke");
  });
});
