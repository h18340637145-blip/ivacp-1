# Jira 解票准确率 Phase 2 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现 Phase 2 准确率增强：错误归因评测、结构化 Evidence Packet、Step 5 证据包优先输入、信号候选池增强。

**架构：** 新增 `lib/analysis/evidence-packet.ts` 作为结构化证据聚合边界，在线处理、结构化校验和离线评测共用它。`app/api/issues/process/route.ts` 只负责收集现有 pipeline 产物并落盘 Evidence Packet，Step 5 优先注入证据包但保留 Phase 1 文本证据兜底。`scripts/eval-accuracy.ts` 增加错误归因，旧历史票没有证据包时继续回退文本证据。

**技术栈：** Next.js API Route、TypeScript、Node fs/path、现有 Qwen wrapper、IndexedDB/Dexie 前端数据、现有 `tsx`/静态检查脚本。

---

## 文件结构

新增：

- `lib/analysis/evidence-packet.ts`：定义 Evidence Packet 类型、构建函数、信号区间解析、错误归因辅助函数。
- `scripts/check-accuracy-phase2.mjs`：静态回归检查，覆盖证据包模块、评测归因、Step 5 接入、候选池约束、文档同步。

修改：

- `scripts/eval-accuracy.ts`：读取可选 `evidence-packet.json`，输出 `errorCategories`、`riskFlags`、`topMissingEvidence` 和分类聚合。
- `app/api/issues/process/route.ts`：生成并落盘 `evidence-packet.json`；Step 5 prompt 优先注入结构化证据包；增强信号候选池并扩展 `signals.json`。
- `lib/analysis/structured-evidence-validation.ts`：允许结构化校验读取 Evidence Packet 文本并把其作为优先证据来源。
- `package.json`：注册 `test:accuracy-phase2`。
- `docs/PRODUCT.md`：补充 Phase 2 准确率闭环能力。
- `docs/ARCHITECTURE.md`：补充 Evidence Packet 在 pipeline 中的位置。
- `docs/WORKFLOW.md`：补充 Step 5 证据包优先输入流程。
- `docs/SEQUENCE_DIAGRAMS.md`：补充 Evidence Packet 与离线评测时序。
- `session-handoff.md`：实现完成后把 Phase 2 待办标记完成并记录验证命令。

不修改：

- 不改 Jira 回填权限边界。
- 不引入后端数据库。
- 不移除 Phase 1 的 exact / fuzzy / self_check。

---

### 任务 1：新增 Phase 2 静态检查脚本

**文件：**
- 创建：`scripts/check-accuracy-phase2.mjs`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的检查脚本**

创建 `scripts/check-accuracy-phase2.mjs`：

```javascript
#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf-8");
const exists = (file) => fs.existsSync(path.join(root, file));
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const evidencePacketPath = "lib/analysis/evidence-packet.ts";
assert(exists(evidencePacketPath), "缺少 lib/analysis/evidence-packet.ts");

if (exists(evidencePacketPath)) {
  const evidence = read(evidencePacketPath);
  assert(/export interface EvidencePacket/.test(evidence), "EvidencePacket 类型未导出");
  assert(/export function buildEvidencePacket/.test(evidence), "buildEvidencePacket 未导出");
  assert(/export function classifyEvidenceErrors/.test(evidence), "classifyEvidenceErrors 未导出");
  assert(/signal_missing/.test(evidence), "错误归因缺少 signal_missing");
  assert(/time_window_mismatch/.test(evidence), "错误归因缺少 time_window_mismatch");
  assert(/ungrounded_conclusion/.test(evidence), "错误归因缺少 ungrounded_conclusion");
}

const evalScript = read("scripts/eval-accuracy.ts");
assert(/evidence-packet\.json/.test(evalScript), "eval-accuracy 未读取 evidence-packet.json");
assert(/errorCategories/.test(evalScript), "eval-accuracy 未输出 errorCategories");
assert(/categoryCounts/.test(evalScript), "eval-accuracy 未输出分类聚合");

const route = read("app/api/issues/process/route.ts");
assert(/buildEvidencePacket/.test(route), "process route 未调用 buildEvidencePacket");
assert(/evidence-packet\.json/.test(route), "process route 未落盘 evidence-packet.json");
assert(/<结构化证据包>/.test(route), "Step5 prompt 未注入结构化证据包");
assert(/candidateSources/.test(route), "signals.json 未记录 candidateSources");
assert(/recoveryReason/.test(route), "recovered 命中未记录 recoveryReason");

const validation = read("lib/analysis/structured-evidence-validation.ts");
assert(/evidencePacketText/.test(validation), "结构化校验未接收 evidencePacketText");

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts?.["test:accuracy-phase2"] === "node scripts/check-accuracy-phase2.mjs", "package.json 未注册 test:accuracy-phase2");

for (const doc of ["docs/PRODUCT.md", "docs/ARCHITECTURE.md", "docs/WORKFLOW.md", "docs/SEQUENCE_DIAGRAMS.md", "session-handoff.md"]) {
  const content = read(doc);
  assert(/Evidence Packet|evidence-packet|证据包|错误归因/.test(content), `${doc} 未同步 Phase 2 文档`);
}

if (failures.length > 0) {
  console.error("Phase 2 accuracy checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Phase 2 accuracy checks passed.");
```

