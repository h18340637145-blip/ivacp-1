# Evidence Validation Signal RAG 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在不阻断 Jira 回填的前提下，为 Jira 票分析增加结构化证据校验和基于 prop/signal 的历史纠错案例召回。

**架构：** 复用现有 IndexedDB、`IssueValidationRun`、`IssueValidationCheck`、`IssueReviewSample`、`/api/embeddings` 和 `fetchFewShotSamples()`。新增共享 evidence fingerprint 工具、结构化证据校验工具，并把校验结果接入现有详情页和校验详情页。所有失败路径降级为警告、`unknown` 或标题相似度回退，不改变人工复核 PASS 才允许 Jira 回填的规则。

**技术栈：** Next.js App Router、React、TypeScript、Zustand、Dexie IndexedDB、Qwen API、OpenAI-compatible Embedding API、Node.js 静态检查脚本。

---

## 执行状态

本计划已在 `feature/remote-shell` 分支完成实现，结构化证据校验保持 advisory 行为，不阻断 Jira 回填。

已落地提交：

- `8c8e962`：新增 evidence fingerprint 数据模型和检查脚本。
- `b4602cd`：将 prop/signal fingerprint 接入 Few-shot RAG 召回。
- `a8f3fce`：新增结构化证据校验工具。
- `c82000c`：将结构化证据校验接入 `validationStore`。
- `93ca618`：在详情页和校验详情页展示证据校验信息。
- `739eb13`：人工驳回样本和 `LearningMemory` 持久化 evidence fingerprint。
- `2aa70a9`：同步产品、架构、流程、时序图和 handoff 文档。

已验证命令：

```bash
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-signal-rag-retrieval.mjs
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-structured-evidence-validation.mjs
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-embedding-rag.mjs
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-validation-report-link.mjs
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-signal-id-extraction.mjs
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-step5-qwen-budget.mjs
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run lint
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit
```

当前已知非本功能变动：`.codegraph/daemon.pid` 在工作区中保持未提交状态，未纳入本计划。

---

## 文件结构

- 创建：`lib/analysis/evidence-fingerprint.ts`
  - 负责从快照、规则组、signals、signals_id、metrics 构造 evidence fingerprint 和 RAG 文本。
- 创建：`lib/analysis/structured-evidence-validation.ts`
  - 负责从 AI 结论中抽取断言，并与 CAN/日志证据文本比对，输出 validation run/check 所需结构。
- 修改：`lib/db/schema.ts`
  - 为 `IssueReviewSample` 和 `IssueValidationCheck` 增加向后兼容的可选字段。
- 修改：`stores/processTaskStore.ts`
  - 扩展 `fetchFewShotSamples()` 查询文本，保存人工驳回样本时写入 evidence fingerprint 字段。
- 修改：`stores/validationStore.ts`
  - 将现有时间戳校验保留为兜底，优先运行结构化证据校验并写入 `IssueValidationCheck`。
- 修改：`components/analysis/IssueDetail.tsx`
  - 在现有 AI 校验面板显示结构化证据摘要，FAIL/WARNING 只提示不禁用回填。
- 修改：`app/analysis/[ruleGroupId]/[issueKey]/validation/[validationRunId]/page.tsx`
  - 展示 `evidenceSource` 和 `confidence`。
- 创建：`scripts/check-signal-rag-retrieval.mjs`
  - 静态检查 schema、fingerprint、RAG 接线和 embedding fallback。
- 创建：`scripts/check-structured-evidence-validation.mjs`
  - 静态检查结构化校验模块、store 接线、UI 展示和 advisory 行为。
- 修改：`package.json`
  - 注册新增检查脚本。
- 修改：`docs/PRODUCT.md`
  - 补充结构化证据校验和 prop/signal RAG 的产品行为。
- 修改：`docs/ARCHITECTURE.md`
  - 补充 evidence fingerprint、结构化校验和 RAG 接线。
- 修改：`docs/WORKFLOW.md`
  - 补充处理完成后 advisory 校验流程和人工复核辅助行为。
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
  - 补充处理结果保存后运行结构化证据校验的时序。
- 修改：`session-handoff.md`
  - 记录本轮实现、验证命令和剩余风险。

## 任务 1：扩展数据模型和 evidence fingerprint

**文件：**
- 修改：`lib/db/schema.ts`
- 创建：`lib/analysis/evidence-fingerprint.ts`
- 测试：`scripts/check-signal-rag-retrieval.mjs`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的静态检查脚本**

创建 `scripts/check-signal-rag-retrieval.mjs`：

```javascript
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const checks = [
  {
    name: "IssueReviewSample stores evidence fingerprint fields",
    pass: () => {
      const schema = read("lib/db/schema.ts");
      return [
        "evidenceFingerprintText?: string",
        "props?: string[]",
        "signalTokens?: string[]",
        "propertyIds?: string[]",
        "carModel?: string",
      ].every((needle) => schema.includes(needle));
    },
  },
  {
    name: "evidence fingerprint helper exists",
    pass: () => {
      const source = read("lib/analysis/evidence-fingerprint.ts");
      return source.includes("export interface EvidenceFingerprint") &&
        source.includes("export function buildEvidenceFingerprintText") &&
        source.includes("export function extractSignalEvidenceFromText");
    },
  },
  {
    name: "process store uses fingerprint text for RAG",
    pass: () => {
      const store = read("stores/processTaskStore.ts");
      return store.includes("buildEvidenceFingerprintText") &&
        store.includes("evidenceFingerprintText") &&
        store.includes("Embedding 召回失败，回退标题相似度");
    },
  },
  {
    name: "package script is registered",
    pass: () => {
      const pkg = JSON.parse(read("package.json"));
      return pkg.scripts?.["test:signal-rag"] === "node scripts/check-signal-rag-retrieval.mjs";
    },
  },
];

const failures = checks.filter((check) => !check.pass());
if (failures.length > 0) {
  console.error("Signal RAG retrieval validation failed:");
  for (const failure of failures) console.error(`- ${failure.name}`);
  process.exit(1);
}

console.log("Signal RAG retrieval validation passed.");
```

