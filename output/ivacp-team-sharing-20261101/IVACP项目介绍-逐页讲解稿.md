# IVACP 项目介绍：逐页讲解稿

讲解总时长约 35 分钟。页码与 PPT 一一对应。技术现状依据本次源码静态核对，历史验证未重跑。未来留言板方案尚未实现。

## 第 01 页：IVACP 车辆智能分析与协作平台

建议时长：1 分钟。证据状态：现有系统与未来规划。

**本页重点：分享重点：飞书工单链路、版本判断证据、可信恢复与有界迭代**

今天围绕 VehicleService / VehicleHal 小团队的实际工作介绍 IVACP。典型问题是：一张缺陷工单同时包含描述、评论、CAN trace、Android/QNX 日志和配置文件，人工需要反复找信号、查版本并整理结论。系统把这些工作组织为可追溯的流水线，模型负责提取和解释，确定性逻辑负责身份、配置和提交边界，人工保留复核与外部操作的决定权。

分享前半段解释已经接通的系统，核心是飞书和版本链路；后半段介绍已写入仓库的最简 Loop，再讨论尚未实现的留言板自动迭代。功能入口多数已经接通，但真实业务与完整迁移验收仍有遗留。今天的技术事实来自当前源码静态核对和已有记录，本次没有运行真实分析或业务写入。

依据：

- README.md:1
- docs/PRODUCT.md:107；定位：目标用户
- docs/REFACTOR_STATUS.md:5；定位：功能与验证边界

## 第 02 页：功能地图与同事的使用路径

建议时长：1.5 分钟。证据状态：当前已实现，业务效果本次未重测。

**本页重点：先认识业务入口，再理解证据、复核与协作如何连接**

功能可以按使用路径而不是代码目录记忆。分析员从首页规则组看板或指定 Jira 票号入口开始，规则组配置查询、车型文件与提示词；筛票后进入工单列表和统一详情，查看 CAN 曲线、信号、版本及过程产物。复核员进行人工通过或结构化驳回，AI 复核提供辅助；标注工作台维护独立标注和导出。

团队侧有年度/月度统计、报告和规则组模板，减少重复配置。首页侧栏承载对话、知识库、记忆和笔记，按用户隔离。管理员使用终端工作台连接白名单 SSH、同步配置或管理 Git 文件；数据管理页负责文件备份、恢复和迁移。OpenAPI 与离线评测、CAN 回放供开发和排障使用。AutoCycle 在浏览器运行条件下执行周期筛票和处理，不是可靠后台开发调度器。

同事第一次使用建议先从隔离样本练习规则组、单票分析和复核，了解来源、运行及配置身份，外部回填另行确认。

依据：

- README.md:38；定位：主要页面
- docs/REFACTOR_STATUS.md:5；定位：功能与验证边界
- src/app/(app)/page.tsx:1

## 第 03 页：整体架构与数据边界

建议时长：2 分钟。证据状态：当前源码结构。

**本页重点：IndexedDB 保存浏览器业务状态，MySQL 提供镜像与团队能力，文件系统保存分析证据**

架构图中的实线表示主要调用方向。浏览器的 app/features 负责页面、状态和交互，domain 提供不依赖 UI 的实体与规则；shared 的 Dexie 数据库保存规则组、分配、任务、结果、历史及助手数据。浏览器通过同源 API 调用 Next.js 的 src/server 服务。

Next.js 对接 Jira REST、飞书 CLI 和 Qwen，也调用本地 Python / CAN 工具。分析过程的文本、图、完整响应和指标写入本地运行目录；上下文图片是另一类按工单隔离的缓存。MySQL 通过现有镜像接口承接 sync_records 等数据，并支持团队统计、模板等能力，不能把数据库镜像理解成新增云同步。

终端有独立 WebSocket / SSH 网关，浏览器通过终端协议调用白名单远程目标。同步生成本地 configuration 和 project.json 映射，分析读取这些本地资料，分析本身不会自动发起远程同步。图是职责级架构，不意味着所有节点之间都有相同的鉴权或事务。

依据：