- [ ] **步骤 2：注册 npm script**

在 `package.json` 的 `scripts` 里加入：

```json
"test:accuracy-phase2": "node scripts/check-accuracy-phase2.mjs"
```

保持 JSON 逗号合法，建议放在 `test:accuracy-tuning` 后面。

- [ ] **步骤 3：运行检查确认失败**

运行：

```bash
npm run test:accuracy-phase2
```

预期：FAIL，至少包含 `缺少 lib/analysis/evidence-packet.ts`。

- [ ] **步骤 4：Commit**

```bash
git add scripts/check-accuracy-phase2.mjs package.json
git commit -m "test: add accuracy phase2 guard"
```

---

### 任务 2：新增 Evidence Packet 纯函数模块

**文件：**
- 创建：`lib/analysis/evidence-packet.ts`
- 修改：`scripts/check-accuracy-phase2.mjs` 如果检查字段需要与最终类型名对齐

- [ ] **步骤 1：创建类型和最小构建函数**

创建 `lib/analysis/evidence-packet.ts`：

```typescript
import { computeGrounding } from "@/lib/analysis/structured-evidence-validation";

export type EvidenceErrorCategory =
  | "signal_missing"
  | "time_window_mismatch"
  | "log_evidence_missing"
  | "ungrounded_conclusion"
  | "rag_mismatch"
  | "low_confidence_evidence";

export interface EvidencePacketTimeWindow {
  commentStart?: string;
  commentEnd?: string;
  traceStart?: string;
  traceEnd?: string;
  source: "comment_timestamp" | "comment_time_only" | "trace_timestamp" | "fallback" | "unknown";
  overlap: boolean | null;
}

export interface EvidencePacketMatchedProp {
  prop: string;
  sourceTokens: string[];
  matchedBy: string[];
  propertyId?: {
    decimal: number | null;
    hex: string | null;
  };
  signals: string[];
}

export interface EvidencePacketSignalInterval {
  signal: string;
  value: string;
  start?: string;
  end?: string;
  frames?: number;
}

export interface EvidencePacketLogHit {
  source: "android" | "qnx" | "extract" | "unknown";
  propertyId?: string;
  lineCount: number;
  sample?: string;
}

export interface EvidencePacketMissingEvidence {
  type: "signal" | "property_id" | "time_window" | "log" | "can_trace";
  name: string;
  reason: string;
}

export interface EvidencePacket {
  issueKey: string;
  ruleGroupId: string;
  ruleGroupName: string;
  carModel: string;
  timeWindow: EvidencePacketTimeWindow;
  matchedProps: EvidencePacketMatchedProp[];
  signalIntervals: EvidencePacketSignalInterval[];
  logHits: EvidencePacketLogHit[];
  missingEvidence: EvidencePacketMissingEvidence[];
  riskFlags: string[];
}

export interface BuildEvidencePacketInput {
  issueKey: string;
  ruleGroupId: string;
  ruleGroupName: string;
  carModel: string;
  commentTimeWindow?: {
    start: string;
    end: string;
    source: EvidencePacketTimeWindow["source"];
  };
  traceStartTime?: string;
  traceEndTime?: string;
  signalMatches: Array<{
    prop: string;
    sourceToken: string;
    matchedBy: string;
    matchedSignal: string | null;
  }>;
  signalIdRecords: Array<{
    prop: string;
    decimalId: number | null;
    hexId: string | null;
    sourceTokens: string[];
    matchedSignals: string[];
  }>;
  signalSummary?: string;
  extractMarkdown?: string;
  androidLog?: string;
  qnxLog?: string;
  unmatchedTokens?: string[];
}

function hasText(value?: string): boolean {
  return Boolean(value && value.trim());
}

function computeWindowOverlap(input: BuildEvidencePacketInput): boolean | null {
  const comment = input.commentTimeWindow;
  if (!comment || !input.traceStartTime || !input.traceEndTime) return null;
  return true;
}

export function parseSignalIntervals(signalSummary = ""): EvidencePacketSignalInterval[] {
  const intervals: EvidencePacketSignalInterval[] = [];
  const pattern = /([A-Za-z][A-Za-z0-9_]+)\s*=\s*([A-Za-z0-9_.-]+).*?持续\s*(\d+)\s*帧(?:（([^~）]+)\s*~\s*([^）]+)）)?/g;
  for (const match of signalSummary.matchAll(pattern)) {
    intervals.push({
      signal: match[1],
      value: match[2],
      frames: Number(match[3]),
      start: match[4]?.trim(),
      end: match[5]?.trim(),
    });
  }
  return intervals;
}

function buildMatchedProps(input: BuildEvidencePacketInput): EvidencePacketMatchedProp[] {
  const byProp = new Map<string, EvidencePacketMatchedProp>();
  for (const record of input.signalIdRecords) {
    byProp.set(record.prop, {
      prop: record.prop,
      sourceTokens: Array.from(record.sourceTokens),
      matchedBy: [],
      propertyId: { decimal: record.decimalId, hex: record.hexId },
      signals: Array.from(record.matchedSignals),
    });
  }

  for (const match of input.signalMatches) {
    const existing = byProp.get(match.prop) ?? {
      prop: match.prop,
      sourceTokens: [],
      matchedBy: [],
      signals: [],
    };
    if (!existing.sourceTokens.includes(match.sourceToken)) existing.sourceTokens.push(match.sourceToken);
    if (!existing.matchedBy.includes(match.matchedBy)) existing.matchedBy.push(match.matchedBy);
    if (match.matchedSignal && !existing.signals.includes(match.matchedSignal)) existing.signals.push(match.matchedSignal);
    byProp.set(match.prop, existing);
  }

  return Array.from(byProp.values());
}

function buildLogHits(input: BuildEvidencePacketInput): EvidencePacketLogHit[] {
  const hits: EvidencePacketLogHit[] = [];
  const sources: Array<[EvidencePacketLogHit["source"], string | undefined]> = [
    ["extract", input.extractMarkdown],
    ["android", input.androidLog],
    ["qnx", input.qnxLog],
  ];
  for (const [source, text] of sources) {
    if (!hasText(text)) continue;
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    hits.push({ source, lineCount: lines.length, sample: lines[0]?.slice(0, 240) });
  }
  return hits;
}

export function buildEvidencePacket(input: BuildEvidencePacketInput): EvidencePacket {
  const missingEvidence: EvidencePacketMissingEvidence[] = [];
  const riskFlags: string[] = [];

  if (!hasText(input.signalSummary)) {
    missingEvidence.push({ type: "can_trace", name: "can_signal_summary", reason: "missing_signal_summary" });
    riskFlags.push("missing_can_signal_summary");
  }
  if (!input.commentTimeWindow || input.commentTimeWindow.source === "fallback") {
    missingEvidence.push({ type: "time_window", name: "comment_time_window", reason: "missing_comment_time_window" });
    riskFlags.push("missing_comment_time_window");
  }
  if (input.unmatchedTokens && input.unmatchedTokens.length > 0) {
    riskFlags.push("unmatched_signal_tokens");
  }

  const matchedProps = buildMatchedProps(input);
  for (const prop of matchedProps) {
    if (!prop.propertyId || prop.propertyId.decimal === null) {
      missingEvidence.push({ type: "property_id", name: prop.prop, reason: "missing_property_id" });
    }
  }

  const logHits = buildLogHits(input);
  if (logHits.length === 0) {
    missingEvidence.push({ type: "log", name: "android_qnx_extract", reason: "missing_filtered_log_hits" });
    riskFlags.push("missing_log_hits");
  }

  return {
    issueKey: input.issueKey,
    ruleGroupId: input.ruleGroupId,
    ruleGroupName: input.ruleGroupName,
    carModel: input.carModel,
    timeWindow: {
      commentStart: input.commentTimeWindow?.start,
      commentEnd: input.commentTimeWindow?.end,
      traceStart: input.traceStartTime,
      traceEnd: input.traceEndTime,
      source: input.commentTimeWindow?.source ?? "unknown",
      overlap: computeWindowOverlap(input),
    },
    matchedProps,
    signalIntervals: parseSignalIntervals(input.signalSummary),
    logHits,
    missingEvidence,
    riskFlags,
  };
}

export interface ClassifyEvidenceErrorsInput {
  replyText: string;
  evidenceText: string;
  evidencePacket?: EvidencePacket | null;
  expectedSignals?: string[];
  signalRecall?: number;
  ragSamples?: Array<{ carModel?: string; props?: string[]; propertyIds?: string[] }>;
}

export function classifyEvidenceErrors(input: ClassifyEvidenceErrorsInput): {
  errorCategories: EvidenceErrorCategory[];
  riskFlags: string[];
  topMissingEvidence: string[];
} {
  const categories = new Set<EvidenceErrorCategory>();
  const riskFlags = new Set<string>(input.evidencePacket?.riskFlags ?? []);
  const missing = new Set<string>();

  if (typeof input.signalRecall === "number" && input.signalRecall < 1) {
    categories.add("signal_missing");
  }
  const matchedNames = new Set((input.evidencePacket?.matchedProps ?? []).map((item) => item.prop.toUpperCase()));
  for (const signal of input.expectedSignals ?? []) {
    if (!matchedNames.has(signal.toUpperCase())) {
      categories.add("signal_missing");
      missing.add(signal);
    }
  }
  if (input.evidencePacket?.timeWindow.overlap === false || input.evidencePacket?.timeWindow.source === "fallback") {
    categories.add("time_window_mismatch");
  }
  if ((input.evidencePacket?.logHits.length ?? 0) === 0) {
    categories.add("log_evidence_missing");
  }

  const grounding = computeGrounding(input.replyText, input.evidenceText);
  for (const item of grounding.ungrounded) missing.add(item.rawText);
  if (grounding.ungrounded.length > 0) {
    categories.add("ungrounded_conclusion");
  }

  const hasLowConfidenceText = /低置信度|证据不足|无法判断/.test(input.replyText);
  if ((input.evidencePacket?.missingEvidence.length ?? 0) > 0 && !hasLowConfidenceText) {
    categories.add("low_confidence_evidence");
  }

  return {
    errorCategories: Array.from(categories),
    riskFlags: Array.from(riskFlags),
    topMissingEvidence: Array.from(missing).slice(0, 8),
  };
}
```

