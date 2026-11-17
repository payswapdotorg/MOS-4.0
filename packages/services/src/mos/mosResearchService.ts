import { randomUUID } from "node:crypto";

import { Emitter } from "@zcode/rpc";
import {
  DEFAULT_SEARCH_CALLS_PER_DAY,
  DEFAULT_UNITS_PER_DAY,
  QuotaLedger,
  YouTubeClient,
  buildSearchPlan,
  depthBudgetFor,
  deriveThemesFromNiche,
  nicheDefinitionSchema,
  runNicheScan,
  startOfCurrentPacificDay,
  type FetchLike,
  type NicheDefinition,
  type QuotaCostEstimate,
  type QuotaSnapshot,
  type ScanResult,
  type SearchTheme,
  type ThemeExpansion,
} from "@zcode/mos";
import type { MosScanStore, SavedScanSummary } from "@zcode/mos/persistence";

import { createServiceLogger } from "../logger/serviceLogger.js";
import type { MosConnectionService } from "./mosConnectionService.js";
import type { IMosResearchService, MosScanProgressEvent, NicheDefinitionInput } from "./mosResearch.js";

const log = createServiceLogger("mosResearchService");

/** Owner 可用环境变量覆盖 Google Cloud 项目申请提升后的配额。 */
const MOS_SEARCH_CALLS_LIMIT_ENV = "MOS_SEARCH_CALLS_LIMIT";
const MOS_UNITS_LIMIT_ENV = "MOS_UNITS_LIMIT";

export interface MosResearchServiceOptions {
  connection: MosConnectionService;
  store: MosScanStore;
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
  now?: () => Date;
}

export class MosResearchService implements IMosResearchService {
  private readonly scanProgress = new Emitter<MosScanProgressEvent>();
  readonly onDidScanProgress = this.scanProgress.event;

  private readonly connection: MosConnectionService;
  private readonly store: MosScanStore;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  constructor(options: MosResearchServiceOptions) {
    this.connection = options.connection;
    this.store = options.store;
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? ((): Date => new Date());
  }

  async expandThemes(niche: NicheDefinitionInput): Promise<ThemeExpansion> {
    const parsed = parseNiche(niche);
    return deriveThemesFromNiche(parsed);
  }

  async estimateScanCost(
    niche: NicheDefinitionInput,
    themes: SearchTheme[],
  ): Promise<QuotaCostEstimate & { requests: number; skippedThemes: number; searchCallsRemainingToday: number }> {
    const parsed = parseNiche(niche);
    const { ledger } = await this.prepareLedger();
    const snapshot = ledger.snapshot();
    const remaining = snapshot.searchCallsLimit - snapshot.searchCallsUsed;
    const plan = buildSearchPlan(parsed, themes, {
      depthBudget: depthBudgetFor(parsed),
      ledgerRemaining: remaining,
    });
    return {
      searchCalls: plan.estimatedCost.searchCalls,
      units: plan.estimatedCost.units,
      requests: plan.requests.length,
      skippedThemes: plan.skippedThemes.length,
      searchCallsRemainingToday: remaining,
    };
  }

  async getQuotaSnapshot(): Promise<QuotaSnapshot> {
    const { ledger } = await this.prepareLedger();
    return ledger.snapshot();
  }

  async runScan(niche: NicheDefinitionInput, themes: SearchTheme[]): Promise<ScanResult> {
    const parsed = parseNiche(niche);
    const auth = await this.resolveAuth();
    const { ledger } = await this.prepareLedger();
    const scanId = randomUUID();
    const client = new YouTubeClient({ auth, fetch: this.fetchImpl, ledger });
    log.info(undefined, "MOS niche 扫描开始", { scanId, depth: parsed.depth, themes: themes.length });
    const result = await runNicheScan(
      {
        client,
        ledger,
        now: this.now,
        scanId,
        onProgress: (progress) => this.scanProgress.fire({ scanId, ...progress }),
      },
      parsed,
      themes,
    );
    this.store.persistScanResult(result);
    log.info(undefined, "MOS niche 扫描完成", {
      scanId,
      status: result.status,
      videos: result.videos.length,
      searchCalls: result.usage.searchCalls,
      units: result.usage.units,
    });
    return result;
  }

  async listScans(): Promise<SavedScanSummary[]> {
    await this.store.ensureReady();
    return this.store.listScans(this.now());
  }

  async getScan(scanId: string): Promise<ScanResult | null> {
    await this.store.ensureReady();
    return this.store.getScanResult(scanId);
  }

  async setScanSaved(scanId: string, saved: boolean): Promise<void> {
    await this.store.ensureReady();
    this.store.setSaved(scanId, saved);
  }

  async deleteScan(scanId: string): Promise<void> {
    await this.store.ensureReady();
    this.store.deleteScan(scanId);
  }

  private async resolveAuth(): Promise<
    | { type: "oauth"; getAccessToken: () => Promise<string> }
    | { type: "apiKey"; key: string }
  > {
    const accessToken = await this.connection.getValidAccessToken();
    if (accessToken !== null) {
      return {
        type: "oauth",
        getAccessToken: async () => {
          const token = await this.connection.getValidAccessToken();
          if (token === null) {
            throw new Error("YouTube connection lost during the scan; please reconnect.");
          }
          return token;
        },
      };
    }
    const apiKey = await this.connection.getApiKey();
    if (apiKey !== null) {
      return { type: "apiKey", key: apiKey };
    }
    throw new Error(
      "YouTube is not connected: connect a Google account or configure an API key before running research.",
    );
  }

  /** 当日（PT）配额账本：从已存扫描续算已用量，限额取环境覆盖或官方默认。 */
  private async prepareLedger(): Promise<{ ledger: QuotaLedger }> {
    await this.store.ensureReady();
    const ptDayStart = startOfCurrentPacificDay(this.now()).toISOString();
    const todayUsage = this.store.getUsageSince(ptDayStart);
    const searchCallsLimit = positiveIntEnv(this.env[MOS_SEARCH_CALLS_LIMIT_ENV]) ?? DEFAULT_SEARCH_CALLS_PER_DAY;
    const unitsLimit = positiveIntEnv(this.env[MOS_UNITS_LIMIT_ENV]) ?? DEFAULT_UNITS_PER_DAY;
    const ledger = new QuotaLedger({ now: this.now, searchCallsLimit, unitsLimit });
    ledger.applyExistingUsage(todayUsage);
    return { ledger };
  }
}

function parseNiche(niche: NicheDefinitionInput): NicheDefinition {
  const parsed = nicheDefinitionSchema.safeParse(niche);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Invalid niche: ${first?.path.join(".") ?? "input"} ${first?.message ?? "is invalid"}`);
  }
  return parsed.data;
}

function positiveIntEnv(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
