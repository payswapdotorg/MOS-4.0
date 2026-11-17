/**
 * mos 对外契约：MOS 4.0 YouTube Content Intelligence 的共享核心。
 *
 * 调用方（desktop services / UI / agent MCP tools）必须遵守的不变量：
 * - 纯逻辑模块：不 import Electron；网络（fetch）、时钟（now）、配额账本全部由调用方注入。
 * - 官方 API only：所有 YouTube 数据来自 youtubeDataApi 能力注册表登记的官方端点；禁止抓取。
 * - 配额诚实：任何 search.list 调用前必须过 QuotaLedger 预检；扫描成本在执行前可估算展示。
 * - 状态诚实：上游调用失败的扫描必须报告 partial/failed；缺失指标不得顶替为满分。
 * - 凭据边界：本模块只见 access token 的注入函数；refresh token 不进入本模块任何返回值或日志。
 * - 评分可复现：VideoScore 携带 modelVersion；同一输入永远得到同一分数。
 */
export type { CapabilityDefinition, CapabilityId, CredentialType, VerificationStatus } from "./capability/types.js";
export type { QuotaCost, QuotaSnapshot } from "./quota/ledger.js";
export type { TokenSet } from "./youtube/oauth.js";
export type { YouTubeAuth, YouTubeClientOptions } from "./youtube/client.js";
export type { FetchLike } from "./youtube/http.js";
export type {
  NicheDefinition,
  SearchTheme,
  ThemeExpansion,
  ScanResult,
  ScanDeps,
  ScoredVideo,
  VideoScore,
  ChannelBaseline,
  ResultView,
} from "./research/index.js";
export { QuotaExhaustedError, QuotaLedger } from "./quota/ledger.js";
export { YouTubeClient } from "./youtube/client.js";
export { QuotaExhaustedApiError, YouTubeApiError } from "./youtube/http.js";
export { runNicheScan } from "./research/scan.js";
export { nicheDefinitionSchema } from "./research/niche.js";
export { SCORING_MODEL_VERSION } from "./research/scoring.js";
