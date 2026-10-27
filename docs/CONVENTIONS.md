# IVACP 重构约定（所有移植任务必须遵守）

背景：把参考项目 `/home/huo2wx/project/nextjs/app`（旧系统，Jira/飞书项目工单 AI 分析平台）完整重构到
`/home/huo2wx/project/nextjs/ivacp/ivacp`（新系统）。**保留全部功能点**，结构更可复用、易理解，UI 按新设计系统重做。
Geely2 功能已删除（不要移植 app/geely2、components/geely2、/api/geely2）。

## 环境
- 运行 npm/node/npx 前必须 `source ~/.bashrc`；当前非交互环境还需 `export PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH`，避免旧 Node 与 npm 混用。
- 装包：`npm i --legacy-peer-deps <pkg>`（尽量不新增依赖）。
- 类型检查：`npx tsc --noEmit -p .`；测试：`npx vitest run test/<file>.test.ts`（只用 Vitest）。
- 不要运行 `next build` / `next dev`（由主控统一执行，避免并发冲突）。
- 不要 import `server-only`（未安装）。不要打印 .env 内容。
- 工作区保留 Copilot 的大量未提交迁移代码；避免覆盖无关改动。全局检查若失败，区分当前改动与基线问题并记录证据。

## 目录分层（eslint 强制）
```
src/
  domain/            纯 TS（前后端共用）：实体、规则、算法。禁止 import react/next/@/server/@/features/@/shared/db
    entities.ts      ★ 统一实体与表注册（唯一数据结构来源）
    analysis/ meegle/ issue-source/ templates/ labeling/ knowledge/ terminal/ auth/ storage/ migration/
  shared/            客户端基础设施，禁止 import features / server
    ui/              UI 组件库（见下），统一从 "@/shared/ui" 导入
    lib/             api.ts(apiFetch/ApiError) errors.ts(errorMessage) format.ts(formatDateTime…) concurrency.ts(createLimiter, CLIENT_CONCURRENCY, sleep) ids.ts(newId) cn.ts
    hooks/           use-async.ts(useAsync) use-action.ts(useAction)
    db/              database.ts(db: IvacpDB Dexie) sync.ts(镜像同步、writeTables、downloadBlob…)
  features/<domain>/ 客户端功能模块：components/、store.ts（zustand）、services（调用 /api 的函数）。禁止 import @/server
  server/            仅 Node：db/(mysql.ts getPool, mirror.ts) http/route.ts auth/session.ts 以及各领域服务端逻辑
  app/               Next.js 路由，只做组装（page 组件很薄，逻辑放 features）
    (app)/           带侧栏外壳的页面；(app)/_shell 为外壳
    (auth)/login
    api/**/route.ts  API 路由
```
旧 → 新 路径映射：
- `@/lib/db/schema` → `@/domain/entities`（类型）+ `@/shared/db/database`（db 实例）
- `@/lib/analysis/*`、`@/lib/meegle/*`（纯函数部分）→ `@/domain/analysis/*`、`@/domain/meegle/*`（已移植，可直接用）
- `@/lib/issue-source/contracts` → `@/domain/issue-source/contracts`；`@/lib/templates/*` → `@/domain/templates/*`；`@/lib/labeling/schema` → `@/domain/labeling/schema`；`@/lib/knowledge/{memory-core,notes-core,retrieval}` → `@/domain/knowledge/*`；`@/lib/terminal/{command-guard,types}` → `@/domain/terminal/*`
- `@/lib/server/*`、`@/lib/pipeline/*` → `@/server/<领域>/*`（由各任务移植）
- `@/lib/auth/session` → 服务端 `@/server/auth/session`；角色/会话类型 `@/domain/auth/permissions`；客户端 `useSession()` from `@/features/auth/session-store`
- `@/lib/server/mysql-mirror` → `@/server/db/mysql`（getPool, isMysqlConfigured）+ `@/server/db/mirror`
- `@/lib/db/backup-format` → `@/domain/storage/backup-format` + `@/domain/storage/serialization`
- stores/* → `src/features/<domain>/store.ts`
- components/ui/* → `@/shared/ui`（新组件库，API 不同，见下）

## 统一实体模型（src/domain/entities.ts，务必先读）
旧版 Jira / 飞书各一套表，新版合并为带 `source: "jira" | "meegle"` 的单表：

| 新表 (db.xxx) | 旧表 |
|---|---|
| ruleGroups | ruleGroups（结构不变） |
| autoCycles（主键 ruleGroupId） | autoCycleStates |
| filterRuns（query=JQL/MQL） | filterTasks + meegleFilterTasks |
| snapshots（origin: "filter"/"process"，title=summary/工作项名） | filteredIssueSnapshots + meegleFilteredIssueSnapshots + meegleIssueSnapshots |
| assignments | meegleAssignments |
| filterAudits | meegleFilterAudits |
| processTasks | issueProcessTasks + meegleProcessTasks |
| processResults（commentStatus 取代 hasCommentedToJira） | issueProcessResults + meegleProcessResults |
| analysisHistories | issueAnalysisHistories + meegleAnalysisHistories |
| validationRuns / validationChecks | issue*/meegle* ValidationRuns/Checks |
| reviewSamples | issueReviewSamples |
| learningMemories / knowledgeDocs / chatMessages / memories / notes | 同名 |

