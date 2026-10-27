# 飞书评论附件统一处理实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将飞书评论附件和附件插件附件按真实类型与时间统一选择，并在没有 CAN trace 或日志包时返回固定结论。

**架构：** 评论附件在共享处理 run 内预取，通过 CLI 下载结果补齐原始名称、类型和大小，同时保留评论创建时间。补齐后的评论附件与插件附件进入现有 `classifyAttachments`；选中的评论文件直接复用，插件文件仍按原方式下载，未选中的评论预取文件删除。

**技术栈：** Next.js Route Handler、TypeScript、Node.js fs、Meegle CLI、Node assert 回归脚本

---

## 文件结构

- 修改 `lib/server/meegle-comment-attachments.ts`：评论附件预取、元数据补齐和安全暂存路径。
- 修改 `app/api/issues/process/route.ts`：在分类前预取，统一选择，并实现飞书无 CAN/日志固定结论。
- 修改 `scripts/test-meegle-comment-attachments.ts`：覆盖真实文件名补齐、评论时间保留和暂存复用。
- 修改 `scripts/check-meegle-result-lifecycle.mjs`：覆盖飞书固定结论与 Jira 原行为隔离。
- 修改 `docs/PRODUCT.md`、`docs/ARCHITECTURE.md`、`docs/WORKFLOW.md`、`docs/SEQUENCE_DIAGRAMS.md`、`session-handoff.md`：同步行为与验证结果。

### 任务 1：评论附件预取与真实元数据

- [x] **步骤 1：编写失败测试**

在 `scripts/test-meegle-comment-attachments.ts` 中用注入下载器返回：

```ts
{
  path: stagedPath,
  size: 26509706,
  name: "can_20260902141049.asc",
  mime_type: "application/octet-stream",
}
```

断言补齐后的 `filename` 为 `can_20260902141049.asc`、`created` 仍为评论时间，并记录可复用的暂存路径。

- [x] **步骤 2：运行测试验证失败**

运行：`source ~/.bashrc && npm run test:meegle-comment-attachments`

预期：FAIL，原因是评论附件预取 API 尚不存在。

- [x] **步骤 3：实现最少代码**

在 `lib/server/meegle-comment-attachments.ts` 增加注入友好的预取函数：

```ts
export async function stageMeegleCommentAttachments(
  attachments: JiraAttachment[],
  identity: { projectKey: string; workItemId: string },
  stagingRoot: string,
  download?: MeegleCommentAttachmentDownloader,
): Promise<StagedMeegleCommentAttachments>
```

默认下载器调用 `runMeegleJson` 与现有 `buildMeegleCommentAttachmentDownloadArgs`，使用 CLI 返回的 `name`、`size`、`mime_type` 更新附件，保留原 `created` 和 `contentUrl`。文件名经过现有安全化和去重逻辑。

- [x] **步骤 4：运行测试验证通过**

运行：`source ~/.bashrc && npm run test:meegle-comment-attachments`

预期：PASS，输出 `Meegle comment attachment checks passed`。

### 任务 2：统一分类、复用与缺附件结论

- [x] **步骤 1：编写失败测试**

扩展静态生命周期检查，要求处理路由：

```ts
stageMeegleCommentAttachments(liveAttachments, meegleIdentity, commentStagingRoot)
```

并要求飞书 `no_attachments` 返回精确固定文本，而 Jira 仍进入原 `no_attachments` AI 分析分支。

- [x] **步骤 2：运行测试验证失败**

运行：`source ~/.bashrc && npm run test:meegle-results`

预期：FAIL，原因是处理路由尚未预取评论附件，也没有飞书专属固定结论。

- [x] **步骤 3：实现最少代码**

在 `app/api/issues/process/route.ts`：

```ts
const MEEGLE_MISSING_ANALYSIS_ATTACHMENTS_REPLY =
  "车控车设问题分析需要CAN trace，请复测并提取问题发生时的Android log, QNX log, CAN trace，依次从应用->Framework再转给VHAL分析，谢谢";
```

建立 `attachRoot/.meegle-comment-staging`，仅对 `source === "meegle"` 的评论附件预取并替换 `liveAttachments` 中对应项；随后调用原 `classifyAttachments`。下载函数在已有暂存路径可用时复制该文件，否则沿用评论 CLI 下载或插件 HTTP 下载。分类后删除未被 CAN、日志包、分卷包或最新两张图片使用的评论暂存文件。

当 `source === "meegle" && classified.mode === "no_attachments"` 时，在图片 OCR 和 Qwen 调用前保存固定回复、metrics、stages，并返回成功响应。Jira 分支不变。

- [x] **步骤 4：运行聚焦测试验证通过**

运行：

```bash
source ~/.bashrc && npm run test:meegle-comment-attachments
source ~/.bashrc && npm run test:meegle-results
source ~/.bashrc && npm run test:meegle-plugin-attachments
```

预期：全部 PASS。

### 任务 3：文档与最终验证

- [x] **步骤 1：同步文档**

在产品、架构、流程和时序文档中写明评论附件预取、评论时间与插件时间统一比较、无 CAN/日志固定结论；在 `session-handoff.md` 记录根因、实现和验证命令。

- [x] **步骤 2：执行类型与质量检查**

运行：

```bash
source ~/.bashrc && npx tsc --noEmit
source ~/.bashrc && npm run lint
git diff --check
```

预期：TypeScript 与 diff 检查退出码 0；lint 无新增 error。

- [x] **步骤 3：复核需求覆盖**

确认评论时间保留、插件时间保留、跨来源最新选择、评论附件真实下载、无 CAN/日志固定结论、Jira 行为不变六项均有代码或测试证据。