- [ ] **步骤 2：运行脚本验证失败**

运行：

```bash
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-signal-rag-retrieval.mjs
```

预期：FAIL，至少报告 `evidence fingerprint helper exists` 和 schema 字段缺失。

- [ ] **步骤 3：扩展 schema 可选字段**

在 `lib/db/schema.ts` 中将 `IssueReviewSample` 扩展为：

```typescript
export interface IssueReviewSample {
  id: string;
  ruleGroupId: string;
  issueKey: string;
  /** Jira issue summary/title for RAG similarity matching */
  issueSummary?: string;
  /** Evidence text used for prop/signal-aware semantic RAG */
  evidenceFingerprintText?: string;
  /** Normalized config props related to this sample */
  props?: string[];
  /** Signal names or tokens related to this sample */
  signalTokens?: string[];
  /** Decimal or hexadecimal property ids related to this sample */
  propertyIds?: string[];
  /** Vehicle model resolved from the rule group or process artifacts */
  carModel?: string;
  /** Cached embedding for semantic RAG retrieval */
  issueSummaryEmbedding?: number[];
  /** Embedding model used to create issueSummaryEmbedding */
  embeddingModel?: string;
  /** Last time issueSummaryEmbedding was refreshed */
  embeddingUpdatedAt?: Date;
  /** Original AI conclusion that was wrong */
  wrongConclusion: string;
  /** Correct conclusion provided by human reviewer */
  correctConclusion: string;
  /** Why it was wrong */
  errorReason: string;
  createdAt: Date;
}
```

Extend `IssueValidationCheck` for later tasks:

```typescript
export interface IssueValidationCheck {
  id: string;
  runId: string;
  type: string;
  status: "pass" | "fail" | "warning";
  expected?: string;
  actual?: string;
  message: string;
  evidenceSource?: string;
  confidence?: number;
  createdAt: Date;
}
```

No Dexie index change is needed because the new fields are not queried by IndexedDB indexes.

- [ ] **步骤 4：创建 evidence fingerprint 工具**

创建 `lib/analysis/evidence-fingerprint.ts`：

```typescript
import type { FilteredIssueSnapshot, RuleGroup } from "@/lib/db/schema";

export interface EvidenceFingerprint {
  ruleGroupId: string;
  ruleGroupName?: string;
  carModel?: string;
  issueKey: string;
  issueSummary?: string;
  props: string[];
  signalTokens: string[];
  propertyIds: string[];
  faultKeywords: string[];
  commentTimeWindow?: string;
  evidenceCompleteness?: Record<string, unknown>;
}

interface SignalEvidenceInput {
  signalsJsonText?: string;
  signalsIdJsonText?: string;
  metricsJsonText?: string;
  step2Text?: string;
  step4Text?: string;
}

function unique(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function readJsonArray(text?: string): unknown[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readJsonObject(text?: string): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function collectStringField(records: unknown[], field: string): string[] {
  return unique(records.map((record) => {
    if (!record || typeof record !== "object") return undefined;
    const value = (record as Record<string, unknown>)[field];
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  }));
}

export function extractSignalEvidenceFromText(input: SignalEvidenceInput): Pick<EvidenceFingerprint, "props" | "signalTokens" | "propertyIds" | "commentTimeWindow" | "evidenceCompleteness"> {
  const signalRecords = readJsonArray(input.signalsJsonText);
  const signalIdRecords = readJsonArray(input.signalsIdJsonText);
  const metrics = readJsonObject(input.metricsJsonText);
  const combinedText = [input.step2Text, input.step4Text].filter(Boolean).join("\n");

  const propMatches = Array.from(combinedText.matchAll(/\b[A-Za-z][A-Za-z0-9_]{2,}\b/g)).map((match) => match[0]);
  const hexMatches = Array.from(combinedText.matchAll(/\b0x[0-9a-fA-F]+\b|\b[0-9A-Fa-f]{2,}h\b/g)).map((match) => match[0]);

  return {
    props: unique([
      ...collectStringField(signalRecords, "prop"),
      ...collectStringField(signalIdRecords, "prop"),
    ]),
    signalTokens: unique([
      ...collectStringField(signalRecords, "matchedSignal"),
      ...collectStringField(signalRecords, "matchedSignals"),
      ...collectStringField(signalRecords, "sourceToken"),
      ...collectStringField(signalIdRecords, "matchedSignals"),
      ...collectStringField(signalIdRecords, "sourceTokens"),
      ...propMatches,
    ]).slice(0, 80),
    propertyIds: unique([
      ...collectStringField(signalIdRecords, "decimalId"),
      ...collectStringField(signalIdRecords, "hexId"),
      ...hexMatches,
    ]),
    commentTimeWindow: typeof metrics?.commentTimeWindow === "string" ? metrics.commentTimeWindow : undefined,
    evidenceCompleteness: metrics?.evidenceCompleteness && typeof metrics.evidenceCompleteness === "object"
      ? metrics.evidenceCompleteness as Record<string, unknown>
      : undefined,
  };
}

export function buildEvidenceFingerprint(params: {
  group: Pick<RuleGroup, "id" | "name">;
  snapshot: Pick<FilteredIssueSnapshot, "issueKey" | "summary">;
  carModel?: string;
  signalEvidence?: Pick<EvidenceFingerprint, "props" | "signalTokens" | "propertyIds" | "commentTimeWindow" | "evidenceCompleteness">;
}): EvidenceFingerprint {
  return {
    ruleGroupId: params.group.id,
    ruleGroupName: params.group.name,
    carModel: params.carModel,
    issueKey: params.snapshot.issueKey,
    issueSummary: params.snapshot.summary,
    props: params.signalEvidence?.props ?? [],
    signalTokens: params.signalEvidence?.signalTokens ?? [],
    propertyIds: params.signalEvidence?.propertyIds ?? [],
    faultKeywords: unique([params.snapshot.summary]).slice(0, 20),
    commentTimeWindow: params.signalEvidence?.commentTimeWindow,
    evidenceCompleteness: params.signalEvidence?.evidenceCompleteness,
  };
}

export function buildEvidenceFingerprintText(fingerprint: Partial<EvidenceFingerprint>): string {
  return [
    fingerprint.issueSummary ? `标题：${fingerprint.issueSummary}` : "",
    fingerprint.ruleGroupName ? `规则组：${fingerprint.ruleGroupName}` : "",
    fingerprint.carModel ? `车型：${fingerprint.carModel}` : "",
    fingerprint.props?.length ? `prop：${fingerprint.props.join(", ")}` : "",
    fingerprint.signalTokens?.length ? `signal token：${fingerprint.signalTokens.slice(0, 40).join(", ")}` : "",
    fingerprint.propertyIds?.length ? `property id：${fingerprint.propertyIds.join(", ")}` : "",
    fingerprint.commentTimeWindow ? `时间窗：${fingerprint.commentTimeWindow}` : "",
  ].filter(Boolean).join("\n");
}
```

