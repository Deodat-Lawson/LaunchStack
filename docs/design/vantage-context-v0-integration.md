# Vantage V0 接入交接 — 2026-10-22

状态：共享实现和 synthetic contract 验证；V0 产品默认值仍待 TL/团队签字。
本文件与 [dated ADR](../architecture/ADR-vantage-context-v0-2026-10-22.md)、
[恢复与决策记录](vantage-recovery-and-decisions-2026-10-22.md) 一起使用。

## 导入与所有权

统一入口：`@launchstack/pipelines/vantage/context-v0`。原
`@launchstack/pipelines/vantage` 的 GenerationInput/GenerationResult 不增加
角色、文档或 research 字段。V0 使用 `v0-proposed`，共享组装产物使用
`v0-assembly-1`；升级时显式变更版本，不能把不同版本的对象强制转换后继续运行。

| 接入方                   | 实现的函数/接口                                                       | 返回与限制                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Joseph                   | `RoleContextPortV0.resolveBusinessRoles(ResolveBusinessRolesInputV0)` | `Promise<BusinessRoleContextV0>`；principal、roleIds、mappingVersion、provenance/fallback；roles 不授予权限                     |
| Joseph                   | `resolveRequiredContext(ResolveRequiredContextInputV0)`               | `Promise<RequiredContextBundleV0>`；canonical company architecture、mandatory docs、每个 actor 的 Vantage stars 和完整 coverage |
| Sophia                   | `RetrievalContextPortV0.retrieve(DynamicRetrievalInputV0)`            | `Promise<DynamicRetrievalBundleV0>`；三条 lane，exact refs、原因、rank、去重与 partial/timeout/omissions                        |
| Sophia                   | `ResearchContextPortV0.research(ContextResearchPlanV0)`               | `Promise<ContextResearchResultV0>`；可选；无 planner 时明确 STOP；public 只接收已绑定的安全 query projection                    |
| TL / server integration  | `ServerContextPortV0.resolveAuthenticatedActor`                       | 当前 session/membership 解析的 actor scope；请求参数不是权限证据                                                                |
| TL / source adapters     | `sourceCatalog(SourceCatalogInputV0)`                                 | 当前 actor 可使用的精确来源版本、ACL、audience、bounded excerpts；来源由服务端读取                                              |
| TL / source adapters     | `currentState(CurrentStateInputV0)`                                   | 权威 actor/source/profile/Architecture/star 状态；事务内调用必须读取同一 transaction 的状态                                     |
| TL                       | `createSourceRegistryV0`、`assembleContextManifestV0`                 | 已实现的纯函数；不建立第二套数据库或替代 canonical entities                                                                     |
| TL / persistence adapter | `GuardedCommitPortV0.run`、`persist`                                  | `currentState(tx)` 和 `persist(tx)` 必须同事务且具有防并发漂移的隔离/锁语义                                                     |

接口完整字段以 `ports.ts`、`contracts.ts` 和 `proposals/context-v0.ts` 为准。
`runContextV0Pipeline(input, ports)` 执行身份 → 角色 → required → retrieval →
optional research → assembler → 权威 freshness 检查。
`runContextV0Generation` 在此基础上执行生成、结果校验、生成后 freshness 检查；
传入 commit port 时再做最终事务检查。所有 provider 均可依赖注入，mock 不注册路由。

## 装配方式

应用层从已验证的 server source catalog 构建 registry：

```ts
const registryResult = createSourceRegistryV0({
  actor,
  reportWindow,
  trustedCatalog,
});
if (!registryResult.ok) return registryResult;

const assembled = assembleContextManifestV0({
  runId,
  inputVersion,
  actor,
  reportWindow,
  roleContext,
  roleProfileVersions,
  required,
  retrievalInput,
  retrieval,
  researchPlan,
  researchResult,
  registry: registryResult.registry,
  budgets,
  trustedPublicProjections,
});
```

这是参数连接示例；source resolver、session 和 transaction 使用应用既有实现。
`ok:false` 不产生 EvidenceSnapshot，调用方不能继续生成。成功返回 immutable
manifest、bounded evidence snapshot 和冻结上下文。相同实质输入即使 runId 或
集合顺序不同，也应得到相同 context fingerprint。校验不是“信任一个 ACL digest”：
catalog 和 current-state provider 必须从权威数据读取，不能把收到的 bundle 原样回传。

## 权限、时间和引用边界

- actor 的 principal/company/audience/ACL 必须贯穿所有阶段；报告默认 actor-only。
  `company` 和 `public` 可作为来源可见性，不自动使报告成为公司共享报告。
- `source = {kind,id,version}` 形成精确身份。`ev/obs/cm` 延续 canonical 实体；
  `doc/company/public` 只存在于 V0。包含分隔符的 ID 使用共享 key helper 编码。
- Registry 是 trusted catalog 的 immutable 视图。retrieval/research 只能选择
  已授权来源，不能靠自带摘录、URL 或 citation 创建新的可信来源。
