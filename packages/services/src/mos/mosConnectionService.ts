import { randomBytes } from "node:crypto";

import { Emitter } from "@zcode/rpc";
import {
  TokenInvalidGrantError,
  TokenRefresher,
  YOUTUBE_READONLY_SCOPE,
  buildAuthorizationUrl,
  codeChallengeFromVerifier,
  exchangeAuthorizationCode,
  generateCodeVerifier,
  revokeToken,
  startLoopbackCallbackServer,
  type FetchLike,
  type TokenSet,
} from "@zcode/mos";

import type { ICredentialService } from "../credential/credential.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { resolveGoogleOAuthClientConfig, type GoogleOAuthClientConfig } from "./mosConfig.js";
import type {
  IMosConnectionService,
  MosConnectionState,
  MosConnectStartResult,
} from "./mosConnection.js";

const log = createServiceLogger("mosConnectionService");

const CREDENTIAL_KEY_GOOGLE_TOKEN_SET = "mos:youtube:token_set";
const CREDENTIAL_KEY_API_KEY = "mos:youtube:api_key";
/** RFC 8252 无超长等待：与 z.ai OAuth pending-state TTL 一致取 5 分钟。 */
const CONNECT_FLOW_TIMEOUT_MS = 5 * 60 * 1000;

export interface MosConnectionServiceOptions {
  credentialService: Pick<ICredentialService, "load" | "save" | "delete">;
  /** 已解析的 app config 目录（~/.zcode/v2）。 */
  configDir: string;
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
  now?: () => Date;
}

interface PendingConnectFlow {
  redirectUri: string;
  codeVerifier: string;
  config: GoogleOAuthClientConfig;
}

/**
 * 状态机：disconnected ⇄ connecting → connected。
 * connecting 期间唯一在途流程；任何终态（成功/失败/超时/用户拒绝）都回到
 * disconnected 或 connected 并带 reason。token 值只在 credentialService
 * 与内存中流转；日志只记结构化事件。
 */
export class MosConnectionService implements IMosConnectionService {
  private readonly connectionChanges = new Emitter<MosConnectionState>();
  readonly onDidChangeConnection = this.connectionChanges.event;

  private readonly credentialService: MosConnectionServiceOptions["credentialService"];
  private readonly configDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  private state: MosConnectionState = { google: { status: "disconnected" }, apiKeyConfigured: false };
  private stateLoaded = false;
  private pendingFlow: PendingConnectFlow | null = null;
  private refresher: TokenRefresher | null = null;

  constructor(options: MosConnectionServiceOptions) {
    this.credentialService = options.credentialService;
    this.configDir = options.configDir;
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? ((): Date => new Date());
  }

  async getConnectionState(): Promise<MosConnectionState> {
    await this.ensureStateLoaded();
    return this.state;
  }