- [ ] **步骤 5：注册脚本**

在 `package.json` 的 `scripts` 中添加：

```json
"test:signal-rag": "node scripts/check-signal-rag-retrieval.mjs"
```

- [ ] **步骤 6：运行检查验证通过**

运行：

```bash
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-signal-rag-retrieval.mjs
```

预期：PASS，输出 `Signal RAG retrieval validation passed.`。

- [ ] **步骤 7：Commit**

```bash
git add lib/db/schema.ts lib/analysis/evidence-fingerprint.ts scripts/check-signal-rag-retrieval.mjs package.json
git commit -m "feat: add evidence fingerprint model"
```

## 任务 2：将 prop/signal fingerprint 接入 RAG 召回

**文件：**
- 修改：`stores/processTaskStore.ts`
- 测试：`scripts/check-signal-rag-retrieval.mjs`

- [ ] **步骤 1：扩展 RAG 文本构造函数**

在 `stores/processTaskStore.ts` 顶部导入：

```typescript
import { buildEvidenceFingerprintText } from "@/lib/analysis/evidence-fingerprint";
```

替换 `buildSampleEmbeddingText()`：

```typescript
function buildSampleEmbeddingText(sample: Pick<IssueReviewSample, "issueSummary" | "wrongConclusion" | "correctConclusion" | "errorReason" | "evidenceFingerprintText" | "props" | "signalTokens" | "propertyIds" | "carModel">): string {
  const fingerprintText = sample.evidenceFingerprintText || buildEvidenceFingerprintText({
    issueSummary: sample.issueSummary,
    carModel: sample.carModel,
    props: sample.props ?? [],
    signalTokens: sample.signalTokens ?? [],
    propertyIds: sample.propertyIds ?? [],
  });
  return [
    fingerprintText,
    sample.errorReason ? `错误原因：${sample.errorReason}` : "",
    sample.wrongConclusion ? `错误结论：${sample.wrongConclusion.slice(0, 500)}` : "",
    sample.correctConclusion ? `正确结论：${sample.correctConclusion.slice(0, 500)}` : "",
  ].filter(Boolean).join("\n");
}
```

- [ ] **步骤 2：让当前票查询文本支持 fingerprint**

修改 `scoreFewShotSamplesWithEmbeddings()` 签名：

