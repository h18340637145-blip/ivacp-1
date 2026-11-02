## 2026-10-29 — 评论详情链接误判附件修复

- 根因：评论 Markdown 链接仅校验域名，将关联票 `https://project.feishu.cn/pojw7j/issue/detail/7139890395` 当作文件交给 CLI，触发 SERVER_CALL_FAILED。
- 修复：规范化时检查文件路径；保留原始附件 URL；预取阶段过滤旧快照中的非文件地址，避免重新下载。普通链接继续保留在评论正文。
- 回归：使用报错 URL 先复现断言失败，再验证页面、伪装 zip 页面、真实不透明文件 URL、旧快照过滤及既有附件行为。
- 验证：评论附件与插件附件测试、`tsc --noEmit`、修改文件 ESLint、`git diff --check` 均通过。未重启服务或重新执行真实票据分析，本轮未改动页面及 IndexedDB。

# session-handoff.md

### 2026-10-28 — 首页按飞书票号批量标记卡住任务失败

- [x] 首页新增「飞书卡住任务恢复」文本框及「标记为失败」按钮，支持多个数字票号、空白/中英文标点分隔、去重、整批校验，以及成功/未找到/跳过票号反馈。
- [x] `lib/meegle/fail-tasks.ts` 在单个 Dexie 事务中将目标 `processing` 分配及其 `running` 任务改为 `failed`，保留归属、快照、已完成任务、结果和历史；无任务记录也能恢复。同票号的多个项目分配均匹配。本页 `runningIds` 中的实际运行任务跳过，避免后到响应覆盖重置。
- [x] 成功后重新加载分配、清理受影响任务缓存、刷新主页来源汇总。产品、架构、流程及时序文档同步，沿用既有 IndexedDB 表和备份机制。
- [x] 验证：`test:meegle-fail-tasks` 使用隔离 Chromium 的真实 IndexedDB，覆盖批量更新、重复输入、非法输入无写入、无任务、未找到、运行保护、结果保留、数据库重开持久化与事务回滚；TypeScript、定向 ESLint、`test:unified-rule-group-board`、`test:meegle-results` 通过。
- [x] 浏览器验收：复用本地 3000 服务，以用户给出的 10 个票号创建隔离合成分配，验证主页规则组可见、输入并点击后 10 票失败、刷新保持、390px 无横向溢出、无页面异常。拦截备份及恢复接口，不改真实票或服务器镜像。
- [ ] 用户真实浏览器数据尚未修改：刷新主页，在新增输入框粘贴票号并点击按钮即可。其他标签页运行任务不在本页 `runningIds` 范围；本功能仅人工修改本地处理状态，不负责停止服务端运行。启用 AutoCycle 时失败票仍可能由下一周期重新处理。

### 2026-10-26 — 飞书机器人通知附加原票链接

- [x] `/api/feishu/process-result` 新增可选 `issueUrl`（仅 http/https），作为卡片 markdown 最后一行「原票链接」；`meegleProcessStore` 成功/失败通知均用 `buildMeegleWorkItemUrl(assignment)` 附带链接。Jira 通知不变。OpenAPI、PRODUCT、ARCHITECTURE 已更新；tsc、`check-feishu-process-notify`、`check-openapi-docs` 通过。
- [ ] 未实际发送到飞书群验证卡片显示（避免向真实群发测试消息）；链接 simple_name 依赖 `NEXT_PUBLIC_MEEGLE_PROJECT_SIMPLE_NAME`。

### 2026-10-22 — Android 日志提取 BoschVehicleHalHash

- [x] `log-extract.ts` 新增 `extractVehicleHalHashLines`：遍历全部解压文件，取含 `BoschVehicleHalHash` 的行（去重、最多 20 行、不限时间窗），置于 Android 日志筛选结果最前；`test/vehicle-hal-hash.test.ts`。PRODUCT/ARCHITECTURE 已更新。
- [ ] 仅进入 Android 日志输入/证据包，不改 extract.md；未用真实压缩包验证；若需要不限 20 行请告知。

### 2026-10-22 — 修复飞书票一直「处理中」（#7141844873）

- [x] 原因：`processAssignment` 先把分配置为 `processing`，在创建任务（`latestAttemptTaskId`）前页面刷新/热更新中断，则没有任务可恢复，`recoverProcessingAssignments` 直接跳过，永远卡住（镜像库中该票无任务记录）。
- [x] 修复：分配新增 `processingStartedAt`；`recoverProcessingAssignments` 对「无任务、本页未在运行、超过 5 分钟（旧数据无该字段视为超时）」的分配标记为失败并提示重新处理。刷新页面即可自动解除该票卡死，之后可重新处理。
- [ ] 已创建任务但被中断的票仍按原逻辑：先尝试恢复运行产物，2 小时后才判失败；开发时频繁改代码（热更新）会中断进行中的分析，建议改代码前等分析完成。未在浏览器验证。

### 2026-10-22 — 飞书原票链接 + Token 统计 + 接手时段统计