- src/shared/db/database.ts:12；定位：DB_SCHEMA_V1
- src/shared/db/sync.ts:28；定位：FLUSH_DELAY_MS
- src/server/pipeline/process/orchestrator.ts:30；定位：processIssue
- terminal-gateway/server.ts:1
- docs/ARCHITECTURE.md:4；定位：IVACP 新仓库实现边界

## 第 04 页：工单身份与运行数据模型

建议时长：1.5 分钟。证据状态：当前实现，示意身份。

**本页重点：ticketKey 是展示标识，完整来源身份和独立 runId 才能约束关联与恢复**

示例 P / issue / 12345 表示项目、类型和工作项 ID 的完整身份。同一个数字 ID 在不同项目或类型中不应合并，Jira 还要区分默认与 Bosch 站点。ruleGroupId 表示处理配置和当前归属，它不是工单自身的永久身份。

筛票运行 filterRun 产生候选快照与归属审计；分配 assignment 指向当前规则组。分析开始时 beginProcessAttempt 在事务中创建 origin=process 的独立输入快照和 processTask，飞书同时设置 latestAttemptTaskId。页面提交的 runId 等于 task.id，服务端据此建立独立产物目录。结果 processResult 关联 task、snapshot、assignment，重跑会把旧结果归档到 history 而非直接抹除。

图示是逻辑关系，不代表所有字段都在每张表上有唯一索引。恢复和部分外部操作当前仅支持 issue 类型，不能因为筛票结构能表达其他类型就声称全类型分析已实现。也不能声称所有旧数据缺失的来源都可以恢复。

依据：

- src/domain/entities.ts:216；定位：ProcessTask
- src/features/tickets/services/process-repository.ts:18；定位：beginProcessAttempt
- src/server/meegle/recovery.ts:50；定位：recoverMeegleRun
- src/server/meegle/mql-filtering.ts:132；定位：meegleMqlIdentityKey

## 第 05 页：飞书工单的端到端路径

建议时长：2 分钟。证据状态：当前已接通，示意主路径。

**本页重点：分析、查看上下文、复核和回填是不同操作，界面动作不能混成一条自动写入链**

从登录开始理解飞书集成。平台沿用本地会话和 analyst、reviewer、admin 角色；API 仍需要服务端鉴权。飞书访问由服务端封装 CLI 执行，CLI 必须在运行 Next.js 的用户与环境中已有有效登录，不是浏览器直接携带飞书凭据请求上游。

规则组 MQL 决定候选，筛选后获得唯一当前归属；用户发起分析或周期处理时，浏览器先建立任务和快照，再取得描述、评论及附件并进入共享分析 API。服务端根据附件模式选择处理路线，产出可展示、可追踪的证据和结论。

成功返回后浏览器保存结果，也可能触发既有群通知和本地一致性校验。用户可以另外执行 AI 复核、人工复核、回填或指派。飞书 AI 复核只能保存建议，不能解除人工门禁。角色权限、目标绑定凭据和回填确认共同限制外部写入。这里只解释现有行为，不在本次分享制作中发起任何请求。

依据：

- src/server/meegle/cli.ts:54；定位：runMeegleJson
- src/features/workflow/filter-service.ts:44；定位：filterSource
- src/features/tickets/services/process.ts:66；定位：processTicket
- src/domain/auth/permissions.ts:42；定位：requiredRoleForPath

## 第 06 页：MQL 筛票、优先级与失败隔离

建议时长：2 分钟。证据状态：当前确定性逻辑。

**本页重点：成功空结果与查询失败含义相反：前者可解除未命中归属，后者保留既有数据**

浏览器优先从完整 MQL 的 FROM 子句取得 projectKey。仅兼容旧条件式查询时才借助我的待办推断项目；服务端会把裸条件补成 issue 查询并执行 workitem query。每个 CLI 命令默认 30 秒截止，飞书整次前端筛票截止 90 秒，Jira 仍使用自身的 10 分钟边界。

