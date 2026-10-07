import { describe, expect, it } from "vitest";
import { findOutsideDocReferences, findPlatformImports } from "../scripts/checks.mjs";

describe("platform import check", () => {
  it("accepts a relative import", () => {
    expect(findPlatformImports(`import { a } from "./a.js";`)).toEqual([]);
  });

  it("flags a node: import", () => {
    expect(findPlatformImports(`import fs from "node:fs";`)).toEqual(["node:fs"]);
  });

  it("flags a bare package import", () => {
    expect(findPlatformImports(`import x from "lodash";`)).toEqual(["lodash"]);
  });

  it("flags a dynamic import of a platform module", () => {
    expect(findPlatformImports(`const f = await import("fs");`)).toEqual(["fs"]);
  });

  it("flags a re-export from a bare module", () => {
    expect(findPlatformImports(`export * from "path";`)).toEqual(["path"]);
  });
});

describe("doc comment reference check", () => {
  it("accepts a self-contained doc comment", () => {
    expect(findOutsideDocReferences(`/** Encodes a key. */\nexport const a = 1;`)).toEqual([]);
  });

  it("ignores ordinary comments", () => {
    expect(findOutsideDocReferences(`// see MRK-3\nexport const a = 1;`)).toEqual([]);
  });

  it("flags a requirement identifier in a doc comment", () => {
    expect(findOutsideDocReferences(`/** Per MRK-3, prefix it. */`)).toHaveLength(1);
  });

  it("flags a path inside the source repository", () => {
    expect(findOutsideDocReferences(`/** See src/codec.ts for details. */`)).toHaveLength(1);
  });

  it("flags a reference to the specification documents", () => {
    expect(findOutsideDocReferences(`/** Described in document 03. */`)).toHaveLength(1);
  });

  it("flags a ticket number", () => {
    expect(findOutsideDocReferences(`/** Fixes #123. */`)).toHaveLength(1);
  });
});