```typescript
async function scoreFewShotSamplesWithEmbeddings(
  currentRetrievalText: string,
  samples: IssueReviewSample[],
): Promise<Array<{ sample: IssueReviewSample; score: number }>> {
  const missingSamples = samples.filter((sample) => !sample.issueSummaryEmbedding?.length);
  const embeddingInputs = [
    currentRetrievalText,
    ...missingSamples.map((sample) => buildSampleEmbeddingText(sample)),
  ];
  const { model, embeddings } = await fetchEmbeddings(embeddingInputs);
  const currentEmbedding = embeddings[0] ?? [];
  const missingEmbeddings = embeddings.slice(1);

  await Promise.all(missingSamples.map((sample, index) => db.issueReviewSamples.update(sample.id, {
    issueSummaryEmbedding: missingEmbeddings[index] ?? [],
    embeddingModel: model,
    embeddingUpdatedAt: new Date(),
  })));

  const missingById = new Map(missingSamples.map((sample, index) => [sample.id, missingEmbeddings[index] ?? []]));
  return samples.map((sample) => {
    const sampleEmbedding = sample.issueSummaryEmbedding?.length
      ? sample.issueSummaryEmbedding
      : missingById.get(sample.id) ?? [];
    return {
      sample,
      score: cosineSimilarity(currentEmbedding, sampleEmbedding),
    };
  });
}
```

Modify `fetchFewShotSamples()` signature:

```typescript
async function fetchFewShotSamples(
  ruleGroupId: string,
  currentIssueKey: string,
  currentSummary: string,
  maxSamples = 3,
  currentEvidenceText?: string,
): Promise<FewShotSample[]> {
  const allSamples = await db.issueReviewSamples
    .where("ruleGroupId")
    .equals(ruleGroupId)
    .toArray();

  const candidates = allSamples.filter((s) => s.issueKey !== currentIssueKey && (s.issueSummary || s.evidenceFingerprintText));
  const retrievalText = currentEvidenceText || currentSummary;
  let scored: Array<{ sample: IssueReviewSample; score: number }> = [];
  let threshold = EMBEDDING_SCORE_THRESHOLD;

  try {
    scored = await scoreFewShotSamplesWithEmbeddings(retrievalText, candidates);
  } catch (error) {
    console.warn(`[FewShot RAG] Embedding 召回失败，回退标题相似度: ${String(error).slice(0, 160)}`);
    scored = scoreFewShotSamplesWithTitleSimilarity(currentSummary, candidates);
    threshold = TITLE_SCORE_THRESHOLD;
  }

  scored = scored
    .filter((s) => s.score > threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSamples);

  return scored.map(({ sample }) => ({
    issueKey: sample.issueKey,
    issueSummary: sample.issueSummary ?? "",
    wrongConclusion: sample.wrongConclusion.slice(0, 2000),
    correctConclusion: sample.correctConclusion.slice(0, 2000),
    errorReason: sample.errorReason,
  }));
}
```

- [ ] **步骤 3：在 `runOne()` 中构造轻量查询 fingerprint**

在调用 `fetchFewShotSamples()` 前加入：

```typescript
const currentEvidenceText = buildEvidenceFingerprintText({
  ruleGroupId: group.id,
  ruleGroupName: group.name,
  issueKey: snapshot.issueKey,
  issueSummary: snapshot.summary,
});
```

然后改为：

```typescript
const fewShotSamples = await fetchFewShotSamples(
  group.id,
  snapshot.issueKey,
  snapshot.summary,
  3,
  currentEvidenceText,
);
```

- [ ] **步骤 4：人工驳回时保存 fingerprint 字段**

在 `rejectResult()` 创建 `sample` 时加入：

```typescript
const evidenceFingerprintText = buildEvidenceFingerprintText({
  ruleGroupId,
  issueKey,
  issueSummary: issueSummary ?? existing?.issueSummary,
});
```

然后 `sample` 包含：

```typescript
const sample: IssueReviewSample = {
  id: existing?.id ?? nanoid(),
  ruleGroupId,
  issueKey,
  issueSummary: issueSummary ?? existing?.issueSummary,
  evidenceFingerprintText,
  props: existing?.props ?? [],
  signalTokens: existing?.signalTokens ?? [],
  propertyIds: existing?.propertyIds ?? [],
  carModel: existing?.carModel,
  wrongConclusion: resultBefore?.replyText ?? "",
  correctConclusion: correctResult,
  errorReason,
  createdAt: existing?.createdAt ?? new Date(),
};
```

- [ ] **步骤 5：运行 RAG 检查**

运行：

```bash
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-signal-rag-retrieval.mjs
```

预期：PASS。

- [ ] **步骤 6：Commit**

```bash
git add stores/processTaskStore.ts scripts/check-signal-rag-retrieval.mjs
git commit -m "feat: use signal fingerprint for rag retrieval"
```

## 任务 3：实现结构化证据校验工具

**文件：**
- 创建：`lib/analysis/structured-evidence-validation.ts`
- 创建：`scripts/check-structured-evidence-validation.mjs`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的结构化校验检查脚本**

创建 `scripts/check-structured-evidence-validation.mjs`：

