# Jira 解票准确率 Phase 3 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 提升 Jira 解票准确率评测可信度，并降低最终结论中的未接地断言。

**架构：** Phase 3 在现有 Evidence Packet、`eval:accuracy` 和 Step 5 证据自批判基础上增量增强。新增评测集覆盖报告，修复时间窗真实 overlap，增强 `computeGrounding()` 的归一化匹配，并在 Step 5 前基于 Evidence Packet 对 few-shot 案例做精召回或重排。

**技术栈：** Next.js API Route、TypeScript、Node fs/path、现有 Qwen wrapper、现有 IndexedDB/Dexie 样本结构、`tsx`、静态回归脚本。

---

## 文件结构

新增：

- `scripts/check-accuracy-phase3.mjs`：静态与行为回归检查，覆盖 Phase 3 关键接口。
- `scripts/eval-set-coverage.ts`：生成人工评测集覆盖报告。
- `docs/golden-baseline/eval-set-coverage.json`：覆盖报告机器可读输出。
- `docs/golden-baseline/eval-set-coverage.md`：覆盖报告人工可读输出。

修改：

- `package.json`：注册 `test:accuracy-phase3` 和 `eval:coverage`。
- `lib/analysis/evidence-packet.ts`：实现真实时间窗 overlap，导出可测试的时间解析辅助函数。
- `lib/analysis/structured-evidence-validation.ts`：增强 `computeGrounding()` 的归一化证据索引。
- `scripts/eval-accuracy.ts`：在评测后调用覆盖报告生成逻辑，或在报告中引用覆盖情况。
- `app/api/issues/process/route.ts`：Step 5 前基于 Evidence Packet 对 few-shot 案例做精召回 / 重排。
- `docs/PRODUCT.md`：记录 Phase 3 准确率闭环能力。
- `docs/ARCHITECTURE.md`：记录覆盖报告、真实 overlap 和二段式 RAG 的位置。
- `docs/WORKFLOW.md`：记录 Step 5 前精召回流程。
- `docs/SEQUENCE_DIAGRAMS.md`：记录离线评测覆盖报告和 Evidence Packet RAG 时序。
- `session-handoff.md`：记录 Phase 3 待办或完成状态。

不修改：

- 不自动覆盖 `docs/golden-baseline/eval-set.json`，该文件可能包含用户正在编辑的人工真值。
- 不改变 Jira 回填仍由人工复核控制的边界。
- 不引入后端数据库或外部向量库。

---

### 任务 1：新增 Phase 3 回归检查脚本

**文件：**
- 创建：`scripts/check-accuracy-phase3.mjs`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的检查脚本**

创建 `scripts/check-accuracy-phase3.mjs`：

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

const evidence = read("lib/analysis/evidence-packet.ts");
assert(/export function parseEvidenceTime/.test(evidence), "缺少 parseEvidenceTime 导出");
assert(/export function computeTimeWindowOverlap/.test(evidence), "缺少 computeTimeWindowOverlap 导出");
assert(/commentStart <= traceEnd/.test(evidence) || /commentStartMs <= traceEndMs/.test(evidence), "时间窗 overlap 未使用真实区间比较");

const validation = read("lib/analysis/structured-evidence-validation.ts");
assert(/interface GroundingEvidenceIndex/.test(validation), "缺少 GroundingEvidenceIndex");
assert(/buildGroundingEvidenceIndex/.test(validation), "缺少 grounding 证据索引构建函数");
assert(/propertyIds/.test(validation), "grounding 未纳入 propertyId 归一化");
assert(/normalizedText/.test(validation), "grounding 未纳入 normalizedText");

assert(exists("scripts/eval-set-coverage.ts"), "缺少 eval-set-coverage.ts");
const coverage = exists("scripts/eval-set-coverage.ts") ? read("scripts/eval-set-coverage.ts") : "";
assert(/eval-set-coverage\.json/.test(coverage), "覆盖报告未输出 json");
assert(/eval-set-coverage\.md/.test(coverage), "覆盖报告未输出 md");
assert(/coverageRatio/.test(coverage), "覆盖报告缺少 coverageRatio");

