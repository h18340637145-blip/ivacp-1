import { validateStructuredEvidence } from "@/domain/analysis/structured-evidence-validation";
import type { ValidationCheck, ValidationRun } from "@/domain/entities";

export interface ValidationCoreInput {
  replyText: string;
  signalSummary?: string;
}

export interface ValidationCoreResult {
  systemVerdict: ValidationRun["systemVerdict"];
  detail: Record<string, unknown>;
  checks: Array<Omit<ValidationCheck, "id" | "runId" | "createdAt" | "source">>;
}

function parseTimeToMs(value: string): number {
  const [hms, fraction] = value.split(".");
  const [hours, minutes, seconds] = hms.split(":").map(Number);
  return hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + Number((fraction ?? "").padEnd(3, "0").slice(0, 3));
}

function buildTimestampChecks(input: ValidationCoreInput) {
  const aiTimes = input.replyText.match(/\b\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\b/g) ?? [];
  const ranges: Array<{ start: number; end: number; text: string }> = [];
  const rangeRegex = /（(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s*~\s*(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)）/g;
  let match: RegExpExecArray | null;
  while ((match = rangeRegex.exec(input.signalSummary ?? "")) !== null) {
    ranges.push({ start: parseTimeToMs(match[1]), end: parseTimeToMs(match[2]), text: match[0] });
  }
  let passCount = 0;
  const checks = aiTimes.map((time) => {
    const point = parseTimeToMs(time);
    const matched = ranges.find((range) => point >= range.start - 2_000 && point <= range.end + 2_000);
    if (matched) passCount += 1;
    return {
      type: "timestamp_consistency",
      status: matched ? "pass" as const : "fail" as const,
      expected: matched?.text ?? "N/A",
      actual: time,
      message: matched ? `AI 提到的时间点 ${time} 与 CAN 信号区间匹配` : `AI 提到的时间点 ${time} 未在 CAN 信号区间中找到`,
      evidenceSource: "signalSummary",
      confidence: 0.7,
    };
  });
  const verdict = aiTimes.length === 0
    ? "unknown" as const
    : passCount === aiTimes.length
      ? "pass" as const
      : passCount / aiTimes.length >= 0.5
        ? "warning" as const
        : "fail" as const;
  return { checks, verdict, detail: { aiTimes, ranges: ranges.map((range) => range.text) } };
}

export function buildValidationCoreResult(input: ValidationCoreInput): ValidationCoreResult {
  const structured = validateStructuredEvidence({
    replyText: input.replyText,
    evidencePacketText: "",
    signalSummary: input.signalSummary,
  });
  const timestamp = buildTimestampChecks(input);
  return {
    systemVerdict: structured.systemVerdict !== "unknown" ? structured.systemVerdict : timestamp.verdict,
    detail: {
      structured: structured.detail,
      timestamp: timestamp.detail,
      checkTypes: ["structured_evidence", "timestamp_consistency"],
      advisory: true,
    },
    checks: [...structured.checks, ...timestamp.checks],
  };
}