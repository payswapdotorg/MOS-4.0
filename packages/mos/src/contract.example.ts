/**
 * mos 标准调用示例：一次完整的 niche 扫描（注入 client、账本与时钟）。
 */
import { QuotaLedger } from "./quota/ledger.js";
import { YouTubeClient } from "./youtube/client.js";
import { nicheDefinitionSchema, runNicheScan } from "./research/index.js";
import type { FetchLike } from "./youtube/http.js";

export async function exampleNicheScan(fetch: FetchLike): Promise<void> {
  const ledger = new QuotaLedger();
  const client = new YouTubeClient({
    auth: { type: "apiKey", key: process.env.MOS_YOUTUBE_API_KEY ?? "" },
    fetch,
    ledger,
  });
  const niche = nicheDefinitionSchema.parse({ description: "Home workout routines for women over 40" });
  const themes = [{ id: "theme-1", text: "low impact strength for women over 40" }];
  const result = await runNicheScan({ client, ledger }, niche, themes);
  if (result.status !== "complete") {
    // 上游失败必须如实呈现，绝不静默当作成功。
    console.error(result.statusReason, result.searchFailures);
  }
  console.log(`top video score: ${result.videos[0]?.score.overall ?? "none"}`);
}
