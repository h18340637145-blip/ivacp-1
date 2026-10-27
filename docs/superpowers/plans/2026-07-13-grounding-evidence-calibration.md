# Grounding 证据判定校准实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 统一在线自批判与离线评测的证据归一化和来源审计，正确处理时间、键值、标识符及 Property ID 等价表达，并明确区分格式误报与真实证据缺失。

**架构：** 将 `computeGrounding()` 扩展为兼容旧字符串输入和具名证据源数组的共享判定入口。每个接地结果携带规范化断言、命中来源或未命中原因；在线处理与离线回放传入同一组可信来源，不改变 Jira 回填门禁。

**技术栈：** TypeScript、Next.js Route Handler、Node.js 20、tsx loader、现有 Evidence Packet 与离线评测脚本

---

## 文件结构

- 创建：`scripts/test-grounding-calibration.ts`，执行语义级归一化和审计回归。
- 修改：`package.json`，注册 `test:grounding-calibration`。
- 修改：`lib/analysis/structured-evidence-validation.ts`，实现具名证据源、共享归一化和审计结果。
- 修改：`app/api/issues/process/route.ts`，向在线自批判传入具名可信证据源并落盘审计。
- 修改：`scripts/eval-accuracy.ts`，向离线评测传入同一来源集合并输出未命中原因。
- 修改：`scripts/check-accuracy-phase1.mjs`、`scripts/check-accuracy-phase3.mjs`，增加接口与接线静态保护。
- 修改：`docs/PRODUCT.md`、`docs/ARCHITECTURE.md`、`docs/WORKFLOW.md`、`docs/SEQUENCE_DIAGRAMS.md`，同步证据判定行为。
- 修改：`session-handoff.md`，记录完成状态、评测前后数据和残余风险。

### 任务 1：建立失败的语义回归测试

**文件：**
- 创建：`scripts/test-grounding-calibration.ts`
- 修改：`package.json`

- [ ] **步骤 1：创建具名证据源和审计字段测试**

```typescript
import assert from "node:assert/strict";
import { computeGrounding } from "../lib/analysis/structured-evidence-validation";

const sources = [
  { name: "can_signal_summary", text: "2026-06-22 13:40:13.416000 RBCM_MFS_HeatSts = 1" },
  { name: "signals_id", text: '{"prop":"ADS_5_ELKSettingSt","propertyId":"0x21800123","getSignals":"ELKSettingSt"}' },
  { name: "extract", text: "getMsgId = null\nkeycode: 535" },
];

const result = computeGrounding(
  "13:40:13.416 时 RBCM_MFS_HeatSts 为 1；getMsgId为null；keycode=535；Property_ID=562037027。",
  sources,
);

assert.equal(result.ungrounded.length, 0);
assert.ok(result.grounded.every((item) => item.normalizedSubject));
assert.ok(result.grounded.every((item) => item.evidenceSource));
assert.ok(result.grounded.every((item) => item.checkedEvidenceSources.length === 3));

const mismatch = computeGrounding("keycode=536", sources);
assert.equal(mismatch.ungrounded.length, 1);
assert.equal(mismatch.ungrounded[0].missReason, "subject_value_pair_not_found");

console.log("Grounding calibration tests passed.");
```

- [ ] **步骤 2：注册不依赖 tsx IPC 的测试命令**

```json
"test:grounding-calibration": "node --import tsx scripts/test-grounding-calibration.ts"
```

- [ ] **步骤 3：运行测试并确认旧接口失败**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:grounding-calibration
```

预期：FAIL；旧实现不接受具名来源数组，且 `GroundingItem` 不包含审计字段。

- [ ] **步骤 4：提交失败测试**

```bash
git add package.json scripts/test-grounding-calibration.ts
git commit -m "test: define grounding calibration cases"
```

### 任务 2：实现共享证据归一化与审计

**文件：**
- 修改：`lib/analysis/structured-evidence-validation.ts:169-367`

- [ ] **步骤 1：扩展兼容类型**

```typescript
export interface GroundingEvidenceSource {
  name: string;
  text: string;
}

