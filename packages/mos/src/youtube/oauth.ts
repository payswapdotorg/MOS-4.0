import { createHash, randomBytes } from "node:crypto";

/**
 * OAuth 2.0 for native/desktop apps (RFC 8252 + Google's native-app profile):
 * PKCE S256, loopback redirect `http://127.0.0.1:{ephemeral port}`, state
 * validation, authorization-code exchange, refresh with single-flight, and
 * revocation. Everything network-touching takes an injectable `fetch`, and no
 * token value ever appears in an error message or log line.
 */

export const GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_OAUTH_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** Read-only scopes only; no upload/publish/comment/manage permissions, ever. */
export const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const YOUTUBE_ANALYTICS_READONLY_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds when the access token expires. */
  expiresAt: number;
  scope: string;
}

export type OAuthFetch = (url: string, init?: RequestInit) => Promise<Response>;

export class OAuthError extends Error {
  constructor(
    message: string,
    public readonly errorCode: string | null,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

/** The refresh token is expired/revoked (e.g., 7-day testing-status expiry) — the user must re-consent. */
export class TokenInvalidGrantError extends OAuthError {
  constructor() {
    super("The stored refresh token is no longer valid (expired, revoked, or rotated); reconnect required.", "invalid_grant");
    this.name = "TokenInvalidGrantError";
  }
}

// --- PKCE (RFC 7636) ---

export function generateCodeVerifier(): string {
  // 64 random bytes → 86 unreserved base64url chars, within the 43–128 range.
  return base64Url(randomBytes(64));
}

export function codeChallengeFromVerifier(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

// --- Authorization URL ---

export interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
  loginHint?: string;
}

export function buildAuthorizationUrl(request: AuthorizationRequest): string {
  const url = new URL(GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", request.clientId);
  url.searchParams.set("redirect_uri", request.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", request.scopes.join(" "));
  url.searchParams.set("state", request.state);
  url.searchParams.set("code_challenge", request.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // consent re-prompt keeps the refresh token coming back on repeat connects
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  if (request.loginHint) {
    url.searchParams.set("login_hint", request.loginHint);
  }
  return url.toString();
}

// --- Loopback callback parsing ---

export type LoopbackCallback =
  | { ok: true; code: string; state: string; scopes: string[] }
  | { ok: false; error: string; state: string | null };

export function parseLoopbackCallback(query: URLSearchParams): LoopbackCallback {
  const state = query.get("state");
  const error = query.get("error");
  if (error !== null) {
    return { ok: false, error, state };
  }
  const code = query.get("code");
  if (code === null || state === null) {
    return { ok: false, error: "invalid_response", state };
  }
  const scopeParam = query.get("scope");
  return { ok: true, code, state, scopes: scopeParam ? scopeParam.split(" ").filter(Boolean) : [] };
}

/** CSRF check: the state returned by Google must equal the one we issued. */
export function isStateValid(expected: string, callback: LoopbackCallback): boolean {
  return callback.state === expected;
}

// --- Token exchange & refresh ---

export interface TokenExchangeRequest {
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetch: OAuthFetch;
  tokenEndpoint?: string;
}

export async function exchangeAuthorizationCode(request: TokenExchangeRequest): Promise<TokenSet> {
  return postTokenRequest(request.tokenEndpoint ?? GOOGLE_OAUTH_TOKEN_ENDPOINT, request.fetch, {
    grant_type: "authorization_code",
    code: request.code,
    redirect_uri: request.redirectUri,
    code_verifier: request.codeVerifier,
    client_id: request.clientId,
    ...(request.clientSecret ? { client_secret: request.clientSecret } : {}),
  });
}

export interface RefreshRequest {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  fetch: OAuthFetch;
  tokenEndpoint?: string;
}

/**
 * Refreshes an access token with single-flight deduplication: concurrent
 * callers share one in-flight request, so a UI burst cannot burn refresh-token
 * rotation or trip per-user limits.
 */
export class TokenRefresher {
  #inFlight: Promise<TokenSet> | null = null;

  constructor(private readonly options: Omit<RefreshRequest, "refreshToken">) {}

  async refresh(refreshToken: string): Promise<TokenSet> {
    if (this.#inFlight) {
      return this.#inFlight;
    }
    this.#inFlight = this.refreshInternal(refreshToken).finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  private async refreshInternal(refreshToken: string): Promise<TokenSet> {
    return postTokenRequest(this.options.tokenEndpoint ?? GOOGLE_OAUTH_TOKEN_ENDPOINT, this.options.fetch, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.options.clientId,
      ...(this.options.clientSecret ? { client_secret: this.options.clientSecret } : {}),
    });
  }
}

async function postTokenRequest(
  endpoint: string,
  fetchImpl: OAuthFetch,
  body: Record<string, string>,
): Promise<TokenSet> {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const payload = (await response.json().catch(() => null)) as
    | { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string }
    | null;

  if (!response.ok || !payload?.access_token) {
    const errorCode = payload?.error ?? null;
    if (errorCode === "invalid_grant") {
      throw new TokenInvalidGrantError();
    }
    throw new OAuthError(
      `OAuth token request failed (${response.status}${errorCode ? `, error=${errorCode}` : ""}).`,
      errorCode,
    );
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1_000,
    scope: payload.scope ?? "",
  };
}

export async function revokeToken(token: string, fetchImpl: OAuthFetch, endpoint = GOOGLE_OAUTH_REVOKE_ENDPOINT): Promise<void> {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
  if (!response.ok) {
    throw new OAuthError(`Token revocation failed (${response.status}).`, null);
  }
}