- [ ] **步骤 2：运行静态检查确认局部通过**

运行：

```bash
npm run test:accuracy-phase2
```

预期：仍然 FAIL，但不再出现 `缺少 lib/analysis/evidence-packet.ts`、`EvidencePacket 类型未导出`、`buildEvidencePacket 未导出`。

- [ ] **步骤 3：运行类型检查**

运行：

```bash
npx tsc --noEmit
```

预期：PASS。若 `@/` alias 在脚本上下文不影响 TS 编译，可继续；若 TS 报 alias 问题，保持现有项目 import 风格，改为相对路径不是首选。

- [ ] **步骤 4：Commit**

```bash
git add lib/analysis/evidence-packet.ts scripts/check-accuracy-phase2.mjs
git commit -m "feat(accuracy): add evidence packet model"
```

---

### 任务 3：扩展离线评测错误归因

**文件：**
- 修改：`scripts/eval-accuracy.ts`
- 测试：`scripts/check-accuracy-phase2.mjs`

- [ ] **步骤 1：扩展评测类型**

在 `scripts/eval-accuracy.ts` 顶部 import：

```typescript
import {
  classifyEvidenceErrors,
  type EvidencePacket,
  type EvidenceErrorCategory,
} from "../lib/analysis/evidence-packet";
```

