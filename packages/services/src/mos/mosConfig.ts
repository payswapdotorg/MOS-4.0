import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Google OAuth 客户端配置解析（docs/integrations/YOUTUBE.md「Owner prerequisites」）。
 * 优先级：环境变量 > ~/.zcode/v2/mos-youtube.json；凭据永不入库、永不入日志。
 */

export const MOS_GOOGLE_OAUTH_CLIENT_ID_ENV = "MOS_GOOGLE_OAUTH_CLIENT_ID";
export const MOS_GOOGLE_OAUTH_CLIENT_SECRET_ENV = "MOS_GOOGLE_OAUTH_CLIENT_SECRET";
export const MOS_YOUTUBE_CONFIG_FILE_NAME = "mos-youtube.json";

export interface GoogleOAuthClientConfig {
  clientId: string;
  clientSecret?: string;
}

interface MosYoutubeConfigFile {
  googleOAuthClientId?: string;
  googleOAuthClientSecret?: string;
}

function readConfigFile(configDir: string): MosYoutubeConfigFile {
  try {
    const raw = readFileSync(join(configDir, MOS_YOUTUBE_CONFIG_FILE_NAME), "utf8");
    const parsed = JSON.parse(raw) as MosYoutubeConfigFile;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    // 文件缺失或损坏按"未配置"处理；连接入口会给出去配置指引。
    return {};
  }
}

export function resolveGoogleOAuthClientConfig(
  env: NodeJS.ProcessEnv,
  configDir: string,
): GoogleOAuthClientConfig | null {
  const envClientId = env[MOS_GOOGLE_OAUTH_CLIENT_ID_ENV]?.trim();
  if (envClientId) {
    const envSecret = env[MOS_GOOGLE_OAUTH_CLIENT_SECRET_ENV]?.trim();
    return { clientId: envClientId, ...(envSecret ? { clientSecret: envSecret } : {}) };
  }
  const file = readConfigFile(configDir);
  const clientId = file.googleOAuthClientId?.trim();
  if (!clientId) return null;
  const clientSecret = file.googleOAuthClientSecret?.trim();
  return { clientId, ...(clientSecret ? { clientSecret } : {}) };
}