- 对新 public research 来源，生产 research/source adapter 需要先验证并注册
  canonical source record，再进入组装；不能复制 research result 来“批准”它自己。
- required sources 不按 recent window 过滤；旧而未变的 star 仍要检查和带版本。
  零 stars 合法；missing/revoked/unchecked/omitted mandatory context 阻断生成。
- `reportWindow` 明确 start-inclusive/end-exclusive/asOf；sourceDate 不晚于 asOf。
  previous-week UI 使用已完成 period、相同 metric/source 与唯一 observations，
  缺失或不可比时不制造变化数字。
- source budget 和 excerpt budget 是跨 lane 合计；不能为了预算悄悄删除 required
  source。retrieval 与 research 的完整性状态分别保留。
- public 工具参数只包括精确可信 projection 和有限预算；原始 gap 文本、私有
  excerpt、internal refs 及未知扩展字段不得进入 public 请求。

## 生成与持久化

`wrapExistingGenerationPort(existing)` 保持原 v1 input 不变，返回
`contextMode:"ignored-v0"` 且 V0 citations 为空。它只证明兼容，不证明角色条件生成。
`createContextAwareGenerationAdapter` 提供单独的 context sidecar，校验 frozen v1
结果及精确 V0 引用；文档引用不能冒充 v1 的 `ev:id` 字符串。

V1 input 与 V0 manifest 必须属于同一 `runId` 和同一报告窗口/截止时刻。
各自的 `inputVersion` 可以保留独立指纹；v1 result 必须返回其 v1 input 的版本。
服务器须先按当前身份构建 v1 input，V0 adapter 不能替代既有 v1 数据读取授权。
V0 sidecar 为 `{v1Result, citationRefs: ContextSourceRefV0[]}`；引用只有同时存在于
manifest registry、snapshot 和 freeze 的 exact ref 才可接受。直接提交也重新验证
snapshot 指纹、摘录、版本集合、截止时刻和 contextMode。

冻结覆盖 actor ACL、source ACL/audience/access、source exact version/content hash、
role map/profile、Company Architecture 和 personal stars。任一阶段发生变化都不能
悄悄把新的 current-state 当作旧 manifest 的生成基线。最终提交在同一事务重读并
校验，且失败时不得持久化结果。事务适配器必须使用真实数据库事务/锁；测试用的
mock transaction 仅证明调用顺序与拒绝路径，不证明生产数据库隔离。

## 错误与重试

Registry/assembler 返回 typed issues；orchestrator/adapter 抛 `ContextPortErrorV0`。
建议应用层映射：400 结构/预算非法，401 未登录，403 授权/受众拒绝，404 缺失来源，
409 版本/窗口/coverage 冲突，503 权威 freshness 元数据或依赖不可用，500 未预期错误。
具体 issue 保留 status；不同边界的聚合错误可能以 409 表示无法继续组装，路由不得
因此绕过原始授权拒绝。错误不回显私有 excerpt。409 后重新读取并重建上下文，不能
只替换 expected version。未知/撤权来源不使用旧内容作 fallback。

## 可执行验收

```sh
pnpm --filter @launchstack/pipelines exec vitest run src/vantage/proposals/context-v0.test.ts src/vantage/context-v0
pnpm --filter @launchstack/pipelines typecheck
node scripts/dev/vantage-integration-tl-test.mjs
node scripts/dev/vantage-integration-runtime.mjs --prepare-fresh
# 启动 --serve 后，在另一个终端运行：
node scripts/dev/vantage-integration-runtime.mjs --e2e
node scripts/dev/vantage-integration-probes.mjs
```

替换 mock 后至少重跑：多角色、零/private/旧 stars、required 缺失/撤权、旧未解决项、
近期无关项、跨 lane 重复、跨公司/跨用户、未知 citation、partial/timeout、research
STOP/unavailable/public sanitization、生成期间 source/profile/ACL 漂移、最终事务
拒绝、manifest determinism 和 coverage。当前执行结果见验收报告，不复用历史数字。

## 最终集成前必须签字的决策

2026-10-22 的建议安全默认值：actor-only、required 缺失就阻断、research 默认 STOP、
显式 trusted public projection、保留 v1 finite signed numeric。TL 与 Joseph 冻结
role directory/priority/profile versions、canonical Architecture review 状态、stars
override/deletion/retention；TL 与 Sophia 冻结 source version/ACL resolver 语义、
recent/unresolved 定义、预算与总延迟、token 发行/过期/撤销和 public-source retention。
typed count metric 的非负/整数约束和迁移/CSV 规则另立 contract。

剩余真实依赖是 teammate modules、生产来源 resolver 与 transaction binding 的跨分支
集成和 E2E。Company Architecture public autodraft、production connectors、scheduled
generation、完整角色条件 live-model delivery 属于后续范围。