const route = read("app/api/issues/process/route.ts");
assert(/rerankFewShotSamplesByEvidence/.test(route), "Step5 前未基于 Evidence Packet 重排 few-shot");
assert(/证据精召回案例/.test(route), "Step5 prompt 未区分证据精召回案例");

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts?.["test:accuracy-phase3"] === "node scripts/check-accuracy-phase3.mjs", "package.json 未注册 test:accuracy-phase3");
assert(pkg.scripts?.["eval:coverage"] === "tsx scripts/eval-set-coverage.ts", "package.json 未注册 eval:coverage");

for (const doc of ["docs/PRODUCT.md", "docs/ARCHITECTURE.md", "docs/WORKFLOW.md", "docs/SEQUENCE_DIAGRAMS.md", "session-handoff.md"]) {
  const content = read(doc);
  assert(/Phase 3|真实时间窗|评测集覆盖|二段式 RAG/.test(content), `${doc} 未同步 Phase 3 文档`);
}

if (failures.length > 0) {
  console.error("Phase 3 accuracy checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Phase 3 accuracy checks passed.");
```

- [ ] **步骤 2：注册 npm script**

在 `package.json` 的 `scripts` 中加入：

```json
"test:accuracy-phase3": "node scripts/check-accuracy-phase3.mjs",
"eval:coverage": "tsx scripts/eval-set-coverage.ts"
```

- [ ] **步骤 3：运行检查确认失败**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase3
```

预期：FAIL，至少包含 `缺少 parseEvidenceTime 导出` 和 `缺少 eval-set-coverage.ts`。

- [ ] **步骤 4：Commit**

```bash
git add scripts/check-accuracy-phase3.mjs package.json
git commit -m "test: add accuracy phase3 guard"
```

---

### 任务 2：生成评测集覆盖报告

**文件：**
- 创建：`scripts/eval-set-coverage.ts`
- 修改：`scripts/eval-accuracy.ts`
- 输出：`docs/golden-baseline/eval-set-coverage.json`
- 输出：`docs/golden-baseline/eval-set-coverage.md`

- [ ] **步骤 1：创建覆盖报告脚本**

创建 `scripts/eval-set-coverage.ts`：

```typescript
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const LOG_ROOT = path.resolve("log");
const EVAL_SET_PATH = path.resolve("docs/golden-baseline/eval-set.json");
const REPORT_JSON = path.resolve("docs/golden-baseline/eval-set-coverage.json");
const REPORT_MD = path.resolve("docs/golden-baseline/eval-set-coverage.md");

interface EvalSetEntry {
  ruleGroupDir: string;
  carModelDir: string;
  issueKey: string;
  expectedSignals?: string[];
  expectedKeywords?: string[];
}

async function readTextSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function loadEvalSet(): Promise<EvalSetEntry[]> {
  const raw = await readTextSafe(EVAL_SET_PATH);
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed as EvalSetEntry[] : [];
}

async function countEvaluatedTickets(): Promise<number> {
  if (!existsSync(LOG_ROOT)) return 0;
  let count = 0;
  const groups = await readdir(LOG_ROOT, { withFileTypes: true });
  for (const group of groups) {
    if (!group.isDirectory()) continue;
    const models = await readdir(path.join(LOG_ROOT, group.name), { withFileTypes: true });
    for (const model of models) {
      if (!model.isDirectory()) continue;
      const tickets = await readdir(path.join(LOG_ROOT, group.name, model.name), { withFileTypes: true });
      count += tickets.filter((ticket) => ticket.isDirectory()).length;
    }
  }
  return count;
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export async function buildEvalSetCoverageReport(): Promise<void> {
  const evalSet = await loadEvalSet();
  const evaluatedTicketCount = await countEvaluatedTickets();
  const byRuleGroup: Record<string, number> = {};
  const byCarModel: Record<string, number> = {};
  let expectedSignalsCount = 0;
  let expectedKeywordsCount = 0;

  for (const entry of evalSet) {
    increment(byRuleGroup, entry.ruleGroupDir);
    increment(byCarModel, entry.carModelDir);
    expectedSignalsCount += entry.expectedSignals?.length ?? 0;
    expectedKeywordsCount += entry.expectedKeywords?.length ?? 0;
  }

  const coverageRatio = evaluatedTicketCount > 0
    ? Number((evalSet.length / evaluatedTicketCount).toFixed(4))
    : 0;
  const recommendation = evalSet.length < 20
    ? "人工真值过少，信号召回率和关键判断命中率只能作为样例指标"
    : "人工真值已有基础覆盖，仍需按车型和错误类型持续补充";

  const report = {
    generatedAt: new Date().toISOString(),
    evalSetCount: evalSet.length,
    evaluatedTicketCount,
    coverageRatio,
    byRuleGroup,
    byCarModel,
    expectedSignalsCount,
    expectedKeywordsCount,
    recommendation,
  };

  await writeFile(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  await writeFile(REPORT_MD, [
    "# Jira 解票评测集覆盖报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 人工真值数量：${report.evalSetCount}`,
    `- 本地日志票数：${report.evaluatedTicketCount}`,
    `- 覆盖比例：${(report.coverageRatio * 100).toFixed(1)}%`,
    `- expectedSignals 数量：${report.expectedSignalsCount}`,
    `- expectedKeywords 数量：${report.expectedKeywordsCount}`,
    `- 建议：${report.recommendation}`,
  ].join("\n"), "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildEvalSetCoverageReport().catch((error) => {
    console.error("eval-set coverage failed:", error);
    process.exit(1);
  });
}
```

- [ ] **步骤 2：在 eval-accuracy 中调用覆盖报告**

在 `scripts/eval-accuracy.ts` 顶部加入：

```typescript
import { buildEvalSetCoverageReport } from "./eval-set-coverage";
```

在写完 `eval-report.md` 之后加入：

```typescript
  await buildEvalSetCoverageReport();
