# VHAL 信号精确配置门禁实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** Step 2 提取出车型 JSON 未精确配置的信号时，停止后续分析并返回要求上层释放 VHAL 的成功结论。

**架构：** 在共享处理路由的 Step 2 精确匹配之后建立门禁，仅检查 Step 2 原始信号是否精确命中 `prop/getSignals/setSignals`。门禁失败时保存审计数据并走现有成功结果收尾，不执行补救匹配、CAN 解析、绘图和后续 AI 阶段。

**技术栈：** Next.js App Router、TypeScript、Node.js 静态回归脚本。

---

### 任务 1：锁定 VHAL 精确配置门禁

**文件：**
- 修改：`scripts/check-accuracy-phase2.mjs`
- 修改：`app/api/issues/process/route.ts`

- [ ] **步骤 1：编写失败的静态回归测试**

在 Phase 2 检查中断言：路由存在 Step 2 未精确配置列表、固定结论文案，并且门禁位于 `recoverViaSelfCheck` 调用和 CAN trace 读取之前。

- [ ] **步骤 2：运行测试验证失败**

运行：`source ~/.bashrc && npm run test:accuracy-phase2`

预期：FAIL，提示缺少 VHAL 精确配置门禁。

- [ ] **步骤 3：实现最少生产代码**

在 Step 2 精确匹配后计算未精确配置的 Step 2 信号。存在缺失时：

```ts
const vhalUnconfiguredSignals = step2RawSignalTokens.filter(
  (token) => !exactMatchedTokenSet.has(normalizeSignalToken(token)),
);
```

将缺失信号写入 `signals.json`，设置最终结论：

```ts
`vhal并没有配置信号${vhalUnconfiguredSignals.join("、")}，需要上层释放vhal`
```

并绕过补救匹配、CAN trace、绘图、日志摘要及 Step 5，复用现有成功结果保存逻辑。

- [ ] **步骤 4：运行聚焦测试验证通过**

运行：`source ~/.bashrc && npm run test:accuracy-phase2`

预期：PASS。

### 任务 2：同步行为文档并完成验证

**文件：**
- 修改：`docs/PRODUCT.md`
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/WORKFLOW.md`
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
- 修改：`session-handoff.md`

- [ ] **步骤 1：同步 Harness 文档**

记录 Step 2 任一信号未在车型 JSON 精确配置时，处理以成功结论提前结束；DBC 存在和模糊/自检补救不能绕过门禁。

- [ ] **步骤 2：运行类型与相关回归检查**

运行：

```bash
source ~/.bashrc && npm run test:accuracy-phase2
source ~/.bashrc && npx tsc --noEmit
source ~/.bashrc && git diff --check
```

预期：全部退出码为 0。

- [ ] **步骤 3：核对最终差异**

确认只修改共享分析路由、Phase 2 回归和本需求相关文档，不修改外部车型 JSON/DBC，也不创建 Git 提交。