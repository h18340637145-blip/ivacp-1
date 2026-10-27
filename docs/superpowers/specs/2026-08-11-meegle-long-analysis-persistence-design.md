# 飞书项目长耗时分析持久化修复设计

## 问题

`meegleProcessStore` 调用 `/api/meegle/analyze`，该路由再通过服务端 `fetch` 回环调用 `/api/issues/process`。当共享分析流水线超过服务端 `fetch` 的约 300 秒响应头等待边界时，外层路由先返回 500；共享流水线仍会继续生成成功产物，但浏览器没有成功响应，因此不会执行 Meegle 结果的 IndexedDB 事务。

## 目标

- Meegle 主处理链路只发起一次长耗时 HTTP 请求。
- 共享 `/api/issues/process` 的 Jira 与 Meegle 处理算法、响应字段和日志目录规则保持不变。
- 只有完整成功响应才将 task、result 和 assignment latest IDs 原子写入 Meegle 专用 IndexedDB 表。
- 不修改现有失败记录，也不尝试从缺少 `traceData` / `ticks` 的服务端日志重建历史结果。

## 方案

`meegleProcessStore` 在 `/api/meegle/context` 成功并保存 snapshot/task 后，直接构造共享 `ProcessRequest` 并调用 `/api/issues/process`。请求显式携带：

- `issueKey = meegle-{workItemId}`；
- 已保存快照的 `rawData`，并补齐 `source`、项目、工作项类型、工作项 ID、状态和项目名称；
- 规则组 prompts、基础路径、车型文件映射和规则组身份；
- `source = meegle` 与当前 task ID 形式的 `runId`。

`/api/meegle/analyze` 暂时保留给旧调用方，但不再属于持久化结果的主链路。本轮不重构共享处理路由，也不增加后台任务系统。

## 错误与持久化语义

共享处理请求非 2xx 或解析失败时，继续保存 failed task 和 assignment error；已有 `latestResultId` 不被清除。成功时沿用现有单个 Dexie transaction 保存 completed task、完整 result 和 assignment latest IDs，详情页刷新后仍从这些表恢复。

## 验证

- 静态生命周期回归必须断言 `meegleProcessStore` 直接请求 `/api/issues/process`，并禁止再次请求 `/api/meegle/analyze`。
- 回归必须断言请求携带 `source: "meegle"`、`runId` 和 `meegle-{workItemId}` identity。
- 运行 Meegle 结果生命周期测试、Meegle 生命周期行为测试、TypeScript、lint 和差异检查。

