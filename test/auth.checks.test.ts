import { afterEach, describe, expect, it, vi } from "vitest";
import { allowAll, anyOf, isEditingRequest, sessionCheck, type Authorize } from "../src/auth.js";
import { MOUNT, ORIGIN, setup } from "./support/harness.js";

const context = { request: new Request(`${ORIGIN}/`), operation: "read" as const };

describe("composing checks", () => {
  it("the first that allows wins", async () => {
    const later = vi.fn(() => true);
    expect(await anyOf(() => ({ identity: { id: "a" } }), later)(context)).toEqual({ identity: { id: "a" } });
    expect(later).not.toHaveBeenCalled();
  });

  it("a later check may allow after an earlier one refused", async () => {
    expect(await anyOf(() => false, () => "forbidden", async () => ({ identity: { id: "b" } }))(context)).toEqual({ identity: { id: "b" } });
  });

  it("none allowing and one forbidding is forbidden", async () => {
    expect(await anyOf(() => false, () => "forbidden")(context)).toBe("forbidden");
  });

  it("none allowing and none forbidding is not authenticated", async () => {
    expect(await anyOf(() => false, () => undefined as never)(context)).toBe(false);
  });

  it("no checks at all allow nothing", async () => {
    expect(await anyOf()(context)).toBe(false);
  });

  it("the descriptor is the union of what the checks declare", async () => {
    const session = sessionCheck({ user: () => null, may: () => true, credentials: true, help: { forbidden: "Ask IT." } });
    const other = sessionCheck({ user: () => null, may: () => true, credentials: false, help: { unauthenticated: "Use your company account." } });
    const reply = await setup({ authorize: anyOf(() => false, session, other) }).call("GET", `${MOUNT}/config`);
    expect(reply.body.auth).toEqual({ credentials: true, help: "Use your company account." });
  });
});

describe("allow everything, for local development", () => {
  afterEach(() => vi.restoreAllMocks());

  it("allows every request when the condition is true", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await allowAll(true)(context)).toBe(true);
  });

  it("allows nothing when the condition is false", async () => {
    expect(await allowAll(false)(context)).toBe(false);
  });

  it("warns once at boot when the condition is true", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const check = allowAll(true);
    await check(context);
    await check(context);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]![0])).toContain("every request");
  });

  it("says nothing when the condition is false", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    allowAll(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("marking only for Editors", () => {
  const toggled = (cookie = "tms-edit=1") => new Request(`${ORIGIN}/da`, { headers: { cookie } });
  const editors: Authorize = sessionCheck({ user: (request) => (request.headers.get("cookie")?.includes("editor=1") ? { id: "u-1" } : null), may: () => true });

  it("the Toggle alone marks without a check", async () => {
    expect(await isEditingRequest(toggled())).toBe(true);
  });

  it("no Toggle never marks", async () => {
    expect(await isEditingRequest(new Request(`${ORIGIN}/da`))).toBe(false);
  });

  it("another value of the Toggle never marks", async () => {
    expect(await isEditingRequest(toggled("tms-edit=0"))).toBe(false);
  });

  it("a cookie that only ends with the Toggle's name does not count", async () => {
    expect(await isEditingRequest(toggled("xtms-edit=1"))).toBe(false);
  });

  it("with a check, the Toggle and a session that may read mark", async () => {
    expect(await isEditingRequest(toggled("tms-edit=1; editor=1"), editors)).toBe(true);
  });

  it("with a check, the Toggle without the Editors' session does not mark", async () => {
    expect(await isEditingRequest(toggled("tms-edit=1; customer=1"), editors)).toBe(false);
  });

  it("with a check, a forbidden Editor does not mark", async () => {
    expect(await isEditingRequest(toggled(), () => "forbidden")).toBe(false);
  });

  it("with a check, no Toggle does not even ask it", async () => {
    const check = vi.fn(() => true);
    expect(await isEditingRequest(new Request(`${ORIGIN}/da`), check)).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it("the check is asked about reading", async () => {
    const check = vi.fn<Authorize>(() => true);
    await isEditingRequest(toggled(), check);
    expect(check.mock.calls[0]![0].operation).toBe("read");
  });

  it("a check that throws does not mark", async () => {
    expect(
      await isEditingRequest(toggled(), () => {
        throw new Error("session store down");
      }),
    ).toBe(false);
  });
});
