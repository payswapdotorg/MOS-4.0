import { describe, expect, it } from "vitest";

import {
  buildAuthorizationUrl,
  codeChallengeFromVerifier,
  exchangeAuthorizationCode,
  generateCodeVerifier,
  isStateValid,
  OAuthError,
  parseLoopbackCallback,
  revokeToken,
  TokenInvalidGrantError,
  TokenRefresher,
} from "../src/youtube/oauth.js";

describe("PKCE", () => {
  it("matches the RFC 7636 appendix B test vector", () => {
    expect(codeChallengeFromVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("generates verifiers in the 43–128 unreserved-char range", () => {
    for (let index = 0; index < 20; index += 1) {
      const verifier = generateCodeVerifier();
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe("authorization URL", () => {
  it("carries loopback redirect, PKCE, offline access, and state", () => {
    const url = buildAuthorizationUrl({
      clientId: "client-1.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:51741/",
      scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
      state: "state-abc",
      codeChallenge: "challenge-value",
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(parsed.searchParams.get("client_id")).toBe("client-1.apps.googleusercontent.com");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:51741/");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(parsed.searchParams.get("state")).toBe("state-abc");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/youtube.readonly");
  });
});

describe("loopback callback parsing", () => {
  it("parses a successful redirect with code, state, and granted scopes", () => {
    const callback = parseLoopbackCallback(
      new URLSearchParams("code=4/0Ab&state=state-abc&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube.readonly"),
    );
    expect(callback).toEqual({
      ok: true,
      code: "4/0Ab",
      state: "state-abc",
      scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
    });
  });

  it("parses user-denied errors", () => {
    const callback = parseLoopbackCallback(new URLSearchParams("error=access_denied&state=state-abc"));
    expect(callback).toEqual({ ok: false, error: "access_denied", state: "state-abc" });
  });

  it("rejects responses without state (CSRF guard input)", () => {
    const callback = parseLoopbackCallback(new URLSearchParams("code=4/0Ab"));
    expect(callback.ok).toBe(false);
    expect(isStateValid("expected", callback)).toBe(false);
  });

  it("validates state equality", () => {
    const callback = parseLoopbackCallback(new URLSearchParams("code=x&state=expected"));
    expect(isStateValid("expected", callback)).toBe(true);
    expect(isStateValid("other", callback)).toBe(false);
  });
});

describe("token exchange and refresh", () => {
  it("exchanges an authorization code for a token set", async () => {
    const fetchMock = async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://oauth2.googleapis.com/token");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code_verifier")).toBe("verifier-1");
      return new Response(
        JSON.stringify({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/youtube.readonly",
        }),
        { status: 200 },
      );
    };
    const tokenSet = await exchangeAuthorizationCode({
      clientId: "client-1",
      code: "code-1",
      redirectUri: "http://127.0.0.1:51741/",
      codeVerifier: "verifier-1",
      fetch: fetchMock,
    });
    expect(tokenSet.accessToken).toBe("access-1");
    expect(tokenSet.refreshToken).toBe("refresh-1");
    expect(tokenSet.expiresAt).toBeGreaterThan(Date.now());
    expect(tokenSet.scope).toContain("youtube.readonly");
  });

  it("maps invalid_grant to a reconnect-required error without leaking token data", async () => {
    const fetchMock = async () =>
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), {
        status: 400,
      });
    await expect(
      exchangeAuthorizationCode({
        clientId: "client-1",
        code: "code-1",
        redirectUri: "http://127.0.0.1:51741/",
        codeVerifier: "v",
        fetch: fetchMock,
      }),
    ).rejects.toBeInstanceOf(TokenInvalidGrantError);
  });

  it("single-flights concurrent refreshes into one token request", async () => {
    let posts = 0;
    const fetchMock = async () => {
      posts += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ access_token: "access-2", expires_in: 3600, scope: "s" }), { status: 200 });
    };
    const refresher = new TokenRefresher({ clientId: "client-1", fetch: fetchMock });
    const [first, second] = await Promise.all([refresher.refresh("refresh-1"), refresher.refresh("refresh-1")]);
    expect(posts).toBe(1);
    expect(first.accessToken).toBe("access-2");
    expect(second.accessToken).toBe("access-2");
  });

  it("surfaces other OAuth failures as typed errors", async () => {
    const fetchMock = async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 });
    await expect(
      new TokenRefresher({ clientId: "client-1", fetch: fetchMock }).refresh("refresh-1"),
    ).rejects.toBeInstanceOf(OAuthError);
  });
});

describe("revocation", () => {
  it("revokes successfully on 200", async () => {
    const fetchMock = async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://oauth2.googleapis.com/revoke");
      expect(String(init?.body)).toContain("token=");
      return new Response("{}", { status: 200 });
    };
    await expect(revokeToken("token-value", fetchMock)).resolves.toBeUndefined();
  });

  it("fails loudly on non-200", async () => {
    const fetchMock = async () => new Response("{}", { status: 400 });
    await expect(revokeToken("token-value", fetchMock)).rejects.toBeInstanceOf(OAuthError);
  });
});
