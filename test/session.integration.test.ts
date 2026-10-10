// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, type RequestFn } from "../src/client.js";
import { decode, encode, strip } from "../src/codec.js";
import { resolveConfig } from "../src/config.js";
import { createHandler } from "../src/handler.js";
import { createSession, type Session } from "../src/session.js";
import { createMemoryAdapter } from "../src/storage.js";
import { fakes } from "./support/session-fakes.js";

const config = resolveConfig({
  locales: ["en", "da"],
  basePath: "https://app.test/api/tms",
  sourceLocale: "en",
  schema: { fields: [{ type: "text", name: "note" }] },
});

const byId = (id: string) => document.getElementById(id)!;
const click = (target: Element) => target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }));
const until = async (condition: () => boolean) => {
  for (let i = 0; i < 50 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

let session: Session | undefined;
beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});
afterEach(() => session?.stop());

function boot(options: { sourceMessage?: string } = {}) {
  const adapter = createMemoryAdapter<typeof config>();
  const handler = createHandler({
    config,
    adapter,
    authorize: () => true,
    ...(options.sourceMessage === undefined ? {} : { metadata: () => ({ sourceMessage: options.sourceMessage }) }),
    onError: () => undefined,
  });
  const request: RequestFn = (url, init) => handler(new Request(url, init));
  const client = createClient({ getConfig: () => config, request });
  const { sink } = fakes();
  session = createSession({ sink, client, getConfig: () => config, getLocale: () => "da" });
  return { adapter, sink, session };
}

describe("session with the real client and handler", () => {
  it("opening a translation delivers the stored values from the store", async () => {
    document.body.innerHTML = `<p id="p">${encode("Hej", "greeting")}</p>`;
    const { adapter, sink, session } = boot();
    await adapter.saveValue("greeting", { locale: "en", value: "Hello" });
    session.start(document);
    click(byId("p"));
    await until(() => sink.setValues.mock.calls.length > 0);
    expect(sink.setValues.mock.calls[0]?.[1].locales).toEqual({ en: { value: "Hello" }, da: { value: "Hej" } });
  });

  it("the on-page text seeds the Current Locale when the store has no row", async () => {
    document.body.innerHTML = `<p id="p">${encode("Hej", "greeting")}</p>`;
    const { sink, session } = boot();
    session.start(document);
    click(byId("p"));
    await until(() => sink.setValues.mock.calls.length > 0);
    expect(sink.setValues.mock.calls[0]?.[1].locales.da).toEqual({ value: "Hej" });
  });

  it("a Source Locale page with a source message is not seeded from truncated page text", async () => {
    document.body.innerHTML = `<p id="p">${encode("Go to ", "nav.docs")}<a>Docs</a></p>`;
    const adapter = createMemoryAdapter<typeof config>();
    const handler = createHandler({ config, adapter, authorize: () => true, metadata: () => ({ sourceMessage: "Go to <a>Docs</a>" }) });
    const client = createClient({ getConfig: () => config, request: (url, init) => handler(new Request(url, init)) });
    const { sink } = fakes();
    session = createSession({ sink, client, getConfig: () => config, getLocale: () => "en" });
    session.start(document);
    click(byId("p"));
    await until(() => sink.setValues.mock.calls.length > 0);
    expect(sink.setValues.mock.calls[0]?.[1].locales.en).toBeUndefined();
  });

  it("a save stores the row and updates the page", async () => {
    document.body.innerHTML = `<p id="p">${encode("Hej", "greeting")}</p>`;
    const { adapter, session } = boot();
    session.start(document);
    click(byId("p"));
    const outcome = await session.save("greeting", { da: { value: "Hej da" } });
    expect([outcome.ok, outcome.page, strip(byId("p").textContent!), (await adapter.getValues("greeting")).da?.value]).toEqual([true, "updated", "Hej da", "Hej da"]);
  });

  it("the saved page text keeps its Marker, so it stays editable", async () => {
    document.body.innerHTML = `<p id="p">${encode("Hej", "greeting")}</p>`;
    const { session } = boot();
    session.start(document);
    click(byId("p"));
    await session.save("greeting", { da: { value: "Ny" } });
    expect(decode(byId("p").textContent!)?.key).toBe("greeting");
  });

  it("a save of a rich message is stored and leaves the page stale", async () => {
    document.body.innerHTML = `<p id="p">${encode("Hej", "greeting")}</p>`;
    const { adapter, session } = boot();
    session.start(document);
    click(byId("p"));
    const outcome = await session.save("greeting", { da: { value: "Gå til <a>Docs</a>" } });
    expect([outcome.page, (await adapter.getValues("greeting")).da?.value]).toEqual(["stale", "Gå til <a>Docs</a>"]);
  });

  it("a stale write comes back as a conflict carrying the stored row, and the page is untouched", async () => {
    document.body.innerHTML = `<p id="p">${encode("Hej", "greeting")}</p>`;
    const { adapter, session } = boot();
    session.start(document);
    click(byId("p"));
    await adapter.saveValue("greeting", { locale: "da", value: "someone else" });
    const outcome = await session.save("greeting", { da: { value: "mine", expected: { value: "Hej" } } });
    expect([outcome.results.da?.failure, outcome.results.da?.current, outcome.page]).toEqual(["conflict", { value: "someone else" }, "untouched"]);
  });

  it("saving a Hidden translation updates its attribute and the list", async () => {
    document.body.innerHTML = `<button id="b" aria-label="${encode("Luk", "a.close")}">x</button>`;
    const { sink, session } = boot();
    session.start(document);
    session.openHidden(sink.setHidden.mock.calls[0]![0][0]!.id);
    await session.save("a.close", { da: { value: "Afvis" } });
    expect([strip(byId("b").getAttribute("aria-label")!), sink.setHidden.mock.calls.at(-1)?.[0][0]?.value]).toEqual(["Afvis", "Afvis"]);
  });
});