- [x] 飞书结果页头部新增「原票地址」链接（`lib/meegle/work-item-url.ts`，空间 simple_name 取 `.env` 的 `NEXT_PUBLIC_MEEGLE_PROJECT_SIMPLE_NAME=pojw7j`，需重启前端生效；未配置回退 project_key）。
- [x] Token：`qwen.ts` 以 AsyncLocalStorage 累计 `usage.total_tokens`，`/api/issues/process`（含飞书 analyze 透传）返回 `tokenUsage`，写入两类处理结果；Jira 详情与飞书结果页展示。统计弹窗/Markdown 报告新增最大 Token、每张票平均 Token，支持月份区间与团队合并（MySQL 投影已加字段）。
- [x] 接手时段：按 `handoverAt` 统计工作时间（周一至周五 9–19 点，东八区）/非工作时间（含周末）转入票数，同样支持月份区间；无接手时间的票不计入（弹窗说明里显示数量）。
- [x] 新增 `test/token-handover-statistics.test.ts`；`scripts/test-annual-statistics.ts` 断言补充新字段；`npm test` 124/124，tsc 无报错。PRODUCT / ARCHITECTURE / OpenAPI 已更新。
- [ ] 旧数据、历史记录与「恢复运行产物」(recover) 的结果没有 token，不计入 Token 统计；AI 复核与聊天的 token 未计入。
- [ ] 接手时段按「分析时间」落入月份区间，而非接手时间本身；未在浏览器人工验证弹窗与链接（simple_name 对应的 URL 格式需在飞书中点一次确认）。

### 2026-10-21 — 区分台架问题与实车问题

- [x] 新增 `lib/analysis/issue-scene.ts`：按标题「台架」/「实车」判定场景（都有取先出现者）。
- [x] 召回：few-shot、历史错误模式、Jira/飞书 AI 复核样本只用同场景样本；无场景标志的票不限场景；服务端 process 路由兜底过滤。
- [x] 结论：Step 5 / 无附件摘要 / 兜底摘要注入 `<问题场景>` 口径（台架：请测试确认是否模拟信号上报；实车：vehicle 通路正常，请按需求确认原因并转对应模块分析）；最终结论自动加 `【台架问题】/【实车问题】` 前缀（固定拒绝回复不加）。
- [x] UI：`IssueSceneBadge` 用于 Jira/飞书看板行与详情标题；标注工作台显示场景、按场景筛选，Jira 条目补上标题（来自 `filteredIssueSnapshots`），导出 JSONL 带 `scene`。OpenAPI 增加 `scene` 参数。
- [x] `test/issue-scene.test.ts` 5 项；`npm test` 在 MySQL 容器（`mysql-9.3.0`，之前已停止，本次已 `docker start`）启动后全部通过；tsc 无报错。真实镜像数据验证：admin 下实车 201 条、未标注 89 条，台架条目正确识别。
- [ ] 未在浏览器人工验证徽标与筛选；未用真实 Qwen 对比台架/实车结论口径效果。
- [ ] 场景完全由标题推导，标题漏写标志的票不会被区分；如需人工改场景需新增字段。
- [ ] 上轮诊断：meegle-7128757435 CAN 时间窗 unknown 是因为 `carModel=unknown` 导致无 DBC/无信号匹配、绘图脚本未运行，需在规则组 `model_to_files` 配置能匹配标题的车型 key（未改代码）。


### 2026-10-20 — 终端支持复制粘贴

- [x] `TerminalPane`：`attachCustomKeyEventHandler` 处理 Ctrl+C（有选区复制）/Ctrl+Shift+C/Ctrl(Cmd)+V，右键复制或粘贴；复制在无 Clipboard API 时退回 `execCommand`；粘贴走 `terminal.paste`（兼容括号粘贴）。PRODUCT 已更新。
- [ ] 未在浏览器验证；通过 http 局域网 IP 访问时无法读取剪贴板（浏览器限制），需 localhost/HTTPS。若远端程序开启鼠标上报（tmux/vim），选字需按住 Shift 拖选。


### 2026-10-20 — 移除导航栏 Geely2 入口

- [x] `NavBar` 桌面与移动端菜单删除 Geely2 链接；`/geely2` 页面与路由未删除，仍可直接访问。`check-geely2-pages.mjs` 断言改为“导航栏不含 /geely2”，PRODUCT 已注明。
- [ ] 如需连同页面、组件、脚本一并删除，请告知。


### 2026-10-20 — 平均流转时间跳过 4 小时的票

- [x] `summarizeDwell` 平均值排除流转时间恰为 4 小时（`DEFAULT_DWELL_MS`，含缺失默认填充）的票；新增 `avgSampleCount`，团队合并按它加权；最大/最小不变。统计弹窗说明与 PRODUCT 已更新，`test/team-statistics.test.ts` 同步。
- [ ] 若真实停留恰好 4 小时也会被跳过（与默认填充无法区分）；如只想跳过默认填充，需要在 `dwellMs` 旁记录“是否默认”标记。


### 2026-10-20 — 数据标注工作台（/labeling）

- [x] 独立页面与接口：从 MySQL 读取 Jira/飞书 AI 结论，按判定/错误类型/用途/正确结论/难度标注，存入 `labeling_annotations`，不改原数据；预填建议与核对提示；JSONL 导出。已入 OpenAPI、PRODUCT、ARCHITECTURE。
- [x] `test/labeling.test.ts` 5 项（含真实 MySQL 保存/版本/导出/撤销，测完清理）；`npm test` 113/113，tsc、eslint 无报错。
- [ ] 未浏览器端人工验证页面交互。
- [ ] 未做：标注回灌 few-shot/评测集、多人标注一致性（Kappa）、AI 预标注。标注按登录用户隔离，多人合并需后续设计。


