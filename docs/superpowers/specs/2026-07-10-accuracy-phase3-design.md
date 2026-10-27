# Jira 解票准确率提升 — Phase 3 设计规格

> 版本：1.0
> 日期：2026-07-10
> 状态：待实现
> 优先级：先提升评测可信度，再提升模型输出质量

---

## 1. 背景

当前项目已经具备 Phase 1 和 Phase 2 的准确率闭环：

- `npm run eval:accuracy` 可回放 `log/` 产物并生成 EGR、信号召回率、关键判断命中率和错误归因。
- `evidence-packet.json` 已作为 Step 5、结构化校验和离线评测的共享证据输入。
- Step 5 已具备低温输出、高优先级 self-consistency、证据自批判和结构化证据包注入。
- RAG 已支持 embedding 召回、标题 fallback、车型偏好和 evidence fingerprint 字段。

最新本地评测报告显示：

- 评测票数：67，跳过 4。
- 平均 EGR：58.8%。
- 错误归因以 `ungrounded_conclusion=46` 为主。
- `docs/golden-baseline/eval-set.json` 仍是稀疏人工真值，当前信号召回率和关键判断命中率不能被解释为整体准确率。

Phase 3 的核心不是继续堆模型调用，而是让系统更可靠地判断：

1. 证据是否真实覆盖问题时间窗。
2. 最终结论中的信号、时间、值和判断是否能被证据支持。
3. 人工真值是否足够代表真实票据分布。
4. few-shot 案例是否在拿到真实 prop / signal / propertyId 后再次精召回。

---

## 2. 目标

### 2.1 产品目标

- 让准确率报告更接近真实质量，而不是只给出粗粒度 EGR。
- 明确降低 `ungrounded_conclusion` 类型错误。
- 保持 Jira 回填仍由人工复核控制，不把新校验变成硬阻断。

### 2.2 工程目标

- 修复 Evidence Packet 的时间窗重叠判断，使 `timeWindow.overlap` 表示真实可计算结果。
- 增强 `computeGrounding()`，支持时间、数值、prop / signal 别名和 Evidence Packet 字段的归一化匹配。
- 增加评测集覆盖报告，暴露人工真值数量、车型覆盖和错误类型覆盖，不直接覆盖用户现有 `eval-set.json`。
- 将 few-shot RAG 调整为两段式：处理前粗召回，Step 5 前基于 Evidence Packet 精召回。

### 2.3 非目标

- 不引入后端数据库或外部向量库。
- 不替换现有 Qwen 模型。
- 不自动修改现有人工评测集中的用户数据。
- 不阻断 Jira 回填；所有新增校验仍作为审计和人工复核辅助。
- 不重写 `app/api/issues/process/route.ts` 的主流程，只在现有证据边界上增量增强。

---

## 3. 总体设计

Phase 3 分为 4 个单元：

| 单元 | 名称 | 作用 |
|---|---|---|
| U1 | 评测集覆盖报告 | 告诉用户当前人工真值是否足够可信 |
| U2 | 时间窗真实重叠 | 修复 Evidence Packet 对 comment / trace 时间窗的判定 |
| U3 | Grounding 归一化 | 降低因格式差异导致的误判，并提高未接地断言识别质量 |
| U4 | Step 5 二段式 RAG | 用真实 Evidence Packet 再召回历史纠错案例 |

推荐实现顺序：

1. 先加回归检查和评测覆盖报告。
2. 再修复时间窗 overlap。
3. 再增强 grounding。
4. 最后把二段式 RAG 接到 Step 5。

---

## 4. U1 — 评测集覆盖报告

### 4.1 输入

- `docs/golden-baseline/eval-set.json`
- `docs/golden-baseline/eval-report.json`
- `log/**/evidence-packet.json`

### 4.2 输出

新增：

- `docs/golden-baseline/eval-set-coverage.json`
- `docs/golden-baseline/eval-set-coverage.md`

报告字段：

```json
{
  "generatedAt": "2026-07-10T00:00:00.000Z",
  "evalSetCount": 1,
  "evaluatedTicketCount": 67,
  "coverageRatio": 0.0149,
  "byRuleGroup": {
    "T1L_FL1_8255": 1
  },
  "byCarModel": {
    "T1L_FL1": 1
  },
  "expectedSignalsCount": 2,
  "expectedKeywordsCount": 1,
  "recommendation": "人工真值过少，信号召回率和关键判断命中率只能作为样例指标"
}
```

### 4.3 行为

- 覆盖报告只读现有文件，不自动增删 `eval-set.json`。
- `npm run eval:accuracy` 完成后可顺带生成覆盖报告。
- 覆盖率不足时只在报告中提示，不让 CI 失败。

---

