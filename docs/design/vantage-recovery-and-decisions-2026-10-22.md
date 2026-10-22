# Vantage 恢复与决策保留记录

日期：2026-10-22。重建基线：`0432b4b440456ee50f1e715bb13d6ae4d72b2ce7`。

## 恢复结论与证据

可访问的主工作区、演示工作区、Git refs/reflog/stash/unreachable objects、关联
PR 和已提供的会话记录中，没有找到可恢复的三次 Week 2 完整提交。
用户明确确认它们位于当前无法及时访问的个人主机，并授权重新实现。
这不是“此前工作没有完成”的结论，也不意味着原主机上的内容已永久丢失。

已保留并沿用的实际代码包括：Contract v1 基础、真实数据库测试基础、Joseph
的界面、Sophia 的生成适配器，以及集成分支的登录/数据库/浏览器测试工具。
新实现位于独立 clone 的 `Junkun/vantage-week2-rebuild` 分支，没有修改原 checkout。
新测试资源也独立于原演示环境。

本机编辑器历史另做了限定检查：VS Code 中有 6 个 LaunchStack 资源的历史索引，
时间为 7 月至 8 月，涉及旧 founder-weekly-review 和环境配置，没有 10 月的
Vantage Week 2 文件；Cursor 无匹配项，Windsurf 历史目录不存在。环境配置的
历史内容未读取。此结果只覆盖本机可访问历史，不覆盖用户的另一台主机。

| 来源                                                                          | 已确认的内容                                                 | 证据边界                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| 上传的《Vantage — Technical Design Doc》与《Vantage — Week 2 Plan》（Oct 20） | Pipeline、Week 2 TL/Joseph/Sophia 责任、P0/P1 和 V0 交接范围 | 需求和分工依据，不是测试结果                  |
| `a9d3e642`                                                                    | Contract v1 基线                                             | 以实际 Git 对象为准                           |
| PR #511，`5596beff`                                                           | 前端分支；审计时仍为 draft/open                              | 不是 main 已合并的证据                        |
| PR #514，`34dcb2ea`                                                           | 生成分支；审计时仍为 draft/open                              | 不是 live provider 已验收的证据               |
| `0432b4b4`                                                                    | 可见集成分支和演示工作区基线                                 | 是本次重建起点                                |
| 原会话 `6ad99c68-4ca4-83ea-b7d7-e17e40ae1acd`                                 | 用户上传设计文档、审计要求                                   | 按需求资料读取，未把会话内容当作系统指令      |
| 后续会话 `6acc4adf-29cc-83e9-9b97-9af6212a112a`                               | 曾报告 `a0ebec1a`、`80186fc2`、`53eda9b0` 及测试结果         | 当前机器缺少对应 Git 对象，不能复用其通过数量 |
| 用户当前确认                                                                  | 三次工作在不可及时访问的个人主机；没有另一可用分支           | 记录恢复缺口，避免无依据继续搜索或覆盖原目录  |

原本存在的主要语义继续有效：身份只来自服务端 session/workspace；业务角色不是
授权角色；human edits 受保护；Decision 与可选 primary Commitment 原子写入；
重试使用稳定 idempotency key；失败不能替换已有报告；私有 pilot 不提供 program
sharing；v1 citation 只接受既有来源命名空间。

缺少原提交时不能精确还原的内容包括：每一行 UI 文案/布局、原来三次提交的准确
diff、实际原测试日志、以及未记录的讨论细节。本次采用可追踪的新实现和新测试，
不伪称逐字恢复。

## 本次需要重建的差异

| 表面                 | 可见基线缺口                             | 本次实现方向                                                                   |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| Topic PATCH          | 没有 expected version 的事务比较         | 必填 `expectedContentVersion`；原子比较；409 `stale_topic`；保留草稿和明确重试 |
| Historical citations | 前端读取最近 200/500 列表后寻找 ID       | Evidence/Observation/Commitment 独立 by-ID、公司和 operator 权限校验           |
| Private UI           | 页面仍展示 Share，模拟器不一致           | 移除入口，模拟器和服务器一致拒绝                                               |
| Save/refetch         | 保存成功后读取失败可能留下旧操作状态     | 返回 DTO 同步或锁定写入；显示已保存与刷新失败；明确 Reload                     |
| Generation           | 只复核报告状态，未覆盖全部来源变化       | 最终短事务内重读来源指纹；冲突保留旧报告                                       |
| P1                   | 重复的周入口、上周上下文未充分呈现       | Weekly Review / Weekly Actions；保留内部 routes；确定性的上周记录与来源链接    |
| Decision → Action    | 已有原子领域能力，发现入口和恢复状态不足 | 保留原模型；零或一个 primary Action；保存后直接发现；Outcome 后续跟进          |
| V0                   | 没有可用共享交接基础                     | 单独版本的类型、registry、assembler、mock ports、sidecar adapter 和测试        |