```

- [ ] **步骤 3：运行覆盖报告**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run eval:coverage
```

预期：PASS，并生成 `docs/golden-baseline/eval-set-coverage.{json,md}`。

- [ ] **步骤 4：运行准确率评测**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run eval:accuracy
```

预期：PASS，同时刷新 `eval-report` 和 `eval-set-coverage`。

- [ ] **步骤 5：Commit**

```bash
git add scripts/eval-set-coverage.ts scripts/eval-accuracy.ts docs/golden-baseline/eval-set-coverage.json docs/golden-baseline/eval-set-coverage.md
git commit -m "feat(eval): report golden set coverage"
```

---

### 任务 3：修复 Evidence Packet 时间窗 overlap

**文件：**
- 修改：`lib/analysis/evidence-packet.ts`

- [ ] **步骤 1：导出时间解析函数**

在 `lib/analysis/evidence-packet.ts` 中替换现有 `computeWindowOverlap()` 附近逻辑：

```typescript
export function parseEvidenceTime(value?: string, referenceDate?: string): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const full = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/);
  if (full) {
    const [, y, m, d, hh, mm, ss, ms = "0"] = full;
    return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss), Number(ms.padEnd(3, "0"))).getTime();
  }

  const timeOnly = trimmed.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/);
  const ref = referenceDate?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (timeOnly && ref) {
    const [, y, m, d] = ref;
    const [, hh, mm, ss, ms = "0"] = timeOnly;
    return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss), Number(ms.padEnd(3, "0"))).getTime();
  }

  return null;
}

export function computeTimeWindowOverlap(input: BuildEvidencePacketInput): boolean | null {
  const comment = input.commentTimeWindow;
  if (!comment || !input.traceStartTime || !input.traceEndTime) return null;

  const referenceDate = input.traceStartTime || comment.start;
  const commentStartMs = parseEvidenceTime(comment.start, referenceDate);
  const commentEndMs = parseEvidenceTime(comment.end, referenceDate);
  const traceStartMs = parseEvidenceTime(input.traceStartTime, comment.start);
  const traceEndMs = parseEvidenceTime(input.traceEndTime, comment.start);
  if ([commentStartMs, commentEndMs, traceStartMs, traceEndMs].some((value) => value === null)) {
    return null;
  }

  return (commentStartMs as number) <= (traceEndMs as number) && (traceStartMs as number) <= (commentEndMs as number);
}
```

- [ ] **步骤 2：替换调用点**

把 `buildEvidencePacket()` 中：

```typescript
overlap: computeWindowOverlap(input),
```

替换为：

```typescript
overlap: computeTimeWindowOverlap(input),
```

- [ ] **步骤 3：运行回归检查**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase3
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase2
```