关键规则：
- `ticketKey`：Jira = issueKey（`ABC-123`）；飞书 = `String(workItemId)`。飞书 reviewSamples.ticketKey 与 learningMemories.memoryKey 也用 `String(workItemId)`（旧版 `meegle-{project}-{type}-{id}` 已由迁移转换）。
- Jira 处理结果必须写 `ruleGroupId`、`snapshotId`、`source:"jira"`、`commentStatus`（回填成功 = "succeeded"）、`transitionStatus`（默认 "not_selected"）。
- 归档历史用 `createAnalysisHistory(task, result)`（`@/domain/meegle/lifecycle`，两个来源通用）。
- 索引见 `src/shared/db/database.ts` 的 `DB_SCHEMA_V1`，例如 `db.processResults.where("[source+ticketKey]").equals(["jira", key])`、`where("[ruleGroupId+source]")`。不要新增 Dexie 版本，确需索引时告诉主控。
- 时间字段统一 `Date`。

## API 约定
- **路径与请求/响应载荷保持与旧系统兼容**（旧客户端/脚本/外部调用依赖它们），除非字段涉及上面的统一模型（如客户端发送的结果 id）。
- 路由写法：
```ts
import { z } from "zod";
import { json, parseJson, parseQuery, requireSession, route, badRequest, notFound, HttpError } from "@/server/http/route";
export const runtime = "nodejs";
const schema = z.object({ ... });
export const POST = route(async (request, { params }) => {
  const session = requireSession(request);          // 需要管理员：requireSession(request, "admin")
  const body = await parseJson(request, schema);    // 校验失败自动 400 { error }
  if (!x) throw badRequest("中文错误信息");
  return json({ ... });
}, "默认中文错误信息");
```
- 错误统一 `{ error: "中文消息" }`；流式（SSE/NDJSON）接口可直接返回 `new Response(stream)`，但仍包在 route() 里。
- zod 为 v4（`z.iso.datetime()`、`z.coerce.number()` 等）。
- 鉴权由 `src/proxy.ts` 统一拦截（未登录 401 / 页面重定向）；路由内需要用户名时调用 `requireSession`。
- 服务端数据库：`getPool()`（新库 ivacp，首次自动建表）。镜像表 `sync_records(owner, table_name, record_id, data JSON 序列化, deleted, source, rule_group_id, ticket_key, record_created_at, …)`，table_name 为新表名（processResults 等）。跨账号读：`readTableRows(table, { owner?, columns? })`（`@/server/db/mirror`）。data 中 Date 编码为 `{"$date": iso}`，用 `deserializeRecord` 还原。
- 旧 `idb_records` / `idb_sync_clients` 表名已改为 `sync_records` / `sync_clients`；`team_templates`、`labeling_annotations` 结构不变（已在 `src/server/db/mysql.ts` 建表，不要在业务模块重复建表）。

## 客户端约定
- 调接口：`apiFetch<T>(url, { method, json })`（自动 JSON、非 2xx 抛 `ApiError(message)`，message 取服务端 `{error}`）。流式接口自行 `fetch`。
- 加载外部数据：`useAsync(useCallback(() => loader(), [deps]))`，调用方提供依赖明确的稳定函数；IndexedDB 业务视图优先 `useLiveData(useCallback(() => dbQuery(), [deps]))` 订阅真实写入。
- 用户操作：`const save = useAction(async (...) => {...}, { success: "已保存", error: "保存失败" }); save.pending`。
- 并发：`createLimiter(CLIENT_CONCURRENCY)`。
- 场景徽标：`<IssueSceneBadge title={summary} />`（`@/features/tickets/components/issue-scene-badge`）。
- 规则组：`useRuleGroups()` / `useRuleGroupStore`（`@/features/rule-groups/store`，已实现：load/add/update/remove/reorder/exportFile/importFile）。
- 会话：`useSession()` → `{ user, ready, username, can(role) }`。
- 本地 Dexie 写入会自动增量同步到服务端（sync.ts 已安装 hook），业务代码无需关心。

