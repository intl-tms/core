import { describe, expect, it } from "vitest";
import { createClient } from "../src/client.js";
import { readHelpText, readSignInDescriptor } from "../src/sign-in.js";
import { clientConfig, fakeRequest, jsonResponse } from "./support/fakes.js";

const refused = { error: "unauthorized", code: "unauthorized", auth: { session: { signIn: "https://app.test/in", credentials: true }, help: "Sign in with your company account." } };

describe("client: refusals", () => {
  it("a 401 read is unauthenticated with the descriptor", async () => {
    const { request } = fakeRequest(() => jsonResponse(401, refused));
    const { failure } = await createClient({ getConfig: () => clientConfig, request }).readValues("k");
    expect(failure).toEqual({ class: "unauthenticated", status: 401, reason: "unauthorized", auth: refused.auth });
  });

  it("a 403 read is forbidden with the website's help text", async () => {
    const { request } = fakeRequest(() => jsonResponse(403, { error: "forbidden", code: "forbidden", help: "Ask IT." }));
    const { failure } = await createClient({ getConfig: () => clientConfig, request }).readValues("k");
    expect(failure).toEqual({ class: "forbidden", status: 403, reason: "forbidden", help: "Ask IT." });
  });

  it("a refused save carries the descriptor for its Locale", async () => {
    const { request } = fakeRequest(() => jsonResponse(401, refused));
    const { results } = await createClient({ getConfig: () => clientConfig, request }).save("k", { da: { value: "x" } });
    expect(results.da).toEqual({ ok: false, failure: "unauthenticated", status: 401, message: "unauthorized", auth: refused.auth });
  });

  it("a forbidden save carries the help text", async () => {
    const { request } = fakeRequest(() => jsonResponse(403, { error: "forbidden", code: "forbidden", help: "Ask IT." }));
    const { results } = await createClient({ getConfig: () => clientConfig, request }).save("k", { da: { value: "x" } });
    expect(results.da!.help).toBe("Ask IT.");
  });

  it("a 401 from an older website, with no descriptor, is still unauthenticated", async () => {
    const { request } = fakeRequest(() => jsonResponse(401, { error: "unauthorized", code: "unauthorized" }));
    const { failure } = await createClient({ getConfig: () => clientConfig, request }).readValues("k");
    expect(failure).toEqual({ class: "unauthenticated", status: 401, reason: "unauthorized" });
  });

  it("a descriptor on any other status is ignored", async () => {
    const { request } = fakeRequest(() => jsonResponse(500, refused));
    const { failure } = await createClient({ getConfig: () => clientConfig, request }).readValues("k");
    expect(failure?.auth).toBeUndefined();
  });
});

describe("reading a descriptor as untrusted input", () => {
  it("keeps a valid descriptor", () => {
    expect(readSignInDescriptor(refused)).toEqual(refused.auth);
  });

  it("keeps a pairing address", () => {
    expect(readSignInDescriptor({ auth: { pair: { address: "https://app.test/api/tms/pair" } } })).toEqual({ pair: { address: "https://app.test/api/tms/pair" } });
  });

  it("an empty descriptor names no way", () => {
    expect(readSignInDescriptor({ auth: {} })).toEqual({});
  });

  it.each([undefined, null, "x", [], { auth: "x" }, { auth: [] }, { auth: null }])("a body of %j has no descriptor", (body) => {
    expect(readSignInDescriptor(body)).toBeUndefined();
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "/relative", "", 42])("a sign-in address %j drops the session", (signIn) => {
    expect(readSignInDescriptor({ auth: { session: { signIn }, help: "Ask IT." } })).toEqual({ help: "Ask IT." });
  });

  it("a pairing address that is not http drops the pairing", () => {
    expect(readSignInDescriptor({ auth: { pair: { address: "javascript:x" } } })).toEqual({});
  });

  it("credentials that are not a boolean are dropped", () => {
    expect(readSignInDescriptor({ auth: { session: { signIn: "https://app.test/in", credentials: "yes" } } })).toEqual({ session: { signIn: "https://app.test/in" } });
  });

  it("unknown members are not carried", () => {
    expect(readSignInDescriptor({ auth: { session: { signIn: "https://app.test/in", extra: 1 }, other: 2 } })).toEqual({ session: { signIn: "https://app.test/in" } });
  });

  it("a help text over the limit is dropped, not shortened", () => {
    expect(readSignInDescriptor({ auth: { help: "x".repeat(201) } })).toEqual({});
  });

  it.each([["with a line break", "a\nb"], ["empty", ""], ["not a string", 1], ["with a control character", "a\u0000b"]])("a help text %s is dropped", (_, help) => {
    expect(readHelpText(help)).toBeUndefined();
  });

  it("a help text at the limit is kept", () => {
    expect(readHelpText("x".repeat(200))).toBe("x".repeat(200));
  });
});