## 5. U2 — 时间窗真实重叠

### 5.1 当前问题

`lib/analysis/evidence-packet.ts` 的 `computeWindowOverlap()` 当前只要 comment 时间窗和 trace 起止存在就返回 `true`。这会导致时间窗错配不能被归因为 `time_window_mismatch`。

### 5.2 新行为

新增时间解析函数：

- 支持 `YYYY-MM-DD HH:mm:ss.SSS`
- 支持 `YYYY-MM-DDTHH:mm:ss.SSS`
- 支持只有 `HH:mm:ss.SSS` 的时间，借用 trace 日期或 comment 日期补齐。
- 无法解析时返回 `null`。

真实 overlap 规则：

```text
commentStart <= traceEnd && traceStart <= commentEnd
```

输出含义：

| 情况 | overlap |
|---|---|
| 全部时间可解析且有交集 | `true` |
| 全部时间可解析但无交集 | `false` |
| 有任一关键时间不可解析 | `null` |

`classifyEvidenceErrors()` 继续按 `overlap === false` 归类 `time_window_mismatch`。对于 `overlap === null` 且 source 为 `fallback`，仍按证据不足处理。

---

## 6. U3 — Grounding 归一化

### 6.1 当前问题

`computeGrounding()` 当前主要依赖原始字符串包含关系。以下情况容易误判：

- 证据中是 `2026-06-25 17:18:24.943`，结论中写 `17:18:24.943`。
- 证据中是 `0x7B`，结论中写 `123`。
- 证据中是 prop，结论中写 matched signal。
- 结论中出现 `getMsgId 为 null` 一类诊断值，但 Evidence Packet 里是结构字段。

### 6.2 新行为

新增归一化证据索引：

```typescript
interface GroundingEvidenceIndex {
  rawText: string;
  normalizedText: string;
  times: string[];
  numericValues: string[];
  props: string[];
  signals: string[];
  propertyIds: string[];
}
```

匹配策略：

- 先做现有原文匹配。
- 再做归一化文本匹配。
- 时间断言允许在同一秒或同一毫秒格式内等价。
- signal 断言允许 prop、matched signal 和 source token 互相命中。
- propertyId 允许十进制和十六进制互相命中。

仍然保持保守：如果不能证明接地，不强行判定 pass。

---

## 7. U4 — Step 5 二段式 RAG

### 7.1 当前问题

前端 `fetchFewShotSamples()` 在处理前执行，此时只有票号、标题、规则组和车型等粗信息。真正能决定相似错误模式的 prop、signal、propertyId 要到 Step 2 / Evidence Packet 生成后才可用。

### 7.2 新行为

保留现有处理前粗召回：

- 用标题、车型和规则组先取最多 3 条候选。
- 失败时继续 fallback，不影响处理。

新增 Step 5 前精召回：

- 从 Evidence Packet 构建 retrieval text：
  - ruleGroup
  - carModel
  - matchedProps
  - signals
  - propertyIds
  - missingEvidence
  - riskFlags
- 在服务端调用一个新的纯函数选择更相关的 few-shot 案例。
- 如果服务端无法访问 IndexedDB 中的历史样本，则先只对前端已传入的 few-shot 样本重排；后续再评估是否需要把学习样本通过请求体显式传入更多候选。

### 7.3 Prompt 接入

Step 5 的 `<历史纠错案例>` 分为两部分：

- `粗召回案例`：处理前已有。
- `证据精召回案例`：Evidence Packet 生成后基于 prop / signal / propertyId 重排。

如果两者重复，按 `issueKey` 去重。

---

## 8. 风险与降级

- 时间解析失败：`overlap=null`，不制造错误结论。
- 覆盖报告缺少输入：输出 N/A，不阻断 `eval:accuracy`。
- Grounding 归一化误判风险：先保守匹配，只增加明确等价规则。
- 二段式 RAG 无可用样本：保留现有 few-shot block。
- 任何新增逻辑失败：记录日志，回退现有路径。

---

## 9. 验证

新增或扩展命令：

- `npm run test:accuracy-phase3`
- `npm run test:accuracy-phase2`
- `npm run test:accuracy-phase1`
- `npm run test:signal-rag`
- `npm run test:evidence-validation`
- `npm run eval:accuracy`

验收标准：

- `computeWindowOverlap()` 对有交集、无交集、不可解析三类样例返回正确结果。
- `eval-report.json` 的 `time_window_mismatch` 不再依赖假 true。
- `eval-set-coverage.md` 明确提示人工真值稀疏程度。
- EGR 归一化后，明显格式等价的时间 / propertyId 不再被算作未接地。
- Step 5 的 few-shot block 能体现 Evidence Packet 精召回或重排结果。
