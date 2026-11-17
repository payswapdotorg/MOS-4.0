/**
 * mos services 标准调用示例：连接 → 主题扩展 → 扫描（renderer 经 RPC 调用）。
 */
import type { IMosConnectionService, IMosResearchService } from "./index.js";

export async function exampleNicheResearchFlow(
  connection: IMosConnectionService,
  research: IMosResearchService,
  openExternal: (url: string) => void,
): Promise<void> {
  const start = await connection.startGoogleConnect();
  if (!start.ok) return; // client-id-missing / already-connecting 由 UI 呈现
  openExternal(start.authorizeUrl); // 调用方负责打开系统浏览器
  const niche = { description: "Home workout routines", dateWindowDays: 365, format: "all", exclusions: [] as string[], depth: "quick" } as const;
  const expansion = await research.expandThemes(niche);
  const result = await research.runScan(niche, expansion.themes);
  if (result.status !== "complete") console.error(result.statusReason);
}