把 `TicketResult` 扩展为：

```typescript
interface TicketResult {
  ticketDir: string;
  egr: number;
  total: number;
  ungrounded: string[];
  signalRecall?: number;
  keywordHitRate?: number;
  errorCategories: EvidenceErrorCategory[];
  riskFlags: string[];
  topMissingEvidence: string[];
}
```

- [ ] **步骤 2：增加证据包读取函数**

在 `buildEvidenceText()` 后添加：

```typescript
async function loadEvidencePacket(ticketDir: string): Promise<EvidencePacket | null> {
  const raw = await readTextSafe(path.join(ticketDir, "evidence-packet.json"));
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as EvidencePacket;
  } catch {
    return null;
  }
}
```

- [ ] **步骤 3：把 Evidence Packet 纳入证据文本**

修改 `buildEvidenceText()`：

```typescript
async function buildEvidenceText(ticketDir: string): Promise<string> {
  const parts = await Promise.all([
    readTextSafe(path.join(ticketDir, "evidence-packet.json")),
    readTextSafe(path.join(ticketDir, "can_signal_summary.txt")),
    readTextSafe(path.join(ticketDir, "can_trace_extracted_result.txt")),
    readTextSafe(path.join(ticketDir, "signals_id.json")),
    readTextSafe(path.join(ticketDir, "extract.md")),
  ]);
  return parts.filter(Boolean).join("\n");
}
```

- [ ] **步骤 4：输出错误归因字段**

在循环里生成 `result` 后、push 前加入：

```typescript
const evidencePacket = await loadEvidencePacket(ticketDir);
const classification = classifyEvidenceErrors({
  replyText,
  evidenceText,
  evidencePacket,
  expectedSignals: evalEntry?.expectedSignals,
  signalRecall: result.signalRecall,
});
result.errorCategories = classification.errorCategories;
result.riskFlags = classification.riskFlags;
result.topMissingEvidence = classification.topMissingEvidence;
```

初始化 `result` 时带空数组：

```typescript
const result: TicketResult = {
  ticketDir: path.relative(LOG_ROOT, ticketDir),
  egr: Number(grounding.ratio.toFixed(4)),
  total: grounding.total,
  ungrounded: grounding.ungrounded.map((u) => u.rawText),
  errorCategories: [],
  riskFlags: [],
  topMissingEvidence: [],
};
```

- [ ] **步骤 5：增加聚合报告**

在 mean 指标后添加：

```typescript
  const categoryCounts = results.reduce<Record<string, number>>((acc, item) => {
    for (const category of item.errorCategories) {
      acc[category] = (acc[category] ?? 0) + 1;
    }
    return acc;
  }, {});
```

