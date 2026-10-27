# Jira 解票准确率提升 — Phase 2 设计规格

> 版本：1.0
> 日期：2026-07-01
> 状态：待实现（已通过头脑风暴确认方向）
> 优先级：准确率优先

---

## 1. 背景与目标

### 1.1 当前基础

当前项目已经完成 Phase 1 准确率闭环：

- `pipeline-metrics.json` 记录阶段耗时、证据完整性和 grounding 指标。
- `npm run eval:accuracy` 可离线回放 `log/` 产物，输出 EGR、信号召回率和关键判断命中率。
- Step 2 已有 exact / fuzzy / self_check 信号补救。
- Step 5 已使用低温结构化输出、高优先级票 self-consistency 和证据自批判。
- 已有结构化证据校验、prop/signal RAG 和人工复核学习样本。

这些能力已经形成可用闭环，但评测报告仍偏“结果指标”，尚不能稳定回答“为什么这张票不准”；Step 5 仍主要读取拼接文本，模型容易受长文本噪声、证据重复和上下文顺序影响。

### 1.2 Phase 2 目标

Phase 2 聚焦准确率，不以重写 pipeline 或更换模型为目标。核心目标是：

1. 把离线评测升级为可归因报告，定位准确率损失来自信号、时间窗、日志证据、RAG 或最终推理。
2. 在 Step 5 前生成统一结构化 Evidence Packet，作为最终分析、结构化校验和离线评测的共享证据输入。
3. 增强信号候选池，让 Jira 文本、OCR、历史错例和车型配置共同参与受限候选匹配，提高关键 prop/signal 召回率。

### 1.3 非目标

- 不阻断 Jira 回填；校验和风险标记继续作为辅助审计信号。
- 不引入后端数据库、向量库或云同步。
- 不替换现有 Qwen 模型配置。
- 不删除 Phase 1 的 exact / fuzzy / self_check 逻辑。
- 不把所有历史产物强制迁移；历史票可以在缺少 Evidence Packet 时继续按现有评测方式回放。
- 不优先做批量处理提速；本阶段速度收益只来自证据结构化带来的 prompt 瘦身。

---

## 2. 总体设计

Phase 2 由三个独立单元组成：

| 单元 | 职责 | 主要输出 |
|---|---|---|
| U1 错误归因评测 | 在现有 `eval:accuracy` 基础上为每张票标记失败原因 | `eval-report.{json,md}` 增加 error categories |
| U2 Evidence Packet | 聚合 signals、Property ID、时间窗、日志命中和缺失证据 | `evidence-packet.json` |
| U3 信号候选池增强 | 从更多上下文构建候选 token，并进行受限匹配 | `signals.json` 增加 candidateSources / recoveryReason |

推荐落地顺序：

1. 先扩展评测归因，建立 Phase 2 基线。
2. 再生成 Evidence Packet，并让 Step 5 优先读取它。
3. 最后增强信号候选池，用评测报告验证召回率变化。

---

## 3. U1 — 错误归因评测

### 3.1 输入

复用 `scripts/eval-accuracy.ts` 当前输入：

- `log/{ruleGroup}/{carModel}/{issueKey}/final_reply.md`
- `can_signal_summary.txt`
- `can_trace_extracted_result.txt`
- `signals.json`
- `signals_id.json`
- `extract.md`
- `pipeline-metrics.json`
- 可选 `docs/golden-baseline/eval-set.json`
- 可选 `evidence-packet.json`

### 3.2 错误分类

每张票输出 `errorCategories`，允许多个分类并存：

| 分类 | 判定依据 |
|---|---|
| `signal_missing` | `eval-set.json.expectedSignals` 未在 `signals.json` / `evidence-packet.json.matchedProps` 命中 |
| `time_window_mismatch` | 评论时间窗缺失、回退到 fallback，或 Evidence Packet 中 trace/comment 时间窗无交集 |
| `log_evidence_missing` | `extract.md` 为空或 `pipeline-metrics.evidenceCompleteness.androidQnxLogLinesFound` 为 false |
| `ungrounded_conclusion` | `computeGrounding()` 存在未接地断言 |
| `rag_mismatch` | 召回样本车型、prop 或 propertyId 与当前票 Evidence Packet 低重合 |
| `low_confidence_evidence` | 证据缺失但最终结论未标低置信度，或 Evidence Packet 有高风险缺口 |