预期：`test:accuracy-phase3` 不再报时间窗函数缺失；`test:accuracy-phase2` 保持 PASS。

- [ ] **步骤 4：Commit**

```bash
git add lib/analysis/evidence-packet.ts
git commit -m "feat(accuracy): compute real evidence time overlap"
```

---

### 任务 4：增强 Grounding 归一化匹配

**文件：**
- 修改：`lib/analysis/structured-evidence-validation.ts`

- [ ] **步骤 1：新增证据索引类型和构建函数**

在 `computeGrounding()` 前新增：

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

function normalizeGroundingText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_:-]+/g, "")
    .replace(/0x([0-9a-f]+)/gi, (_, hex) => String(Number.parseInt(hex, 16)));
}

function uniqueMatches(source: string, pattern: RegExp): string[] {
  return Array.from(new Set(Array.from(source.matchAll(pattern)).map((match) => match[0])));
}

function buildGroundingEvidenceIndex(evidenceText: string): GroundingEvidenceIndex {
  const rawText = evidenceText ?? "";
  return {
    rawText,
    normalizedText: normalizeGroundingText(rawText),
    times: uniqueMatches(rawText, /\b(?:\d{4}-\d{2}-\d{2}[ T])?\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\b/g),
    numericValues: uniqueMatches(rawText, /\b(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b/g),
    props: uniqueMatches(rawText, /"prop"\s*:\s*"([^"]+)"/g).map((item) => item.replace(/^"prop"\s*:\s*"|"$/g, "")),
    signals: uniqueMatches(rawText, /"signals"\s*:\s*\[[^\]]+\]|[A-Za-z][A-Za-z0-9_]{2,}/g),
    propertyIds: uniqueMatches(rawText, /\b(?:0x[0-9a-fA-F]+|\d{2,})\b/g),
  };
}

function evidenceIndexIncludes(index: GroundingEvidenceIndex, value?: string): boolean {
  if (!value) return true;
  if (includesAny(index.rawText, [value])) return true;
  return index.normalizedText.includes(normalizeGroundingText(value));
}
```

- [ ] **步骤 2：改造 computeGrounding() 使用索引**

在 `computeGrounding()` 内把：

```typescript
  const evidence = (evidenceText ?? "").trim();
```

替换为：

```typescript
  const evidence = (evidenceText ?? "").trim();
  const evidenceIndex = buildGroundingEvidenceIndex(evidence);
```

把 subject / expected 匹配替换为：

```typescript
    const subjectMatched = assertion.subject
      ? evidenceIndexIncludes(evidenceIndex, assertion.subject)
      : false;
    const expectedMatched = assertion.expected
      ? evidenceIndexIncludes(evidenceIndex, assertion.expected)
      : true;
```

- [ ] **步骤 3：运行结构化校验与 Phase 3 检查**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:evidence-validation
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase3
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run eval:accuracy
```

预期：测试 PASS，`eval:accuracy` 成功刷新报告。EGR 变化需要结合报告解释，不能只看单次数字。

- [ ] **步骤 4：Commit**

```bash
git add lib/analysis/structured-evidence-validation.ts docs/golden-baseline/eval-report.json docs/golden-baseline/eval-report.md
git commit -m "feat(accuracy): normalize grounding evidence matches"
```

---

### 任务 5：Step 5 前基于 Evidence Packet 重排 few-shot

**文件：**
- 修改：`app/api/issues/process/route.ts`

- [ ] **步骤 1：新增重排函数**

在 Step 5 相关 helper 附近新增：

