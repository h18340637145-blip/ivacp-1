import {
  REJECT_REASON_CODES,
  REJECT_REASONS,
  effectiveRejectReasonCode,
  isRejectReasonCode,
  type RejectReasonCode,
} from "@/domain/analysis/reject-reasons";

export const VERDICTS = ["correct", "partial", "wrong", "unusable"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const PURPOSES = ["few_shot_positive", "few_shot_negative", "eval_truth", "exclude"] as const;
export type Purpose = (typeof PURPOSES)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const VERDICT_INFO: Record<Verdict, { label: string; hint: string }> = {
  correct: { label: "完全正确", hint: "现象、证据、结论都与日志一致，可直接回填 Jira。" },
  partial: { label: "部分正确", hint: "主结论成立，但有遗漏或表述过度；需勾选错误类型。" },
  wrong: { label: "错误", hint: "主结论与日志不符；需勾选错误类型，并尽量给出正确结论。" },
  unusable: { label: "无法标注", hint: "缺日志、信息不足或票据本身不明确，不进入任何数据集。" },
};

export const PURPOSE_INFO: Record<Purpose, { label: string; hint: string }> = {
  few_shot_positive: { label: "正例 few-shot", hint: "结论写得好，可作为同类票的示范。要求：完全正确。" },
  few_shot_negative: { label: "负例 few-shot", hint: "AI 结论 → 正确结论成对示范。要求：错误/部分正确，且填写正确结论。" },
  eval_truth: { label: "评测真值", hint: "结论足够确定，可作为准确率评测的标准答案。" },
  exclude: { label: "排除", hint: "质量差、有争议或含敏感内容，不要用于 few-shot 与评测。" },
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: "简单", medium: "中等", hard: "困难" };

export interface AnnotationInput {
  verdict: Verdict;
  errorCodes: RejectReasonCode[];
  purposes: Purpose[];
  correctedConclusion: string;
  difficulty: Difficulty;
  note: string;
}

export interface Annotation extends AnnotationInput {
  itemId: string;
  labeler: string;
  revision: number;
  updatedAt: string;
}

/** 校验并规整标注输入；任何不合规的组合都抛出中文错误 */
export function validateAnnotation(raw: unknown): AnnotationInput {
  const input = (raw ?? {}) as Record<string, unknown>;
  if (!VERDICTS.includes(input.verdict as Verdict)) throw new Error("请选择结论判定");
  const verdict = input.verdict as Verdict;
  const errorCodes = Array.isArray(input.errorCodes)
    ? Array.from(new Set(input.errorCodes.filter(isRejectReasonCode)))
    : [];
  const purposes = Array.isArray(input.purposes)
    ? Array.from(new Set(input.purposes.filter((p): p is Purpose => PURPOSES.includes(p as Purpose))))
    : [];
  const correctedConclusion = typeof input.correctedConclusion === "string" ? input.correctedConclusion.trim() : "";
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 2000) : "";
  const difficulty = DIFFICULTIES.includes(input.difficulty as Difficulty) ? (input.difficulty as Difficulty) : "medium";

  if (correctedConclusion.length > 20000) throw new Error("正确结论过长");
  if ((verdict === "partial" || verdict === "wrong") && errorCodes.length === 0) {
    throw new Error("部分正确/错误必须至少勾选一个错误类型");
  }
  if (errorCodes.includes("other") && !note) throw new Error("勾选“其他”时必须在备注里说明");
  if (verdict === "correct" && errorCodes.length > 0) throw new Error("完全正确不应勾选错误类型");
  if (verdict === "unusable" && purposes.some((p) => p !== "exclude")) {
    throw new Error("无法标注的数据只能选择“排除”或不选用途");
  }
  if (purposes.includes("exclude") && purposes.length > 1) throw new Error("“排除”不能与其他用途同时选择");
  if (purposes.includes("few_shot_positive") && verdict !== "correct") throw new Error("正例 few-shot 要求判定为完全正确");
  if (purposes.includes("few_shot_negative")) {
    if (verdict !== "wrong" && verdict !== "partial") throw new Error("负例 few-shot 要求判定为错误或部分正确");
    if (!correctedConclusion) throw new Error("负例 few-shot 必须填写正确结论");
  }
  if (purposes.includes("eval_truth") && (verdict === "wrong" || verdict === "partial") && !correctedConclusion) {
    throw new Error("错误样本作评测真值时必须填写正确结论");
  }
  return { verdict, errorCodes, purposes, correctedConclusion, difficulty, note };
}

