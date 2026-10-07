import { describe, expect, it } from "vitest";
import { createClient } from "../src/client.js";
import { BASE, clientConfig, fakeRequest, jsonResponse } from "./support/fakes.js";

const report = (count = 1, url = "https://app.test/pricing") => ({ url, title: "Pricing", keys: [{ key: "a", count }] });
const ok = () => jsonResponse(200, { ok: true, count: 1 });

function harness(respond: Parameters<typeof fakeRequest>[0] = ok, config: Parameters<typeof createClient>[0]["getConfig"] = () => clientConfig) {
  const clock = { now: 1_000_000 };
  const fake = fakeRequest(respond);
  const client = createClient({ getConfig: config, request: fake.request, now: () => clock.now });
  return { client, clock, ...fake };
}

describe("client: reporting usage", () => {
  it("T26: with no usage-report endpoint the outcome is unconfigured", async () => {
    const { client } = harness(ok, () => ({ endpoints: { values: clientConfig.endpoints.values } }));
    expect(await client.reportUsage(report())).toBe("unconfigured");
  });

  it("T26: and no request is made", async () => {
    const { client, calls } = harness(ok, () => ({ endpoints: { values: clientConfig.endpoints.values } }));
    await client.reportUsage(report());
    expect(calls).toEqual([]);
  });

  it("with no configuration loaded the outcome is unconfigured", async () => {
    expect(await harness(ok, () => undefined).client.reportUsage(report())).toBe("unconfigured");
  });

  it("T27: a report with no keys is skipped", async () => {
    const { client, calls } = harness();
    expect([await client.reportUsage({ url: "https://app.test/p", keys: [] }), calls.length]).toEqual(["skipped", 0]);
  });

  it("T28: a first report that the server accepts is sent", async () => {
    expect(await harness().client.reportUsage(report())).toBe("sent");
  });

  it("the report is one batched POST to the usage-report URL", async () => {
    const { client, calls } = harness();
    await client.reportUsage(report());
    expect([calls.length, calls[0]?.url, calls[0]?.init.method]).toEqual([1, `${BASE}/usage`, "POST"]);
  });

  it("the body is the report as given", async () => {
    const { client, calls } = harness();
    await client.reportUsage(report());
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(report());
  });

  it("T29: the same report again is skipped without a request", async () => {
    const { client, calls } = harness();
    await client.reportUsage(report());
    expect([await client.reportUsage(report()), calls.length]).toEqual(["skipped", 1]);
  });

  it("T30: a different report for the same URL is sent", async () => {
    const { client } = harness();
    await client.reportUsage(report(1));
    expect(await client.reportUsage(report(2))).toBe("sent");
  });

  it("a report for another URL with the same counts is sent", async () => {
    const { client } = harness();
    await client.reportUsage(report(1, "https://app.test/a"));
    expect(await client.reportUsage(report(1, "https://app.test/b"))).toBe("sent");
  });

  it("T31: a report the server rejects is failed", async () => {
    expect(await harness(() => jsonResponse(500, { error: "x" })).client.reportUsage(report())).toBe("failed");
  });

  it("a report the server refuses as invalid is failed", async () => {
    expect(await harness(() => jsonResponse(400, { error: "x" })).client.reportUsage(report())).toBe("failed");
  });

  it("T32: the same report inside the cool-down is skipped", async () => {
    const { client, clock, calls } = harness(() => jsonResponse(500, {}));
    await client.reportUsage(report());
    clock.now += 29_999;
    expect([await client.reportUsage(report()), calls.length]).toEqual(["skipped", 1]);
  });

  it("T33: the same report after the cool-down is tried again", async () => {
    const { client, clock, calls } = harness(() => jsonResponse(500, {}));
    await client.reportUsage(report());
    clock.now += 30_000;
    await client.reportUsage(report());
    expect(calls).toHaveLength(2);
  });

  it("a failed report is not remembered as accepted: once the server recovers it is sent", async () => {
    let healthy = false;
    const { client, clock } = harness(() => (healthy ? ok() : jsonResponse(500, {})));
    await client.reportUsage(report());
    healthy = true;
    clock.now += 30_000;
    expect(await client.reportUsage(report())).toBe("sent");
  });

  it("a different report during another report's cool-down is still sent", async () => {
    let healthy = false;
    const { client } = harness(() => (healthy ? ok() : jsonResponse(500, {})));
    await client.reportUsage(report(1));
    healthy = true;
    expect(await client.reportUsage(report(2))).toBe("sent");
  });

  it("T34: the same report while the first is in flight is skipped", async () => {
    let release: (response: Response) => void = () => undefined;
    const { client, calls } = harness(() => new Promise<Response>((resolve) => (release = resolve)));
    const first = client.reportUsage(report());
    const second = await client.reportUsage(report());
    release(ok());
    expect([await first, second, calls.length]).toEqual(["sent", "skipped", 1]);
  });

  it("T35: a request that throws is failed without throwing", async () => {
    expect(await harness(() => Promise.reject(new TypeError("Failed to fetch"))).client.reportUsage(report())).toBe("failed");
  });

  it("a request that throws synchronously is failed without throwing", async () => {
    expect(
      await harness(() => {
        throw new Error("boom");
      }).client.reportUsage(report()),
    ).toBe("failed");
  });

  it("T36: after a reset the accepted report is sent again", async () => {
    const { client, calls } = harness();
    await client.reportUsage(report());
    client.resetUsage();
    await client.reportUsage(report());
    expect(calls).toHaveLength(2);
  });

  it("a reset also forgets a recent failure", async () => {
    const { client, calls } = harness(() => jsonResponse(500, {}));
    await client.reportUsage(report());
    client.resetUsage();
    await client.reportUsage(report());
    expect(calls).toHaveLength(2);
  });

  it("a reset forgets a report still in flight", async () => {
    const releases: ((response: Response) => void)[] = [];
    const { client, calls } = harness(() => new Promise<Response>((resolve) => releases.push(resolve)));
    const first = client.reportUsage(report());
    client.resetUsage();
    const second = client.reportUsage(report());
    for (const release of releases) release(ok());
    await Promise.all([first, second]);
    expect(calls).toHaveLength(2);
  });
});