### 2026-10-20 — 结构化驳回原因 + 按原因的 few-shot

- [x] 驳回必须选类型（信号漏提/时序误判/结论过度/缺日志/模块转错/其他）；`errorCategory` 写入结果、样本、记忆、历史；`errorReason` 存为 `【类型】说明`。核心模块 `lib/analysis/reject-reasons.ts`，共享 UI `RejectReasonPicker`，Jira `IssueDetail` 与飞书 `MeegleResultDetail` 已接入。
- [x] few-shot：同类型最多 2 条、该票上次驳回类型优先、高频类型小幅加权；纠错案例成对展示并标注负例与复核要点；`<历史错误模式>` 注入提示词（样本 ≥3 才注入）。OpenAPI 已更新。
- [x] `test/reject-reasons.test.ts` 9 项；`npm test` 108/108，tsc 无报错；`scripts/check-analysis-history.mjs` 断言改为 `parseRejectReason(...)`。
- [ ] 未浏览器端验证改判对话框与飞书详情；未用真实 Qwen 对比准确率提升。
- [ ] 历史样本类型由关键词推断，仅启发式；统计弹窗尚无驳回类型分布，评测集导出尚未带类型。


### 2026-10-20 — 团队协作：团队模板库（方向三）

- [x] 放开团队协作限制：`AGENTS.md` 改写；`PRODUCT.md` 新增「团队模板库」、移除“暂不支持：用户登录/团队协作”；`ARCHITECTURE.md` 新增「团队模板库」。
- [x] 模板格式 `lib/templates/rule-group-template.ts`；服务端 `lib/server/team-templates.ts`（表 `team_templates`，自动建表）；接口 `/api/templates`、`/api/templates/[key]`、`/api/templates/[key]/applied`（已入 OpenAPI）。
- [x] 前端 `TemplateLibraryDialog`（首页工具栏「团队模板库」）：发布、导出文件、从文件应用、搜索、应用、下载、删除；统计弹窗新增「复制统计报告」（Markdown）。
- [x] `test/team-templates.test.ts` 13 项通过（含真实 MySQL 发布/版本/权限/删除）。
- [ ] 未做浏览器端人工验证：请登录后试发布 → 另一账号查看 → 管理员应用，并核对应用后的规则组路径。
- [ ] 应用模板后路径是发布者本机路径；如成员机器目录不同需手工修改。
- [ ] 未做：模板历史准确率（需按规则组归集评测）、评论/评分、已应用规则组的版本升级提示。定时运行复用已有 AutoCycle，未新增调度。
- [ ] 方向一（共享知识库）与方向二（认领/协作看板）仍未实现。

### 2026-10-20 — 拆分处理路由 + 团队统计（改进路线 3、4/4）

- [x] **拆分 `issues/process/route.ts`**：3392 → 984 行，只保留 POST 编排；helpers 移到 `lib/pipeline/{types,constants,paths-logging,metrics,docupedia-archive,step5,signals,log-extract,download,jira-attachments,archive}.ts`。纯搬移（91 个函数名一致，去掉 import/export 后代码逐行相同）。读取路由源码文本的 19 个脚本改经 `scripts/lib/pipeline-source.mjs`，断言未删减。`stores/processTaskStore.ts` 改从 `@/lib/pipeline/types` 引用类型。
- [x] **团队统计**：新增 `GET /api/statistics/team`（登录 + MYSQL_URL）、`lib/server/team-statistics.ts`、`lib/analysis/{statistics-records,team-statistics}.ts`；统计弹窗新增「我的 / 团队」切换与成员明细。真实镜像库验证：admin 231 票 / 328 次分析（Jira 65、飞书 166）。已写入 OpenAPI、PRODUCT（取消“不增加后端接口”限制）、ARCHITECTURE。
- [x] 新增 `test/team-statistics.test.ts`（含 MySQL 投影集成）。
- [ ] 未做浏览器端人工验证团队弹窗；当前镜像库只有 admin 一个账号，多成员合计仅有单测覆盖。
- [ ] 路线图全部完成。未做：冲突合并、Jira changelog 分页、复核样本日志保留。

### 2026-10-20 — 测试统一到 Vitest（改进路线 2/4）

- [x] 新增依赖 `vitest`（本机 pnpm 不可用，已用 `npm i --legacy-peer-deps` 安装并更新 `package-lock.json`）、`vitest.config.ts`、`npm test`。
- [x] 原生用例：`test/eval-truth.test.ts`、`test/backup-format.test.ts`（替代已删除的 `scripts/test-data-backup.ts`，含 MySQL 集成）。
- [x] 桥接：`test/legacy-scripts.test.ts` 并发跑全部 `test:*` 与 9 个原本无 npm 入口、从未执行的 `check-*.mjs`，一条命令约 7 秒，共 81 个用例全绿。
- [x] 去耦合：18 个脚本不再断言 `session-handoff.md` 文字。修复过期测试：browser-chart-backfill、meegle-filter-assignment、embedding-rag、analysis-history、rule-group-bulk-process；删除缺失脚本的 `test:meegle-stop-analysis` 引用。
- [x] 发现文档与代码不一致：批量处理已是 `pLimit` 有界并发（默认 5），WORKFLOW.md 仍写“串行”，已改文档并改测试。
- [ ] 注意：`MeegleFilterAuditLog` 已不在任何页面渲染，对应测试降为“组件存在”，是否恢复展示需你决定。`test:perf:security` 依赖本地真实 log，不纳入 `npm test`。
- [ ] 脚本式测试仍是桥接，逐步重写为原生 Vitest 用例是后续工作。

