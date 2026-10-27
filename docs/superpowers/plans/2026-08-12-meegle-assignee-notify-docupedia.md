# 飞书项目经办人流转与处理通知集成实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [x]`）语法来跟踪进度。

**目标：** 在飞书项目工单详情中安全、独立地变更经办人，并让飞书项目的单票分析复用 Jira 的处理结果飞书通知和成功日志 Docupedia 归档能力。

**架构：** 经办人变更使用详情读取时签发的短期凭据、目标用户绑定授权和服务端二次读取，动态定位“经办人”角色后进行 replace 操作，绝不触发状态流转。处理通知扩展为来源显式的通用卡片；Jira 与 Meegle 各自的 Zustand store 在处理成功/失败后非阻塞地通知。Meegle 继续调用共享处理路由，Docupedia 仅在共享流水线成功后归档当前 run 的日志，失败或开关关闭均不改变处理结果。

**技术栈：** Next.js App Router、React、TypeScript、Zustand、Dexie/IndexedDB、Meegle CLI、Node assert/静态回归脚本。

---

## 文件结构

### 新建

- `lib/meegle/assignee.ts`：规范化成员键、构造角色替换命令的纯函数。
- `app/api/meegle/assignee/route.ts`：重新读取、并发校验并执行经办人角色替换。
- `components/meegle/MeegleAssigneeControl.tsx`：人员搜索、二次确认、更新与刷新交互。
- `scripts/test-meegle-assignee.ts`：详情凭据、授权篡改、角色操作的纯函数回归测试。

### 修改

- `lib/server/meegle-write-authorization.ts`：新增受详情凭据保护的 `assignee` 判别授权声明。
- `app/api/meegle/workitem/route.ts`：成功详情响应携带经办人详情凭据。
- `app/api/meegle/authorize/route.ts`：区分分析结果写入与独立经办人授权。
- `lib/server/meegle-cli.ts`：提供 role-operate 命令构造与目标用户解析边界。
- `components/meegle/MeegleWorkItemDetail.tsx`：在基本信息卡片中接入独立经办人控制，成功后重新读取详情。
- `stores/processTaskStore.ts`、`stores/meegleProcessStore.ts`：复用来源明确的飞书处理结果通知，成功/失败均不阻断持久化。
- `app/api/feishu/process-result/route.ts`：接收 `source` 并显示“Jira”或“飞书项目”来源标题。
- `scripts/check-meegle-parity-ui.mjs`、`scripts/check-feishu-process-notify.mjs`、`scripts/check-docupedia-archive.mjs`、`package.json`：新增专项测试并要求 Meegle 的通知与 success-only Docupedia 语义。
- `docs/PRODUCT.md`、`docs/ARCHITECTURE.md`、`docs/WORKFLOW.md`、`docs/SEQUENCE_DIAGRAMS.md`、`session-handoff.md`：同步功能、来源边界、验证结果与未完成项。

## 任务 1：锁定经办人更新的安全协议

**文件：**
- 创建：`scripts/test-meegle-assignee.ts`
- 创建：`lib/meegle/assignee.ts`
- 修改：`lib/server/meegle-write-authorization.ts`
- 修改：`package.json`

- [x] **步骤 1：编写失败的授权与角色替换测试**

```ts
const receipt = createMeegleDetailReceipt({
  projectKey: "p", workItemTypeKey: "issue", workItemId: "7",
  assigneeRoleKey: "role_x", assigneeUserKeys: ["u2", "u1"], updatedAt: "v1",
});
const claims = {
  action: "assignee" as const, projectKey: "p", workItemTypeKey: "issue" as const,
  workItemId: "7", expectedCurrentUserKeys: ["u1", "u2"], targetUserKey: "u3", detailReceipt: receipt,
};
const token = createMeegleWriteAuthorization(claims);
verifyMeegleWriteAuthorization(token, claims);
assert.throws(() => verifyMeegleWriteAuthorization(token, { ...claims, targetUserKey: "u4" }));
assert.deepEqual(buildAssigneeRoleOperate("role_x", ["u2", "u1"], "u3"), [
  { op: "remove", role_key: "role_x", user_keys: ["u1", "u2"] },
  { op: "add", role_key: "role_x", user_keys: ["u3"] },
]);
```

- [x] **步骤 2：运行测试，确认缺少实现**

运行：

```bash
source ~/.bashrc
export PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH
npm run test:meegle-assignee
```

预期：FAIL，指出 `createMeegleDetailReceipt` 或 `buildAssigneeRoleOperate` 尚未导出。

- [x] **步骤 3：实现最小安全协议**

将写声明改为 `comment | transition | assignee` 判别联合；详情凭据签名 payload 必须包括工作项身份、动态 role key、排序后的当前成员键和 `updatedAt`。在 `lib/meegle/assignee.ts` 中排序去重输入，并仅在目标不在当前唯一成员时生成以下命令：

```ts
return [
  ...(currentUserKeys.length ? [{ op: "remove" as const, role_key: roleKey, user_keys: currentUserKeys }] : []),
  { op: "add" as const, role_key: roleKey, user_keys: [targetUserKey] },
];
```

