import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findOutsideDocReferences, findPlatformImports } from "../scripts/checks.mjs";

const SRC = resolve(import.meta.dirname, "../src");
const read = (file: string): string => readFileSync(file, "utf8");
const sources = (): string[] => readdirSync(SRC).filter((name) => name.endsWith(".ts")).map((name) => join(SRC, name));

const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

/** Every source file reachable from `entry` through relative imports and re-exports. */
function moduleGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const match of withoutComments(read(file)).matchAll(/(?:from|import\()\s*["'](\.[^"']+)["']/g)) {
      visit(resolve(dirname(file), match[1]!.replace(/\.js$/, ".ts")));
    }
  };
  visit(entry);
  return seen;
}
const names = (graph: Set<string>): string[] => [...graph].map((file) => file.slice(SRC.length + 1)).sort();

const DOM_MODULES = ["scanner.ts", "highlighter.ts", "picker.ts", "session.ts", "panel-view.ts", "panel-style.ts", "storybook-addon.ts"];
const SERVER_MODULES = ["handler.ts", "storage.ts", "conformance.ts"];
const DOM_TOKENS = /\b(document|window|HTMLElement|Element|MutationObserver|TreeWalker|Node|Text|MouseEvent|getComputedStyle)\b/;

describe("package: module graphs", () => {
  const website = moduleGraph(join(SRC, "website.ts"));
  const tools = moduleGraph(join(SRC, "tools.ts"));
  const storybook = moduleGraph(join(SRC, "storybook.ts"));

  it("the graph walker sees the server modules from the website entry (so the checks below are not vacuous)", () => {
    expect(names(website)).toEqual(expect.arrayContaining(["handler.ts", "storage.ts", "codec.ts", "catalog.ts"]));
  });

  it("the graph walker sees the page modules from the editing-tool entry", () => {
    expect(names(tools)).toEqual(expect.arrayContaining(["scanner.ts", "session.ts", "panel-store.ts"]));
  });

  it("Z3: the website entry's module graph contains no DOM-using module", () => {
    expect(names(website).filter((name) => DOM_MODULES.includes(name))).toEqual([]);
  });

  it("Z3: and no module in it mentions a DOM global in code", () => {
    expect([...website].filter((file) => DOM_TOKENS.test(withoutComments(read(file)))).map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it("PKG-8: the editing-tool entry's module graph contains no server code", () => {
    expect(names(tools).filter((name) => SERVER_MODULES.includes(name))).toEqual([]);
  });

  it("the workbench entry's module graph contains no server code", () => {
    expect(names(storybook)).toEqual(expect.arrayContaining(["storybook-addon.ts", "panel-view.ts", "session.ts"]));
    expect(names(storybook).filter((name) => SERVER_MODULES.includes(name))).toEqual([]);
  });

  it("the editing-tool entry carries no view: the built-in panel is the workbench entry's alone", () => {
    expect(names(tools).filter((name) => ["panel-view.ts", "panel-style.ts", "panel-log.ts", "storybook-addon.ts"].includes(name))).toEqual([]);
  });

  it("the panel modules reach no DOM code", () => {
    const panel = names(moduleGraph(join(SRC, "panel-store.ts")));
    expect(panel.filter((name) => DOM_MODULES.includes(name) || name === "client.ts")).toEqual([]);
  });

  it("every source module belongs to at least one entry", () => {
    const reachable = new Set([...names(website), ...names(tools), ...names(storybook)]);
    expect(sources().map((f) => f.slice(SRC.length + 1)).filter((name) => !reachable.has(name))).toEqual([]);
  });
});

describe("package: manifest", () => {
  const manifest = JSON.parse(read(resolve(import.meta.dirname, "../package.json"))) as Record<string, unknown>;

  it("Z4: the package has no runtime dependencies", () => {
    expect([manifest.dependencies, manifest.peerDependencies, manifest.optionalDependencies]).toEqual([undefined, undefined, undefined]);
  });

  it("PKG-3: the package is declared side-effect free", () => {
    expect(manifest.sideEffects).toBe(false);
  });

  it("PKG-5: there are exactly three entry points", () => {
    expect(Object.keys(manifest.exports as object)).toEqual([".", "./tools", "./storybook"]);
  });

  it("PKG-2: each entry ships type declarations", () => {
    const entries = Object.values(manifest.exports as Record<string, { types?: string }>);
    expect(entries.every((entry) => entry.types?.endsWith(".d.ts"))).toBe(true);
  });

  it("the package ships standard modules", () => {
    expect(manifest.type).toBe("module");
  });
});

describe("package: discipline", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.name === ".generated" ? [] : entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
  const ROOT = resolve(import.meta.dirname, "..");
  const files = [...walk(SRC), ...walk(join(ROOT, "test")), ...walk(join(ROOT, "scripts"))].filter((f) => /\.(ts|mjs)$/.test(f) && !f.endsWith("package.test.ts"));

  it("SEC-10: the source never evaluates a string as code or injects a script", () => {
    const code = sources().map((file) => withoutComments(read(file))).join("\n");
    expect(code).not.toMatch(/\beval\s*\(|new\s+Function\s*\(|createElement\(\s*["']script["']\s*\)|\.innerHTML\s*=|insertAdjacentHTML|document\.write/);
  });

  it("no lint or type suppression appears anywhere in the source, the tests or the scripts", () => {
    const suppression = new RegExp(["eslint-" + "disable", "@ts-" + "ignore", "@ts-" + "expect-error", "@ts-" + "nocheck"].join("|"));
    expect(files.filter((file) => suppression.test(read(file))).map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});

describe("package: source", () => {
  it("Z5: no shipped doc comment references anything outside the package", () => {
    expect(sources().flatMap((file) => findOutsideDocReferences(read(file)))).toEqual([]);
  });

  it("Z6: the whole source imports no platform module and no bare package", () => {
    expect(sources().flatMap((file) => findPlatformImports(read(file)))).toEqual([]);
  });

  it("every exported declaration in the source has a doc comment (re-exports carry the original's)", () => {
    const missing = sources().flatMap((file) => {
      const lines = read(file).split("\n");
      return lines.flatMap((line, i) => {
        if (!/^export (?:async )?(?:function|const|class|interface|type)\s+[A-Za-z_]/.test(line)) return [];
        const above = lines[i - 1]?.trim() ?? "";
        return above.endsWith("*/") ? [] : [`${file.slice(SRC.length + 1)}:${i + 1} ${line.slice(0, 60)}`];
      });
    });
    expect(missing).toEqual([]);
  });
});
