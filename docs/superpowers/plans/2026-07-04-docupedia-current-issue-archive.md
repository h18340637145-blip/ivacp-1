# Docupedia Current Issue Archive 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** Jira 单票处理成功后，在 Docupedia 目标父页面下创建当前票对应页面，并上传当前票的 `log/<规则组>/<车型>/<IssueKey>` 文本日志。

**架构：** 新增 `lib/server/docupedia.ts`，复用 demo 项目的 Docupedia 默认地址、space、parent id 和鉴权模式。`app/api/issues/process/route.ts` 只在 success 路径调用归档服务，传入当前处理产生的 `logRoot`，Docupedia 失败仅写入 pipeline 日志，不影响处理结果返回。

**技术栈：** Next.js API Route、TypeScript、Node `https`、Node `fs/promises`、Confluence/Docupedia REST API。

---

## 文件职责

- `lib/server/docupedia.ts`：Docupedia 配置解析、鉴权、创建/复用页面、导入当前 issue 日志目录中的文本文件。
- `app/api/issues/process/route.ts`：在 no-attachments success 和正常附件 success 两条成功路径调用归档服务。
- `scripts/check-docupedia-archive.mjs`：静态回归检查，防止改成扫描历史 `log/` 或在非 success 路径上传。
- `package.json`：注册 `test:docupedia-archive`。
- `docs/PRODUCT.md`、`docs/ARCHITECTURE.md`、`docs/WORKFLOW.md`、`docs/SEQUENCE_DIAGRAMS.md`：同步产品与流程说明。
- `session-handoff.md`：记录本轮完成项。

## 任务

- [ ] **步骤 1：编写失败的回归检查**

创建 `scripts/check-docupedia-archive.mjs`，检查 `lib/server/docupedia.ts`、`archiveIssueLogToDocupedia`、process route success 调用和 `logRoot` 限制。

- [ ] **步骤 2：运行检查验证失败**

运行：`node scripts/check-docupedia-archive.mjs`
预期：FAIL，报错 `Missing lib/server/docupedia.ts`。

- [ ] **步骤 3：实现 Docupedia 服务**

创建 `lib/server/docupedia.ts`，提供：

```ts
export async function archiveIssueLogToDocupedia(input: {
  issueKey: string;
  summary: string;
  ruleGroupName: string;
  carModel: string;
  logRoot: string;
}): Promise<DocupediaArchiveResult>
```

配置默认值参考 demo：`https://inside-docupedia.bosch.com/confluence2`、`BCSCVC`、`1171390502`。

- [ ] **步骤 4：接入 success 路径**

修改 `app/api/issues/process/route.ts`：

```ts
const docupediaResult = await archiveIssueLogToDocupedia({
  issueKey,
  summary,
  ruleGroupName: groupDirName,
  carModel: carModel || "unknown",
  logRoot,
});
```

只放在 `finalizePipelineMetrics(metrics, "success", ...)` 之后，不放入 reject/failed。

- [ ] **步骤 5：同步文档**

更新产品、架构、流程、时序图和 session handoff，明确只上传当前处理成功票的当前日志目录，不补扫历史。

- [ ] **步骤 6：运行验证**

运行：

```bash
node scripts/check-docupedia-archive.mjs
npx tsc --noEmit
npm run lint
```

预期：Docupedia 检查通过，TypeScript 通过，lint 仅允许既有无关 warning。