```javascript
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const checks = [
  {
    name: "structured evidence validation helper exists",
    pass: () => {
      const source = read("lib/analysis/structured-evidence-validation.ts");
      return source.includes("export interface EvidenceAssertion") &&
        source.includes("export function extractEvidenceAssertions") &&
        source.includes("export function validateStructuredEvidence") &&
        source.includes("evidenceSource");
    },
  },
  {
    name: "validation store calls structured validator",
    pass: () => {
      const store = read("stores/validationStore.ts");
      return store.includes("validateStructuredEvidence") &&
        store.includes("structured_evidence") &&
        store.includes("timestamp_consistency");
    },
  },
  {
    name: "validation checks support evidence source and confidence",
    pass: () => {
      const schema = read("lib/db/schema.ts");
      return schema.includes("evidenceSource?: string") && schema.includes("confidence?: number");
    },
  },
  {
    name: "UI presents structured evidence without blocking Jira backfill",
    pass: () => {
      const detail = read("components/analysis/IssueDetail.tsx");
      return detail.includes("证据校验") &&
        detail.includes("不阻断 Jira 回填") &&
        !detail.includes("validationStatus !== \"pass\" &&") &&
        !detail.includes("latestValidation.validationStatus !== \"pass\" &&");
    },
  },
  {
    name: "package script is registered",
    pass: () => {
      const pkg = JSON.parse(read("package.json"));
      return pkg.scripts?.["test:evidence-validation"] === "node scripts/check-structured-evidence-validation.mjs";
    },
  },
];

const failures = checks.filter((check) => !check.pass());
if (failures.length > 0) {
  console.error("Structured evidence validation checks failed:");
  for (const failure of failures) console.error(`- ${failure.name}`);
  process.exit(1);
}

console.log("Structured evidence validation checks passed.");
```

- [ ] **步骤 2：运行脚本验证失败**

运行：

```bash
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-structured-evidence-validation.mjs
```

预期：FAIL，至少报告 helper 和 store 接线缺失。

- [ ] **步骤 3：实现结构化校验工具**

创建 `lib/analysis/structured-evidence-validation.ts`：

```typescript
import type { IssueValidationCheck, IssueValidationRun } from "@/lib/db/schema";

export interface EvidenceAssertion {
  type: "signal_value" | "time_window" | "reproduction" | "evidence_availability";
  subject: string;
  expected?: string;
  rawText: string;
  confidence: number;
}

export interface StructuredEvidenceInput {
  replyText: string;
  signalSummary?: string;
  canTraceText?: string;
  extractText?: string;
  step4Text?: string;
  metricsText?: string;
}

export interface StructuredEvidenceResult {
  systemVerdict: IssueValidationRun["systemVerdict"];
  checks: Array<Omit<IssueValidationCheck, "id" | "runId" | "createdAt">>;
  detail: Record<string, unknown>;
}

function includesAny(source: string, values: string[]): boolean {
  const normalized = source.toLowerCase();
  return values.some((value) => normalized.includes(value.toLowerCase()));
}

export function extractEvidenceAssertions(replyText: string): EvidenceAssertion[] {
  const assertions: EvidenceAssertion[] = [];
  const signalRegex = /\b([A-Za-z][A-Za-z0-9_]{2,})\s*(?:=|为|是|变为|value\s*)\s*([A-Za-z0-9_.-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = signalRegex.exec(replyText)) !== null) {
    assertions.push({
      type: "signal_value",
      subject: match[1],
      expected: match[2],
      rawText: match[0],
      confidence: 0.78,
    });
  }

  const timeRegex = /\b\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\b/g;
  const timeMatches = replyText.match(timeRegex) ?? [];
  for (const value of timeMatches) {
    assertions.push({
      type: "time_window",
      subject: value,
      expected: value,
      rawText: value,
      confidence: 0.72,
    });
  }

  if (includesAny(replyText, ["一致", "匹配", "复现", "支持描述"])) {
    assertions.push({
      type: "reproduction",
      subject: "AI 结论与证据一致性",
      expected: "supported",
      rawText: "AI 结论声明证据支持问题描述",
      confidence: 0.62,
    });
  }

  if (assertions.length === 0) {
    assertions.push({
      type: "evidence_availability",
      subject: "结构化断言",
      expected: "available",
      rawText: "AI 结论中未提取到可结构化比对的信号或时间断言",
      confidence: 0.5,
    });
  }

  return assertions;
}

function validateAssertion(assertion: EvidenceAssertion, evidenceText: string): Omit<IssueValidationCheck, "id" | "runId" | "createdAt"> {
  if (assertion.type === "evidence_availability") {
    return {
      type: "structured_evidence",
      status: "warning",
      expected: assertion.expected,
      actual: "missing_assertion",
      message: "AI 结论缺少可结构化比对的信号值或时间窗断言",
      evidenceSource: "replyText",
      confidence: assertion.confidence,
    };
  }

  const subjectMatched = assertion.subject ? includesAny(evidenceText, [assertion.subject]) : false;
  const expectedMatched = assertion.expected ? includesAny(evidenceText, [assertion.expected]) : false;
  const status = subjectMatched && (!assertion.expected || expectedMatched)
    ? "pass"
    : subjectMatched
      ? "warning"
      : "fail";

  return {
    type: "structured_evidence",
    status,
    expected: assertion.expected ?? assertion.subject,
    actual: subjectMatched ? "evidence_matched_subject" : "evidence_missing_subject",
    message: status === "pass"
      ? `结构化断言 ${assertion.rawText} 可在 CAN/日志证据中找到`
      : status === "warning"
        ? `结构化断言 ${assertion.rawText} 找到部分证据，但值或上下文不完整`
        : `结构化断言 ${assertion.rawText} 未在 CAN/日志证据中找到`,
    evidenceSource: "can_signal_summary/can_trace/extract/step4",
    confidence: assertion.confidence,
  };
}

function summarizeVerdict(checks: Array<Omit<IssueValidationCheck, "id" | "runId" | "createdAt">>): IssueValidationRun["systemVerdict"] {
  if (checks.length === 0) return "unknown";
  if (checks.some((check) => check.status === "fail" && (check.confidence ?? 0) >= 0.7)) return "fail";
  if (checks.some((check) => check.status === "fail" || check.status === "warning")) return "warning";
  return "pass";
}

export function validateStructuredEvidence(input: StructuredEvidenceInput): StructuredEvidenceResult {
  const evidenceText = [
    input.signalSummary,
    input.canTraceText,
    input.extractText,
    input.step4Text,
    input.metricsText,
  ].filter(Boolean).join("\n");

  if (!evidenceText.trim()) {
    return {
      systemVerdict: "unknown",
      checks: [{
        type: "structured_evidence",
        status: "warning",
        expected: "CAN/日志证据",
        actual: "missing_evidence",
        message: "未找到可用于结构化校验的 CAN 或上层日志证据",
        evidenceSource: "log artifacts",
        confidence: 0.5,
      }],
      detail: {
        assertions: [],
        advisory: true,
      },
    };
  }

  const assertions = extractEvidenceAssertions(input.replyText);
  const checks = assertions.map((assertion) => validateAssertion(assertion, evidenceText));
  return {
    systemVerdict: summarizeVerdict(checks),
    checks,
    detail: {
      assertions,
      advisory: true,
    },
  };
}
```

