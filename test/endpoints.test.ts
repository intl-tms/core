import { describe, expect, it } from "vitest";
import { resolveEndpoint } from "../src/endpoints.js";

describe("endpoint resolution", () => {
  it("F18: the key is percent-encoded into the placeholder", () => {
    expect(resolveEndpoint("https://x.test/keys/{key}", "a/b c")).toBe("https://x.test/keys/a%2Fb%20c");
  });

  it("F19: a template with no placeholder is returned unchanged", () => {
    expect(resolveEndpoint("https://x.test/usage", "anything")).toBe("https://x.test/usage");
  });

  it("nothing else in the template is touched", () => {
    expect(resolveEndpoint("https://x.test/a%20b/{key}?v=1#top", "k")).toBe("https://x.test/a%20b/k?v=1#top");
  });

  it("a key containing replacement patterns is inserted literally", () => {
    expect(resolveEndpoint("https://x.test/{key}", "$&$1")).toBe("https://x.test/%24%26%241");
  });

  it("every occurrence of the placeholder is replaced", () => {
    expect(resolveEndpoint("https://x.test/{key}/{key}", "k")).toBe("https://x.test/k/k");
  });
});