在 `report` 对象中加入：

```typescript
    categoryCounts,
```

在 markdown 输出中加入：

```typescript
  mdLines.push("");
  mdLines.push("## 错误归因聚合");
  const sortedCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
  if (sortedCategories.length === 0) {
    mdLines.push("- 未发现可归因错误分类");
  } else {
    for (const [category, count] of sortedCategories) {
      mdLines.push(`- ${category}: ${count}`);
    }
  }
```

在每票热点行中追加分类：

```typescript
    mdLines.push(`- \`${r.ticketDir}\`（EGR ${(r.egr * 100).toFixed(0)}%，分类 ${r.errorCategories.join(", ") || "none"}）：${r.ungrounded.join("；")}`);
```

- [ ] **步骤 6：运行检查和评测**

运行：

```bash
npm run test:accuracy-phase2
npm run eval:accuracy
```

预期：

- `test:accuracy-phase2` 仍可能因 route、validation、文档未完成而 FAIL，但不再报 `eval-accuracy 未读取 evidence-packet.json`、`eval-accuracy 未输出 errorCategories`、`eval-accuracy 未输出分类聚合`。
- `eval:accuracy` PASS，并生成包含 `categoryCounts` 的 `docs/golden-baseline/eval-report.json`。

- [ ] **步骤 7：Commit**

不要提交 `docs/golden-baseline/eval-report.json` 或 `.md`，除非仓库当前已跟踪且产品要求纳入版本。先用 `git status --short` 确认。

```bash
git add scripts/eval-accuracy.ts scripts/check-accuracy-phase2.mjs
git commit -m "feat(accuracy): add eval error attribution"
```

---

### 任务 4：在线生成并落盘 Evidence Packet

**文件：**
- 修改：`app/api/issues/process/route.ts`
- 测试：`scripts/check-accuracy-phase2.mjs`

- [ ] **步骤 1：添加 import**

在 `app/api/issues/process/route.ts` 现有 analysis import 附近加入：

```typescript
import { buildEvidencePacket } from "@/lib/analysis/evidence-packet";
```

- [ ] **步骤 2：生成证据包**

在 `commentTimeWindow`、`extractMarkdown`、`androidLog`、`qnxLog` 和 `canPlotResult` 都已可用之后，`const step5CanTrace = summarizeCanTraceForStep5(canPlotResult.summary, canTraceText)` 之前添加：

```typescript
    const evidencePacket = buildEvidencePacket({
      issueKey,
      ruleGroupId,
      ruleGroupName,
      carModel,
      commentTimeWindow,
      traceStartTime: canPlotResult.traceStartTime,
      traceEndTime: canPlotResult.traceEndTime,
      signalMatches: exactMatches.concat(recoveredMatches).map((match) => ({
        prop: match.prop,
        sourceToken: match.sourceToken,
        matchedBy: match.matchedBy,
        matchedSignal: match.matchedSignal,
      })),
      signalIdRecords,
      signalSummary: canPlotResult.summary,
      extractMarkdown,
      androidLog,
      qnxLog,
      unmatchedTokens,
    });
    const evidencePacketText = JSON.stringify(evidencePacket, null, 2);
    await saveStepLog(logRoot, "evidence-packet.json", evidencePacketText);
    logger.log("PARSING", `结构化证据包已生成：props=${evidencePacket.matchedProps.length} intervals=${evidencePacket.signalIntervals.length} risks=${evidencePacket.riskFlags.length}`);
```

如果当前位置变量名有冲突，保持 `evidencePacket` 和 `evidencePacketText` 两个名字，后续 Step 5 需要复用。

- [ ] **步骤 3：运行检查**

运行：

```bash
npm run test:accuracy-phase2
```

预期：不再报 `process route 未调用 buildEvidencePacket`、`process route 未落盘 evidence-packet.json`。

- [ ] **步骤 4：运行类型检查**

运行：

```bash
npx tsc --noEmit
```

预期：PASS。若报 `evidencePacketText` 未使用，下一任务会使用；本任务内可先在日志中使用以避免未使用变量。

- [ ] **步骤 5：Commit**

```bash
git add app/api/issues/process/route.ts scripts/check-accuracy-phase2.mjs
git commit -m "feat(accuracy): write evidence packet"
```

---

### 任务 5：Step 5 优先注入 Evidence Packet

**文件：**
- 修改：`app/api/issues/process/route.ts`
- 测试：`scripts/check-accuracy-phase2.mjs`

- [ ] **步骤 1：构造 Step 5 证据包 block**

在 `signalsJsonBlock` 后添加：

```typescript
    const evidencePacketBlock = [
      "<结构化证据包>",
      evidencePacketText,
      "</结构化证据包>",
    ].join("\n");