规则组按 sortOrder，再按 id 排序。一项工作项命中多个组时，确定唯一自动归属。针对一个目标组的筛票也要查询其更高优先级比较组，比较查询失败就不能安全认定目标归属；successfulRuleGroupIds 是提交依据，HTTP 200 不是充分条件。手工分配在新自动分配时有保护，但成功查询后未再命中的原归属仍按当前清理规则解除，不能笼统说手工分配永远不变。

事务提交核对最新运行，写入快照、分配与审计。成功空结果解除该组未命中归属，保留已有结果和历史；失败记录审计并保留原归属，页面不把旧成功快照冒充本次结果。超时后迟到响应不能覆盖新运行，Jira 与飞书分别成功或失败。

依据：

- src/server/meegle/mql-filter-run.ts:99；定位：runMeegleMqlFilter
- src/server/meegle/mql-filtering.ts:82；定位：selectMeegleMqlFilterExecutionScope
- src/features/workflow/filter-repository.ts:27；定位：commitFilterRun
- src/features/workflow/filter-service.ts:44；定位：filterSource
- src/domain/issue-source/jira-workflow.ts:10；定位：MEEGLE_FILTER_TIMEOUT_MS

## 第 07 页：工单上下文与本地图片缓存

建议时长：1.5 分钟。证据状态：当前实现，时序为职责级简化。

**本页重点：当前票缓存便于查看，分析快照用于追溯；刷新原票不会改写旧分析运行**

这里特意区分两个上下文用途。工单详情的 context-view/context-image 路径用于用户查看原票，先读本票 context.json，必要时只读取得远端字段、评论及作者，图片通过 CLI 下载至本地缓存。缓存路径按 projectKey / issue / meegle-ID 隔离，图片用原 URL 的 SHA-256 作为标识。API 检查登录、工单映射与图片格式，渲染只引用同源鉴权图片。

下载只接受受限官方 HTTPS 文件地址，每张最多 20 MiB，一次新增最多 40 张、100 MiB、45 秒，并复用有效旧图。远端失败保留旧内容，无缓存可回退分析快照；评论失败不清空旧评论，单图失败显示占位。正文经过清理后保留主要排版，不能把任意 HTML 原样执行。

分析前的 fetchMeegleContext 则取得详情、评论、评论附件和附件插件，并构建处理 rawData。富文本查看缓存不等于分析 evidence。单纯打开或刷新上下文不会启动分析、发送评论或修改已有 run。

依据：

- src/server/meegle/context-view.ts:6；定位：meegleContextCache
- src/server/meegle/context-cache.ts:49；定位：createMeegleContextCache
- src/server/meegle/context.ts:21；定位：fetchMeegleContext
- src/features/tickets/components/ticket-context-panel.tsx:1

## 第 08 页：共享分析流水线与证据生成

建议时长：2.5 分钟。证据状态：当前共享编排。

**本页重点：“有回复”不等于“完整证据分析成功”，缺附件与摘要兜底需要明确解释**

共享服务端 processIssue 先建立运行上下文，准备评论和附件。飞书没有有效附件时，在 OCR 之前直接返回固定补日志回复；拒绝模式也会提前结束，因此界面有结构化回复不能证明已执行全部 AI 阶段。

完整路径下载解压后先提取版本、选择并冻结有效配置，然后读取 JSON 和 Proto。Step1 提需求，Step2 提信号；映射先走真实配置，再有受限补救，不能把任意模型字符串当作有效 Property ID。CAN 解码绘图与 Step3 上层摘要局部并行，证据汇总等待二者。Step3 的直接输入是评论、需求和信号结果，Android/QNX 日志在证据整理和 Step4 中处理。

版本检查位于证据整理之后、Step4/5 之前，可以按明确条件提前结束。最终 Step5 根据附件模式联合分析、CAN 对比或摘要兜底，再做证据自修正。业务内部自修正最多 3 轮，与开发规则的最多 2 轮不同。EGR 衡量断言接地，不是端到端正确率。运行可能有重试或额外判断请求，不能把五个 AI 阶段说成恰好调用模型五次。

依据：