export type GroundingMissReason =
  | "missing_evidence"
  | "subject_not_found"
  | "expected_not_found"
  | "subject_value_pair_not_found";

export interface GroundingItem {
  type: EvidenceAssertion["type"];
  subject: string;
  expected?: string;
  rawText: string;
  normalizedSubject: string;
  normalizedExpected?: string;
  grounded: boolean;
  evidenceSource?: string;
  evidenceExcerpt?: string;
  checkedEvidenceSources: string[];
  missReason?: GroundingMissReason;
}
```

- [ ] **步骤 2：增加输入兼容和时间归一化函数**

```typescript
function toGroundingSources(input: string | GroundingEvidenceSource[]): GroundingEvidenceSource[] {
  if (typeof input === "string") return [{ name: "combined_evidence", text: input }];
  return input.filter((source) => source.text.trim());
}

function normalizeTimeToken(value: string): string {
  const match = value.match(/(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?/);
  if (!match) return "";
  const fraction = (match[4] ?? "").padEnd(6, "0").replace(/0+$/, "");
  return `${match[1]}${match[2]}${match[3]}${fraction}`;
}
```

将 `buildGroundingEvidenceIndex()` 的 `times` 改为通过 `normalizeTimeToken()` 建索引；Property ID 继续使用现有十六进制转十进制扩展。

- [ ] **步骤 3：实现逐来源匹配和审计结果**

```typescript
function findGroundingSource(
  sources: GroundingEvidenceSource[],
  assertion: EvidenceAssertion,
): GroundingEvidenceSource | undefined {
  return sources.find((source) => {
    const index = buildGroundingEvidenceIndex(source.text);
    return assertion.type === "signal_value"
      ? evidenceIndexIncludesPair(index, assertion.subject, assertion.expected)
      : evidenceIndexIncludes(index, assertion.subject) &&
          (!assertion.expected || evidenceIndexIncludes(index, assertion.expected));
  });
}
```

`computeGrounding(replyText, evidenceInput)` 对每条断言填写规范化字段、所有已检查来源、命中来源和最多 240 字符的证据摘要。未命中时按以下固定顺序设置原因：无来源为 `missing_evidence`；subject 不存在为 `subject_not_found`；signal/value 对不在同一来源片段为 `subject_value_pair_not_found`；其余为 `expected_not_found`。

- [ ] **步骤 4：运行语义测试确认通过**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:grounding-calibration
```

预期：PASS，输出 `Grounding calibration tests passed.`。

- [ ] **步骤 5：提交共享实现**

```bash
git add lib/analysis/structured-evidence-validation.ts
git commit -m "feat: audit normalized grounding evidence"
```

### 任务 3：对齐在线与离线证据来源

**文件：**
- 修改：`app/api/issues/process/route.ts:553-652,2955-2964`
- 修改：`scripts/eval-accuracy.ts:20-60,117-140,220-230`

- [ ] **步骤 1：让在线自批判同时接收展示文本和具名来源**

```typescript
const u3EvidenceSources = [
  { name: "evidence_packet", text: evidencePacketText },
  { name: "can_signal_summary", text: canPlotResult.summary },
  { name: "can_trace_extracted_result", text: step5CanTrace.decodedSummary },
  { name: "signals_id", text: JSON.stringify(signalIdRecords) },
  { name: "extract", text: extractMarkdown },
].filter((source) => source.text.trim());
const u3EvidenceText = u3EvidenceSources.map((source) => source.text).join("\n");
finalReply = await runEvidenceSelfCritique(
  finalReply,
  u3EvidenceText,
  u3EvidenceSources,
  logRoot,
  metrics,
  logger,
);
```

在 `runEvidenceSelfCritique()` 内的每次 `computeGrounding()` 调用使用 `evidenceSources`；`evidence-grounding.json` 的 history 增加 `grounded` 和 `ungrounded` 完整审计条目，保留原有 ratio 与字符串列表字段以兼容旧消费方。

- [ ] **步骤 2：让离线评测构造相同的具名来源**

```typescript
async function buildEvidenceSources(ticketDir: string) {
  const specs = [
    ["evidence_packet", "evidence-packet.json"],
    ["can_signal_summary", "can_signal_summary.txt"],
    ["can_trace_extracted_result", "can_trace_extracted_result.txt"],
    ["signals_id", "signals_id.json"],
    ["extract", "extract.md"],
  ] as const;
  const sources = await Promise.all(specs.map(async ([name, file]) => ({
    name,
    text: await readTextSafe(path.join(ticketDir, file)),
  })));
  return sources.filter((source) => source.text.trim());
}
```

`TicketResult` 墧加 `ungroundedAudit: GroundingItem[]`；Markdown 热点为每条未接地断言追加 `missReason` 和 `checkedEvidenceSources`，JSON 保留完整审计。

- [ ] **步骤 3：运行语义与既有准确率回归**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:grounding-calibration
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase1
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase3
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:evidence-validation
```

预期：四个命令均 PASS。

- [ ] **步骤 4：提交调用链对齐**

```bash
git add app/api/issues/process/route.ts scripts/eval-accuracy.ts
git commit -m "feat: align online and offline grounding sources"
```

### 任务 4：补强静态保护并重跑离线评测

**文件：**
- 修改：`scripts/check-accuracy-phase1.mjs`
- 修改：`scripts/check-accuracy-phase3.mjs`
- 生成：`docs/golden-baseline/eval-report.json`
- 生成：`docs/golden-baseline/eval-report.md`

- [ ] **步骤 1：增加静态断言**

在 `scripts/check-accuracy-phase1.mjs` 增加：

```javascript
assert(/export interface GroundingEvidenceSource/.test(sev), "grounding 缺少具名证据源接口");
assert(/checkedEvidenceSources/.test(sev), "GroundingItem 缺少已检查来源审计");
assert(/missReason/.test(sev), "GroundingItem 缺少未命中原因");
```

在 `scripts/check-accuracy-phase3.mjs` 的 route 和 eval 检查中增加：

```javascript
for (const sourceName of [
  "evidence_packet",
  "can_signal_summary",
  "can_trace_extracted_result",
  "signals_id",
  "extract",
]) {
  assert(route.includes(sourceName), `在线 grounding 缺少来源：${sourceName}`);
  assert(read("scripts/eval-accuracy.ts").includes(sourceName), `离线 grounding 缺少来源：${sourceName}`);
}
```

- [ ] **步骤 2：运行完整准确率回归**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase1
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase2
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase3
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:signal-rag
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:evidence-validation
```

预期：全部 PASS。

- [ ] **步骤 3：运行离线评测并记录差异**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run eval:accuracy
```

预期：生成新报告。将其与基线 67 票、跳过 4、EGR 57.5%、`ungrounded_conclusion=46` 对比；分别记录格式误报减少量和仍缺少可信证据的断言数量，不把 EGR 变化表述为端到端准确率。

- [ ] **步骤 4：提交测试与评测产物**

```bash
git add scripts/check-accuracy-phase1.mjs scripts/check-accuracy-phase3.mjs docs/golden-baseline/eval-report.json docs/golden-baseline/eval-report.md
git commit -m "test: cover grounding evidence calibration"
```

### 任务 5：同步文档并完成最终验证

**文件：**
- 修改：`docs/PRODUCT.md`
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/WORKFLOW.md`
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
- 修改：`session-handoff.md`

- [ ] **步骤 1：同步文档**

在四份 Harness 文档中明确：在线和离线共用具名可信证据源；归一化支持时间、键值、标识符和 Property ID；审计失败不阻断 Jira 回填。将 `session-handoff.md` 的证据校准待办标记完成，并记录评测前后指标和残余真实缺证据问题。

- [ ] **步骤 2：运行最终验证**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:grounding-calibration
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase1
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase2
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase3
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:signal-rag
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:evidence-validation
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run build
```

预期：所有回归和生产构建通过。

- [ ] **步骤 3：提交文档与最终状态**

```bash
git add docs/PRODUCT.md docs/ARCHITECTURE.md docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md
git commit -m "docs: record grounding calibration rollout"
```
