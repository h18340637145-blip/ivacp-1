# Docupedia 后台归档逐篇日志实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `executing-plans` 在当前运行工作区逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** Docupedia 后台归档开始及每一篇日志文章结束时，同时在该 run 的 `pipeline.log` 和 Next.js 终端记录结构化进度。

**架构：** `archiveIssueLogToDocupedia` 接受可选的进度回调，并在导入计划生成后、每个子文章创建或确认已存在后、单篇最终失败后发出事件。`/api/issues/process` 将事件转换为既有 `PipelineLogger` 记录；该 logger 已同步输出 Next.js 终端并在延后回调结束时写入 `pipeline.log`。归档仍由 `after()` 执行，绝不等待它或改变分析成功语义。

**技术栈：** Next.js App Router、TypeScript、Node.js `assert` 静态归档守卫。

---

### 任务 1：为归档日志契约建立回归守卫

**文件：**
- 修改：`scripts/check-docupedia-archive.mjs`

- [x] **步骤 1：编写失败的测试**

在既有静态归档守卫中断言：归档服务声明 `onProgress`、发出 `archive_started` 与 `page_completed` 事件；共享处理路由将进度写入 `logger.log("DOCUPEDIA", ...)`。既有 logger 的 `console.log` 保证同一记录输出到终端。

- [x] **步骤 2：运行测试验证失败**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:docupedia-archive`

预期：失败信息指出缺少逐篇归档进度契约。

### 任务 2：实现后台归档进度日志

**文件：**
- 修改：`lib/server/docupedia.ts`
- 修改：`app/api/issues/process/route.ts`

- [x] **步骤 1：实现最少的服务端进度事件**

在 `DocupediaArchiveInput` 新增可选 `onProgress`，其事件含 `kind`、`pageIndex`、`pageTotal`、`title` 和完成状态。导入计划生成后发 `archive_started`；每篇 find-or-create 返回后发 `page_completed`；单篇 catch 后发 `page_failed`。

- [x] **步骤 2：将事件输出到两处日志**

在处理路由新增仅用于归档的格式化函数，并在归档回调中将格式化后的事件交给 `logger.log("DOCUPEDIA", message)`；既有 logger 会将相同记录输出终端。不得改变 `after()`、上传间隔、重试和成功响应顺序。

- [x] **步骤 3：运行测试验证通过**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:docupedia-archive`

预期：输出 `Docupedia archive integration checks passed`。

### 任务 3：同步文档与完成验证

**文件：**
- 修改：`docs/ARCHITECTURE.md`
- 修改：`session-handoff.md`

- [x] **步骤 1：更新运行时可观测性说明**

在 Docupedia 稳定性/失败策略段落明确后台归档会记录启动、逐篇完成和逐篇失败，并同时写入当前 run 的 `pipeline.log` 与服务终端；不承诺跨重启恢复。

- [x] **步骤 2：记录本轮交接**

在 `session-handoff.md` 的最新记录区写明变更范围、回归守卫和验证结果。

- [x] **步骤 3：运行完整相关验证**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:docupedia-archive
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:docupedia-retries
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit
git diff --check
```

预期：两个归档检查通过；TypeScript 结果如被既有未提交改动阻断，准确报告阻断文件；diff 检查通过。