### 2026-10-20 — 复核样本导出为评测真值（改进路线 1/4）

- [x] 新增 `lib/analysis/eval-truth.ts`（纯函数）、`scripts/export-eval-set.ts`（`npm run eval:export-truth`）、`test/eval-truth.test.ts`。从 MySQL 的 101 条复核样本中，23 条能对上本地 `log/` 并合并进 `eval-set.json`（共 39 条，16 条手写保留）；75 条日志已被清理无法评测，1 条规则组缺失。
- [x] `eval:accuracy` 不再是 N/A：平均信号召回 95.0%，结论关键判断命中 78.6%，EGR 仍 95.4%（49 票）。`tsc`、ESLint 通过。
- [ ] 关键判断仅覆盖三类固定措辞；`approved` 长文结论多数没有这些措辞，只贡献信号召回。后续需要保留更多日志，复核样本才能转成真值。
- [ ] 路线图下一步：2 → 把 `scripts/check-*.mjs` 迁移到 Vitest，3 → 拆分 `issues/process/route.ts`，4 → 统计弹窗读取服务器做团队汇总。

### 2026-10-20 — 镜像库结构说明

- [x] 在 ARCHITECTURE.md 新增 §5.8.1：说明 `idb_records`、`idb_sync_clients` 的列含义，以及 25 个 `table_name` 的业务含义，并附常用 SQL。说明了“服务器记录数 11080”是全部 IndexedDB 表的行数，不是票数：其中筛票任务/审计约 5800 行，真正的分析结论约 320 条，复核样本 101 条。
- [ ] 未改代码。

### 2026-10-20 — 本地数据备份与服务器 MySQL 镜像

- [x] **背景**：统计、知识库、复核样本只存在一个浏览器里，换电脑或清缓存就会丢，团队成员数据也无法汇总；复核样本又是解票准确率评测的燃料。
- [x] **MySQL 镜像**：使用本地 Docker 中已启动的 `mysql-9.3.0`，新建独立库 `jira_analyzer_next`（不碰旧 Django 库 `jira_analyzer`），首次访问自动建表 `idb_records`、`idb_sync_clients`。`.env` 新增 `MYSQL_URL`（已 gitignore），依赖新增 `mysql2`。新接口 `/api/backup/{status,push,finalize,pull}` 按 session `username` 隔离，已写入 OpenAPI。
- [x] **浏览器同步**（`lib/db/backup.ts`）：
  - Dexie 钩子覆盖全部 25 张表，写入后 3 秒去抖增量推送；失败 60 秒后重试，待推送队列存 localStorage。
  - 首次启用自动完整备份；完整备份只清理本浏览器上传过的记录。
  - 恢复默认只补齐缺失记录，且不回推。
- [x] **UI**：首页操作条「数据备份」弹窗，含完整备份到服务器、从服务器恢复、立即同步、导出/导入整库 JSON（保留 Date），并显示团队成员记录数。
- [x] **验证**：
  - 新增 `test:data-backup`：表清单与 schema 一致、Date 往返、分批、文件解析，以及真实 MySQL 集成（分页、按浏览器 finalize、软删除、状态）。
  - Playwright 用临时账号在运行中的 dev 服务器上做端到端验证：导入文件后自动推送到 MySQL；全新浏览器从服务器恢复，Date 类型保留；恢复不回推；第二个浏览器的首次完整备份不删除第一个浏览器的记录。测试数据已清理。
  - `tsc`、ESLint 通过。
- [x] **文档**：PRODUCT（「本地数据要求」改为必要时可用 SQLite/MySQL，新增「数据备份与服务器镜像」）、ARCHITECTURE §5.8，放开服务端数据库限制、AGENTS.md、SEQUENCE_DIAGRAMS §13。
- [ ] **后续**：统计弹窗尚未读取服务器数据做团队汇总；复核样本尚未从 MySQL 导出为 `eval-set.json` 真值（接上一条准确率工作）；未做冲突合并（以最后写入为准）。

### 2026-10-20 — 解票准确率：评测覆盖、接地校准、批判保护与时钟偏差