- src/server/pipeline/process/orchestrator.ts:47；定位：runStages
- src/server/pipeline/process/signals-stage.ts:114；定位：matchSignalsToConfig
- src/server/pipeline/process/evidence-stage.ts:35；定位：collectEvidence
- src/server/pipeline/step5.ts:218；定位：runEvidenceSelfCritique
- docs/PIPELINE_GUIDE.md:84；定位：附件分支与提前结束

## 第 09 页：有效配置：选择、冻结与整体回退

建议时长：2.5 分钟。证据状态：当前已实现，历史整套配套未验证。

**本页重点：原请求身份保持，实际配置另行记录；自动文件与用户回退文件不拼接混用**

自动配置选择在日志解压后、Step2 前。先按当前规则组完整别名匹配工单车型；SOC 去掉已识别构建版本后匹配 project.json 中的分支，SCC 提供日志车型，要求与同一规则组的车型条目唯一一致。Android hash 若可用，则作为分支交叉证据；多日志身份冲突、hash 冲突或候选仍不唯一都不能强选。

目录确定后，检查 .sync-state.json 的项目分支与仓库身份、文件名及 Git blob 标识，自动模式还要验证 JSON 数组、Proto Property_ID 和实际 DBC 解析。通过后将文件读取并冻结至 run/effective-config/UUID，保存源路径、快照路径、SHA-256、manifest 与仓库提交。后续 JSON、DBC、Proto 和当前 type.h 用同一实际配置。

失败走整体用户配置回退，冻结可用用户文件，保留缺失时原有能力，不能从另一个自动目录补几个文件。requested 与 actual 分开，原 runId、目录和工单归属不改。身份明确冲突时，历史 VHAL 判定不得利用冲突上下文提前停止。结果保存 effective-config-resolution.json 和 effective-config-check.md。

依据：

- src/server/pipeline/process/effective-configuration.ts:145；定位：selectEffectiveConfiguration
- src/server/pipeline/process/effective-configuration.ts:67；定位：freeze
- src/server/pipeline/process/effective-context.ts:8；定位：configurationFor
- src/domain/rule-groups/model-files.ts:31；定位：resolveModelAlias

## 第 10 页：日志版本提取与 SOC / SCC 判断

建议时长：2.5 分钟。证据状态：当前实现，模型判断可能为 unknown。

**本页重点：比较结果只有明确 mismatched 才停止；缺失、格式无效或判断失败保持 unknown**

SOC 递归读取 Buildinfo.txt 的 MAIN_VERSION；SCC 解码同一目录 Scc-*.dlt 的真实 payload，提取 [Vip-App]App: 后原文。不能从整个包随意拿一个 SOC 和另一个目录的 SCC 配成一对，多配对全部留档。原始提取在配置选择前完成，但 AI 版本比较仍在后面的版本检查阶段执行。

比较提示要求只看有效版本号，忽略模块名、平台和日期；输出 matched、mismatched 或 unknown，并用 schema 校验。任一明确 mismatched 就保存原因、跳过后续版本定位和 Step4/5；全部明确 matched 才汇总为 matched，缺失或任何不确定保留 unknown 并继续。这个 AI 判断有证据和格式边界，不能当作已完成实际刷机一致性验证。

Android 的 BoschVehicleHalHash 是独立信息，解析 hash-YYYY-MM-DD，按编译日期选择最新候选，不按日志行时间。最新日期出现不同 hash、日期无效或来源读取告警时保留未知或歧义。当前配置 type.h 的 8 位 VER_PRO_CFG 是另一项元数据，不能取代问题日志的历史版本。

依据：

- src/server/pipeline/log-versions.ts:42；定位：extractLogVersions
- src/server/pipeline/process/version-vhal-stage.ts:34；定位：runVersionVhalCheck
- src/server/pipeline/version-vhal/resolution.ts:18；定位：chooseLatestHash
- src/server/pipeline/vhal-version.ts:1

## 第 11 页：RTC 关联、历史 VHAL 与信号检查

建议时长：3 分钟。证据状态：当前确定性追溯与检查。

**本页重点：unknown、歧义、部分缺少或仅大小写不同均提示后继续；全体确认缺少才停止**

