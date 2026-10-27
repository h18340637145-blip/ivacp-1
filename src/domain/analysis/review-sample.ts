import { buildEvidenceFingerprintText } from "./evidence-fingerprint";
import type { EvidencePacket } from "./evidence-packet";
import {
  REJECT_REASONS,
  effectiveRejectReasonCode,
  isRejectReasonCode,
  type ErrorPattern,
  type RejectReasonCode,
} from "./reject-reasons";
import type {
  ReviewSample,
  ReviewEvidence,
  ReviewSampleKind,
  TicketSource,
} from "@/domain/entities";

export interface ReviewSampleShape {
  ticketKey: string;
  issueSummary?: string;
  sampleKind?: ReviewSampleKind;
  approvedConclusion?: string;
  wrongConclusion: string;
  correctConclusion: string;
  errorReason: string;
  /** 结构化驳回原因；历史样本缺失时按 errorReason 文本推断 */
  errorCategory?: RejectReasonCode;
  carModel?: string;
  props?: string[];
  signalTokens?: string[];
  propertyIds?: string[];
}

interface BuildReviewSampleInput {
  existing?: ReviewSample;
  id: string;
  ruleGroupId: string;
  ruleGroupName?: string;
  source: TicketSource;
  ticketKey: string;
  issueSummary?: string;
  sampleKind: ReviewSampleKind;
  aiConclusion: string;
  correctConclusion?: string;
  errorReason?: string;
  errorCategory?: RejectReasonCode;
  reviewEvidence?: ReviewEvidence;
  signalSummary?: string;
  now?: Date;
}

interface RankedCandidate<T extends ReviewSampleShape> {
  sample: T;
  relevanceScore: number;
}

const COMMON_TECHNICAL_WORDS = new Set([
  "CAN",
  "CANTrace",
  "Property",
  "Signal",
]);

