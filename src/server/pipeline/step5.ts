import { chat } from "@/server/ai/qwen";
import { computeGrounding } from "@/domain/analysis/structured-evidence-validation";
import type { GroundingEvidenceSource, GroundingItem } from "@/domain/analysis/structured-evidence-validation";
import type { EvidencePacket } from "@/domain/analysis/evidence-packet";
import { rankReviewSampleCandidates, reviewEvidenceFromEvidencePacket } from "@/domain/analysis/review-sample";
import { MAX_STEP5_CAN_SUMMARY_CHARS, MAX_STEP5_RAW_CAN_CHARS, STEP5_OUTPUT_CONSTRAINT, STEP5_PROMPT_TOKEN_BUDGET, STEP5_SELF_CONSISTENCY_SAMPLES, STEP5_SELF_CONSISTENCY_TEMPERATURE, STEP5_TEMPERATURE } from "@/server/pipeline/constants";
import { PipelineLogger, saveStepLog } from "@/server/pipeline/paths-logging";
import { FewShotSample, PipelineMetrics } from "@/server/pipeline/types";
import { fewShotTicketKey } from "@/domain/analysis/process-contracts";

/** Detect high-priority Jira issues that warrant self-consistency voting. */
export function isHighPriorityIssue(priority: unknown): boolean {
  if (!priority) return false;
  return /(highest|high|critical|blocker|urgent|severe|p0|p1|s0|s1|s2|紧急|严重|致命|阻塞|高)/i.test(String(priority));
}

export interface Step5PromptSection {
  name: string;
  content: string;
  minChars?: number;
  maxChars?: number;
  /**
   * Trim priority: higher value = trimmed earlier (less important).
   * Sections with the lowest value (e.g. CAN Trace 提取结果) are protected and
   * only trimmed as a last resort. Defaults to array index when omitted.
   */
  trimPriority?: number;
}

export function estimatePromptTokens(text: string): number {
  return Math.ceil(text.length / 1.5);
}

export function truncateMiddle(text: string, maxChars: number, label: string): string {
  if (!text || text.length <= maxChars) return text;
  if (maxChars <= 200) return text.slice(0, maxChars);

  const marker = `\n\n[${label} 已裁剪：原始 ${text.length} 字符，仅保留前后关键片段]\n\n`;
  const remaining = Math.max(0, maxChars - marker.length);
  const headChars = Math.ceil(remaining * 0.65);
  const tailChars = Math.floor(remaining * 0.35);
  return `${text.slice(0, headChars)}${marker}${text.slice(text.length - tailChars)}`;
}

export function summarizeCanTraceForStep5(
  decodedSummary: string,
  rawCanTrace: string,
): { decodedSummary: string; rawPreview: string; trimmed: string[] } {
  const trimmed: string[] = [];
  const cappedDecoded = truncateMiddle(decodedSummary, MAX_STEP5_CAN_SUMMARY_CHARS, "CAN Trace提取结果");
  const cappedRaw = truncateMiddle(rawCanTrace, MAX_STEP5_RAW_CAN_CHARS, "CAN Trace日志片段");

  if (decodedSummary && cappedDecoded.length < decodedSummary.length) {
    trimmed.push(`CAN提取结果 ${decodedSummary.length}->${cappedDecoded.length} 字符`);
  }
  if (rawCanTrace && cappedRaw.length < rawCanTrace.length) {
    trimmed.push(`CAN原始片段 ${rawCanTrace.length}->${cappedRaw.length} 字符`);
  }

  return { decodedSummary: cappedDecoded, rawPreview: cappedRaw, trimmed };
}