这页是版本追溯最重要的链路。Android 的完整短 hash 先在 project.json 的 commid-rtcids-map 前缀匹配，必须唯一定位来源提交和它所在的项目、branches 条目。取得 RTC 列表后，只在同一项目和同一个 branches 对象里的唯一 repoName=vs 中做 RTC 完整匹配，去重得到唯一 VS commit。这里 RTC 不是当前工单号，也不要求两个仓库的 Git 分支名一样。

用 VS commit 查 configuration 项目分支组的根目录和 bak 归档文件名，兼容有无 .h。归档前缀冲突、多版本码或缺失都不任取。示例 82552236 分解为平台 8255 与版本 2.2.36，再定位对应 VHAL Excel；当前文件命名仍含 CHERY 模式，不能声称已泛化到所有 OEM。

Excel 按表头读取 Vehicle property ID、MCU UP、IVI DOWN，精确区分大小写，然后检查同行 Project 中按斜线分割的完整车型，车型来自实际 DBC 文件名。ALL、空白或无法解释的 Project 保持 unknown。只有非空待查列表的全部信号都确认不存在或车型未配置、且没有大小写差异豁免，才停止 Step4/5。部分缺少继续，命中记录表、行、列和值，Excel 读取前后摘要也要一致。

依据：

- src/server/pipeline/version-vhal/resolution.ts:156；定位：resolveVhal
- src/server/pipeline/version-vhal/resolution.ts:100；定位：associateVs
- src/server/pipeline/version-vhal/signals.ts:29；定位：checkSignalRows
- src/server/pipeline/process/version-vhal-stage.ts:34；定位：runVersionVhalCheck
- scripts/read-vhal-xlsx.py:1

## 第 12 页：分析保存、刷新恢复与外部回填

建议时长：3 分钟。证据状态：当前实现，时序省略部分内部调用。

**本页重点：HTTP 断开不停止飞书运行；评论成功和状态流转成功分开记录**

浏览器在短事务内建立 task 和快照，网络调用在事务外。服务端先保存 final_reply、stages 和 process-response，刷新日志之后最后原子发布 success metrics，并标记 responseArtifactVersion=1。仅存在 final_reply 不能恢复成功。客户端成功提交还要核对 analysisRunId、最新 task 和 assignment 的运行令牌，迟到结果不能覆盖新状态。

飞书忽略 HTTP 断开带来的取消，显式 cancel 才请求运行注册表停止，停止与成功发布互斥。页面刷新用原 run 身份调用 recover；完整产物通过后重签 artifactRef 与 analysisReceipt，保留曲线、枚举、Token、版本和有效配置。尚不完整且未超过两小时可保持处理中，超时转失败。运行注册表是进程内的，服务重启不能保证继续执行，完整成功产物恢复与任意断点续跑是两回事。

人工通过或驳回并提供正确结论后才满足飞书回填门禁，AI 复核只是建议。回填事务领取，凭据绑定目标与动作；评论完成立即保存，流转失败只重试流转。指派另走目标绑定授权，不等于评论或流转。当前恢复还依赖原快照及组等上下文，不能宣传删除所有配置仍能无条件恢复。

依据：

- src/server/pipeline/process/finish.ts:24；定位：persistSuccess
- src/server/meegle/recovery.ts:50；定位：recoverMeegleRun
- src/features/tickets/services/process-repository.ts:54；定位：finishProcessAttempt
- src/features/tickets/services/backfill.ts:17；定位：execute
- src/server/artifacts/analysis-run-registry.ts:141；定位：registerAnalysisRun

## 第 13 页：可靠性、验证证据与已知限制

建议时长：1.5 分钟。证据状态：本次静态核对，未重跑业务验收。

**本页重点：当前多数入口已接通，真实业务、准确率和完整迁移验收仍需按项补齐**

可靠性来自多层约束。身份和归属门禁保护并发，运行产物提交顺序保护恢复，配置冻结保护同次分析的一致性，外部写入使用角色、目标凭据、人工复核和回填领取保护。测试目录存在对应服务、事务、恢复、配置、CLI 与浏览器用例，本次只核对代码和资料，不重跑测试也不引用历史总数当成当前全量通过。