```typescript
function scoreFewShotByEvidence(sample: FewShotSample, evidencePacketText: string): number {
  const haystack = evidencePacketText.toLowerCase();
  const sampleText = [
    sample.issueSummary,
    sample.errorReason,
    sample.correctConclusion,
    sample.wrongConclusion,
  ].join("\n").toLowerCase();
  let score = 0;
  for (const token of sampleText.match(/[A-Za-z][A-Za-z0-9_]{3,}|0x[0-9a-f]+|\d{3,}/g) ?? []) {
    if (haystack.includes(token.toLowerCase())) score += 1;
  }
  return score;
}

function rerankFewShotSamplesByEvidence(samples: FewShotSample[] | undefined, evidencePacketText: string): FewShotSample[] {
  if (!samples?.length || !evidencePacketText.trim()) return samples ?? [];
  return samples
    .map((sample, index) => ({ sample, score: scoreFewShotByEvidence(sample, evidencePacketText), index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.sample)
    .slice(0, 3);
}
```

- [ ] **步骤 2：在 Step 5 前生成精召回集合**

在 `evidencePacketText` 生成后、`fewShotBlock` 构建前加入：

```typescript
    const evidenceRerankedFewShotSamples = rerankFewShotSamplesByEvidence(fewShotSamples, evidencePacketText);
```

- [ ] **步骤 3：改造 few-shot block 文案**

把现有 `fewShotSamples.map(...)` 的输入改为：

```typescript
      const examples = evidenceRerankedFewShotSamples.map((s, i) => [
        `### 证据精召回案例${i + 1}：${s.issueKey}（${s.issueSummary}）`,
        `**错误结论：**\n${s.wrongConclusion}`,
        `**错误原因：** ${s.errorReason}`,
        `**正确结论：**\n${s.correctConclusion}`,
      ].join("\n")).join("\n\n");
```

并把日志改为：

```typescript
      logger.log("AI_STEP5", `注入 ${evidenceRerankedFewShotSamples.length} 条证据精召回 few-shot 纠错案例`);
```

- [ ] **步骤 4：运行 RAG 与准确率检查**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:signal-rag
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase3
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase2
```

预期：全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add app/api/issues/process/route.ts
git commit -m "feat(accuracy): rerank step5 few-shot by evidence"
```

---

### 任务 6：同步产品、架构、流程与交接文档

**文件：**
- 修改：`docs/PRODUCT.md`
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/WORKFLOW.md`
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
- 修改：`session-handoff.md`

- [ ] **步骤 1：更新产品文档**

在 `docs/PRODUCT.md` 的离线准确率评测和 Phase 2 附近追加：

```markdown
- **Phase 3 评测可信度与证据判定增强**：系统会生成 `eval-set-coverage.{json,md}`，报告人工真值数量、车型覆盖和覆盖比例；Evidence Packet 会真实计算评论时间窗与 trace 时间窗是否重叠；EGR 判定会对时间、数值、prop / signal 和 Property ID 做归一化匹配，减少格式差异导致的误判；Step 5 会在结构化证据包生成后对 few-shot 案例做证据精召回 / 重排。
```

- [ ] **步骤 2：更新架构文档**

在 `docs/ARCHITECTURE.md` 的核心数据流或 Pipeline Metrics 章节追加：

```markdown
Phase 3 在准确率闭环中增加评测集覆盖报告和真实时间窗判定。`scripts/eval-set-coverage.ts` 只读 `eval-set.json` 和本地 `log/`，输出覆盖报告，不自动修改人工真值；`lib/analysis/evidence-packet.ts` 负责计算 comment / trace 时间窗 overlap；`structured-evidence-validation.ts` 通过归一化证据索引复用到在线自检和离线评测。
```

- [ ] **步骤 3：更新流程文档**

在 `docs/WORKFLOW.md` 的 Step 5 或评测闭环处追加：

```markdown
Step 5 前，系统会基于 `evidence-packet.json` 对处理前召回的 few-shot 案例进行证据精召回 / 重排，使历史纠错案例优先匹配当前票的 prop、signal、Property ID、缺失证据和风险标记。该重排失败时回退原 few-shot 顺序，不影响处理流程。
```

- [ ] **步骤 4：更新时序图文档**

在 `docs/SEQUENCE_DIAGRAMS.md` 的 Evidence Packet 与错误归因评测时序后追加：

```markdown
Phase 3 中，Eval Script 额外调用 `eval-set-coverage.ts` 生成覆盖报告；Issue Process API 在 Step 5 前使用 Evidence Packet 对 few-shot 案例重排，并继续把校验结果作为人工复核辅助，不阻断 Jira 回填。
```