export function trimPromptSectionsToTokenBudget(
  sections: Step5PromptSection[],
  tokenBudget: number,
): { prompt: string; originalTokens: number; finalTokens: number; trimmed: string[] } {
  const originalPrompt = sections.map((s) => s.content).filter(Boolean).join("\n\n");
  const originalTokens = estimatePromptTokens(originalPrompt);
  const mutable = sections.map((section) => {
    const content = section.maxChars
      ? truncateMiddle(section.content, section.maxChars, section.name)
      : section.content;
    return { ...section, content };
  });
  const trimmed: string[] = [];

  let prompt = mutable.map((s) => s.content).filter(Boolean).join("\n\n");
  let finalTokens = estimatePromptTokens(prompt);
  if (finalTokens <= tokenBudget) {
    return { prompt, originalTokens, finalTokens, trimmed };
  }

  // Trim in descending trimPriority order so the most important evidence
  // (lowest trimPriority, e.g. CAN Trace 提取结果) is preserved the longest.
  const trimOrder = mutable
    .map((section, index) => ({ index, priority: section.trimPriority ?? index }))
    .sort((a, b) => b.priority - a.priority)
    .map((entry) => entry.index);

  for (const i of trimOrder) {
    if (finalTokens <= tokenBudget) break;
    const section = mutable[i];
    if (!section.content) continue;
    const minChars = section.minChars ?? Math.min(1_000, section.content.length);
    if (section.content.length <= minChars) continue;

    const before = section.content.length;
    section.content = truncateMiddle(section.content, minChars, section.name);
    trimmed.push(`${section.name} ${before}->${section.content.length} 字符`);
    prompt = mutable.map((s) => s.content).filter(Boolean).join("\n\n");
    finalTokens = estimatePromptTokens(prompt);
  }

  if (finalTokens > tokenBudget) {
    const before = prompt.length;
    prompt = truncateMiddle(prompt, Math.floor(tokenBudget * 1.2), "Step5 prompt");
    finalTokens = estimatePromptTokens(prompt);
    trimmed.push(`Step5 prompt ${before}->${prompt.length} 字符`);
  }

  return { prompt, originalTokens, finalTokens, trimmed };
}

export function buildStep5MergedPrompt(
  sections: Step5PromptSection[],
  logger: PipelineLogger,
): string {
  const result = trimPromptSectionsToTokenBudget(sections.filter((s) => s.content.trim()), STEP5_PROMPT_TOKEN_BUDGET);
  if (result.trimmed.length > 0 || result.originalTokens !== result.finalTokens) {
    logger.log(
      "AI_STEP5",
      `Step5 prompt 裁剪：tokens ${result.originalTokens}->${result.finalTokens}/${STEP5_PROMPT_TOKEN_BUDGET}；${result.trimmed.join("；") || "仅应用分段上限"}`,
    );
  } else {
    logger.log("AI_STEP5", `Step5 prompt tokens ${result.finalTokens}/${STEP5_PROMPT_TOKEN_BUDGET}`);
  }
  return result.prompt;
}

/* ── Evidence-based few-shot reranking helpers ── */

export function rerankFewShotSamplesByEvidence(
  samples: FewShotSample[] | undefined,
  evidencePacket: EvidencePacket,
): Array<FewShotSample & { ticketKey: string }> {
  if (!samples?.length) return [];
  return rankReviewSampleCandidates({
    currentEvidence: reviewEvidenceFromEvidencePacket(evidencePacket),
    candidates: samples.map((sample) => ({
      sample: { ...sample, ticketKey: fewShotTicketKey(sample) },
      relevanceScore: sample.relevanceScore ?? 0,
    })),
    maxSamples: 3,
  }).map(({ sample }) => sample);
}

/**
 * Run the Step 5 final conclusion.
 *
 * - Always appends the structured-output constraint and uses a low temperature
 *   for stable, evidence-grounded output.
 * - For high-priority issues, draws several independent samples (self-consistency)
 *   and consolidates them into a single conclusion that drops contradictory or
 *   unsupported claims.
 */
export async function runStep5Conclusion(
  systemPrompt: string,
  userContent: string,
  highPriority: boolean,
  logger: PipelineLogger,
): Promise<string> {
  const fullSystem = `${systemPrompt}${STEP5_OUTPUT_CONSTRAINT}`;

  if (!highPriority) {
    return chat(fullSystem, userContent, { temperature: STEP5_TEMPERATURE });
  }

  logger.log(
    "AI_STEP5",
    `高优先级票：启用 Self-Consistency（${STEP5_SELF_CONSISTENCY_SAMPLES} 次采样投票）`,
  );
  const candidates = await Promise.all(
    Array.from({ length: STEP5_SELF_CONSISTENCY_SAMPLES }, () =>
      chat(fullSystem, userContent, { temperature: STEP5_SELF_CONSISTENCY_TEMPERATURE }).catch((e) => {
        logger.log("AI_STEP5", `Self-Consistency 采样失败：${String(e).slice(0, 120)}`);
        return "";
      }),
    ),
  );
  const valid = candidates.map((c) => c.trim()).filter(Boolean);
  if (valid.length <= 1) {
    return valid[0] ?? chat(fullSystem, userContent, { temperature: STEP5_TEMPERATURE });
  }

  const aggregationSystem = [
    "你是资深车载软件缺陷分析复核专家。下面是同一张缺陷票的多份独立分析结论草稿。",
    "请对比这些草稿：剔除相互矛盾或缺乏证据支撑的部分，保留多数草稿一致且有明确证据支撑的判断，合并为一份最终结论。",
    "不得引入任何草稿中未出现且无证据支撑的新结论。",
    STEP5_OUTPUT_CONSTRAINT,
  ].join("\n");
  const aggregationUser = valid
    .map((c, i) => `<分析草稿${i + 1}>\n${c}\n</分析草稿${i + 1}>`)
    .join("\n\n");
  try {
    const consolidated = (await chat(aggregationSystem, aggregationUser, { temperature: STEP5_TEMPERATURE })).trim();
    logger.log(
      "AI_STEP5",
      `Self-Consistency 合并完成：${valid.length} 份草稿 -> 最终结论 ${consolidated.length} 字符`,
    );
    return consolidated || valid[0];
  } catch (e) {
    logger.log("AI_STEP5", `Self-Consistency 合并失败，回退首个草稿：${String(e).slice(0, 120)}`);
    return valid[0];
  }
}