功能对照明确：许多入口和隔离回归已连接，真实工单完整分析、真实回填、部分 MySQL 与完整迁移仍有验证边界。上下文图片曾有真实只读链路记录，只能说明该记录覆盖的范围，不能推导整个业务端到端已通过。

EGR、信号召回、关键判断和真值覆盖要一起看，没有证据时 unknown 不进入普通成功率。服务重启不等于任务持久执行，浏览器 AutoCycle 不等于后台任务系统。后续若做自动迭代，需要新增开发队列和发布控制，而不是直接复用分析队列就宣称完成。

依据：

- docs/REFACTOR_STATUS.md:39；定位：验证纪律
- test/pipeline-run-commit.test.ts:1
- test/pipeline-auto-config.test.ts:1
- test/meegle-recovery.test.ts:1
- test/kanban-browser.test.ts:1
- src/server/evaluation/accuracy.ts:163；定位：buildAccuracyReport

## 第 14 页：Harness 与 Loop 的配合

建议时长：1.5 分钟。证据状态：项目已采用的开发规范。

**本页重点：已有规则与上下文继续保留，开发 Loop 把调查、执行、验证和交接连接起来**

Harness 在本项目体现为产品、架构、流程、时序、代码分层、工具、测试和交接规则。它回答开发者应该依据什么、哪些边界不能破坏、如何证明结果。Loop 则规定同一目标内如何连续调查、做最小修改、验证、根据失败证据继续修复或结束。两者不是替代关系，Harness 也可以包含反馈，只是侧重点不同。

已有备份的 AGENTS.md 已切换为最简 Loop，保留五份必读文件、现有存储和协作边界、中文输出与外部操作门禁。外部记忆复用 session-handoff，不新增 .loop 或复杂状态设施。

对同事而言，最有价值的不是再学一组命令，而是知道任务如何界定和恢复：目标、范围、验收、证据、当前尝试和下一步都要能从文件找到。规则文件本身不会唤醒 Agent，也不是自动发布服务。

依据：

- AGENTS.md:29；定位：最小开发循环
- docs/loop-engineering/minimal-loop-agents-review.md:7；定位：实施记录
- docs/loop-engineering/project-adoption-review.md:1

## 第 15 页：小功能与缺陷改进的有界 Loop

建议时长：1.5 分钟。证据状态：当前规则，适用性为工程判断。

**本页重点：默认最多 2 轮修复；同一失败两次且无新证据时交接，测试全绿不替代业务判断**

当前功能地图和回归基础已经比较完整，后续常见任务更可能是某字段展示、一次失败恢复、一个小配置项或明确可复现缺陷。这类任务适合先写验收，再做最小改动，验证失败时带着新假设继续。这里是基于项目阶段的判断，不是已经测得成本下降或成功率提升。

举例：未来某个规则组字段保存后刷新丢失，先复现表单到转换、store 和 IndexedDB 的链路，写清保存与刷新仍在的验收，然后最小修复并检查卡片、数据库重读和浏览器。不要同时顺手重构多个模块。复杂的权限、数据迁移或架构改变仍需要先澄清与规划。

两轮是修复假设加对应验证的次数，不是两次工具调用或两个消息。没有新证据的重复失败就交接，用户明确要求继续时带着历史尝试恢复。纯文档检查内容和格式即可；涉及共享生命周期和存储时扩大回归。最终完成需要验收、相关文档和交接一致，而不是命令退出码全绿后自行扩张下一功能。

依据：

- AGENTS.md:56；定位：停止与交接
- docs/REFACTOR_STATUS.md:5；定位：功能与验证边界
- session-handoff.md:21；定位：实施最简 AGENTS.md

## 第 16 页：未来：留言板与需求筛选架构

建议时长：1.5 分钟。证据状态：未来规划，尚未实现。

**本页重点：建议内容是不可信输入，不能直接授予工具权限、秘密访问或发布授权**

