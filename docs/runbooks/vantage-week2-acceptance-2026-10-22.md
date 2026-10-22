# Vantage Week 2 重建验收报告

日期：2026-10-22。基线：`0432b4b440456ee50f1e715bb13d6ae4d72b2ce7`。
分支：`Junkun/vantage-week2-rebuild`。本报告记录本次实际执行，未复用旧会话的测试数量。

## 交付结论

Tech Lead 可独立执行的 v1 P0/P1 修复和 V0 共享基础设施已经实现。
真实 Better Auth + PostgreSQL + 浏览器完整验收 **12/12 PASS**，真实 HTTP API
probes **10/10 PASS**。V0 registry/assembler/adapter 在合成 provider 上运行，不能
据此宣称 Joseph/Sophia 的生产模块或 live-model 已验收。

三次个人主机提交 `a0ebec1a`、`80186fc2`、`53eda9b0` 未能从当前可访问 Git/history
恢复。当前实现为基于已上传设计、Week 2 计划和可见代码的新重建；保留原 checkout，
没有推送、合并 main、重置原分支或删除旧数据库数据。

## 实际行为差异和证据

| 要求                      | 当前实现与验收                                                                                                                                                         | 主要代码/证据                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Topic PATCH 并发控制      | 正整数 `expectedContentVersion` 必填；事务内比较；stale 返回 409 且不覆盖；UI 保留草稿，加载最新后显式重用                                                             | `_schemas.ts`、`repository-v1.ts`、`TopicDialogs.tsx`；PG concurrent-write tests、browser `@gap`    |
| 历史 citation by-ID       | Evidence/Observation/Commitment 直接按 ID 读取，使用 server company/operator 权限；不存在与跨公司返回 404                                                              | 三个 `[id]/route.ts`、`SourceDialog.tsx`；真实浏览器 >200 Evidence、>500 Observation                |
| Private Share             | 界面移除 Share；API 和 dev simulator 拒绝分享                                                                                                                          | `EvidenceScreen.tsx`、simulators；browser private UI、API private sharing                           |
| 保存成功、刷新失败        | 已确认 DTO 立即同步；刷新失败保留“已保存”状态并阻断旧状态写入，显式 Reload 恢复；未知写入结果不盲目重复                                                                | `AgendaScreen.tsx`、`TopicDialogs.tsx`；browser `@refresh/@retry/@reload`、组件测试                 |
| Count / signed metric     | 保留 v1 finite signed number；允许负数/小数，拒绝 NaN/Infinity；不根据名称或 unit 推断非负整数                                                                         | `MetricsScreen.tsx`、schema/API probes；typed count 规则待单独决议                                  |
| Generation 与 human edits | 短事务最终校验 agenda 与 source fingerprint；来源变化拒绝旧结果；失败保留旧报告；模型调用不占事务                                                                      | `service-v1.ts`、`repository-v1.ts`、`db.ts`；PG 和服务测试、browser regeneration                   |
| Weekly Review / Actions   | 单一 Weekly Review 导航；Weekly Actions 标题与操作文案；旧 agenda/commitments routes 和 deep links 保留                                                                | `VantageTool.tsx`、`CommitmentsScreen.tsx`、API 文案；browser linked action + reload                |
| Previous-week context     | 读取上一周报告和 Actions；有限且唯一的相同指标/来源、完整周期比较；有 cutoff；来源可点击；读取失败与无数据区分                                                         | `AgendaScreen.tsx`、组件测试、browser `@readback`                                                   |
| Decision → Action         | 原有原子 decide endpoint + stable idempotency key；零或一个 primary Action；直接发现；check-in/status/Outcome 可跨周引用                                               | browser `@happy/@retry/@p1/@readback`、PG decide tests                                              |
| V0 handoffs               | 单独 package subpath；types/validators、trusted registry、deterministic manifest/snapshot、freeze、mock ports、v1 compatibility 与 context-aware sidecar               | `pipelines/src/vantage/proposals`、`context-v0`；contract/registry/assembler/mock integration tests |
| V0 安全边界               | actor-only；stars 绑定用户；public query projection 脱敏；来源 exact version/ACL/audience/hash 冻结；生成后与事务内复核；直接 commit 检查 snapshot/manifest/run/window | V0 adapter/acceptance tests；真实 production source resolver/transaction adapter 留到跨分支集成     |

完整文件清单由交付包中的 `changed-files.txt` 提供；代码按 v1/runtime、V0、文档分组
保存为本地提交，便于审阅与应用。

本地实现提交：`7e76c9c4`（38 个 v1/runtime 文件）、`40f2604c`（19 个 V0/fixture/
package 文件）。文档单独提交；精确最终 HEAD 见恢复包 `README.txt` 和 `commits.txt`。