```

- [ ] **步骤 2：更新 Step 5 输出约束**

在 `STEP5_OUTPUT_CONSTRAINT` 数组中，`"2. 【证据】"` 之后加入：

```typescript
  "优先引用 `<结构化证据包>` 中的 matchedProps、signalIntervals、logHits、missingEvidence 和 riskFlags；如果证据包标记缺失证据，必须降低置信度并说明缺失项。",
```

- [ ] **步骤 3：把证据包加入 both/can_in_zip Step 5 sections**

在 both/can_in_zip 的 `buildStep5MergedPrompt([` 列表中，把证据包放在 `signalsJsonBlock` 前：

```typescript
          { name: "结构化证据包", content: evidencePacketBlock, minChars: 2_000, trimPriority: 5 },
          { name: "信号配置与特性映射 (signals.json)", content: signalsJsonBlock, minChars: 1_000, trimPriority: 40 },
```

- [ ] **步骤 4：把证据包加入 can_only Step 5 sections**

在 can_only 的 `buildStep5MergedPrompt([` 列表中做同样修改：

```typescript
          { name: "结构化证据包", content: evidencePacketBlock, minChars: 2_000, trimPriority: 5 },
          { name: "信号配置与特性映射 (signals.json)", content: signalsJsonBlock, minChars: 1_000, trimPriority: 40 },
```

- [ ] **步骤 5：让自批判证据文本包含 Evidence Packet**

修改 `u3EvidenceText`：

```typescript
    const u3EvidenceText = [
      evidencePacketText,
      canPlotResult.summary,
      step5CanTrace.decodedSummary,
      JSON.stringify(signalIdRecords),
      extractMarkdown,
    ].filter(Boolean).join("\n");
```

- [ ] **步骤 6：运行检查**

运行：

```bash
npm run test:accuracy-phase2
npm run test:accuracy-tuning
npm run test:accuracy-phase1
npx tsc --noEmit
```

预期：

- `test:accuracy-phase2` 不再报 `Step5 prompt 未注入结构化证据包`。
- Phase 1 和 tuning 检查保持 PASS。
- TypeScript PASS。

- [ ] **步骤 7：Commit**

```bash
git add app/api/issues/process/route.ts scripts/check-accuracy-phase2.mjs
git commit -m "feat(accuracy): prioritize evidence packet in step5"
```

---

### 任务 6：增强信号候选池并扩展 signals.json

**文件：**
- 修改：`app/api/issues/process/route.ts`
- 测试：`scripts/check-accuracy-phase2.mjs`

- [ ] **步骤 1：新增候选类型**

在 `SignalConfigMatch` 附近添加：

```typescript
interface SignalCandidate {
  token: string;
  normalized: string;
  sources: Array<"step2" | "jira_summary" | "jira_description" | "jira_comment" | "ocr" | "config_prop" | "config_signal" | "few_shot">;
  weight: number;
}
```

把 `SignalConfigMatch` 扩展：

```typescript
  recoveryReason?: string;
```

- [ ] **步骤 2：新增候选池构建函数**

放在 `parseStep2SignalTokens()` 后：

```typescript
function addSignalCandidate(
  map: Map<string, SignalCandidate>,
  token: string,
  source: SignalCandidate["sources"][number],
  weight: number,
): void {
  const normalized = normalizeSignalToken(token);
  if (normalized.length < 2) return;
  const existing = map.get(normalized) ?? { token: token.trim(), normalized, sources: [], weight: 0 };
  if (!existing.sources.includes(source)) existing.sources.push(source);
  existing.weight = Math.max(existing.weight, weight);
  map.set(normalized, existing);
}

function collectTextSignalCandidates(text: string, source: SignalCandidate["sources"][number], weight: number, map: Map<string, SignalCandidate>): void {
  for (const token of parseStep2SignalTokens(text)) {
    addSignalCandidate(map, token, source, weight);
  }
}

function buildSignalCandidatePool(args: {
  step2Text: string;
  summary: string;
  description?: string;
  commentsText: string;
  configItems: ModelSignalConfigEntry[];
  fewShotSamples?: Array<{ issueSummary: string; wrongConclusion: string; correctConclusion: string; errorReason: string }>;
}): SignalCandidate[] {
  const map = new Map<string, SignalCandidate>();
  collectTextSignalCandidates(args.step2Text, "step2", 1, map);
  collectTextSignalCandidates(args.summary, "jira_summary", 0.8, map);
  collectTextSignalCandidates(args.description ?? "", "jira_description", 0.7, map);
  collectTextSignalCandidates(args.commentsText, "jira_comment", 0.7, map);

  for (const item of args.configItems) {
    if (item.prop) addSignalCandidate(map, String(item.prop), "config_prop", 0.6);
    for (const signal of collectSignalsFromConfigItem(item)) {
      addSignalCandidate(map, signal, "config_signal", 0.6);
    }
  }

  for (const sample of args.fewShotSamples ?? []) {
    collectTextSignalCandidates(
      [sample.issueSummary, sample.wrongConclusion, sample.correctConclusion, sample.errorReason].join("\n"),
      "few_shot",
      0.5,
      map,
    );
  }

  return Array.from(map.values()).sort((a, b) => b.weight - a.weight);
}
```

- [ ] **步骤 3：用候选池替换 raw token 输入**

在 Step 2 解析 `rawSignalTokens` 的位置，保留原始 Step 2 tokens，然后构建候选池：

```typescript
      const step2RawSignalTokens = parseStep2SignalTokens(aiSignals);
      const signalCandidatePool = buildSignalCandidatePool({
        step2Text: aiSignals,
        summary,
        description: rawData.description,
        commentsText,
        configItems,
        fewShotSamples,
      });
      const rawSignalTokens = signalCandidatePool.map((candidate) => candidate.token);
```

如果当前代码里 `rawSignalTokens` 是 `const`，改成使用上面三行定义。`step2RawSignalTokens` 用于日志：

```typescript
      logger.log("AI_STEP2", `信号候选池：step2=${step2RawSignalTokens.length} total=${rawSignalTokens.length}`);
```

- [ ] **步骤 4：给 fuzzy/self_check 命中写 recoveryReason**

在 `recoverFuzzyMatches()` push 时加入：

```typescript
        recoveryReason: `edit_or_substring_similarity_${Number(best.similarity.toFixed(3))}`,
```

在 `recoverViaSelfCheck()` push 时加入：

```typescript
        recoveryReason: "restricted_llm_self_check",
```

- [ ] **步骤 5：扩展 signals.json 落盘**

两处 `saveStepLog(logRoot, "signals.json", JSON.stringify({` 都要加入：

```typescript
        candidateSources: Object.fromEntries(
          signalCandidatePool.map((candidate) => [
            candidate.token,
            { sources: candidate.sources, weight: candidate.weight },
          ]),
        ),
```

并在 `recovered` item 中加入：

```typescript
          recoveryReason: match.recoveryReason,
```

- [ ] **步骤 6：运行检查**

运行：

```bash
npm run test:accuracy-phase2
npm run test:accuracy-phase1
npm run test:signal-rag
npx tsc --noEmit
```

预期：

- `test:accuracy-phase2` 不再报 `signals.json 未记录 candidateSources`、`recovered 命中未记录 recoveryReason`。
- Phase 1 和 signal-rag 检查 PASS。
- TypeScript PASS。

- [ ] **步骤 7：Commit**

```bash
git add app/api/issues/process/route.ts scripts/check-accuracy-phase2.mjs
git commit -m "feat(accuracy): expand signal candidate pool"
```

---

### 任务 7：结构化校验优先读取 Evidence Packet

**文件：**
- 修改：`lib/analysis/structured-evidence-validation.ts`
- 修改：调用 `validateStructuredEvidence()` 的 store 或 API 文件，如 `stores/validationStore.ts`
- 测试：`scripts/check-accuracy-phase2.mjs`、`scripts/check-structured-evidence-validation.mjs`

- [ ] **步骤 1：扩展输入类型**

在 `StructuredEvidenceInput` 中加入：

```typescript
  evidencePacketText?: string;
```

- [ ] **步骤 2：调整 evidenceText 拼接顺序**

修改 `validateStructuredEvidence()` 中的 evidenceText：

```typescript
  const evidenceText = [
    input.evidencePacketText,
    input.signalSummary,
    input.canTraceText,
    input.extractText,
    input.step4Text,
    input.metricsText,
  ].filter(Boolean).join("\n");
```

- [ ] **步骤 3：更新调用方读取证据包**

在调用 `validateStructuredEvidence()` 的位置，读取当前工单日志目录下的 `evidence-packet.json`。如果当前调用方已经读取同目录日志文件，按现有 `readTextSafe` 模式增加：

```typescript
const evidencePacketText = await readTextSafe(path.join(logDir, "evidence-packet.json"));
```

传入：

```typescript
evidencePacketText,
```

如果调用方在前端 store 中无法直接读文件，则保持 API route 读取文件的边界，不要让浏览器直接访问文件系统。

- [ ] **步骤 4：运行检查**

运行：

```bash
npm run test:accuracy-phase2
npm run test:evidence-validation
npx tsc --noEmit
```

预期：

- `test:accuracy-phase2` 不再报 `结构化校验未接收 evidencePacketText`。
- `test:evidence-validation` PASS。
- TypeScript PASS。

- [ ] **步骤 5：Commit**

```bash
git add lib/analysis/structured-evidence-validation.ts stores/validationStore.ts scripts/check-accuracy-phase2.mjs
git commit -m "feat(accuracy): use evidence packet in validation"
```

如果实际调用方不是 `stores/validationStore.ts`，用真实变更文件替换 git add 列表。

---

### 任务 8：文档与交接同步

**文件：**
- 修改：`docs/PRODUCT.md`
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/WORKFLOW.md`
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
- 修改：`session-handoff.md`

- [ ] **步骤 1：更新产品文档**

在 `docs/PRODUCT.md` 的 `3.3.3 功能点` 准确率/评测相关 bullet 后补充：

```markdown
- **Phase 2 错误归因与证据包**：处理流水线在 Step 5 前生成 `evidence-packet.json`，统一记录匹配 prop、Property ID、信号区间、日志命中、缺失证据和风险标记；离线评测报告按 `signal_missing`、`time_window_mismatch`、`log_evidence_missing`、`ungrounded_conclusion`、`rag_mismatch`、`low_confidence_evidence` 聚合错误原因。
```

- [ ] **步骤 2：更新架构文档**

在 `docs/ARCHITECTURE.md` 的核心数据流或 pipeline metrics 附近补充：

```markdown
Step 5 前会生成结构化 Evidence Packet，文件位于 `log/{ruleGroupId}/{carModel}/{issueKey}/evidence-packet.json`。它由 `signals.json`、`signals_id.json`、CAN trace 摘要、日志筛选结果和时间窗组成，供最终结论 prompt、结构化校验和离线评测共用。
```

- [ ] **步骤 3：更新工作流文档**

在 `docs/WORKFLOW.md` 的 Step 5 说明中补充：

```markdown
Step 5 优先读取 `<结构化证据包>`，再读取 CAN trace 摘要和日志文本。若证据包存在 `missingEvidence` 或 `riskFlags`，模型必须降低置信度并说明缺失证据；该机制不改变人工复核控制 Jira 回填的边界。
```

- [ ] **步骤 4：更新时序图文档**

在 `docs/SEQUENCE_DIAGRAMS.md` 的 Pipeline Metrics 或结构化校验时序中补充文本时序：

```markdown
Issue Process API -> File System: 写入 evidence-packet.json
Issue Process API -> Qwen API: Step 5 prompt 注入 <结构化证据包>
Eval Script -> File System: 优先读取 evidence-packet.json
Eval Script -> Report: 输出 errorCategories / categoryCounts
```

- [ ] **步骤 5：更新 session-handoff**

把 `未完成 / 待处理` 中 `Jira 解票准确率 Phase 2 待实现` 改为完成，并在 `已完成 / 已实现` 顶部追加：

```markdown
### v3.34 — Jira 解票准确率 Phase 2 错误归因 + Evidence Packet (本轮)

- [x] **错误归因评测**：`eval:accuracy` 输出 `errorCategories`、`riskFlags`、`topMissingEvidence` 和 `categoryCounts`。
- [x] **Evidence Packet**：处理流水线落盘 `evidence-packet.json`，Step 5、证据自批判、结构化校验和离线评测优先复用。
- [x] **信号候选池增强**：`signals.json` 记录 `candidateSources` 和 `recovered[].recoveryReason`，候选池只扩大待匹配 token，不允许输出配置外 prop。
- [x] **回归检查**：记录实际执行通过的命令。
```

- [ ] **步骤 6：运行文档检查**

运行：

```bash
npm run test:accuracy-phase2
git diff --check -- docs/PRODUCT.md docs/ARCHITECTURE.md docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md
```

预期：PASS。

- [ ] **步骤 7：Commit**

```bash
git add docs/PRODUCT.md docs/ARCHITECTURE.md docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md scripts/check-accuracy-phase2.mjs
git commit -m "docs: document accuracy phase2 workflow"
```

---

### 任务 9：全量验证与收尾

**文件：**
- 只在验证暴露问题时修改对应实现或文档文件。

- [ ] **步骤 1：运行准确率相关检查**

运行：

```bash
npm run test:accuracy-phase2
npm run test:accuracy-phase1
npm run test:accuracy-tuning
npm run test:signal-rag
npm run test:evidence-validation
```

预期：全部 PASS。

- [ ] **步骤 2：运行离线评测**

运行：

```bash
npm run eval:accuracy
```

预期：PASS，终端输出类似：

```text
评测完成：48 票，平均 EGR 59.2%，跳过 2
```

票数和 EGR 以本地 `log/` 实际数据为准。检查 `docs/golden-baseline/eval-report.json` 中存在：

```json
{
  "categoryCounts": {
    "ungrounded_conclusion": 1
  }
}
```

- [ ] **步骤 3：运行类型与 lint**

运行：

```bash
npx tsc --noEmit
npm run lint
```

预期：TypeScript PASS；lint PASS 或仅保留既有无关 warning，不新增 error。

- [ ] **步骤 4：检查工作区**

运行：

```bash
git status --short
```

预期：只剩本任务有意保留的评测报告产物或既有 `.codegraph/daemon.pid` 变动。不要提交 `.codegraph/daemon.pid`。

- [ ] **步骤 5：最终提交验证记录**

如果 `session-handoff.md` 还没有记录实际验证命令和结果，补充后提交：

```bash
git add session-handoff.md
git commit -m "docs: record accuracy phase2 verification"
```

如果任务 8 已记录完整验证结果且没有变更，本步骤跳过提交。