留言板是用户提出的未来方向，当前源码未核对到这套需求到开发到发布的闭环实现。本图是候选设计。用户沿用既有登录提交建议，记录作者、状态和可见范围，管理员可以查看全部，普通用户的可见规则需要产品确认。建议和审批记录适合在现有自托管 MySQL 能力中另行设计服务端表；若浏览器保留草稿仍用 IndexedDB，不能为了简化复用业务镜像记录就丢失任务状态约束。

只读筛选 Agent 做去重、分类、已有能力检索和优先级建议，检查价值与信息充分性，必要时要求补充。策略服务负责确定是否在管理员预授权的范围，不让模型自行改变权限。只有形成任务合同，包括范围、验收、预算和允许工具，才进入独立开发队列。

开发 worker 在隔离环境写代码，审核与验证角色只读候选，发布角色持有最小部署凭据，筛选角色不持发布密钥。队列必须持久化、可暂停、串行或有明确冲突策略、幂等领取和可恢复状态。未来设施并不因为当前有 AutoCycle 就已经存在。保持现有不引入第三方账号、云同步或真实 GitHub API 的边界。

依据：

- AGENTS.md:3；定位：角色与项目边界
- docs/REFACTOR_STATUS.md:5；定位：功能与验证边界

## 第 17 页：未来：需求到发布的受控时序

建议时长：2.5 分钟。证据状态：未来规划，A / B 两种授权模式。

**本页重点：A 模式逐次人工确认，B 模式按预授权策略自动推进；超范围、失败或未知均暂停**

模式 A：筛选 Agent 生成建议和任务，开发者确认后才创建开发运行；测试、构建、浏览器、差异审查和预览通过后，再由开发者确认合入及发布。适合首期建立证据和积累真实任务。模式 B：管理员预先限定低风险文件范围、任务类型、工具和发布条件，在策略允许时自动开发，通过全部发布条件后自动更新，超范围、未知或敏感改动转人工。B 是待验证的演进方向，不是当前能力。

建议、任务、开发 run 和候选版本分别有 ID，防止重复评论生成相同任务、worker 重启重复提交或发布请求重放。服务中断恢复应读取任务持久状态和既有副作用账本，不能盲目重放。隔离开发以固定基线进行，合入前重新检查当前基线和冲突，冲突转重新验证或人工决定。

自动更新需要拆成代码生成、受控合入和部署三个动作。发布前保存版本、构建摘要、验证证据及回退目标，部署后健康检查失败恢复上一已验证版本；数据库变更不能假设随代码一键回退，首期自动范围应排除此类高风险任务。暂停开关同时拦截未启动任务和新发布，已运行任务按明确取消策略收尾，不夸大为任意时刻强杀都安全。

依据：

- AGENTS.md:39；定位：外部评论
- docs/loop-engineering/minimal-loop-agents-review.md:96；定位：最小开发循环

## 第 18 页：演进路线与同事需要记住的重点

建议时长：1.5 分钟。证据状态：当前事实与未来阶段分别列示。

**本页重点：先让每个小目标可解释、可验证、可恢复，再扩大自动化授权范围**

最后收束到五个重点：第一，工单不是一个票号，跨项目、站点和运行要追溯完整身份；第二，当前分支配置快照与日志历史 VHAL 追溯不同；第三，未知不等于通过或缺少，停止条件必须有明确证据；第四，完整产物、最新运行门禁和独立外部操作账目共同保护恢复；第五，Loop 在 Harness 约束中完成小目标，而不是无限自我扩张。

未来按三个阶段独立验收。阶段一只做建议收集、去重、审核状态和后台可见性，合格建议可解释且没有越权执行；阶段二接人工确认后的隔离开发，检查任务合同、回归、预览和失败恢复，暂不自动上线；阶段三只在真实试点证明有效后开放预授权低风险自动发布，必须能暂停、追溯和回退。没有测量就不承诺自动化成功率。

会后讨论建议聚焦现有业务验收遗留，以及第一阶段的建议状态、可见范围和管理员审核方式，不立即把整个愿景当成一次开发任务。

依据：

- docs/REFACTOR_STATUS.md:39；定位：验证纪律
- AGENTS.md:41；定位：验证与完成