  async startGoogleConnect(): Promise<MosConnectStartResult> {
    await this.ensureStateLoaded();
    if (this.pendingFlow !== null) {
      return { ok: false, reason: "already-connecting" };
    }
    const config = resolveGoogleOAuthClientConfig(this.env, this.configDir);
    if (config === null) {
      log.info(undefined, "MOS Google 连接被拒绝：未配置 OAuth client id（见 docs/integrations/YOUTUBE.md）");
      return { ok: false, reason: "client-id-missing" };
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = codeChallengeFromVerifier(codeVerifier);
    const state = randomBytes(24).toString("hex");
    const flow = await startLoopbackCallbackServer({ expectedState: state });
    const authorizeUrl = buildAuthorizationUrl({
      clientId: config.clientId,
      redirectUri: flow.redirectUri,
      scopes: [YOUTUBE_READONLY_SCOPE],
      state,
      codeChallenge,
    });
    this.pendingFlow = { redirectUri: flow.redirectUri, codeVerifier, config };
    this.refresher = new TokenRefresher({ clientId: config.clientId, ...(config.clientSecret ? { clientSecret: config.clientSecret } : {}), fetch: this.fetchImpl });
    this.setGoogleState("connecting");
    log.info(undefined, "MOS Google 连接流程已启动（loopback 回调等待中）");
    void this.awaitLoopbackCallback(flow);
    return { ok: true, authorizeUrl };
  }

  async disconnectGoogle(): Promise<void> {
    await this.ensureStateLoaded();
    const tokenSet = await this.loadTokenSet();
    if (tokenSet?.refreshToken) {
      try {
        await revokeToken(tokenSet.refreshToken, this.fetchImpl);
      } catch (error) {
        // revoke 失败不阻断本地断开；只留一条 warn（不含 token 值）。
        log.warn(undefined, "MOS Google token revoke 失败（继续本地断开）", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await this.credentialService.delete(CREDENTIAL_KEY_GOOGLE_TOKEN_SET);
    this.refresher = null;
    this.setGoogleState("disconnected");
  }

  async configureApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      throw new Error("API key cannot be empty.");
    }
    await this.credentialService.save(CREDENTIAL_KEY_API_KEY, trimmed);
    await this.ensureStateLoaded();
    this.updateState({ apiKeyConfigured: true });
  }

  async clearApiKey(): Promise<void> {
    await this.credentialService.delete(CREDENTIAL_KEY_API_KEY);
    await this.ensureStateLoaded();
    this.updateState({ apiKeyConfigured: false });
  }

  // ---- host-side helpers (not RPC-published; used by the research service) ----

  /** 有效 access token（必要时 single-flight 刷新并回写凭据库）；不可用时返回 null。 */
  async getValidAccessToken(): Promise<string | null> {
    await this.ensureStateLoaded();
    const tokenSet = await this.loadTokenSet();
    if (tokenSet === null) return null;
    if (tokenSet.expiresAt > this.now().getTime() + 60_000) {
      return tokenSet.accessToken;
    }
    const refreshed = await this.refreshAndStore(tokenSet);
    return refreshed?.accessToken ?? null;
  }

  /** 已配置的 API key（公开数据路径）；未配置返回 null。 */
  async getApiKey(): Promise<string | null> {
    await this.ensureStateLoaded();
    return this.credentialService.load(CREDENTIAL_KEY_API_KEY);
  }

  private async refreshAndStore(tokenSet: TokenSet): Promise<TokenSet | null> {
    if (!tokenSet.refreshToken) {
      this.setGoogleState("disconnected", "Access token expired; reconnect required (no refresh token).");
      return null;
    }
    if (this.refresher === null) {
      const config = resolveGoogleOAuthClientConfig(this.env, this.configDir);
      if (config === null) {
        this.setGoogleState("disconnected", "Access token expired and the OAuth client is no longer configured.");
        return null;
      }
      this.refresher = new TokenRefresher({ clientId: config.clientId, ...(config.clientSecret ? { clientSecret: config.clientSecret } : {}), fetch: this.fetchImpl });
    }
    try {
      const refreshed = await this.refresher.refresh(tokenSet.refreshToken);
      const next: TokenSet = { ...refreshed, refreshToken: refreshed.refreshToken ?? tokenSet.refreshToken };
      await this.credentialService.save(CREDENTIAL_KEY_GOOGLE_TOKEN_SET, JSON.stringify(next));
      this.setGoogleState("connected");
      return next;
    } catch (error) {
      if (error instanceof TokenInvalidGrantError) {
        // Google Testing 态 refresh token 7 天过期是开发期常态：清凭据、引导重连。
        await this.credentialService.delete(CREDENTIAL_KEY_GOOGLE_TOKEN_SET);
        this.setGoogleState("disconnected", "Reconnect required: the stored refresh token expired or was revoked.");
        log.info(undefined, "MOS Google refresh token 失效，已清除凭据等待重连");
        return null;
      }
      this.setGoogleState("connected", "Token refresh failed; will retry on the next request.");
      log.warn(undefined, "MOS Google token 刷新失败（暂按已连接处理，稍后重试）", {
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async awaitLoopbackCallback(flow: Awaited<ReturnType<typeof startLoopbackCallbackServer>>): Promise<void> {
    try {
      const result = await flow.waitForCallback({ timeoutMs: CONNECT_FLOW_TIMEOUT_MS });
      if (!result.ok) {
        this.setGoogleState("disconnected", describeLoopbackFailure(result.reason, result.message));
        return;
      }
      const pending = this.pendingFlow;
      if (pending === null) return;
      const tokenSet = await exchangeAuthorizationCode({
        clientId: pending.config.clientId,
        ...(pending.config.clientSecret ? { clientSecret: pending.config.clientSecret } : {}),
        code: result.callback.code,
        redirectUri: pending.redirectUri,
        codeVerifier: pending.codeVerifier,
        fetch: this.fetchImpl,
      });
      await this.credentialService.save(CREDENTIAL_KEY_GOOGLE_TOKEN_SET, JSON.stringify(tokenSet));
      this.setGoogleState("connected");
      log.info(undefined, "MOS Google 连接成功（token 已加密落库）");
    } catch (error) {
      this.setGoogleState(
        "disconnected",
        error instanceof Error ? error.message : "Google connection failed.",
      );
      log.warn(undefined, "MOS Google 连接失败", {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.pendingFlow = null;
    }
  }

  private async loadTokenSet(): Promise<TokenSet | null> {
    const raw = await this.credentialService.load(CREDENTIAL_KEY_GOOGLE_TOKEN_SET);
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as TokenSet;
      return typeof parsed.accessToken === "string" ? parsed : null;
    } catch {
      return null;
    }
  }

  private async ensureStateLoaded(): Promise<void> {
    if (this.stateLoaded) return;
    this.stateLoaded = true;
    const [tokenSet, apiKey] = await Promise.all([
      this.loadTokenSet(),
      this.credentialService.load(CREDENTIAL_KEY_API_KEY),
    ]);
    this.state = {
      google: { status: tokenSet !== null ? "connected" : "disconnected" },
      apiKeyConfigured: apiKey !== null,
    };
  }

  private setGoogleState(status: MosConnectionState["google"]["status"], lastReason?: string): void {
    this.updateState({ google: { status, ...(lastReason !== undefined ? { lastReason } : {}) } });
  }

  private updateState(partial: Partial<MosConnectionState>): void {
    this.state = { ...this.state, ...partial, google: partial.google ?? this.state.google };
    this.connectionChanges.fire(this.state);
  }
}

function describeLoopbackFailure(reason: string, message?: string): string {
  switch (reason) {
    case "timed-out":
      return "Sign-in timed out after 5 minutes. Please try again.";
    case "access-denied":
      return "Authorization was cancelled in the browser.";
    case "server-error":
      return message ?? "The local sign-in listener failed.";
    default:
      return "Connection attempt ended.";
  }
}