- [x] **步骤 4：注册并验证纯函数测试**

在 `package.json` 注册：

```json
"test:meegle-assignee": "node --import tsx scripts/test-meegle-assignee.ts"
```

运行同一命令，预期：PASS，并输出 `Meegle assignee tests passed.`。

- [x] **步骤 5：提交任务 1**

```bash
git add lib/meegle/assignee.ts lib/server/meegle-write-authorization.ts scripts/test-meegle-assignee.ts package.json
git commit -m "feat: 定义飞书经办人安全授权协议"
```

## 任务 2：实现详情凭据、人员搜索与经办人写接口

**文件：**
- 创建：`app/api/meegle/assignee/route.ts`
- 修改：`app/api/meegle/workitem/route.ts`
- 修改：`app/api/meegle/authorize/route.ts`
- 修改：`lib/server/meegle-cli.ts`

- [x] **步骤 1：为详情读取签发凭据**

详情成功读取时从 `detail.assigneeRole` 取动态角色 key、成员 key 和工作项 `updatedAt`，返回：

```ts
{ detail, errors, detailReceipt }
```

没有“经办人”角色时返回空凭据；不得用分析结果的 `analysisReceipt` 替代详情凭据。

- [x] **步骤 2：实现 `/api/meegle/authorize` 的 assignee 分支**

`assignee` 必须校验 `projectKey`、`workItemTypeKey === "issue"`、`workItemId`、非空 `targetUserKey`、排序去重后的 `expectedCurrentUserKeys` 与 `detailReceipt`；验证详情凭据后签发两分钟、目标绑定的写 token。现有 comment / transition 分支仍要求 `resultId` 与 `analysisReceipt`。

- [x] **步骤 3：实现写接口的二次读取和冲突保护**

`POST /api/meegle/assignee` 的顺序固定为：验证 token → 读取最新完整工作项 → 动态查找名称等于“经办人”的角色 → 比较排序后的成员键。成员与授权期望值不同返回 409；目标已是唯一成员返回 `{ success: true, changed: false }`；否则先解析目标用户，再执行：

```ts
await runMeegleJson([
  "workitem", "update", "--project-key", projectKey,
  "--work-item-id", workItemId,
  "--role-operate", JSON.stringify(roleOperate),
]);
```

CLI 或用户解析异常只返回安全中文 502，响应不得泄漏令牌或命令参数。

- [x] **步骤 4：验证 API 边界**

运行：

```bash
source ~/.bashrc
export PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH
npm run test:meegle-assignee
npm run test:meegle-workitem-detail
```

预期：PASS；真实 Meegle 仅使用 mock/纯函数验证，不执行经办人更新。

- [x] **步骤 5：提交任务 2**

```bash
git add app/api/meegle/assignee/route.ts app/api/meegle/workitem/route.ts app/api/meegle/authorize/route.ts lib/server/meegle-cli.ts
git commit -m "feat: 安全更新飞书工单经办人"
```

## 任务 3：接入独立经办人交互

**文件：**
- 创建：`components/meegle/MeegleAssigneeControl.tsx`
- 修改：`components/meegle/MeegleWorkItemDetail.tsx`
- 修改：`scripts/check-meegle-parity-ui.mjs`

- [x] **步骤 1：扩展静态回归守卫并确认失败**

守卫必须要求标准详情页渲染 `MeegleAssigneeControl`，包含 300ms 防抖、`AbortController`、`/api/meegle/users`、`/api/meegle/authorize` 和 `/api/meegle/assignee`；同时断言不向 `/api/meegle/workflow` 传递经办人参数。

运行：

```bash
source ~/.bashrc
export PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH
npm run test:meegle-parity-ui
```

预期：FAIL，报告控制组件缺失。

- [x] **步骤 2：实现搜索、确认与失败语义**

输入至少一个字符后调用人员目录；选择后显示 `当前：{currentNames} → 目标：{selectedUser.name}`。仅在用户二次确认时依次请求授权和更新。成功时关闭对话框、清空选择并调用 `reload()`；409 时显示“经办人已被其他人修改，请刷新后重新确认”并刷新；502 时保留可重试状态。组件不得读写状态流转状态。

- [x] **步骤 3：在单一基本信息卡片内接入控制组件**

将控制组件作为“经办人”行的内容，继续保持 `MeegleBasicInfo` 只有一个 `Section` 和一个 `dl`。`DetailResponse` 增加 `detailReceipt`，每次 `load()` 刷新它。

- [x] **步骤 4：验证 UI、lint 与类型**

```bash
source ~/.bashrc
export PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH
npm run test:meegle-parity-ui
npx eslint components/meegle/MeegleAssigneeControl.tsx components/meegle/MeegleWorkItemDetail.tsx
npx tsc --noEmit
```

预期：全部 PASS。

- [x] **步骤 5：提交任务 3**