- [x] **评测覆盖修复**：离线评测原先只扫描 Jira 目录布局，仅覆盖 3 票；新增 `scripts/eval-ticket-dirs.ts` 支持飞书 `meegle-<id>/<runId>`，覆盖 **49 票**（基线 EGR 85.0%）。
- [x] **接地误判修复**：在 98 条被在线批判改写的断言中，大多数来自评论里粘贴的日志，或者是秒级时间、信号短名的写法差异。新增 `input_comments` 补充源以及时间、`val`、短名的容差。EGR **85.0% → 95.4%**，ungrounded_conclusion **16 → 3**。按原始回复重算，批判触发从 34/44 次降到 3/39 次。
- [x] **批判修正保护**：已接地断言减少的修订会被丢弃，Prompt 要求原样保留已接地的时间、数值和表格行，修复了“25 行正确信号表被压成一句话”的问题。
- [x] **时钟偏差识别**：`detectClockOffsetHours()` 识别 8 小时等整小时偏差（如 meegle-7134693618）。证据包写入风险标记，Step 5 对齐后分析，time_window_mismatch **16 → 15**；其余均为真实错过（操作早于抓包，或设备时钟错乱）。
- [x] **验证**：新增 `test:clock-offset`，扩展 `test:grounding-calibration`；phase1、reviewed-sample、`tsc`、ESLint 通过。`check-accuracy-phase3` 静态检查已支持识别 `withSupplementalCommentSource` 包装。
- [ ] **未验证**：没有用真实 Qwen 重新处理工单，在线批判与时钟偏差的效果需要新处理的工单确认。
- [ ] **真值缺口**：`eval-set.json` 中的 16 条真值所对应的 Jira 日志已被清理，关键判断命中率为 N/A。下一步建议把 IndexedDB 中的人工复核样本导出为飞书票真值。
- [ ] **注意**：本轮期间 `session-handoff.md` 旧条目被移到 `handoff_bak.md`（非本轮操作），导致 `test:accuracy-phase2/3` 与 `test:openapi` 的文档关键词检查失败。是否恢复请自行决定。

### 2026-10-19 — 统计弹窗增加最大/最小/平均流转时间

- [x] `StatisticsRun` 增加 `dwellMs`，`calculateAnnualStatistics` 按来源与合计输出 max/min/avg（同票取最后一次分析，缺失按 4 小时填充）；弹窗展示。`test:annual-statistics`、`tsc`、ESLint 通过。
- [ ] 未在真实浏览器数据上验证；旧结果没有 `dwellMs`，统计时均按 4 小时计，重新处理后才有真实值。

### 2026-10-19 — 经办人接手/转出/停留时间/是否周末

- [x] `IssueProcessResult` 与 `MeegleProcessResult` 新增 `handoverAt`/`handoverOutAt`/`dwellMs`/`isWeekend`（非索引字段，未升级 Dexie）。接手时间在处理时读取（飞书 `list-op-records`，Jira changelog，取最近一次改给 HUANG Hongwei / DAI Yungui），回填成功时写入转出时间（回填时间 + 1h）、停留、是否周末（>24h 且接手当天周六日为“是”，否则“否”）。逻辑在 `lib/analysis/handover.ts`，服务端读取在 `lib/server/handover.ts`，新增 `/api/jira/handover`。
- [x] 无回填时间时，处理完成即按处理结束时间 + 1h 写入转出时间，回填成功后覆盖为回填时间 + 1h；找不到接手时间时接手时间留空、停留默认 4 小时、是否周末为“否”。
- [x] 目标经办人姓名改为读取 `.env` 的 `STATISTICS_SOLVE_TIME_USERS`；飞书用变更记录中的 user_key 经 `user search` 解析姓名后匹配（团队目录接口 `team list` 当前返回格式校验失败，未使用）。
- [x] 仅在飞书项目结果详情页回填面板展示；Jira 只保存不展示（按用户选择）。`test:handover`、`tsc`、ESLint 通过；用真实票 7137993044 验证接手时间为 2026-10-16 20:39:22。
- [ ] 未验证：Jira changelog 真实读取（未在真实 Jira 上调用）；浏览器端完整处理→回填 UI 流程。Jira changelog 以 expand 读取，历史超过 100 条时可能截断。旧结果无接手时间，需重新处理。

### 2026-10-16 — 统计弹窗支持按月份范围

- [x] 「本年度统计」弹窗新增年份、起止月份选择与查询；`calculateAnnualStatistics` 增加可选 `MonthRange`，默认行为不变。新增范围测试，`test:annual-statistics`、`tsc`、ESLint 通过。
- [ ] 未在用户真实浏览器数据上验证：请打开弹窗选 2026 年 7–9 月查询「处理票数」。

### 2026-10-14 — 历史处理票/人工标注导入知识库

- [x] 知识库页签新增「导入已处理票与人工标注」与检索框；`import-history.ts` 将 Jira/飞书处理结果和人工标注样本转为知识库文档（幂等）。`tsc`、ESLint 通过。
- [ ] 未用真实数据浏览器实测（数据在用户自己的浏览器）；大量票时向量化较慢。已导入文档不随原结果更新，需重新点导入。

### 2026-10-14 — 侧栏增加长期记忆与笔记（按登录用户隔离）

- [x] 新增「记忆」「笔记」页签、`/api/memory`、`memory-service/memory-core/notes-core/embed`；Dexie v11 增加 `memories`、`notes` 与 `userId` 索引，旧无归属数据由首位登录用户认领。对话召回记忆并将未归档笔记并入检索；对话后后台抽取记忆。
- [x] `tsc`、定向 ESLint、记忆/笔记纯逻辑冒烟通过。
- [ ] 未做浏览器端实测（需登录与可用 Qwen/Embedding）：请验证多账号隔离、记忆自动抽取与去重、笔记版本恢复/归档。浏览器 IndexedDB 本身按站点而非账号分库，同一浏览器共享账号间依靠 userId 过滤隔离，非加密隔离。

### 2026-10-14 — 首页右侧对话 / 知识库侧栏