分类只用于报告，不改变在线处理结果。

### 3.3 报告增强

`eval-report.json` 每票增加：

```json
{
  "ticketDir": "chery T1J_FL3-8255/T1J_FL3_8255/FL3-490",
  "egr": 0.72,
  "signalRecall": 0.5,
  "keywordHitRate": 1,
  "errorCategories": ["signal_missing", "ungrounded_conclusion"],
  "riskFlags": ["missing_comment_time_window"],
  "topMissingEvidence": ["CouplingFaultStatus_253h"]
}
```

`eval-report.md` 增加：

- 错误分类聚合排名。
- 每类错误的样例票。
- Phase 2 推荐优先修复点。

---

## 4. U2 — Evidence Packet

### 4.1 位置

在 `app/api/issues/process/route.ts` 中，完成以下产物后生成：

- `signals.json`
- `signals_id.json`
- `can_signal_summary.txt`
- `can_trace_extracted_result.txt`
- `extract.md`
- `step4_android_qnx_input.md`
- `pipeline-metrics.json`

生成时机应在 Step 5 前，使 Step 5 可以优先读取结构化证据。

### 4.2 数据结构

新增文件：`log/{ruleGroup}/{carModel}/{issueKey}/evidence-packet.json`。

建议结构：

```json
{
  "issueKey": "FL3-490",
  "ruleGroupId": "chery T1J_FL3-8255",
  "ruleGroupName": "Chery T1J FL3 8255",
  "carModel": "T1J_FL3_8255",
  "timeWindow": {
    "commentStart": "2026-06-25 17:18:24.000",
    "commentEnd": "2026-06-25 17:18:54.000",
    "traceStart": "2026-06-25 17:18:20.000",
    "traceEnd": "2026-06-25 17:19:10.000",
    "source": "comment_timestamp",
    "overlap": true
  },
  "matchedProps": [
    {
      "prop": "CouplingFaultStatus_253h",
      "sourceTokens": ["CouplingFaultStatus_253h"],
      "matchedBy": ["prop", "fuzzy"],
      "propertyId": { "decimal": 123, "hex": "0x7b" },
      "signals": ["CouplingFaultStatus_253h"]
    }
  ],
  "signalIntervals": [
    {
      "signal": "CouplingFaultStatus_253h",
      "value": "0",
      "start": "2026-06-25 17:18:30.000",
      "end": "2026-06-25 17:18:55.280",
      "frames": 1189
    }
  ],
  "logHits": [
    {
      "source": "qnx",
      "propertyId": "0x7b",
      "lineCount": 12,
      "sample": "17:18:31.204 propertyId=0x7b value=0"
    }
  ],
  "missingEvidence": [
    {
      "type": "signal",
      "name": "ExpectedSignal",
      "reason": "not_found_in_trace"
    }
  ],
  "riskFlags": [
    "missing_comment_time_window",
    "unmatched_signal_tokens"
  ]
}
```

### 4.3 Step 5 接入

Step 5 prompt 结构调整为：

1. 优先注入 `<结构化证据包>`，内容为精简 JSON。
2. 保留 `CAN Trace提取结果`、`extract.md`、上层日志摘要作为补充证据。
3. 在 `STEP5_OUTPUT_CONSTRAINT` 中要求每条证据优先引用 Evidence Packet 字段；若 Evidence Packet 标记缺失证据，结论必须降置信度。

这不是删除长文本证据，而是改变优先级：结构化证据为主，长文本为辅助。

### 4.4 校验与评测复用

`validateStructuredEvidence()` 和 `eval:accuracy` 都应优先读取 Evidence Packet：

- 有 Evidence Packet：用其 `matchedProps`、`signalIntervals`、`logHits` 和 `missingEvidence` 做结构化比对。
- 无 Evidence Packet：回退 Phase 1 的文本拼接证据。

---

## 5. U3 — 信号候选池增强

### 5.1 当前问题

Step 2 已有补救，但 raw token 主要来自模型输出和文本正则。若 Jira 描述使用业务现象、缩写、截图文本或历史错例中的说法，关键 prop 可能一开始就没有进入候选集合。

### 5.2 候选来源