```bash
git add components/meegle/MeegleAssigneeControl.tsx components/meegle/MeegleWorkItemDetail.tsx scripts/check-meegle-parity-ui.mjs
git commit -m "feat: 接入飞书经办人独立流转交互"
```

## 任务 4：让处理结果飞书通知显式支持两种来源

**文件：**
- 修改：`app/api/feishu/process-result/route.ts`
- 修改：`stores/processTaskStore.ts`
- 修改：`stores/meegleProcessStore.ts`
- 修改：`scripts/check-feishu-process-notify.mjs`

- [x] **步骤 1：扩展失败的通知守卫**

要求 payload 的 `source` 为 `"jira" | "meegle"`，卡片标题根据来源显示 `Jira 处理通知` 或 `飞书项目处理通知`；Jira 和 Meegle store 都必须在 success / failed 路径以 warning-only 方式调用通知。

- [x] **步骤 2：实现来源安全的通用通知**

在 route 中默认缺省来源为 `jira`，确保旧 Jira 调用向后兼容；只接受精确的 `meegle` 值切换标题。将共享客户端 helper 提取到 `lib/feishu/process-result-notify.ts`（或在两个 store 使用同一现有 helper），请求体始终包含 `origin`、`processedAt` 和 `source`。

- [x] **步骤 3：在 Meegle 成功和失败完成后通知**

Meegle 成功仅在结果与 assignment 已持久化后发送；失败使用已创建 snapshot 的描述，若 context 阶段失败则安全使用空描述。通知失败只 `console.warn`，不得改变 task/assignment 的 completed 或 failed 状态，也不得重复调用共享分析 API。

- [x] **步骤 4：验证通知守卫**

```bash
source ~/.bashrc
export PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH
npm run test:feishu-process-notify
npm run test:meegle-results
```

预期：PASS；静态测试不发送真实 webhook。

- [x] **步骤 5：提交任务 4**

```bash
git add app/api/feishu/process-result/route.ts stores/processTaskStore.ts stores/meegleProcessStore.ts scripts/check-feishu-process-notify.mjs
git commit -m "feat: 飞书项目发送单票处理通知"
```

## 任务 5：显式验证 Meegle 的 Docupedia 成功归档并同步文档

**文件：**
- 修改：`scripts/check-docupedia-archive.mjs`
- 修改：`docs/PRODUCT.md`
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/WORKFLOW.md`
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
- 修改：`session-handoff.md`

- [x] **步骤 1：扩展 Docupedia 守卫**

要求 `stores/meegleProcessStore.ts` 请求 `/api/issues/process` 时保留 `source: "meegle"` 与 `runId: task.id`，并要求共享成功路径在两种返回模式都调用 `archiveSuccessToDocupedia`；守卫继续禁止 reject/失败路径归档，继续要求 `ENABLE_DOCUPEDIA=1` 开启、`=0` 跳过与上传失败不阻断。

- [x] **步骤 2：同步产品、架构与时序语义**

文档应明确：飞书项目经办人可独立变更但不改变状态；Meegle 成功/失败各发送一次来源标识的处理通知；Jira 与 Meegle 都由共享流水线在成功时归档本次 run 的日志，Docupedia 开关和失败策略完全一致。不得声称测试发送真实 webhook、真实 Meegle 更新或真实 Docupedia 上传。

- [x] **步骤 3：更新交接与计划状态**

勾选本计划完成步骤，并在 `session-handoff.md` 记录分支、提交、验证命令与真实外部服务未做写入验证的边界。

- [x] **步骤 4：运行全量相关回归**

```bash
source ~/.bashrc
export PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH
npm run test:meegle-assignee
npm run test:meegle-workitem-detail
npm run test:meegle-user-directory
npm run test:meegle-parity-ui
npm run test:meegle-results
npm run test:meegle-lifecycle
npm run test:feishu-process-notify
npm run test:docupedia-archive
npx tsc --noEmit
git diff --check
```

预期：全部 PASS。之后在 webpack dev server 下只做读取、搜索和 UI 交互验证；不提交真实经办人更新，也不发送真实 webhook 或 Docupedia 写入。

- [x] **步骤 5：提交任务 5**

```bash
git add scripts/check-docupedia-archive.mjs docs/PRODUCT.md docs/ARCHITECTURE.md docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md docs/superpowers/plans/2026-08-12-meegle-assignee-notify-docupedia.md
git commit -m "docs: 同步飞书项目流转与通知归档流程"
```

## 完成判定

- 经办人替换受到详情凭据、目标绑定授权、二次读取和 409 并发冲突保护，且不触发状态流转。
- 人员搜索仅返回完整目录结果；搜索、授权、更新失败都有可恢复中文提示。
- Jira 与 Meegle 各自产生一条 success / failed 处理通知，通知失败不影响本地持久化。
- 共享成功处理路径对两种来源的当前 run 目录执行 Docupedia 归档；失败、拒绝和关闭开关时绝不归档。
- 相关文档、计划与 `session-handoff.md` 已同步，专项测试、类型检查和 diff 检查有通过证据。