- [ ] **步骤 4：注册脚本**

在 `package.json` 的 `scripts` 中添加：

```json
"test:evidence-validation": "node scripts/check-structured-evidence-validation.mjs"
```

- [ ] **步骤 5：运行脚本确认仍因 store/UI 未接线失败**

运行：

```bash
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-structured-evidence-validation.mjs
```

预期：FAIL，只剩 validation store 或 UI 接线相关失败。

- [ ] **步骤 6：Commit**

```bash
git add lib/analysis/structured-evidence-validation.ts scripts/check-structured-evidence-validation.mjs package.json
git commit -m "feat: add structured evidence validator"
```

## 任务 4：将结构化证据校验接入 validation store

**文件：**
- 修改：`stores/validationStore.ts`
- 测试：`scripts/check-structured-evidence-validation.mjs`

- [ ] **步骤 1：导入结构化校验工具**

在 `stores/validationStore.ts` 顶部加入：

```typescript
import { validateStructuredEvidence } from "@/lib/analysis/structured-evidence-validation";
```

- [ ] **步骤 2：保留现有时间戳校验为 helper**

将 `runValidation()` 中现有时间戳逻辑提取为本文件内函数：

```typescript
function buildTimestampChecks(result: IssueProcessResult): {
  systemVerdict: IssueValidationRun["systemVerdict"];
  detail: Record<string, unknown>;
  checks: Array<{
    type: string;
    status: "pass" | "fail" | "warning";
    expected?: string;
    actual?: string;
    message: string;
    evidenceSource?: string;
    confidence?: number;
  }>;
} {
  const aiTimes = extractTimestamps(result.replyText);
  const signalSummary = result.signalSummary || "";
  const rangeRegex = /（(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s*~\s*(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)）/g;
  const ranges: { start: number; end: number; text: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = rangeRegex.exec(signalSummary)) !== null) {
    ranges.push({
      start: parseTimeToMs(match[1]),
      end: parseTimeToMs(match[2]),
      text: match[0],
    });
  }

  const checks: Array<{
    type: string;
    status: "pass" | "fail" | "warning";
    expected?: string;
    actual?: string;
    message: string;
    evidenceSource?: string;
    confidence?: number;
  }> = [];
  let passCount = 0;

  for (const aiTimeStr of aiTimes) {
    const aiTimeMs = parseTimeToMs(aiTimeStr);
    let matchedRange: string | undefined;
    const buffer = 2000;
    for (const range of ranges) {
      if (aiTimeMs >= range.start - buffer && aiTimeMs <= range.end + buffer) {
        matchedRange = range.text;
        break;
      }
    }
    if (matchedRange) passCount++;
    checks.push({
      type: "timestamp_consistency",
      status: matchedRange ? "pass" : "fail",
      expected: matchedRange || "N/A",
      actual: aiTimeStr,
      message: matchedRange
        ? `AI 提到的时间点 ${aiTimeStr} 与 CAN 信号区间匹配`
        : `AI 提到的时间点 ${aiTimeStr} 未在 CAN 信号区间中找到`,
      evidenceSource: "signalSummary",
      confidence: 0.7,
    });
  }

  let systemVerdict: IssueValidationRun["systemVerdict"] = "unknown";
  if (aiTimes.length > 0) {
    const ratio = passCount / aiTimes.length;
    if (ratio === 1) systemVerdict = "pass";
    else if (ratio >= 0.5) systemVerdict = "warning";
    else systemVerdict = "fail";
  }

  return {
    systemVerdict,
    detail: {
      checks,
      aiTimes,
      ranges: ranges.map((range) => range.text),
    },
    checks,
  };
}
```

- [ ] **步骤 3：在 `runValidation()` 中优先运行结构化校验**

替换 `runValidation()` 的主体为：