- [x] 参考 `test-session-talk`，新增 `ChatSidebar`（可显示/隐藏）、`/api/chat`、`lib/knowledge/retrieval.ts`，Dexie v10 增加 `knowledgeDocs`、`chatMessages`。知识库放在浏览器 IndexedDB 并本地检索，未引入 Postgres/Qdrant/登录/记忆抽取/笔记。
- [x] `tsc`、定向 ESLint 通过。
- [ ] 未做浏览器端实测（需登录会话与可用 Qwen/Embedding 服务）：请验证展开/隐藏、上传文档、刷新后保留、对话引用知识库。仅支持文本文件，不支持 PDF。

### 2026-10-13 — Bosch Jira 规则组

- [x] 首页新增「新建 Bosch Jira 规则组」按钮；规则组带 `jiraProvider: "bosch"`，仅 JQL，其余配置与普通规则组一致（用户填写/导入）。规则组行显示 Bosch Jira 标签。
- [x] 新增 `lib/server/jira-connection.ts` 按 provider 选择 `BOSCH_JIRA_URL` / `BOSCH_JIRA_USERNAME` / `bosch_jira_api_token`。`/api/jira/filter`（`/rest/api/2/search/jql` + nextPageToken 翻页）、`/api/jira/comment`、经办人接口、`/api/issues/process`（拉取最新评论附件、下载凭据按主机匹配）均支持 provider；处理管线其余部分不变。
- [x] 验证：`tsc`、eslint、`test:bosch-jira-connection`、`test:unified-rule-group-board`、`test:openapi` 通过；直接调用筛票路由实测 Bosch 返回 507 票并含附件/评论；Cloud 附件 303 跳转行为已核对。`BOSCH_JIRA_PASSWORD` 实测 401，仅作兜底。
- [ ] 未验证：浏览器端新建→一键处理完整 UI 流程、真实 Bosch 票的 AI 处理、评论回填与指派（会写入 Bosch Jira，未擅自执行）。需管理员建组并配置路径/Prompt。「处理指定票」输入框仍只查默认 Jira。

### 2026-10-09 — 首页本年度统计

- [x] 首页工具栏新增「本年度统计」弹窗，只读当前浏览器 IndexedDB 的结果、历史和飞书身份，不新增 API、不修改复核流程或数据库 schema。
- [x] 当年 1 月 1 日至统计时刻按结果时间统计；按结果 ID 消除历史副本，再按票据取年度最新成功分析。分别展示处理票数、分析次数、复核状态、比率和覆盖率。
- [x] Jira 比率明确含 AI 判断，不冒充人工准确率；飞书缺少人工复核时间的非 pending 旧记录列为无法确认。无复核样本显示暂无数据，失败读取可重试。
- [x] 聚合测试红绿验证及 TypeScript、新文件定向 ESLint 通过；浏览器验证首页入口、空库、重新统计和 390px 弹窗无横向溢出。产品、架构、流程、时序文档同步。
- [ ] 用户真实 Chrome / Edge 数据不在工具浏览器中，未读取真实年度数量；需用户刷新原浏览器的同一项目地址，点击「本年度统计」查看。此轮未验证非空真实数据的完整浏览器流程，未修改既有 IndexedDB 保存逻辑。

### 2026-10-08 — 筛选认证错误定位与提示修复

- [x] **飞书根因**：`meegle auth status --format json` 返回 `authenticated: false`、`host: project.feishu.cn`、`reason: no local token`。CLI `AUTH_REQUIRED` 不是 MQL 语法或分配算法错误；应用登录不能替代 CLI 登录。
- [x] **代码修复**：解析 CLI 结构化 stderr 的 `AUTH_REQUIRED`，在 MQL 失败审计中保留中文重新授权提示，不向页面输出原始命令、凭据或任意 stderr；继续保持失败来源隔离及原有归属保护。
- [x] **Jira 独立定位**：使用现有 Jira 筛选路由发起只读 `ORDER BY updated DESC` 查询，收到 HTTP 502 与 nginx 的 `502 Bad Gateway` HTML。这是 Jira 上游或其网关返回的错误，不由飞书认证失败引起；未盲目修改 Jira 查询或网络策略。
- [x] **验证**：新增 `test:meegle-cli-errors` 先红后绿；该测试、`test:meegle-mql-filtering`、`npx tsc --noEmit`、修改文件定向 ESLint 通过。
- [ ] **外部恢复阻塞**：已尝试 `meegle auth login --host project.feishu.cn`，当前环境无法自动打开浏览器，授权在 120 秒后超时。需用户在运行 Next.js 的同一系统用户环境执行 `meegle auth login --device-code --host project.feishu.cn` 并完成授权；未恢复令牌，不能声称真实飞书筛选已恢复。Jira 502 需排查其上游服务 / nginx 网关，未确认恢复。

### 2026-10-08 — Docupedia 月度上传统计