构建 `SignalCandidatePool`，来源包括：

- Jira summary / description / comments。
- 图片 OCR 文本。
- Step 2 输出。
- 当前车型配置中的 `prop`、`getSignals`、`setSignals`。
- 当前规则组历史人工改判样本中的 `props`、`signalTokens`、`propertyIds`。
- Evidence fingerprint / RAG 召回样本中的相关字段。

每个候选保留来源：

```json
{
  "token": "CouplFaultSts",
  "normalized": "COUPLFAULTSTS",
  "sources": ["jira_comment", "ocr", "review_sample"],
  "weight": 0.86
}
```

### 5.3 匹配约束

候选池只能扩大“待匹配 token”，不能扩大“允许输出的信号”。最终匹配仍必须落到当前车型配置中的真实 `prop` / `getSignals` / `setSignals`。

匹配顺序：

1. exact。
2. fuzzy / alias。
3. self_check，从当前车型候选列表中选择或返回 null。

输出到 `signals.json`：

- `candidateSources`：每个 token 的来源。
- `recovered[].recoveryReason`：命中原因。
- `unmatched`：仍未命中的 token。

### 5.4 风险控制

- OCR 和历史样本只提供候选 token，不直接认定真实信号。
- 跨车型历史样本不得直接提升权重到同车型样本之上。
- self_check 输出候选外 prop 一律丢弃。
- 每个 token 最多映射一个最佳 prop，避免把业务词泛化到多个信号。

---

## 6. 错误处理

| 场景 | 处理 |
|---|---|
| Evidence Packet 生成失败 | 记录日志，Step 5 回退 Phase 1 文本输入 |
| Evidence Packet 字段缺失 | 字段留空并写入 `missingEvidence` / `riskFlags` |
| eval 读取旧历史票 | 没有 `evidence-packet.json` 时使用现有文本证据 |
| RAG 样本缺少 fingerprint | 继续按标题/文本相似度召回 |
| 候选池为空 | 回退现有 Step 2 token 匹配 |
| self_check 调用失败 | 保留 exact + fuzzy 结果，不中断 |

---

## 7. 测试与验收

### 7.1 新增或扩展检查

- 扩展 `scripts/eval-accuracy.ts`：输出 `errorCategories` 和分类聚合。
- 新增或扩展静态检查脚本，覆盖：
  - Evidence Packet 生成函数存在。
  - Step 5 prompt 注入 Evidence Packet。
  - `eval:accuracy` 优先读取 Evidence Packet 并兼容旧日志。
  - 信号候选池来源只扩大 token，不允许输出配置外 prop。

### 7.2 回归命令

实现后至少运行：

- `npm run eval:accuracy`
- `npm run test:accuracy-phase1`
- `npm run test:signal-rag`
- `npm run test:evidence-validation`
- `npx tsc --noEmit`
- `npm run lint`

### 7.3 验收标准

- `eval-report.md` 能按错误分类聚合展示失败原因。
- 新处理票落盘 `evidence-packet.json`。
- Step 5 最终结论能引用 Evidence Packet 中的结构化证据，证据缺失时明确低置信度。
- 旧历史票没有 Evidence Packet 时仍能被 `eval:accuracy` 回放。
- `signals.json` 能展示候选来源、补救原因和未命中 token。
- EGR、信号召回率、关键判断命中率不低于 Phase 1 基线，目标是至少一个指标有可解释提升。

---

## 8. 文档同步范围

实现 Phase 2 时需要同步：

- `docs/PRODUCT.md`：补充 Evidence Packet、错误归因评测和信号候选池增强属于准确率闭环。
- `docs/ARCHITECTURE.md`：补充 Evidence Packet 在处理 pipeline 中的位置。
- `docs/WORKFLOW.md`：补充 Step 5 优先读取结构化证据包的流程。
- `docs/SEQUENCE_DIAGRAMS.md`：补充 Evidence Packet 与离线评测时序。
- `session-handoff.md`：记录 Phase 2 完成状态和验证命令。

---

## 9. 显式不做

- 不做硬性自动驳回。
- 不做跨规则组自动学习。
- 不新增后端持久化数据库。
- 不把 OCR 或历史错例直接当成事实证据。
- 不为了提速跳过人工复核或结构化校验。
