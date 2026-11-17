# mos

MOS 4.0 的 YouTube Content Intelligence 共享核心：桌面 UI 与 agent 工具共用同一个研究引擎
（niche → themes → discovery → baselines → scoring → classification）。

意图：把所有"怎么研究 YouTube"的决策集中在一个纯逻辑模块里，配额、诚实性与可复现性
是产品要求而不是调用方的自觉。

不变量：

- 纯逻辑：不 import Electron；`fetch`、时钟、配额账本由调用方注入。
- 官方 YouTube API only（capability registry 的六个能力）；不存在抓取路径。
- 每次 `search.list` 前过 `QuotaLedger` 预检；扫描计划执行前给出 `estimatedCost`。
- 上游请求失败 → 扫描 `partial`/`failed` 并保留失败明细；绝不静默成功。
- 缺失指标被排除而非补分；completeness < 0.5 → `overall = null`（诚实下限）。
- 动量只来自 ≥2 次观测；views/day 是发布年龄估算；engagement 是公开计数代理。
- token 值不进入任何返回结构、provenance 或错误消息；凭据边界在调用方。

与其它模块的交集：desktop services（Stage 4+）经 `contract.ts` 消费本模块并持有
凭据/持久化；agent MCP tools 调用同一 services，不直接触达凭据。