export interface LabelItemSignals {
  reviewStatus?: string;
  errorReason?: string;
  errorCategory?: unknown;
  aiReviewVerdict?: string;
  replyText?: string;
  signalSummary?: string;
  manualCorrectResult?: string;
}

export interface LabelSuggestion {
  verdict?: Verdict;
  errorCodes: RejectReasonCode[];
  purposes: Purpose[];
  /** 逐条核对提示，帮助标注者发现常见问题 */
  hints: string[];
}

/**
 * 根据已有人工复核、AI 复核与文本特征给出“预填建议”和核对提示。
 * 仅是建议，标注者必须自行确认，不会被当作标注结果保存。
 */
export function suggestLabels(item: LabelItemSignals): LabelSuggestion {
  const hints: string[] = [];
  const reply = item.replyText ?? "";
  let verdict: Verdict | undefined;
  let errorCodes: RejectReasonCode[] = [];
  let purposes: Purpose[] = [];

  if (item.reviewStatus === "approved") {
    verdict = "correct";
    purposes = ["few_shot_positive"];
    hints.push("人工复核已通过：请重新核对证据后确认，避免把凑合通过的结论当正例。");
  } else if (item.reviewStatus === "rejected") {
    verdict = "wrong";
    const code = effectiveRejectReasonCode({ errorCategory: item.errorCategory, errorReason: item.errorReason });
    if (code !== "other") errorCodes = [code];
    purposes = item.manualCorrectResult?.trim() ? ["few_shot_negative", "eval_truth"] : [];
    hints.push(`人工已驳回${item.errorReason ? `：${item.errorReason.slice(0, 80)}` : ""}。`);
    if (!item.manualCorrectResult?.trim()) hints.push("驳回时没有留下正确结论，需补写后才能作负例。");
  } else {
    hints.push("尚未人工复核：请结合信号摘要与日志独立判断。");
  }
  if (item.aiReviewVerdict === "fail") hints.push("AI 复核判为不通过，优先检查证据与结论是否对应。");
  if (/待人工复核|证据不足|无法确定|不确定/.test(reply)) hints.push("结论自述证据不足：判断是否应标为“缺日志”或“结论过度”。");
  if (!/\d{1,2}:\d{2}:\d{2}/.test(reply)) hints.push("结论里没有时间戳：核对时序描述是否有依据。");
  if (reply.length < 120) hints.push("结论很短：可能漏提信号，检查信号是否齐全。");
  if (item.signalSummary !== undefined && !item.signalSummary.trim()) hints.push("信号摘要为空：可能缺日志。");
  return { verdict, errorCodes, purposes, hints };
}

/** 错误类型选项（沿用结构化驳回原因），供界面展示 */
export function describeErrorCodes(): Array<{ code: RejectReasonCode; label: string; hint: string }> {
  return REJECT_REASON_CODES.map((code) => ({ code, label: REJECT_REASONS[code].label, hint: REJECT_REASONS[code].hint }));
}

export interface ExportableItem {
  itemId: string;
  source: "jira" | "meegle";
  issueKey: string;
  /** 台架 bench / 实车 vehicle，无标志时缺省 */
  scene?: "bench" | "vehicle";
  aiConclusion: string;
}

/** 导出 JSONL 一行：无法标注、排除或未选用途的一律不导出 */
export function toExportRecord(item: ExportableItem, annotation: Annotation): Record<string, unknown> | null {
  if (annotation.verdict === "unusable" || annotation.purposes.includes("exclude") || annotation.purposes.length === 0) return null;
  return {
    id: item.itemId,
    source: item.source,
    issueKey: item.issueKey,
    scene: item.scene,
    verdict: annotation.verdict,
    errorCodes: annotation.errorCodes,
    purposes: annotation.purposes,
    aiConclusion: item.aiConclusion,
    correctedConclusion: annotation.correctedConclusion || undefined,
    difficulty: annotation.difficulty,
    note: annotation.note || undefined,
    labeler: annotation.labeler,
    updatedAt: annotation.updatedAt,
  };
}