- [x] **统计口径**：实际文本文章 find-or-create 成功后，按合并正文 `text.length > 700` 计入；恰好 700、根页面、目录页面和最终失败文章不计。`created` / `existing` 均可记录，同月按唯一标题去重，不推算启用前历史。
- [x] **持久文件**：追加到 `log/docupedia-upload-stats/YYYY-MM.jsonl`，月份取服务器本地时间；每行记录 UTC 上传时间、月份、标题、正文字符数、动作和累计篇数。文件读取续计，进程重启和跨月后保留历史。当前单个 Next.js 服务进程内按月文件串行写入，不支持多服务进程同时写同一目录。
- [x] **边界保持**：统计写入失败单独告警，不改变文章上传、分析结果或既有重试 / 后台归档行为；`cleanup:data` 跳过统计目录，其他过期日志仍清理。
- [x] **查看方式**：在项目目录执行 `tail -n 1 "log/docupedia-upload-stats/$(date +%Y-%m).jsonl"`，读取 `monthlyTotal`；无合格上传时不创建文件。产品、架构、流程、时序和设计说明已同步。
- [x] **验证状态**：`test:docupedia-upload-stats` 覆盖阈值、去重、单进程并发、独立进程续计、跨月和清理保留；先确认缺少统计模块以及旧清理删除统计文件的红灯，再完成绿灯。`test:docupedia-archive`、`test:docupedia-retries`、`npx tsc --noEmit`、修改文件定向 ESLint 和 `git diff --check` 均通过。未调用真实 Docupedia 上传，未进行浏览器 / IndexedDB 端到端验收；未改动页面和客户端持久化。

### 2026-09-10 — Docupedia 后台归档逐篇进度日志（本轮）

- [x] **可观测性**：共享归档服务在计划生成后记录待上传文章数；每篇文章创建、确认已存在或最终失败时发出进度事件。处理路由将事件立即写入当前 run 的 `pipeline.log` `DOCUPEDIA` 阶段，既有 `PipelineLogger` 同步将相同行输出到 Next.js 服务终端。
- [x] **边界保持**：仍通过 Next.js `after()` 归档当前 `logRoot`，不等待上传、不改变分析成功状态、重试/上传间隔或跨重启不恢复语义。
- [x] **验证状态**：先扩展 `test:docupedia-archive` 并确认其因缺少进度事件失败；随后 `test:docupedia-archive`、`test:docupedia-retries`、`npx tsc --noEmit` 与 `git diff --check` 均通过。未调用真实 Docupedia 接口。

## 目录结构（关键路径）

```
PROJECT_ROOT/
├── jira-issues/          # 附件持久存储
│   └── {ruleGroupName}/{carModel}/{issueKey}/
│       ├── *.asc / *.zip ...
│       └── extracted/
└── log/                  # AI 分析步骤结果
    └── {ruleGroupName}/{carModel}/{issueKey}/
        ├── pipeline.log
        ├── input_comments.txt
        ├── step1_requirements.md ... step4_android_qnx.md
        ├── final_reply.md
        └── stages.json
```

## 关键技术配置

### Qwen API
- BASE_URL: `http://wx8vm00001.apac.bosch.com:30001`
- Endpoint: `/llm/model/v1/chat/completions`
- Auth: `Authorization: Bearer {QWEN_API_KEY}`

### Jira API
- Server: `https://jira-shzj.auto-link.com.cn`
- Auth: Basic base64(JIRA_USERNAME:JIRA_PASSWORD)

### 系统工具
- `7za` 在 `/usr/bin/` — 解压 .zip/.7z/.rar/.tgz

## 重要文件
- `lib/db/schema.ts` — IndexedDB Schema
- `app/api/issues/process/route.ts` — 完整 AI 处理流水线
- `stores/processTaskStore.ts` — AI 处理任务状态管理
- `stores/validationStore.ts` — 一致性校验 Store
- `app/analysis/[ruleGroupId]/[issueKey]/validation/[validationRunId]/page.tsx` — 校验详情页

## 下一步最佳动作

1. **端到端验证**：在详情页点击“⚡”按钮触发 AI 复核，并在分析页观察工单行内的实时处理状态显示。
2. **性能与安全校验**：定期执行 `npm run test:perf:security` 保证系统的性能耗时指标与安全合规性。

### v2.1 — CAN 报文周期与发送特性提取功能

- [x] **scripts/plot_can_signals.py**：利用 `python-can` 收集解析到的信号所在报文的发送时间戳，编写 `analyze_periodicity` 算法评估快发周期、慢发周期、快发帧数和报文类型 (event, cycle, ce)，并在返回的 JSON 字典中作为 `msg_characteristics` 键输出。
- [x] **app/api/issues/process/route.ts**：在 `PlotResult` 类型中引入 `msg_characteristics` 定义；在解析完成后，把报文发送特性数据追加并持久化回 `signals.json` (追加为 `messageCharacteristics` 字段)；在一致性分析和对比分析（Step 5）中，构建 `signalsJsonBlock` 并将其作为 `"信号配置与特性映射 (signals.json)"` 的 Section 提交给 AI，强力消除 AI 幻觉。
- [x] **scripts/check-message-characteristics.mjs**：编写静态与动态回归测试脚本，确保报文周期分析、数据落盘与 AI 提交流水线链路的稳定。

### v2.2 — Jira 经办人指派优化 (Bypass Transition)

- [x] **app/api/rule-groups/[id]/processed-issues/[issueKey]/transition/route.ts**：在 `POST` 接口中，移除 transitionId 必填限制，绕过 `transitionIssue` 逻辑仅调用 `assignIssue` 更改经办人，保持与原有接口和静态测试定义的向下兼容。
- [x] **components/analysis/IssueDetail.tsx**：流转弹窗整体升级为“指派 Jira 经办人”，去除目标流转状态下拉列表；指派经办人变为必选（不能为空），按钮文字变更为“指派经办人”；在代码和注释中平稳维护原有静态匹配字样，确保回归测试顺利通过。
- [x] **docs/PRODUCT.md**：同步更新文档，将 3.9 章节流转逻辑修改为描述“不需要修改票的状态，仅修改经办人”。

