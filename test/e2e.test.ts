// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, type RequestFn } from "../src/client.js";
import { decode, strip } from "../src/codec.js";
import { markCatalog } from "../src/catalog.js";
import { resolveConfig } from "../src/config.js";
import { createHandler } from "../src/handler.js";
import { createPanelStore, type PanelStore } from "../src/panel-store.js";
import { createSession, type Session } from "../src/session.js";
import { createMemoryAdapter } from "../src/storage.js";
import type { UntypedStorageAdapter } from "../src/storage.js";

const config = resolveConfig({
  locales: ["en", "da", "es"],
  basePath: "https://app.test/api/tms",
  sourceLocale: "en",
  schema: { fields: [{ type: "text", name: "note" }] },
});

/** The website: a real handler over an in-memory adapter, reached through an in-process request function. */
function website() {
  const adapter = createMemoryAdapter<typeof config>();
  const handler = createHandler({ config, adapter, authorize: () => true, onError: (error) => { throw error; } });
  const request: RequestFn = (url, init) => handler(new Request(url, init));
  return { adapter: adapter as UntypedStorageAdapter, client: createClient({ getConfig: () => config, request }) };
}

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 100 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 0));
  if (!condition()) throw new Error("condition never became true");
};

let session: Session | undefined;
beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});
afterEach(() => session?.stop());

describe("end to end: a page, a session, a panel, a client, a handler and a store", () => {
  it("clicks a translation, edits two Locales, saves, and the page, the store and the panel agree", async () => {
    const { adapter, client } = website();
    await adapter.saveValue("home.title", { locale: "en", value: "Welcome" });
    await adapter.saveValue("home.title", { locale: "es", value: "Bienvenido" });

    // The website marks its merged Catalog once, where it assembles its messages.
    const catalog = markCatalog({ home: { title: "Velkommen" } });
    document.body.innerHTML = `<main><h1 id="title">${(catalog.home as { title: string }).title}</h1></main>`;

    // The panel store is the session's sink, and the session is how the store saves.
    const panel: PanelStore = createPanelStore({
      persist: (changes) => session!.save(panel.getState().selection!.key, changes),
    });
    panel.setConfig({ locales: config.locales, schema: config.schema, sourceLocale: config.sourceLocale });
    session = createSession({ sink: panel, client, getConfig: () => config, getLocale: () => "da" });
    session.start(document);

    document.getElementById("title")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(panel.getState().selection).toMatchObject({ key: "home.title", locale: "da" });
    expect(panel.getState().draft.da?.value).toBe("Velkommen");

    await until(() => panel.getState().baseline.en !== undefined);
    expect(panel.getState().rowOrder).toEqual(["da", "en", "es"]);

    panel.editValue("da", "Velkommen hjem");
    panel.editValue("es", "Bienvenido a casa");
    await panel.save();

    const title = document.getElementById("title")!;
    expect(strip(title.textContent!)).toBe("Velkommen hjem");
    expect(decode(title.textContent!)?.key).toBe("home.title");
    expect(await adapter.getValues("home.title")).toEqual({ en: { value: "Welcome" }, es: { value: "Bienvenido a casa" }, da: { value: "Velkommen hjem" } });
    expect(panel.getState().status).toEqual({ text: "da ✓  es ✓", kind: "success" });
    expect(panel.getState().dirty.count).toBe(0);
  });

  it("the edited text stays clickable: a second edit opens with the saved text", async () => {
    const { client } = website();
    const catalog = markCatalog({ home: { title: "Velkommen" } });
    document.body.innerHTML = `<h1 id="title">${(catalog.home as { title: string }).title}</h1>`;
    const panel: PanelStore = createPanelStore({ persist: (changes) => session!.save(panel.getState().selection!.key, changes) });
    panel.setConfig({ locales: config.locales, schema: config.schema });
    session = createSession({ sink: panel, client, getConfig: () => config, getLocale: () => "da" });
    session.start(document);
    const click = () => document.getElementById("title")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    click();
    panel.editValue("da", "Hej");
    await panel.save();
    click();
    expect(panel.getState().draft.da?.value).toBe("Hej");
  });
});

describe("end to end: a Write conflict between two panel stores", () => {
  /** An Editor's panel: a store that persists straight through the shared client. */
  function editor(client: ReturnType<typeof website>["client"]) {
    const panel: PanelStore = createPanelStore({ persist: (changes) => client.save(panel.getState().selection!.key, changes) });
    panel.setConfig({ locales: config.locales, schema: config.schema });
    return panel;
  }
  const load = async (panel: PanelStore, client: ReturnType<typeof website>["client"], key: string) => {
    panel.open(key, "da", "Hej");
    const read = await client.readValues(key, { locale: "da", value: "Hej" });
    panel.setValues(key, read.values, read.error);
  };

  it("the second Editor is told, keeps their text, and can then overwrite knowingly", async () => {
    const { adapter, client } = website();
    await adapter.saveValue("k", { locale: "da", value: "Hej" });
    const [anna, ben] = [editor(client), editor(client)];
    await load(anna, client, "k");
    await load(ben, client, "k");

    ben.editValue("da", "Ben's text");
    await ben.save();
    expect(ben.getState().status.kind).toBe("success");

    anna.editValue("da", "Anna's text");
    await anna.save();
    expect(anna.getState().status).toEqual({ text: "da ⚠ changed elsewhere", kind: "error" });
    expect(anna.getState().conflicts).toEqual({ da: ["value"] });
    expect(anna.getState().draft.da?.value).toBe("Anna's text");
    expect(anna.getState().baseline.da?.value).toBe("Ben's text");
    expect((await adapter.getValues("k")).da?.value).toBe("Ben's text");

    await anna.save();
    expect(anna.getState().status).toEqual({ text: "da ✓", kind: "success" });
    expect((await adapter.getValues("k")).da?.value).toBe("Anna's text");
    expect(anna.getState().conflicts).toEqual({});
  });

  it("two Editors who made the same change are not told they disagree", async () => {
    const { adapter, client } = website();
    await adapter.saveValue("k", { locale: "da", value: "Hej" });
    const [anna, ben] = [editor(client), editor(client)];
    await load(anna, client, "k");
    await load(ben, client, "k");
    ben.editValue("da", "Same text");
    await ben.save();
    anna.editValue("da", "Same text");
    await anna.save();
    expect(anna.getState().status).toEqual({ text: "da ✓", kind: "success" });
  });

  it("Editors changing different columns of one row each succeed", async () => {
    const { adapter, client } = website();
    await adapter.saveValue("k", { locale: "da", value: "Hej", fields: { note: "" } });
    const [anna, ben] = [editor(client), editor(client)];
    await load(anna, client, "k");
    await load(ben, client, "k");
    ben.editField("da", "note", "Ben's note");
    await ben.save();
    anna.editValue("da", "Anna's text");
    await anna.save();
    expect(anna.getState().status.kind).toBe("success");
  });
});
