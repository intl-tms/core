import { describe, expect, it } from "vitest";
import { aggregateUsage, isHttpUrl, normalizeUrl, usageSignature } from "../src/usage.js";

describe("usage helpers", () => {
  it("U14: a URL with a query and a fragment normalises to origin and path", () => {
    expect(normalizeUrl("https://x.test/a/b?utm=1#top")).toBe("https://x.test/a/b");
  });

  it("a root URL keeps its slash", () => {
    expect(normalizeUrl("https://x.test/?q=1")).toBe("https://x.test/");
  });

  it("a port is part of the origin", () => {
    expect(normalizeUrl("http://localhost:3000/a?x=1")).toBe("http://localhost:3000/a");
  });

  it("parameterised routes stay distinct", () => {
    expect(normalizeUrl("https://x.test/users/1")).not.toBe(normalizeUrl("https://x.test/users/2"));
  });

  it("an unparseable URL comes back unchanged", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });

  it("T37: aggregating three findings, two sharing a key, gives two entries", () => {
    expect(aggregateUsage([{ key: "a" }, { key: "b" }, { key: "a" }])).toEqual([
      { key: "a", count: 2 },
      { key: "b", count: 1 },
    ]);
  });

  it("T38: aggregated entries are sorted by key", () => {
    expect(aggregateUsage([{ key: "b" }, { key: "c" }, { key: "a" }]).map((e) => e.key)).toEqual(["a", "b", "c"]);
  });

  it("aggregating nothing gives an empty list", () => {
    expect(aggregateUsage([])).toEqual([]);
  });

  it("the signature has the documented shape", () => {
    expect(usageSignature("https://x.test/p", [{ key: "a", count: 2 }, { key: "b", count: 1 }])).toBe("https://x.test/p|a:2,b:1");
  });

  it("the signature is stable for equal reports", () => {
    const entries = [{ key: "a", count: 2 }];
    expect(usageSignature("u", entries)).toBe(usageSignature("u", [...entries]));
  });

  it("the signature differs when a count differs", () => {
    expect(usageSignature("u", [{ key: "a", count: 1 }])).not.toBe(usageSignature("u", [{ key: "a", count: 2 }]));
  });

  it.each(["http://x.test/a", "https://x.test/a"])("is-http accepts %s", (url) => {
    expect(isHttpUrl(url)).toBe(true);
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "/relative", "ftp://x.test", "", "not a url"])("is-http rejects %s", (url) => {
    expect(isHttpUrl(url)).toBe(false);
  });
});
