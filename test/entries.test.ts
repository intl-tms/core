import { describe, expect, it } from "vitest";
import * as website from "../src/website.js";
import * as tools from "../src/tools.js";

describe("package entries", () => {
  it("Z1: the website entry's public names equal the pinned list", () => {
    expect(Object.keys(website).sort()).toEqual([]);
  });

  it("Z2: the editing-tool entry's public names equal the pinned list", () => {
    expect(Object.keys(tools).sort()).toEqual([]);
  });
});
