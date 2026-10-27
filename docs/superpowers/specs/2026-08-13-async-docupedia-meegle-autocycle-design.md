# Docupedia 异步归档与飞书自动周期设计

## 背景与根因

飞书项目的 `meegleProcessStore.processAssignment()` 只有在 `/api/issues/process`
返回成功响应后，才会在 IndexedDB 创建 `MeegleProcessResult` 并将 assignment
标记为 `completed`。当前处理路由已写完 `final_reply.md`、`pipeline-metrics.json`
和 `stages.json` 后，仍 `await archiveSuccessToDocupedia()`。Docupedia 的网络上传
因此延迟了 HTTP 响应，使浏览器一直保持 `processing`，无法查看结果或执行复核、
回填。

主页自动周期虽然使用统一筛选 `runUnifiedFilter()`，其后却只读取 Jira
`filterTasks` 并调用 `runAll()`；它没有调用统一处理入口，故飞书项目的待处理
assignment 不会随周期运行。

## 已确认范围

- 分析成功后必须先返回结果，飞书项目立即完成本地结果持久化，允许查看、复核与回填。
- Docupedia 仅作为响应后的尽力归档任务；失败不改变分析结果、处理状态或回填资格。
- 不增加跨重启恢复、重试队列、后端数据库或历史日志补扫。服务重启时尚未完成的上传可丢弃。
- 自动周期必须通过统一处理入口覆盖 Jira 与飞书项目，手动“处理”语义保持一致。

## 方案选择

候选方案如下：

1. 响应后后台任务（采用）：在路由返回响应后使用 Next.js `after()` 调度现有归档函数。
   无需额外存储，响应链不再等待网络上传；代价是进程重启不恢复任务，符合已确认范围。
2. 内存队列：由常驻 Node 进程维护 Promise 队列。可限制并发，但在开发热重载和
   serverless 生命周期下可靠性更弱，也增加了本需求不需要的调度状态。
3. 持久化队列：本地文件或外部队列记录任务、重启恢复。可靠性更高，但超出“不需要
   恢复”的确认范围，并会引入新的存储和失败状态机。

## 架构与数据流

```text
共享分析流水线
  ├─ 写入分析产物、最终结果、metrics、stages 与 pipeline.log
  ├─ 构造 ProcessResponse 并立即返回给浏览器
  │    └─ Meegle store 写入结果 → assignment=completed → 可复核/回填
  └─ after()：归档当前 logRoot 到 Docupedia
       └─ 仅追加 DOCUPEDIA 成功/失败日志，不修改 ProcessResponse 或任务状态

主页自动周期
  ├─ runUnifiedFilter(ruleGroup)
  ├─ processRuleGroup(ruleGroup)
  │    ├─ Jira：处理最新完成筛票快照
  │    └─ Meegle：处理该组 pending/failed assignments
  └─ markAutoCycleRun(ruleGroupId)
```

`after()` 回调必须自行捕获异常并刷新日志，避免未处理 rejection；归档输入继续只
接受当前 run 的 `logRoot`。这保留既有“当前成功票、当前目录、文本日志”的安全边界。

## 组件边界

- `app/api/issues/process/route.ts`：只负责分析、产物落盘、响应构造和响应后归档调度；
  不再在响应链中等待 Docupedia。
- `lib/server/docupedia.ts`：继续负责归档与重试策略，不感知 HTTP 响应或 IndexedDB。
- `stores/meegleProcessStore.ts`：无需改变结果写入协议；会因更早得到成功响应而正常完成。
- `components/KanbanBoard.tsx`：自动周期改调用 `ruleGroupWorkflowStore.processRuleGroup()`，
  不直接实现 Jira-only 处理逻辑。
- `stores/ruleGroupWorkflowStore.ts`：继续是 Jira/Meegle 处理分派边界；必要时仅补充
  可测试的任务选择辅助逻辑。

## 错误处理与可观测性

- 归档关闭时，后台日志记录 `ENABLE_DOCUPEDIA=0`；不会创建任何上传工作。
- 归档失败或文章部分失败仅写 `DOCUPEDIA` 日志，保留现有 Docupedia 内部重试。
- `ProcessResponse` 不新增“上传完成”承诺，避免前端把归档状态误认为分析完成条件。
- 自动周期的任一来源失败维持来源隔离；已成功来源仍可按既有统一处理规则继续。

## 验收与测试

1. 静态/单元测试证明归档被 `after()` 调度，响应路径不 `await` 归档 Promise。
2. Meegle 生命周期检查证明 `/api/issues/process` 成功响应后仍立即写入 result 并完成 assignment。
3. 自动周期检查证明筛选后调用统一 `processRuleGroup()`，而非 Jira-only `runAll()`。
4. 既有 Docupedia 归档检查继续验证 success-only、当前 `logRoot` 限定、开关和失败不阻断。
5. 更新产品、架构、工作流、时序图和 `session-handoff.md`，明确新的响应与归档边界。