- [ ] **步骤 5：更新 session-handoff**

在 `session-handoff.md` 的「已完成 / 已实现」顶部新增：

```markdown
### v3.46 — Jira 解票准确率 Phase 3 评测可信度与证据判定增强 (本轮)

- [x] **评测集覆盖报告**：新增 `eval-set-coverage.{json,md}`，明确人工真值覆盖比例和当前准确率指标解释边界。
- [x] **真实时间窗 overlap**：Evidence Packet 不再把存在时间字段等同于有交集，而是按 comment / trace 起止时间实际计算。
- [x] **Grounding 归一化**：EGR 判定纳入时间、数值、prop / signal 和 Property ID 归一化匹配。
- [x] **Step 5 证据精召回**：基于 Evidence Packet 对 few-shot 历史纠错案例重排，优先注入证据相似案例。
- [x] **回归检查**：已验证 `test:accuracy-phase3`、`test:accuracy-phase2`、`test:accuracy-phase1`、`test:signal-rag`、`test:evidence-validation` 和 `eval:accuracy`。
```

- [ ] **步骤 6：运行文档空白检查**

运行：

```bash
git diff --check
```

预期：无 trailing whitespace 或冲突标记。

- [ ] **步骤 7：Commit**

```bash
git add docs/PRODUCT.md docs/ARCHITECTURE.md docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md
git commit -m "docs: record accuracy phase3 workflow"
```

---

### 任务 7：最终验证

**文件：**
- 修改：`docs/golden-baseline/eval-report.json`
- 修改：`docs/golden-baseline/eval-report.md`
- 修改：`docs/golden-baseline/eval-set-coverage.json`
- 修改：`docs/golden-baseline/eval-set-coverage.md`

- [ ] **步骤 1：运行静态与准确率回归**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase3
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase2
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase1
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:signal-rag
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:evidence-validation
```

预期：全部 PASS。

- [ ] **步骤 2：运行类型和 lint**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run lint
```

预期：`tsc` PASS；`lint` 不新增错误，允许保留既有无关 warning。

- [ ] **步骤 3：运行离线评测**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run eval:accuracy
```

预期：PASS，并刷新：

- `docs/golden-baseline/eval-report.json`
- `docs/golden-baseline/eval-report.md`
- `docs/golden-baseline/eval-set-coverage.json`
- `docs/golden-baseline/eval-set-coverage.md`

- [ ] **步骤 4：解释评测结果**

在最终回复中报告：

```text
评测票数：N，跳过 M。
平均 EGR：X%。
人工真值数量：Y，覆盖比例：Z%。
主要错误分类：...
```

如果 EGR 下降，但未接地断言分类更准确，需要明确说明这是评测更严格或归一化规则变化导致，不能简单视为模型退化。

- [ ] **步骤 5：最终 Commit**

```bash
git add docs/golden-baseline/eval-report.json docs/golden-baseline/eval-report.md docs/golden-baseline/eval-set-coverage.json docs/golden-baseline/eval-set-coverage.md
git commit -m "chore(eval): refresh accuracy phase3 reports"
```

---

## 自检

- 规格覆盖：本计划覆盖 Phase 3 的 U1 评测集覆盖、U2 时间窗 overlap、U3 Grounding 归一化、U4 二段式 RAG。
- 占位符扫描：没有使用「待定」「TODO」「类似任务」作为实施步骤。
- 类型一致性：计划中新增函数名为 `parseEvidenceTime`、`computeTimeWindowOverlap`、`buildGroundingEvidenceIndex`、`rerankFewShotSamplesByEvidence`，检查脚本和任务步骤一致。
- 范围控制：不自动修改现有 `eval-set.json`，避免覆盖用户正在编辑的人工真值。

---

## 执行选项

计划已完成并保存到 `docs/superpowers/plans/2026-07-10-accuracy-phase3.md`。两种执行方式：

1. 子代理驱动（推荐）：每个任务调度一个新的子代理，任务间进行审查，快速迭代。
2. 内联执行：在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点。