## 本次实际测试

| 类别                       | 执行结果                                                                                            | 能证明什么                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 独立 TL runner             | 6 pipeline suites **54 PASS** + 11 web suites **203 PASS**                                          | 合计 257，其中真实 PostgreSQL storage 23、route 8、membership/auth 13，共 **44**；session/cookie 与 generator 为 doubles                                |
| 追加 web focused           | 10 suites **99 PASS**                                                                               | UI、API client、prepare、week steps、tool、one-click、autodraft、agenda row、schema                                                                     |
| 前端末次文案调整           | 2 suites **29 PASS**                                                                                | 已包含在上述 99 中，单独重跑不重复相加                                                                                                                  |
| Pipeline generation        | **51 PASS**                                                                                         | rules/模拟 provider、重试/校验；无 live provider                                                                                                        |
| V0 contract/infrastructure | 7 suites **48 PASS**                                                                                | 真实 shared implementation + synthetic ports；包括 malformed、coverage、partial/timeout、research unavailable、ACL/profile/source 漂移和 exact citation |
| 隔离启动器                 | **13 PASS**                                                                                         | 资源归属、端口/环境、credential ignore、namespace/ID 长度、fixture 周期一致性                                                                           |
| 真实浏览器                 | **12/12 PASS**                                                                                      | Playwright Chromium、真实 Better Auth session、真实 isolated PG、rules generation；故障注入只用于 browser transport                                     |
| 真实 API probes            | **10/10 PASS**                                                                                      | 周期往返/非法日期/反向区间、finite signed 数值、private share、跨公司读写拒绝、request company override、撤权后拒绝并恢复 membership                    |
| 类型与静态检查             | pipeline/web typecheck、build-config typecheck、route exports、changed-file lint/format、diff check | 具体输出随交付包保存；不是 repository-wide build/test 通过声明                                                                                          |

最终浏览器报告：`2026-10-22T06-25-27-690Z.json`，12 项通过，无 skipped。
最终 API 报告：`api-probe-b31ca10655194a1e.json`，pass=10/fail=0/notRun=0，
`membershipRestored=true`。两份报告都只含 synthetic 数据，凭证不进入交付包。

不重复累计的选定自动化测试合计 468（257 + 99 + 51 + 48 + 13）；浏览器与 API
probes 分别单列。Changed-file ESLint 为 0 errors、2 个 unused metadata-binding
warnings；另有仓库 Pages-directory 配置提示。没有通过关闭规则来掩盖检查失败。

早期失败均保留为调试历史，不算通过：缺少锁定 Chromium；webpack 内存阈值重启；
复用已生成 report 的 fixture；namespace ID 超过 64 字符；main evidence 不在所选周；
旧 Action 页面标题与断言不一致。已安装匹配浏览器、改用 app 默认 Turbopack、增加
不删除数据的 fresh namespace、修正长度/日期和 UI 文案后，完成上述全量复跑。

## 仍需最终决策 / 外部依赖

具体字段与 dated 决议见 [恢复与决策记录](../design/vantage-recovery-and-decisions-2026-10-22.md)、
[V0 ADR](../architecture/ADR-vantage-context-v0-2026-10-22.md) 和
[接入交接](../design/vantage-context-v0-integration.md)。安全默认值已可执行，产品签字未被假定。

- TL + Joseph：role directory/priority/profile versions；canonical Company Architecture 的 reviewed 状态；selected stars 的 override、删除和版本保留。
- TL + Sophia：recent/unresolved 定义；source identity/version/ACL 适配；预算和总延迟；public projection token 发行/过期/撤销、provider 与 retention。
- TL/product：typed count metric 的 `valueKind/minimum/integer`、迁移/backfill 和 CSV 兼容；更广报告 audience 需独立 contract。
- 跨分支集成：将 mock provider 换成 Joseph/Sophia 的真实模块，接入权威 source resolver 和真实原子 persistence adapter，再跑跨模块 E2E。

未运行/不作结论：live-model、真实 public research provider、生产 connectors、scheduled
generation、完整 role-conditioned model delivery、Company Architecture 公共信息自动起草、
生产部署、全仓库 build/test、真实辅助技术和手工视觉/移动端体验验收。当前 accessibility
证据限于语义 labels、focus 行为、组件和浏览器操作。现有 v1 短事务 table locks 较保守，
跨 workspace 串行化；生产扩展前应单独设计更细粒度并发控制。

本次专用 app 与两套 PostgreSQL 容器验收后已停止，卷和历史 namespace 均保留。
