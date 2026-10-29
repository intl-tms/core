import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import * as storybook from "../src/storybook.js";
import * as tools from "../src/tools.js";
import * as website from "../src/website.js";

const ROOT = resolve(import.meta.dirname, "..");
const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");

/** The names in backticks in the first column-two cells of the table that follows `heading`. */
function exportedNames(heading: string): string[] {
  const section = readme.slice(readme.indexOf(heading) + heading.length);
  const table = section.slice(0, section.search(/\n##/));
  return [...table.matchAll(/^\| [^|]+ \| (.+) \|$/gm)].flatMap((row) => [...row[1]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!));
}

describe("readme", () => {
  it("the website export table names exactly the website entry's runtime exports", () => {
    expect([...new Set(exportedNames("### `@intl-tms/core` (website)"))].sort()).toEqual(Object.keys(website).sort());
  });

  it("the editing-tool export table names exactly the editing-tool entry's runtime exports", () => {
    expect([...new Set(exportedNames("### `@intl-tms/core/tools` (editing tools)"))].sort()).toEqual(Object.keys(tools).sort());
  });

  it("the workbench export table names exactly the workbench entry's runtime exports", () => {
    expect([...new Set(exportedNames("### `@intl-tms/core/storybook` (Storybook addon)"))].sort()).toEqual(Object.keys(storybook).sort());
  });

  it("the route table lists the five routes", () => {
    expect(readme).toMatch(/\| GET \| `\/config` \|[\s\S]*\| PUT \| `\/keys\/\{key\}` \|[\s\S]*\| POST \| `\/usage` \|[\s\S]*\| GET \| `\/usage\/\{key\}` \|/);
  });

  it("the security section is in the readme and says the Toggle protects nothing", () => {
    expect(readme).toMatch(/## Security[\s\S]*The Toggle protects nothing/);
  });

  describe("the quick start", () => {
    const code = /<!-- quickstart:start -->\s*```ts\n([\s\S]*?)```\s*<!-- quickstart:end -->/.exec(readme)?.[1];

    const editor = { cookie: "editor-session=s-1" };

    async function load() {
      const dir = resolve(import.meta.dirname, ".generated");
      mkdirSync(dir, { recursive: true });
      const file = resolve(dir, "quickstart.ts");
      writeFileSync(file, code!.replace('"@intl-tms/core"', JSON.stringify(resolve(ROOT, "src/website.ts"))));
      return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
        handler: (request: Request) => Promise<Response>;
        config: { basePath: string };
        messagesFor: (catalog: Record<string, unknown>, request: Request) => Promise<Record<string, unknown>>;
      };
    }

    it("exists", () => {
      expect(code).toBeDefined();
    });

    it("the handler it builds serves the configuration to an authorized caller", async () => {
      const { handler } = await load();
      const response = await handler(new Request("https://app.example.com/api/tms/config", { headers: editor }));
      expect(response.status).toBe(200);
    });

    it("the handler it builds refuses an unauthorized caller and says where to sign in", async () => {
      const { handler } = await load();
      const response = await handler(new Request("https://app.example.com/api/tms/config"));
      expect([response.status, (await response.json()).auth.session.signIn]).toEqual([401, "https://app.example.com/editors/sign-in"]);
    });

    it("the handler it builds saves a translation", async () => {
      const { handler } = await load();
      const headers = { ...editor, "content-type": "application/json" };
      const put = await handler(new Request("https://app.example.com/api/tms/keys/home.title", { method: "PUT", headers, body: JSON.stringify({ locale: "da", value: "Hej" }) }));
      const get = await handler(new Request("https://app.example.com/api/tms/keys/home.title", { headers }));
      expect([put.status, (await get.json()).locales.da.value]).toEqual([200, "Hej"]);
    });

    it("marking is off for a request that is not an editing session, and the output is the same object", async () => {
      const { messagesFor } = await load();
      const catalog = { a: "x" };
      expect(await messagesFor(catalog, new Request("https://app.example.com/da", { headers: { cookie: "tms-edit=1" } }))).toBe(catalog);
    });

    it("marking is on for an Editor who set the Toggle", async () => {
      const { messagesFor } = await load();
      expect((await messagesFor({ a: "x" }, new Request("https://app.example.com/da", { headers: { cookie: "tms-edit=1; editor-session=s-1" } }))).a).not.toBe("x");
    });
  });
});