function unique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawValue of values) {
    const value = rawValue?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function normalizedSet(values?: string[]): Set<string> {
  return new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function overlapCount(left?: string[], right?: string[]): number {
  const leftSet = normalizedSet(left);
  return Array.from(normalizedSet(right)).filter((value) => leftSet.has(value)).length;
}

function sameCarModel(left?: string, right?: string): boolean {
  const normalizedLeft = left?.trim().toLowerCase();
  const normalizedRight = right?.trim().toLowerCase();
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function normalizeReviewSampleKind(
  sample: { sampleKind?: ReviewSampleKind },
): ReviewSampleKind {
  return sample.sampleKind === "approved" ? "approved" : "correction";
}

export function extractLegacyReviewEvidence(texts: Array<string | undefined>): ReviewEvidence {
  const text = texts.filter(Boolean).join("\n");
  const identifiers = Array.from(text.matchAll(/\b[A-Za-z][A-Za-z0-9_]{2,}\b/g))
    .map((match) => match[0])
    .filter((token) => (
      token.includes("_")
      || /[a-z][A-Z]/.test(token)
      || /^[A-Z]{2,}[A-Za-z0-9]*$/.test(token)
    ))
    .filter((token) => !COMMON_TECHNICAL_WORDS.has(token));
  const hexadecimalIds = Array.from(text.matchAll(/\b0x[0-9a-fA-F]+\b|\b[0-9A-Fa-f]{2,}h\b/g))
    .map((match) => match[0]);
  const decimalIds = Array.from(
    text.matchAll(/(?:property[\s_-]*id|prop(?:erty)?[\s_-]*id)\s*(?:[:=：]|\bis\b)?\s*(\d{2,})/gi),
  ).map((match) => match[1]);

  return {
    props: [],
    signalTokens: unique(identifiers).slice(0, 80),
    propertyIds: unique([...hexadecimalIds, ...decimalIds]),
  };
}

export function reviewEvidenceFromEvidencePacket(packet: EvidencePacket): ReviewEvidence {
  return {
    carModel: packet.carModel === "unknown" ? undefined : packet.carModel,
    props: unique(packet.matchedProps.map((item) => item.prop)),
    signalTokens: unique(packet.matchedProps.flatMap((item) => [
      ...item.sourceTokens,
      ...item.signals,
    ])),
    propertyIds: unique(packet.matchedProps.flatMap((item) => {
      const decimal = item.propertyId?.decimal;
      return [
        decimal === null || decimal === undefined ? undefined : String(decimal),
        item.propertyId?.hex ?? undefined,
      ];
    })),
  };
}

export function buildReviewSample(input: BuildReviewSampleInput): ReviewSample {
  const fallbackEvidence = input.reviewEvidence
    ? undefined
    : extractLegacyReviewEvidence([
        input.issueSummary,
        input.aiConclusion,
        input.signalSummary,
        input.correctConclusion,
        input.errorReason,
      ]);
  const evidence = input.reviewEvidence ?? fallbackEvidence ?? {
    props: [],
    signalTokens: [],
    propertyIds: [],
  };
  const issueSummary = input.issueSummary ?? input.existing?.issueSummary;
  const fingerprint = buildEvidenceFingerprintText({
    ruleGroupId: input.ruleGroupId,
    ruleGroupName: input.ruleGroupName,
    issueKey: input.ticketKey,
    issueSummary,
    carModel: evidence.carModel,
    props: evidence.props,
    signalTokens: evidence.signalTokens,
    propertyIds: evidence.propertyIds,
  });

  return {
    id: input.existing?.id ?? input.id,
    source: input.source,
    ruleGroupId: input.ruleGroupId,
    ticketKey: input.ticketKey,
    issueSummary,
    evidenceFingerprintText: fingerprint,
    props: evidence.props,
    signalTokens: evidence.signalTokens,
    propertyIds: evidence.propertyIds,
    carModel: evidence.carModel,
    sampleKind: input.sampleKind,
    approvedConclusion: input.sampleKind === "approved" ? input.aiConclusion : undefined,
    wrongConclusion: input.sampleKind === "correction" ? input.aiConclusion : "",
    correctConclusion: input.sampleKind === "correction" ? input.correctConclusion?.trim() ?? "" : "",
    errorReason: input.sampleKind === "correction" ? input.errorReason?.trim() ?? "" : "",
    errorCategory: input.sampleKind === "correction"
      ? input.errorCategory ?? effectiveRejectReasonCode({ errorReason: input.errorReason })
      : undefined,
    issueSummaryEmbedding: undefined,
    embeddingModel: undefined,
    embeddingUpdatedAt: undefined,
    createdAt: input.now ?? new Date(),
  };
}

/** 某类错误在规则组里越常见，同类纠错案例越值得注入；上限避免压过语义相似度 */
const CATEGORY_PRIOR_WEIGHT = 0.2;
const CATEGORY_PRIOR_CAP = 0.08;
/** 同一票上次被驳回的类型：再次分析时优先注入同类纠错案例 */
const FOCUS_CATEGORY_BOOST = 0.2;
const DEFAULT_MAX_PER_CATEGORY = 2;

export function rankReviewSampleCandidates<T extends ReviewSampleShape>(args: {
  currentEvidence: ReviewEvidence;
  candidates: Array<RankedCandidate<T>>;
  maxSamples?: number;
  /** 各错误类型在规则组内的占比（0-1），用于先验加权 */
  categoryPrior?: Partial<Record<RejectReasonCode, number>>;
  /** 优先类型（如该票上次的驳回类型） */
  focusCategories?: RejectReasonCode[];
  /** 仅保留这些类型的纠错案例；正确案例不受影响 */
  onlyCategories?: RejectReasonCode[];
  /** 同一个具体错误类型最多入选条数，保证类型多样；“其他”不受限 */
  maxPerCategory?: number;
}): Array<RankedCandidate<T> & { score: number }> {
  const focus = new Set(args.focusCategories ?? []);
  const only = args.onlyCategories?.length ? new Set(args.onlyCategories) : null;
  const scored = args.candidates.flatMap((candidate, index) => {
    const sample = candidate.sample;
    const modelMatch = sameCarModel(args.currentEvidence.carModel, sample.carModel);
    const propOverlap = overlapCount(args.currentEvidence.props, sample.props);
    const signalOverlap = overlapCount(args.currentEvidence.signalTokens, sample.signalTokens);
    const propertyIdOverlap = overlapCount(args.currentEvidence.propertyIds, sample.propertyIds);
    const hasStructuredOverlap = propOverlap + signalOverlap + propertyIdOverlap > 0;

    const isApproved = normalizeReviewSampleKind(sample) === "approved";
    if (isApproved && !modelMatch && !hasStructuredOverlap) {
      return [];
    }
    const category = isApproved ? undefined : effectiveRejectReasonCode(sample);
    if (category && only && !only.has(category)) return [];
    const categoryBoost = category
      ? Math.min((args.categoryPrior?.[category] ?? 0) * CATEGORY_PRIOR_WEIGHT, CATEGORY_PRIOR_CAP)
        + (focus.has(category) ? FOCUS_CATEGORY_BOOST : 0)
      : 0;

    return [{
      ...candidate,
      category,
      score: candidate.relevanceScore
        + categoryBoost
        + (modelMatch ? 0.15 : 0)
        + Math.min(propOverlap, 2) * 0.12
        + Math.min(signalOverlap, 3) * 0.08
        + Math.min(propertyIdOverlap, 2) * 0.16,
      index,
    }];
  });

  const maxPerCategory = args.maxPerCategory ?? DEFAULT_MAX_PER_CATEGORY;
  const perCategory = new Map<RejectReasonCode, number>();
  const selected: typeof scored = [];
  for (const item of scored.sort((left, right) => right.score - left.score || left.index - right.index)) {
    if (selected.length >= (args.maxSamples ?? 3)) break;
    if (item.category && item.category !== "other") {
      const used = perCategory.get(item.category) ?? 0;
      if (used >= maxPerCategory) continue;
      perCategory.set(item.category, used + 1);
    }
    selected.push(item);
  }
  return selected.map(({ sample, relevanceScore, score }) => ({ sample, relevanceScore, score }));
}

const HISTORY_EVIDENCE_GUARD = [
  "不得复制历史票的信号值、时间、报文状态或责任结论。",
  "当前票不存在对应证据时，忽略历史案例中的事实。",
  "最终断言必须由当前票 Evidence Packet、CAN 摘要或日志摘录支持。",
].join("\n");

function evidenceLine(sample: ReviewSampleShape): string {
  const evidence = [
    sample.carModel ? `车型=${sample.carModel}` : "",
    sample.props?.length ? `props=${sample.props.join(", ")}` : "",
    sample.signalTokens?.length ? `signals=${sample.signalTokens.join(", ")}` : "",
    sample.propertyIds?.length ? `Property IDs=${sample.propertyIds.join(", ")}` : "",
  ].filter(Boolean).join("；");
  return evidence || "无结构化证据（历史兼容样本）";
}

function checklistLine(corrections: ReviewSampleShape[]): string {
  const codes = [...new Set(corrections.map((sample) => effectiveRejectReasonCode(sample)))]
    .filter((code) => REJECT_REASONS[code].checklist);
  if (codes.length === 0) return "";
  return ["本次案例涉及的复核要点：", ...codes.map((code) => `- ${REJECT_REASONS[code].label}：${REJECT_REASONS[code].checklist}`)].join("\n");
}

/** 历史错误模式：告诉模型本规则组 / 车型最常见的人工驳回类型，作为自查清单 */
export function buildErrorPatternBlock(patterns: ErrorPattern[] | undefined): string {
  // 请求体来自客户端：只信任类型代码与数字，标签和要点一律由服务端常量生成
  const valid = (patterns ?? [])
    .filter((pattern) => isRejectReasonCode(pattern?.code) && pattern.code !== "other" && Number.isFinite(pattern.count) && Number.isFinite(pattern.share))
    .slice(0, 3);
  if (!valid.length) return "";
  const scope = valid[0].scope === "car_model" ? "该车型" : "该规则组";
  return [
    "<历史错误模式>",
    `${scope}历史上被人工驳回的常见原因（仅作自查提醒，不是当前票的事实）：`,
    ...valid.map((pattern) => {
      const info = REJECT_REASONS[pattern.code];
      return `- ${info.label}（${Math.round(pattern.count)} 次，占 ${Math.round(pattern.share * 100)}%）：${info.checklist}`;
    }),
    "</历史错误模式>",
  ].join("\n");
}

export function buildReviewSamplePromptBlocks(samples: ReviewSampleShape[]): {
  correctionBlock: string;
  approvedBlock: string;
} {
  const corrections = samples.filter((sample) => normalizeReviewSampleKind(sample) === "correction");
  const approved = samples.filter((sample) => normalizeReviewSampleKind(sample) === "approved");

  const correctionBlock = corrections.length === 0 ? "" : [
    "<历史纠错案例>",
    "以下案例用于避免重复历史错误；只参考纠错模式。",
    HISTORY_EVIDENCE_GUARD,
    ...corrections.map((sample, index) => [
      `### 纠错案例 ${index + 1}：${sample.ticketKey}（${sample.issueSummary ?? ""}）`,
      `证据指纹：${evidenceLine(sample)}`,
      `错误类型：${REJECT_REASONS[effectiveRejectReasonCode(sample)].label}`,
      `错误结论（负例，不要重复）：${sample.wrongConclusion}`,
      `错误原因：${sample.errorReason}`,
      `正确结论：${sample.correctConclusion}`,
    ].join("\n")),
    checklistLine(corrections),
    "</历史纠错案例>",
  ].filter(Boolean).join("\n\n");

  const approvedBlock = approved.length === 0 ? "" : [
    "<历史正确案例>",
    "以下人工确认案例只用于参考分析结构和决策模式，不得作为当前票事实。",
    HISTORY_EVIDENCE_GUARD,
    ...approved.map((sample, index) => [
      `### 正确案例 ${index + 1}：${sample.ticketKey}（${sample.issueSummary ?? ""}）`,
      `证据指纹：${evidenceLine(sample)}`,
      `人工确认结论：${sample.approvedConclusion ?? ""}`,
    ].join("\n")),
    "</历史正确案例>",
  ].join("\n\n");

  return { correctionBlock, approvedBlock };
}
