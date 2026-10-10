import { describe, expect, it } from "vitest";
import { TOGGLE_COOKIE_NAME, TOGGLE_ON_VALUE } from "../src/toggle.js";

describe("the Toggle protocol constant", () => {
  it("the value meaning on is 1", () => {
    expect(TOGGLE_ON_VALUE).toBe("1");
  });

  it("the cookie name is a non-empty cookie-safe token", () => {
    expect(TOGGLE_COOKIE_NAME).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