export const EVIDENCE_CRITIQUE_SYSTEM =
  "你是严谨的车载故障结论复核员。下面给出一份分析结论与其可用证据语料。" +
  "只处理【未接地断言】中列出的断言：删除或弱化证据语料中找不到依据的断言，无法确认的改写为“证据不足，待人工复核”；" +
  "其余可在证据语料中找到的时间戳、信号值、表格行必须逐字保留，不得合并、概括或删减；" +
  "不得新增证据之外的任何结论或数值；保持原有【现象/证据/根因/结论/置信度】结构。" +
  "只输出修订后的结论正文，不要解释你做了什么。";

/**
 * U3：Step 5 结论产出后内联证据自批判。存在未接地断言则做 1 次批判-修订调用。
 * 自愈性质，失败回退原结论，不阻断流程。
 */
export async function runEvidenceSelfCritique(
  finalReply: string,
  evidenceText: string,
  evidenceSources: GroundingEvidenceSource[],
  missingEvidenceSources: string[],
  logRoot: string,
  metrics: PipelineMetrics,
  logger: { log: (stage: string, msg: string) => void },
): Promise<string> {
  if (!finalReply.trim()) return finalReply;

  const before = computeGrounding(finalReply, evidenceSources);
  if (evidenceSources.length === 0) {
    const hasGroundingAssertions = before.total > 0;
    const groundingRatio = hasGroundingAssertions ? Number(before.ratio.toFixed(4)) : null;
    if (hasGroundingAssertions) {
      metrics.groundingBefore = groundingRatio ?? undefined;
      metrics.groundingAfter = groundingRatio ?? undefined;
    }
    await saveStepLog(logRoot, "evidence-grounding.json", JSON.stringify({
      ratioBefore: groundingRatio,
      ratioAfter: groundingRatio,
      groundingStatus: hasGroundingAssertions
        ? "missing_evidence"
        : "unknown_missing_evidence",
      revised: false,
      ungroundedBefore: before.ungrounded.map((item) => item.rawText),
      ungroundedAfter: before.ungrounded.map((item) => item.rawText),
      missingEvidenceSources,
      rounds: 0,
      history: [{
        round: 0,
        ratio: groundingRatio,
        ungrounded: before.ungrounded.map((item) => item.rawText),
        groundedAudit: before.grounded,
        ungroundedAudit: before.ungrounded,
      }],
    }, null, 2));
    return finalReply;
  }

  metrics.groundingBefore = Number(before.ratio.toFixed(4));
  if (before.ungrounded.length === 0) {
    await saveStepLog(logRoot, "evidence-grounding.json", JSON.stringify({
      ratioBefore: metrics.groundingBefore,
      ratioAfter: metrics.groundingBefore,
      groundingStatus: "evaluated",
      revised: false,
      ungroundedBefore: [],
      ungroundedAfter: [],
      missingEvidenceSources,
      rounds: 0,
      history: [{
        round: 0,
        ratio: metrics.groundingBefore,
        ungrounded: [],
        groundedAudit: before.grounded,
        ungroundedAudit: before.ungrounded,
      }],
    }, null, 2));
    metrics.groundingAfter = metrics.groundingBefore;
    return finalReply;
  }

  let currentReply = finalReply;
  let currentGrounding = before;
  const history: {
    reply: string;
    ratio: number;
    groundedAudit: GroundingItem[];
    ungroundedAudit: GroundingItem[];
  }[] = [
    {
      reply: finalReply,
      ratio: before.ratio,
      groundedAudit: before.grounded,
      ungroundedAudit: before.ungrounded,
    },
  ];

  const maxRounds = 3;
  let round = 0;

  while (round < maxRounds && currentGrounding.ungrounded.length > 0 && evidenceText.trim()) {
    round++;
    logger.log(
      "AI_STEP5",
      `U3 证据自批判：第 ${round} 轮启动，当前接地率 ${(currentGrounding.ratio * 100).toFixed(0)}%，未接地断言数 ${currentGrounding.ungrounded.length}`,
    );

    try {
      const userContent =
        `【原结论】\n${currentReply}\n\n【可用证据语料】\n${evidenceText}\n\n` +
        `【未接地断言】\n${currentGrounding.ungrounded.map((item) => item.rawText).join("；")}`;
      const out = await chat(EVIDENCE_CRITIQUE_SYSTEM, userContent, { temperature: 0.1 });
      const stripped = stripThinkTags(out).cleaned.trim();
      if (!stripped) {
        logger.log("AI_STEP5", `U3 第 ${round} 轮自批判返回空值，终止自修正`);
        break;
      }

      const after = computeGrounding(stripped, evidenceSources);
      history.push({
        reply: stripped,
        ratio: after.ratio,
        groundedAudit: after.grounded,
        ungroundedAudit: after.ungrounded,
      });

      currentReply = stripped;
      currentGrounding = after;

      if (after.ratio >= 1.0) {
        logger.log("AI_STEP5", `U3 第 ${round} 轮自修正已达到 100% 接地率，终止循环`);
        break;
      }
    } catch (e) {
      logger.log("AI_STEP5", `U3 第 ${round} 轮自批判调用失败：${String(e).slice(0, 120)}`);
      break;
    }
  }

  let bestIndex = 0;
  let bestRatio = history[0].ratio;
  const originalGroundedCount = history[0].groundedAudit.length;
  for (let i = 1; i < history.length; i++) {
    // 通过删减已接地事实换取接地率的修订不可采纳
    if (history[i].groundedAudit.length < originalGroundedCount) {
      logger.log(
        "AI_STEP5",
        `U3 第 ${i} 轮修订丢失已接地断言（${history[i].groundedAudit.length}/${originalGroundedCount}），不采纳`,
      );
      continue;
    }
    if (history[i].ratio > bestRatio) {
      bestRatio = history[i].ratio;
      bestIndex = i;
    }
  }

  const finalBest = history[bestIndex];
  metrics.groundingAfter = Number(bestRatio.toFixed(4));

  await saveStepLog(logRoot, "evidence-grounding.json", JSON.stringify({
    ratioBefore: metrics.groundingBefore,
    ratioAfter: metrics.groundingAfter,
    groundingStatus: "evaluated",
    revised: bestIndex > 0,
    bestRoundIndex: bestIndex,
    totalRoundsRun: round,
    ungroundedBefore: history[0].ungroundedAudit.map((item) => item.rawText),
    ungroundedAfter: finalBest.ungroundedAudit.map((item) => item.rawText),
    missingEvidenceSources,
    history: history.map((h, index) => ({
      round: index,
      ratio: Number(h.ratio.toFixed(4)),
      ungrounded: h.ungroundedAudit.map((item) => item.rawText),
      groundedAudit: h.groundedAudit,
      ungroundedAudit: h.ungroundedAudit,
    })),
  }, null, 2));

  if (bestIndex > 0) {
    logger.log(
      "AI_STEP5",
      `U3 证据自批判完成：接地率 ${(metrics.groundingBefore * 100).toFixed(0)}% -> ${(metrics.groundingAfter * 100).toFixed(0)}%（共执行 ${round} 轮，最终采纳第 ${bestIndex} 轮结果）`,
    );
  } else {
    logger.log(
      "AI_STEP5",
      `U3 证据自批判结束：无可改善结果，回退原结论。接地率保持 ${(metrics.groundingBefore * 100).toFixed(0)}%`,
    );
  }

  return finalBest.reply;
}

/* ─── CAN Signal Plotting via Node.js + Chart.js ─────────────────────── */

/**
 * Strip <think>...</think> tags from AI response.
 * Returns { cleaned, thinking } where thinking is the extracted content.
 */
export function stripThinkTags(text: string): { cleaned: string; thinking: string } {
  const thinkParts: string[] = [];
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, (match) => {
    thinkParts.push(match);
    return "";
  });
  // Also handle unclosed <think> at the start (model sometimes doesn't close it)
  const unclosed = cleaned.replace(/^<think>[\s\S]*$/, (match) => {
    thinkParts.push(match);
    return "";
  });
  return { cleaned: unclosed.trim(), thinking: thinkParts.join("\n") };
}