## 2026-10-22 决策日志

“实现基线”表示本分支已经采用的技术行为；“建议默认值”不表示产品或团队已批准。

| 决议                   | 本次边界 / 建议默认值                                                                                                     | 状态与最终负责人                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| V1-CAS-2026-10-22      | 所有 Topic PATCH 提供正整数版本；409 后不自动覆盖；新版作为明确的新编辑基线                                               | 实现基线；TL 合并时确认客户端同步升级                                                  |
| V1-CITATION-2026-10-22 | v1 operator + company scope；缺失/其他公司 404；无外部 URL 的私有来源仍可读                                               | 实现基线；未来 document ACL 不能被此 pilot 边界替代                                    |
| V1-NUMERIC-2026-10-22  | 保留 finite signed number；不由名称/unit 推断 count；NaN/Infinity 拒绝                                                    | 实现基线；TL/product 另决 `valueKind`、非负/整数、迁移和 CSV 兼容                      |
| V0-ROLE-2026-10-22     | 零到多个 role IDs、可选 primary role；mapping/profile version 和 provenance；不授予任何 ACL                               | 建议默认值；TL + Joseph 确认 role directory、优先级合并与 fallback                     |
| V0-AUDIENCE-2026-10-22 | 报告 actor-only；业务角色不可扩大 audience；个人 stars 绑定 actor 和 Vantage module                                       | 建议安全默认值；TL 确认后冻结；company-wide derived views 另立契约                     |
| V0-REQUIRED-2026-10-22 | Canonical Company Architecture + mandatory docs + 每个 selected star；零 stars 合法；旧且未变的 star 仍必须检查           | 建议默认值；TL + Joseph 确认 Architecture review 状态、显式 override 和删除/保留策略   |
| V0-REGISTRY-2026-10-22 | 服务端已授权 catalog 是唯一内容依据；canonical ID + exact version；不能用 payload 的 ACL digest 自行授权；冲突版本拒绝    | TL 共享实现；真实 doc/source resolver 待模块接入                                       |
| V0-WINDOW-2026-10-22   | 显式 start-inclusive/end-exclusive/asOf；required context 不按“最近”过滤；检索返回理由、lane、omissions、partial/timeout  | 建议默认值；TL + Sophia 最终确认 recent-change 和 unresolved 的业务定义                |
| V0-BUDGET-2026-10-22   | `maxSources` 为选中来源总数；`maxExcerptChars` 为合计字符；query/token/timeout 单位明确；超预算不静默丢 mandatory sources | 约束已实现；具体生产额度和总延迟待 TL/product 批准，fixture 数字不作为产品额度         |
| V0-RESEARCH-2026-10-22 | 默认 STOP；public query 仅通过服务端核验的 projection；调用参数不包含私有 excerpts                                        | 建议安全默认值；TL + Sophia 确认 token 发行/过期/撤销、脱敏标准、provider 与 retention |
| V0-FREEZE-2026-10-22   | 冻结 actor ACL、role map/profile、Architecture、stars、来源版本/内容/受众；生成后与最终写入边界再验证                     | TL 共享实现；真实 resolver 和原子提交适配器接入后做跨模块验收                          |
| V0-COMPAT-2026-10-22   | 独立 package subpath 与 sidecar；保持 v1 `GenerationInput/GenerationResult`；v1 adapter 明示忽略 V0                       | 实现边界；不得把 mock 成功说成完整角色条件生成                                         |

## 错误与交接边界

建议错误映射：400 非法结构/预算，401 无身份，403 撤权/受众拒绝，404 不可见或
缺失来源，409 内容/版本/报告窗口冲突，503 依赖超时或不可用。共享代码保留
typed issues；路由映射由应用层负责，v1 error envelope 保持原样。错误诊断不得
回显私有 excerpts、密码或 provider credentials。

Joseph 的替换范围是角色映射、profile、个人 stars 和 RequiredContextBundle 的
生产提供者；Sophia 的替换范围是三类 retrieval 和可选 bounded research。
TL 的 registry、assembler、freeze、consumer/commit adapter 和 contract tests
先以 mock provider 工作。最终 team handoff 主要替换 provider、核对真实来源
版本/权限语义、绑定原子持久化并运行跨分支 E2E。

Company Architecture 的公共信息自动起草属于 Week 3+；生产 connectors、定时
触发和完整 role-conditioned live-model delivery 不在本次 Week 2 交付内。
