# mos services

MOS 4.0 的桌面服务层：YouTube 连接（Google OAuth loopback / API key）与 niche 研究
（主题扩展、配额续算、扫描执行、保存结果）。规范见 `docs/mos/desktop-integration-spec.md`。

## 边界与不变量

- 瘦封装：研究引擎、配额账本、loopback 服务器、sqlite 扫描库全部来自 `@zcode/mos`
  （requires: mos）；本模块只做凭据装配、事件转发与 host 生命周期接线。
- 凭据：Google token set / API key 只经 `ICredentialService`（key：`mos:youtube:*`）；
  token 值不进入日志、事件、RPC 返回值或扫描记录。`getValidAccessToken`/`getApiKey`
  是 host 侧方法，仅供 research 服务装配客户端，不经 RPC 发布。
- 配额续算：每次扫描前从扫描库按 PT 日起算当日已用量（`applyExistingUsage`），
  限额可用 `MOS_SEARCH_CALLS_LIMIT`/`MOS_UNITS_LIMIT` 覆盖（owner 申请提额后）。
- 状态诚实：连接状态机 connecting → connected/disconnected(+reason)；扫描的
  partial/failed 与失败明细原样透传，从不吞掉。
- Google OAuth client 配置：env（`MOS_GOOGLE_OAUTH_CLIENT_ID[_SECRET]`）优先于
  `~/.zcode/v2/mos-youtube.json`；未配置时 `startGoogleConnect` 返回
  `client-id-missing`，UI 给出配置指引而非死流程。

## 与其它模块的交集

- `node.ts`（services 装配）：构造 `MosConnectionService` + `MosResearchService`，
  注册进 ServiceCollection；扫描库句柄进 `sqliteReposToClose` 统一 dispose。
- renderer（packages/ui niche-explorer 模块）：只经 RPC 接口
  （`IMosConnectionService`/`IMosResearchService`）与 `openExternal` 打开授权页。
- Agent 工具（Stage 5）：与 UI 共用同一对服务接口，不新增旁路。
