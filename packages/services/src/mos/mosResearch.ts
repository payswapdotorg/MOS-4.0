import type { Event } from "@zcode/rpc";
import { ServiceChannels } from "@zcode/shared";
import type {
  QuotaCostEstimate,
  QuotaSnapshot,
  ScanProgress,
  ScanResult,
  SavedScanSummary,
  SearchTheme,
  ThemeExpansion,
} from "@zcode/mos";

import { createServiceDescriptor } from "../descriptors.js";

/**
 * MOS 4.0 niche 研究服务（docs/mos/desktop-integration-spec.md）。
 *
 * 瘦封装：研究引擎/配额/持久化都在 @zcode/mos；本服务负责凭据装配、
 * 当日配额续算（跨重启）、进度事件与保存研究的读写。
 */

export interface MosScanProgressEvent {
  scanId: string;
  phase: ScanProgress["phase"];
  themeId?: string;
  candidatesSoFar?: number;
}

/** 渲染层提交的 niche 原始输入（默认值可选；服务端经 nicheDefinitionSchema 校验补全）。 */
export interface NicheDefinitionInput {
  description: string;
  regionCode?: string;
  language?: string;
  dateWindowDays?: number;
  format?: "all" | "short" | "long";
  exclusions?: string[];
  depth?: "quick" | "standard" | "deep";
}

export interface IMosResearchService {
  /** 扫描阶段进度（planning → discovery → enrichment → sampling → scoring → done）。 */
  readonly onDidScanProgress: Event<MosScanProgressEvent>;
  /**
   * 主题扩展（Workflow C）。当前为确定性派生 + 手工编辑路径；LLM 扩展随
   * Stage 5 接入模型客户端，且始终保留用户可编辑性。
   */
  expandThemes(niche: NicheDefinitionInput): Promise<ThemeExpansion>;
  /** 执行前的配额成本估算（含当日剩余额度的约束）。 */
  estimateScanCost(niche: NicheDefinitionInput, themes: SearchTheme[]): Promise<
    QuotaCostEstimate & {
      requests: number;
      skippedThemes: number;
      searchCallsRemainingToday: number;
    }
  >;
  /** 当日配额快照（PT 日起算，从已存扫描续算）。 */
  getQuotaSnapshot(): Promise<QuotaSnapshot>;
  /**
   * 执行一次 niche 扫描并持久化结果（Workflow D–G）。未连接（无 OAuth 且
   * 无 API key）时抛出可读错误；配额耗尽抛 QuotaExhaustedError。
   */
  runScan(niche: NicheDefinitionInput, themes: SearchTheme[]): Promise<ScanResult>;
  listScans(): Promise<SavedScanSummary[]>;
  getScan(scanId: string): Promise<ScanResult | null>;
  setScanSaved(scanId: string, saved: boolean): Promise<void>;
  deleteScan(scanId: string): Promise<void>;
}

export const IMosResearchService = createServiceDescriptor<IMosResearchService>(
  ServiceChannels.MosResearch,
);
