import type { Event } from "@zcode/rpc";
import { ServiceChannels } from "@zcode/shared";

import { createServiceDescriptor } from "../descriptors.js";

/**
 * MOS 4.0 YouTube 连接服务（docs/mos/desktop-integration-spec.md）。
 *
 * Google OAuth（PKCE + 127.0.0.1 loopback 回调，RFC 8252）与 API key 两条凭据路径。
 * 凭据只存在加密 credentialService（key 约定 `mos:youtube:*`）；token 值不出现在
 * 事件、日志或 RPC 返回值中。host 侧额外暴露 getValidAccessToken/getApiKey 供
 * research 服务装配 YouTubeClient，不经 RPC 发布。
 */

export interface MosGoogleConnectionState {
  status: "disconnected" | "connecting" | "connected";
  /** 最近的失败/中断原因（用户可读；不含任何敏感值）。 */
  lastReason?: string;
}

export interface MosConnectionState {
  google: MosGoogleConnectionState;
  apiKeyConfigured: boolean;
}

export type MosConnectStartResult =
  | { ok: true; authorizeUrl: string }
  | { ok: false; reason: "client-id-missing" | "already-connecting" };

export interface IMosConnectionService {
  /** 连接状态变化（connecting → connected / disconnected(+reason)）。 */
  readonly onDidChangeConnection: Event<MosConnectionState>;
  getConnectionState(): Promise<MosConnectionState>;
  /**
   * 发起 Google 连接：启动 loopback 回调服务并返回授权 URL（调用方负责
   * openExternal 打开系统浏览器）。回调到达后自动交换 token 并落库。
   */
  startGoogleConnect(): Promise<MosConnectStartResult>;
  /** 断开：尽力 revoke refresh token，清除凭据。 */
  disconnectGoogle(): Promise<void>;
  /** 配置/清除 API key（公开数据研究路径；与 OAuth 互不干扰）。 */
  configureApiKey(key: string): Promise<void>;
  clearApiKey(): Promise<void>;
}

export const IMosConnectionService = createServiceDescriptor<IMosConnectionService>(
  ServiceChannels.MosConnection,
);