## UI 设计系统（ui-ux-pro-max，见 design-system/ivacp/MASTER.md）
- 风格：数据密集型仪表盘；中性 slate + 绿色主 CTA；字体 Fira Sans / Fira Code；亮/暗主题。
- 只用语义 token 类（见 src/app/globals.css 的 --color-*）：背景 `bg-background bg-surface bg-surface-2 bg-surface-3`；文字 `text-foreground text-muted-foreground text-subtle-foreground`；边框 `border-border border-border-strong`；主色 `bg-primary text-primary-foreground hover:bg-primary-hover bg-primary-soft text-primary`；语义 `text-success bg-success-soft text-warning bg-warning-soft text-destructive bg-destructive-soft text-info bg-info-soft text-purple bg-purple-soft`；`ring-ring`、`bg-scrim`。**不存在** bg-card/bg-muted/text-danger。**禁止**硬编码颜色（`bg-blue-500`、hex、style 内联色）。
- 图标只用 `lucide-react`，**禁止 emoji**。图标按钮必须 `aria-label`。
- 文案中文；每页只有一个 primary 按钮（显式 `variant="primary"`，默认是 secondary），次要用 `variant="outline" | "ghost" | "secondary"`，危险操作必须二次确认。覆盖导入在预览弹窗明确选择覆盖方式并点击「确认覆盖导入」。
- 每个数据视图必须有 加载（`Skeleton`/`Spinner`）、空（`EmptyState`）、错误（`ErrorState` 带重试）三态。
- 数字/时间列加 `tabular` 类（等宽数字）。时间用 `formatDateTime`。
- 状态一律用 `<StatusBadge status="running|completed|failed|approved|rejected|pass|fail|…" label?="" />`（图标+文字，不只靠颜色）。
- Dialog 必须有 `DialogTitle` + `DialogDescription`。表单字段用 `<Field label="" hint="" error="">`。
- 响应式 375/768/1024/1440，无横向滚动（宽表格放 `overflow-x-auto` 容器）；触控目标 ≥ 44px（Button 的 size 已满足，icon 按钮用 `size="icon"`）。
- 页面结构：
```tsx
<Page>  {/* @/shared/ui，width="full" 用于看板/工作台 */}
  <PageHeader title="…" description="…" breadcrumbs={[{label:"规则组看板",href:"/"},{label:"…"}]} actions={<Button>主操作</Button>} />
  …内容（Card / Table / Tabs）…
</Page>
```
- UI 组件（`import { … } from "@/shared/ui"`）：Button(variant: primary|secondary|outline|ghost|destructive|destructive-outline|link; size: sm|md|lg|icon|icon-sm; loading?) · Badge(tone) · Card/CardHeader/CardTitle/CardDescription/CardContent/CardFooter · ConfirmDialog · Dialog/DialogContent/DialogHeader/DialogBody/DialogFooter/DialogTitle/DialogDescription · DropdownMenu* · Spinner/Skeleton/EmptyState/ErrorState/Callout · Label/Field · Input/Textarea · PageHeader/SectionHeader · Select(options) · Sheet/SheetContent · Stat · StatusBadge · Switch/Checkbox · Table* · Tabs* · toast/Toaster · Tooltip · Page。使用前先读对应源码确认 props。
- 需要新的通用组件时放 `src/shared/ui/` 并加到 index.ts（文件名避免与他人冲突，先 ls 检查）。

## 路由（新）
- `/` 规则组看板（KanbanBoard，dnd-kit 拖拽排序）
- `/rule-groups/[id]` 规则组分析看板，Tabs：Jira / 飞书项目（旧 /analysis/[ruleGroupId] 与 /analysis/[ruleGroupId]/meegle）
- `/tickets/jira/[key]?group=<ruleGroupId>` Jira 工单详情（旧 /analysis/[ruleGroupId]/[issueKey]）
- `/tickets/jira/[key]/validation/[runId]?group=` 校验详情
- `/tickets/meegle/[workItemId]?group=` 飞书工单详情（旧 /meegle/issues/[workItemId] 与结果详情）
- `/meegle` 飞书项目工作台；`/statistics` 统计；`/templates` 模板库；`/labeling` 标注；`/terminal` 终端（admin）；`/settings/data` 数据管理（备份/恢复/迁移）；`/api/docs` OpenAPI 文档
- 旧路由 `/analysis/...`、`/meegle/issues/...` 由主控统一加 redirect（next.config），你无需处理。

## 代码风格
- 小文件、单一职责；组件 ≤ ~300 行，拆分子组件；纯逻辑抽到 domain 并写 Vitest 单测。
- 注释只写必要的中文说明。不要保留旧代码中已无用的兼容分支（如 hasCommentedToJira、Geely2）。
- 完成后：`npx tsc --noEmit -p .` 中属于你目录的错误为 0；`npx eslint <你的目录>` 无 error；相关 vitest 通过。
- 最终回复：列出新增文件、API 列表、与旧版的差异/未完成项（简洁）。