```typescript
runValidation: async (result: IssueProcessResult) => {
  const structured = validateStructuredEvidence({
    replyText: result.replyText,
    signalSummary: result.signalSummary,
  });
  const timestamp = buildTimestampChecks(result);
  const systemVerdict = structured.systemVerdict !== "unknown"
    ? structured.systemVerdict
    : timestamp.systemVerdict;

  const runId = nanoid();
  const run: IssueValidationRun = {
    id: runId,
    resultId: result.id,
    validationStatus: systemVerdict,
    systemVerdict,
    diffSeconds: 0,
    detail: {
      structured: structured.detail,
      timestamp: timestamp.detail,
      advisory: true,
    },
    createdAt: new Date(),
  };

  await db.issueValidationRuns.add(run);

  const now = new Date();
  const checkRecords = [...structured.checks, ...timestamp.checks].map((check) => ({
    id: nanoid(),
    runId,
    type: check.type,
    status: check.status,
    expected: check.expected,
    actual: check.actual,
    message: check.message,
    evidenceSource: check.evidenceSource,
    confidence: check.confidence,
    createdAt: now,
  }));

  if (checkRecords.length > 0) {
    await db.issueValidationChecks.bulkAdd(checkRecords);
  }

  await get().loadValidations(result.id);
  return run;
},
```

- [ ] **步骤 4：运行结构化校验脚本**

运行：

```bash
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-structured-evidence-validation.mjs
```

预期：FAIL，只剩 UI 展示相关失败。

- [ ] **步骤 5：Commit**

```bash
git add stores/validationStore.ts scripts/check-structured-evidence-validation.mjs
git commit -m "feat: store structured evidence validation"
```

## 任务 5：在详情页和校验详情页展示结构化证据

**文件：**
- 修改：`components/analysis/IssueDetail.tsx`
- 修改：`app/analysis/[ruleGroupId]/[issueKey]/validation/[validationRunId]/page.tsx`
- 测试：`scripts/check-structured-evidence-validation.mjs`

- [ ] **步骤 1：在 IssueDetail 校验面板增加 advisory 文案**

在 `components/analysis/IssueDetail.tsx` 的校验面板标题或最新校验摘要附近加入中文说明：

```tsx
<p className="mt-2 text-xs text-[var(--c-text-muted)]">
  证据校验用于辅助人工复核；FAIL/WARNING 表示证据存在冲突或不足，但不阻断 Jira 回填。
</p>
```

确保 Jira 回填按钮禁用条件不引用 `latestValidation.validationStatus`。

- [ ] **步骤 2：在校验详情页展示证据来源和置信度**

在 `app/analysis/[ruleGroupId]/[issueKey]/validation/[validationRunId]/page.tsx` 的 `checks.map()` 渲染区域中，为每条 check 增加：

```tsx
{check.evidenceSource ? (
  <div className="mt-2 text-xs text-[var(--c-text-muted)]">
    证据来源：<span className="font-mono">{check.evidenceSource}</span>
  </div>
) : null}
{typeof check.confidence === "number" ? (
  <div className="mt-1 text-xs text-[var(--c-text-muted)]">
    置信度：{Math.round(check.confidence * 100)}%
  </div>
) : null}
```

- [ ] **步骤 3：运行结构化校验脚本**

运行：

```bash
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-structured-evidence-validation.mjs
```

预期：PASS，输出 `Structured evidence validation checks passed.`。

- [ ] **步骤 4：Commit**

```bash
git add components/analysis/IssueDetail.tsx app/analysis/[ruleGroupId]/[issueKey]/validation/[validationRunId]/page.tsx scripts/check-structured-evidence-validation.mjs
git commit -m "feat: show structured evidence validation"
```

## 任务 6：补充处理流程和人工驳回样本的 evidence 数据

**文件：**
- 修改：`stores/processTaskStore.ts`
- 测试：`scripts/check-signal-rag-retrieval.mjs`
- 测试：`scripts/check-structured-evidence-validation.mjs`

- [ ] **步骤 1：人工驳回样本写入当前已知 evidence 字段**

在 `rejectResult()` 中保留任务 2 已写入的 `evidenceFingerprintText`，并确保旧样本更新时不会丢失已有字段：

```typescript
const sample: IssueReviewSample = {
  id: existing?.id ?? nanoid(),
  ruleGroupId,
  issueKey,
  issueSummary: issueSummary ?? existing?.issueSummary,
  evidenceFingerprintText,
  props: existing?.props ?? [],
  signalTokens: existing?.signalTokens ?? [],
  propertyIds: existing?.propertyIds ?? [],
  carModel: existing?.carModel,
  wrongConclusion: resultBefore?.replyText ?? "",
  correctConclusion: correctResult,
  errorReason,
  createdAt: existing?.createdAt ?? new Date(),
};
```

- [ ] **步骤 2：LearningMemory 内容同步保存 fingerprint**

修改 `rejectResult()` 中 `learningMemories` 的 JSON 内容：

```typescript
const memoryContent = JSON.stringify({
  errorReason,
  correctResult,
  issueSummary,
  wrongConclusion: resultBefore?.replyText,
  evidenceFingerprintText,
});
```

然后 update/add 均使用 `content: memoryContent`。

- [ ] **步骤 3：运行两个专项检查**

运行：

```bash
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-signal-rag-retrieval.mjs
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-structured-evidence-validation.mjs
```

预期：两个脚本均 PASS。

- [ ] **步骤 4：Commit**

```bash
git add stores/processTaskStore.ts scripts/check-signal-rag-retrieval.mjs
git commit -m "feat: persist signal rag sample context"
```

## 任务 7：更新产品和架构文档

