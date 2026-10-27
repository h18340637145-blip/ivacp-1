# 飞书项目恢复无产物响应实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 遗留的飞书项目 `processing` 任务没有完整成功产物时，不再以 HTTP 404 记录为接口错误，同时保持其本地任务状态不变。

**架构：** 恢复路由将“未找到完整成功产物”表示为成功的 JSON 业务结果；客户端只在该结果包含完整分析字段时落库并将任务改为 `completed`。保留 400 参数校验与成功产物恢复路径不变。

**技术栈：** Next.js Route Handler、TypeScript、Zustand、Node 静态回归脚本。

---

### 任务 1：先锁定恢复协议的失败行为

**文件：**
- 修改：`scripts/check-meegle-result-lifecycle.mjs`
- 测试：`scripts/check-meegle-result-lifecycle.mjs`

- [x] **步骤 1：编写失败的测试**

在 `checks` 中新增两个断言，并增加直接调用恢复路由的测试：恢复路由对无完整产物（含缺失规则组日志目录）返回 `recoverable: false` 和 HTTP 200；客户端在该标记为 false 时直接返回，不解析或持久化分析结果。

- [x] **步骤 2：运行测试验证失败**

运行：`source ~/.bashrc && npm run test:meegle-results`

预期：FAIL，指出恢复路由或客户端缺少 `recoverable` 协议。

### 任务 2：实现无产物的正常恢复结果

**文件：**
- 修改：`app/api/meegle/recover/route.ts`
- 修改：`stores/meegleProcessStore.ts`
- 测试：`scripts/check-meegle-result-lifecycle.mjs`

- [x] **步骤 1：编写最少实现代码**

将恢复路由末尾改为：

```ts
return NextResponse.json({ recoverable: false });
```

将客户端响应判断改为：

```ts
const data = await response.json() as MeegleAnalyzeResponse & { recoverable?: boolean };
if (data.recoverable === false || !data.replyText || !data.artifactRef || !data.analysisReceipt) return undefined;
```

- [x] **步骤 2：运行测试验证通过**

运行：`source ~/.bashrc && npm run test:meegle-results`

预期：PASS，输出 `Meegle result lifecycle checks passed`。

### 任务 3：同步流程与交接记录

**文件：**
- 修改：`docs/WORKFLOW.md`
- 修改：`session-handoff.md`

- [x] **步骤 1：更新恢复流程说明**

在飞书项目第 6 步明确：无成功产物是正常未恢复结果，接口返回 HTTP 200 且不改变 IndexedDB 状态。

- [x] **步骤 2：更新交接记录**

记录根因、协议边界、未触碰 MQL 筛票改动，以及实际验证命令和结果。

### 任务 4：完成验证

**文件：**
- 验证：`scripts/check-meegle-result-lifecycle.mjs`
- 验证：`stores/meegleProcessStore.ts`
- 验证：`app/api/meegle/recover/route.ts`

- [x] **步骤 1：运行定向回归测试**

运行：`source ~/.bashrc && npm run test:meegle-results`

预期：PASS。

- [x] **步骤 2：运行 TypeScript 检查**

运行：`source ~/.bashrc && npx tsc --noEmit`

预期：exit 0。
