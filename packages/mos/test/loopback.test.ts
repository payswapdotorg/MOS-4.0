import { describe, expect, it } from "vitest";

import { startLoopbackCallbackServer } from "../src/youtube/loopback.js";

/**
 * The loopback receiver is exercised with a REAL socket (port 0 on 127.0.0.1):
 * these tests cover the exact path Google's redirect will hit.
 */
describe("startLoopbackCallbackServer", () => {
  it("resolves a matching-state callback with code and scopes", async () => {
    const flow = await startLoopbackCallbackServer({ expectedState: "state-1" });
    expect(flow.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    const callbackUrl = `${flow.redirectUri}?code=4%2FAbCd&state=state-1&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube.readonly`;
    const response = await fetch(callbackUrl);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("MOS 4.0");

    const result = await flow.waitForCallback();
    expect(result).toEqual({
      ok: true,
      callback: {
        ok: true,
        code: "4/AbCd",
        state: "state-1",
        scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
      },
    });
  });

  it("answers mismatched-state requests without killing the live flow", async () => {
    const invalidRequests: string[] = [];
    const flow = await startLoopbackCallbackServer({
      expectedState: "state-live",
      onInvalidRequest: (info) => invalidRequests.push(info.kind),
    });

    const stale = await fetch(`${flow.redirectUri}?code=x&state=state-stale`);
    expect(stale.status).toBe(400);

    // The flow is still waiting: a subsequent valid callback resolves it.
    await fetch(`${flow.redirectUri}?code=good&state=state-live`);
    const result = await flow.waitForCallback();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.callback.ok && result.callback.code).toBe("good");
    expect(invalidRequests).toContain("state-mismatch");
  });

  it("resolves access_denied as a user denial", async () => {
    const flow = await startLoopbackCallbackServer({ expectedState: "s" });
    const response = await fetch(`${flow.redirectUri}?error=access_denied&state=s`);
    expect(response.status).toBe(200);
    const result = await flow.waitForCallback();
    expect(result).toMatchObject({ ok: false, reason: "access-denied" });
  });

  it("answers incomplete redirects with 400 but keeps waiting", async () => {
    const flow = await startLoopbackCallbackServer({ expectedState: "s" });
    const response = await fetch(`${flow.redirectUri}?nothing=here`);
    expect(response.status).toBe(400);
    void flow.dispose();
    const result = await flow.waitForCallback();
    expect(result).toMatchObject({ ok: false, reason: "aborted" });
  });

  it("times out after the configured window", async () => {
    const flow = await startLoopbackCallbackServer({ expectedState: "s" });
    const result = await flow.waitForCallback({ timeoutMs: 50 });
    expect(result).toMatchObject({ ok: false, reason: "timed-out" });
  });

  it("waitForCallback resolves exactly once and dispose aborts pending waiters", async () => {
    const flow = await startLoopbackCallbackServer({ expectedState: "s" });
    const first = flow.waitForCallback();
    const second = flow.waitForCallback();
    await flow.dispose();
    expect(await first).toMatchObject({ ok: false, reason: "aborted" });
    expect(await second).toMatchObject({ ok: false, reason: "aborted" });
  });

  it("rejects non-GET methods", async () => {
    const flow = await startLoopbackCallbackServer({ expectedState: "s" });
    const response = await fetch(flow.redirectUri, { method: "POST", body: "x" });
    expect(response.status).toBe(405);
    await flow.dispose();
  });
});