**文件：**
- 修改：`docs/PRODUCT.md`
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/WORKFLOW.md`
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
- 修改：`session-handoff.md`

- [ ] **步骤 1：更新 `docs/PRODUCT.md`**

在 AI 校验章节补充：

```markdown
- **结构化证据校验**：处理完成后，系统从 AI 结论中抽取信号值、时间窗、复现判断等结构化断言，并与 CAN trace 摘要、`signals_id.json`、`extract.md` 和上层日志摘录逐项比对，生成 `IssueValidationCheck`。
- **辅助性质**：结构化证据校验的 `FAIL` / `WARNING` 用于提示人工复核证据冲突或证据不足，不阻断 Jira 回填；Jira 回填仍以人工复核 `PASS` 为前置条件。
```

在人工复核学习记忆章节补充：

```markdown
- **prop/signal RAG**：历史纠错案例召回除 Jira 标题外，还会使用 `prop`、signal token、Property ID、车型等 evidence fingerprint；Embedding 服务不可用时仍回退标题 Token 重叠度。
```

- [ ] **步骤 2：更新 `docs/ARCHITECTURE.md`**

在 AI 服务或数据流章节补充：

```markdown
结构化证据校验复用现有 IndexedDB 校验模型：`IssueValidationRun` 记录总体 advisory verdict，`IssueValidationCheck` 记录每一条结构化断言的 expected/actual/message/evidenceSource/confidence。该链路不引入后端数据库，也不改变 Jira 回填权限判断。
```

在 RAG 说明补充：

```markdown
Few-shot 召回文本由 issue summary 扩展为 evidence fingerprint，包含 rule group、车型、prop、signal token 和 property id。`/api/embeddings` 失败时，前端 store 保持标题相似度回退。
```

- [ ] **步骤 3：更新 `docs/WORKFLOW.md`**

在处理后置条件或 AI 校验流程补充：

```markdown
处理结果保存后会自动运行 advisory 结构化证据校验。校验结果会显示在单票详情页和校验详情页；即使系统判定为 `FAIL` 或 `WARNING`，也只提示人工复核注意，不会禁用 Jira 回填入口。
```

- [ ] **步骤 4：更新 `docs/SEQUENCE_DIAGRAMS.md`**

在 AI 分析处理时序后补充：

```text
IssueProcessResult 保存
      │
      ▼
build evidence fingerprint
      │
      ▼
validateStructuredEvidence()
      │
      ▼
IssueValidationRun + IssueValidationCheck
      │
      ▼
详情页展示 advisory 证据校验结果
```

- [ ] **步骤 5：更新 `session-handoff.md`**

新增本轮条目：

```markdown
### v3.18 — 结构化证据校验与 prop/signal RAG (本轮)

- [x] **结构化证据校验**：处理完成后从 AI 结论抽取信号值、时间窗和复现断言，并写入 `IssueValidationRun` / `IssueValidationCheck` 供详情页审计。
- [x] **辅助校验边界**：FAIL/WARNING 只提示证据冲突或不足，不阻断 Jira 回填；回填仍由人工复核 PASS 控制。
- [x] **prop/signal RAG**：Few-shot 召回文本扩展为 evidence fingerprint，包含标题、规则组、车型、prop、signal token 和 Property ID，Embedding 失败时保留标题相似度回退。
- [x] **回归检查**：新增 `npm run test:signal-rag` 和 `npm run test:evidence-validation`。
```

- [ ] **步骤 6：运行文档格式检查**

运行：

```bash
git diff --check -- docs/PRODUCT.md docs/ARCHITECTURE.md docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md
```

预期：无输出，退出码 0。

- [ ] **步骤 7：Commit**

```bash
git add docs/PRODUCT.md docs/ARCHITECTURE.md docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md
git commit -m "docs: document evidence validation signal rag"
```

## 任务 8：最终验证

**文件：**
- 检查：`package.json`
- 检查：`scripts/check-signal-rag-retrieval.mjs`
- 检查：`scripts/check-structured-evidence-validation.mjs`
- 检查：`scripts/check-embedding-rag.mjs`
- 检查：`scripts/check-validation-report-link.mjs`
- 检查：`scripts/check-signal-id-extraction.mjs`
- 检查：`scripts/check-step5-qwen-budget.mjs`

- [ ] **步骤 1：运行新增专项检查**

运行：

```bash
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-signal-rag-retrieval.mjs
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-structured-evidence-validation.mjs
```

预期：两个脚本均 PASS。

- [ ] **步骤 2：运行相关历史回归检查**

运行：

```bash
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-embedding-rag.mjs
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-validation-report-link.mjs
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-signal-id-extraction.mjs
/home/huo2wx/.nvm/versions/node/v20.20.0/bin/node scripts/check-step5-qwen-budget.mjs
```

预期：全部 PASS。

- [ ] **步骤 3：运行 lint**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run lint
```

预期：PASS，无 ESLint error。

- [ ] **步骤 4：运行 TypeScript 检查**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit
```

预期：PASS，无 TypeScript error。

- [ ] **步骤 5：检查最终 diff**

运行：

```bash
git status --short
git diff --check
```

预期：只包含本功能相关文件；`git diff --check` 无输出。

- [ ] **步骤 6：最终 Commit**

如果任务 1-7 已分别 commit，最终只在有遗漏修复时提交：

```bash
git add .
git commit -m "chore: verify evidence validation signal rag"
```

如果没有遗漏修复，不创建空提交。
