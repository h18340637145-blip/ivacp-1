# Structured Evidence Validation and Signal RAG Design

## Goal

Improve Jira ticket analysis accuracy without blocking the existing Jira backfill flow.

The change adds two auxiliary accuracy features:

1. A structured evidence validator that converts AI conclusions into auditable checks against CAN and upper-log evidence.
2. A prop/signal-aware RAG retrieval path that recalls historical correction cases by evidence fingerprint, not only by Jira title.

This design follows the selected scope: validation warnings and failures help reviewers and prompts, but they do not prevent Jira comments from being written when the existing manual-review rules allow backfill.

## Current Context

The project already has the main building blocks:

- Issue processing writes evidence files under `log/{ruleGroupId}/{carModel}/{issueKey}/`.
- `signals.json` and `signals_id.json` normalize AI signal tokens to config `prop` and proto `Property_ID`.
- `extract.md` and `step4_android_qnx_input.md` capture Android/QNX logs filtered by comment-derived time windows and signal ids.
- `IssueValidationRun` and `IssueValidationCheck` already model validation runs and check items.
- `IssueReviewSample` stores historical wrong/correct conclusions.
- `/api/embeddings` and `fetchFewShotSamples()` already support semantic few-shot retrieval with lexical fallback.
- `pipeline-metrics.json` records evidence completeness and processing metrics.

The design should reuse these surfaces instead of adding a backend database or a separate validation result store.

## Non-Goals

- Do not block Jira backfill based on structured validation results.
- Do not replace the existing Qwen model configuration.
- Do not add cloud sync, login changes, or a backend database.
- Do not remove the lexical fallback for RAG retrieval.
- Do not require all historical samples to be migrated before the feature works.

## Recommended Architecture

### 1. Evidence Fingerprint

Introduce a small evidence fingerprint model used by both validation and RAG.

Suggested fields:

- `ruleGroupId`
- `ruleGroupName`
- `carModel`
- `issueKey`
- `issueSummary`
- `props`
- `signalTokens`
- `propertyIds`
- `faultKeywords`
- `commentTimeWindow`
- `evidenceCompleteness`

The fingerprint is derived from existing artifacts:

- `FilteredIssueSnapshot.summary` and `rawData`
- `signals.json`
- `signals_id.json`
- `pipeline-metrics.json`
- optionally Step 2/Step 4 output files if present

If one source is missing, the fingerprint should still be built from the remaining sources. Missing evidence should lower confidence, not fail the whole processing flow.

### 2. Prop/Signal RAG Retrieval

Extend the current few-shot retrieval path in `stores/processTaskStore.ts`.

The current `buildSampleEmbeddingText()` uses title, error reason, and wrong conclusion. It should be expanded to include evidence fingerprint fields when available:

```text
标题：...
规则组：...
车型：...
prop：...
signal token：...
property id：...
错误原因：...
错误结论：...
正确结论：...
```

For the current ticket, build the query text using the same shape:

```text
标题：...
规则组：...
车型：...
prop：...
signal token：...
property id：...
```

Retrieval behavior:

- Keep `ruleGroupId` scoping.
- Prefer embedding cosine similarity when `/api/embeddings` is available.
- Cache embeddings on `IssueReviewSample` as today.
- Keep title-token similarity as fallback.
- Preserve the downstream few-shot payload shape so Step 5 prompt injection does not need a broad rewrite.

Historical samples without fingerprint data remain valid. They simply rank by the existing text fields until new data is available.

### 3. Structured Evidence Validator

Add a focused validation module that produces structured `IssueValidationCheck` entries.

Inputs:

- `IssueProcessResult.replyText`
- `can_signal_summary.txt`
- `can_trace_extracted_result.txt`
- `signals.json`
- `signals_id.json`
- `extract.md`
- `step4_android_qnx_input.md`
- `pipeline-metrics.json`

The validator has two phases:

1. Extract evidence assertions from the AI conclusion.
2. Compare each assertion with CAN/log evidence.

Example assertion categories:

- Signal value assertion: `CouplingFaultStatus_253h = 0`
- Time-window assertion: issue occurs around a specific comment or CAN trace time
- Reproduction assertion: CAN data supports or contradicts Jira description
- Evidence availability assertion: CAN/log evidence is missing or incomplete

Each check should map to the existing validation UI shape:

- `checkName`
- `expectedValue`
- `actualValue`
- `verdict`
- `reason`
- `evidenceSource`
- optional `confidence`

System verdict calculation:

- `FAIL` when at least one high-confidence check contradicts the AI conclusion.
- `WARNING` when evidence is incomplete, ambiguous, or only partially matched.
- `PASS` when checks align with available evidence.
- `UNKNOWN` when there is not enough structured evidence to compare.

The result is advisory only. It updates validation status and UI, but does not change Jira backfill permissions.

### 4. Processing Flow Integration

The feature should integrate after the current analysis result is saved:

1. Run the existing issue processing pipeline.
2. Save `IssueProcessResult`.
3. Build evidence fingerprint from stored snapshot and evidence files.
4. Run structured evidence validation.
5. Save `IssueValidationRun` and `IssueValidationCheck`.
6. Show results in the existing detail and validation pages.

Step 5 prompt generation should receive improved few-shot examples from prop/signal RAG before generating `replyText`.

Failures should be non-blocking:

- If fingerprint creation fails, log a warning and fall back to current title-based retrieval.
- If structured validation fails, keep the process result and show validation as `UNKNOWN` or `FAILED` according to existing UI semantics.
- If embedding service fails, use lexical fallback.

### 5. UI Behavior

No new primary workflow is required.

Existing pages should surface stronger details:

- Single issue detail page shows structured evidence verdict summary.
- Validation detail page lists each structured check with evidence source and reason.
- FAIL/WARNING states should make evidence conflicts visible, but should not disable Jira backfill buttons.

Chinese UI copy should be used for reviewer-facing labels.

### 6. Data Model Changes

Prefer additive fields.

Potential additions to `IssueReviewSample`:

- `evidenceFingerprintText?: string`
- `props?: string[]`
- `signalTokens?: string[]`
- `propertyIds?: string[]`
- `carModel?: string`

Potential additions to `IssueValidationCheck` if not already available:

- `evidenceSource?: string`
- `confidence?: number`

If the current schema already has generic detail fields, use those instead of expanding the schema unnecessarily.

## Testing Strategy

Add focused validation scripts consistent with existing project style:

- Check RAG fingerprint construction and embedding fallback wiring.
- Check that `IssueReviewSample` remains backward compatible.
- Check structured validation module maps assertions to `IssueValidationCheck`.
- Check processing flow triggers structured validation after saving the result.
- Check documentation mentions advisory behavior and no Jira backfill blocking.

Recommended script names:

- `scripts/check-signal-rag-retrieval.mjs`
- `scripts/check-structured-evidence-validation.mjs`

Existing validations should still be run after implementation:

- `npm run lint`
- `npx tsc --noEmit`
- relevant existing check scripts for RAG, validation, signal extraction, and Step 5 prompt budgeting

Use the repository's Node 20 path if the shell resolves to `/usr/bin/node` v12.

## Documentation Updates

Implementation should update:

- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/WORKFLOW.md`
- `docs/SEQUENCE_DIAGRAMS.md`
- `session-handoff.md`

The documents must explicitly state:

- Structured evidence validation is advisory.
- Jira backfill remains controlled by manual review status.
- Prop/signal RAG uses existing embedding configuration and lexical fallback.

## Acceptance Criteria

- Similar historical correction cases can be recalled by shared `prop`, signal token, or property id even when Jira titles differ.
- Embedding service failure does not break issue processing.
- Processing a ticket can produce structured validation checks tied to concrete CAN/log evidence sources.
- Validation FAIL/WARNING is visible to reviewers but does not block existing Jira backfill flow.
- Existing historical `IssueReviewSample` records still participate in retrieval.
- Documentation and `session-handoff.md` are synchronized after implementation.
