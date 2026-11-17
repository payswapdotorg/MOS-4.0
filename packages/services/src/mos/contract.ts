/**
 * mos services 对外契约：连接与研究两个 RPC 服务接口。
 * 不变量与边界见 src/mos/CONTRACT.md 与 docs/mos/desktop-integration-spec.md。
 */
export type {
  IMosConnectionService,
  MosConnectionState,
  MosConnectStartResult,
} from "./mosConnection.js";
export type { IMosResearchService, MosScanProgressEvent } from "./mosResearch.js";