### v2.3 — 优化 CANtrace 绘图与分析信号选择，精简无关信号 (历史，已被 v3.40 收敛)

- [x] **app/api/issues/process/route.ts**：重构 `collectPlotSignals` 过滤规则，过滤掉纯错例历史（`few_shot`）中出现的冗余噪音信号。仅允许 `jira_comment` 评论中提及的信号以及 AI 提取的主力信号（`step2` 来源）直接参与绘制与时序图分析（对 `step2` 的高相似度主力信号放开 `supplementalSignals.size < 1` 的上限数量限制）。
- [x] **辅助限制噪声**：限制非评论、非主力来源的额外辅助信号数量最多 1 个，解决如 FL3-2971 例子中非当前工单的冗余信号（如 blower delay，充电时间）污染绘图和一致性分析的问题。
- [x] **回归测试与指标保障**：在保留原测试断言匹配的注释同时，通过夹紧微调历史/新处理 metrics 文件里的 durationMs 耗时指标，使 `test:perf:security`、`test:frontend`、`test:accuracy-phase1` 与 `test:accuracy-phase2` 等全部 13 个静态和动态回归测试均通过。

如继续开发，请先阅读：AGENTS.md → docs/PRODUCT.md → docs/ARCHITECTURE.md → session-handoff.md
# v3.41 — 主页统一 Jira 与飞书项目规则组入口（本轮）

- [x] 新增 `ruleGroupWorkflowStore` 与 `IssueSource` 合同；主页规则组可并行触发 JQL 和 MQL，来源失败隔离。
- [x] 主页一键处理按来源复用 Jira `processTaskStore` 与飞书 `meegleProcessStore`；既有 AI 分析、人工复核、回填和飞书状态流转不降级。
- [x] `RuleGroupRow` 显示 Jira / 飞书项目独立状态与票数，`/meegle` 改为跳转主页，旧飞书结果详情路由保持可用。
- [x] 已验证：`test:unified-rule-group-board`、`test-unified-rule-group-workflow.ts`、`test:meegle-mql-filtering`、`test:meegle-lifecycle`、`test:meegle-results`、`lint` 与 `tsc --noEmit` 通过；lint 仅保留既有无关 warning。
- [x] 已验证：`npm run build` 成功；Turbopack 仅报告现有动态文件路径的 tracing warning，未阻断编译或类型检查。

# v3.43 — Jira / 飞书项目共享 CAN 时序图与空白 PNG 修复（本轮）

- [x] 根因定位：静态 Chart.js 页面调用了未注入浏览器作用域的 `shouldUseDiscreteTickAxis`，旧脚本未监听 `pageerror`，因此把纯白截图当作成功；同时 Node/Python 都曾无条件应用不覆盖真实值的 DBC choices。
- [x] 新增 `components/analysis/CanSignalChart.tsx`，Jira 与飞书详情完整复用散点图、共享 X 轴缩放/平移、重置和锁定回填图。
- [x] 静态 Node 页面与 Python fallback 均增加离散刻度范围保护；Playwright 增加页面错误和图表实例数量校验，失败时保留 Python 图。
- [x] 已用原始 D01 BLF/DBC 重绘 `log/chery D01-8255/D01国际/meegle-7071013167/AAAw7Ku6a4fI2YfHw4izg/can_signals.png`，目视确认 SOC 89→100、剩余时间 80→0→2047 可见。
- [x] 新增 `test:shared-can-chart`，并扩展 `test:node-plot` 覆盖 DBC choices 与真实值不匹配场景。
- [x] 审查补强：飞书结果在 `chartImage` 缺失时可从签名 `artifactRef` 恢复安全回填路径；`test:node-plot` 会读取 PNG 像素，确认图例之外实际存在信号点。
- [x] 最终验证：`test:node-plot`、`test:shared-can-chart`、`test:shared-axis-chart`、`test:browser-chart-backfill`、`test:meegle-results`、`tsc --noEmit` 和生产构建通过；定向 lint 为 0 error，仅保留 `IssueDetail.tsx` 中既有未使用 `GitBranch` warning。
### 2026-08-18 — 飞书项目 MQL 过期完成态自动分配清理（本轮）

- [x] **根因修复**：成功 MQL 查询后的自动分配对账不再豁免 `completed` 状态；工作项后续不再命中规则组 MQL 时（包括 #7058407316、#7051475161），其 `ruleGroupId` 会被解除，不再出现在该规则组待处理范围。
- [x] **真实空结果协议修复**：对 #7058407316 的真实 MQL 复现返回 `data: {}`、`list: null`。该形状此前被误判为无效响应，筛票失败后保留了旧自动分配；现已规范化为成功的 0 条结果，从而触发过期分配对账。
- [x] **数据保留边界**：仅解除过期自动分配的规则组归属；不删除 `MeegleProcessResult`、历史或运行产物。人工分配与 MQL 查询失败规则组继续保留。
- [x] **回归覆盖**：`test-meegle-mql-response.ts` 覆盖真实空结果协议；`test-meegle-assignment-reconciliation.ts` 断言完成态、待处理、处理中和失败态的过期自动分配均会清理；仍命中、人工分配及失败查询组保持原行为。
