import type { GroundingEvidenceSource } from "./structured-evidence-validation";

const EXTRACT_TITLE_PATTERN = /^#\s*CAN Trace Window Extract\s*$/gim;
const PLACEHOLDER_EXTRACT_PATTERN = /未生成筛选结果\s*[:：]/;

export function isPlaceholderExtractText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || PLACEHOLDER_EXTRACT_PATTERN.test(trimmed)) return true;
  return !trimmed.replace(EXTRACT_TITLE_PATTERN, "").trim();
}

export function getGroundingSourceValidationError(
  source: GroundingEvidenceSource,
): string | undefined {
  if (source.name !== "signals_id" && source.name !== "evidence_packet") return undefined;
  const text = source.text.trim();
  if (!text) return undefined;
  try {
    JSON.parse(text);
    return undefined;
  } catch {
    return `invalid_json:${source.name}`;
  }
}

export function hasMeaningfulGroundingSource(source: GroundingEvidenceSource): boolean {
  const text = source.text.trim();
  if (!text || text === "[]" || text === "{}" || text === "null") return false;
  if (getGroundingSourceValidationError(source)) return false;

  if (source.name === "extract") {
    return !isPlaceholderExtractText(text);
  }

  if (source.name === "signals_id") {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  }

  if (source.name === "evidence_packet") {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const hasEvidenceItems = ["matchedProps", "signalIntervals", "logHits"]
        .some((key) => Array.isArray(parsed[key]) && parsed[key].length > 0);
      const timeWindow = parsed.timeWindow && typeof parsed.timeWindow === "object"
        ? parsed.timeWindow as Record<string, unknown>
        : null;
      const hasTimeStart = timeWindow
        ? ["start", "commentStart", "traceStart"]
          .some((key) => typeof timeWindow[key] === "string" && Boolean((timeWindow[key] as string).trim()))
        : false;
      const hasTimeEnd = timeWindow
        ? ["end", "commentEnd", "traceEnd"]
          .some((key) => typeof timeWindow[key] === "string" && Boolean((timeWindow[key] as string).trim()))
        : false;
      const hasActualTimeSource = typeof timeWindow?.source === "string"
        && ["comment_timestamp", "comment_time_only", "trace_timestamp"]
          .includes(timeWindow.source.trim());
      return hasEvidenceItems || (hasActualTimeSource && hasTimeStart && hasTimeEnd);
    } catch {
      return false;
    }
  }

  return true;
}

export const INPUT_COMMENTS_SOURCE_NAME = "input_comments";

/**
 * 测试人员在评论中粘贴的上层日志（时间戳、setIntProperty val 等）是原始证据，
 * 作为补充来源参与接地匹配；仅在已有核心证据时追加，不改变“缺少证据/未知”判定。
 */
export function withSupplementalCommentSource(
  coreSources: GroundingEvidenceSource[],
  commentsText: string | undefined,
): GroundingEvidenceSource[] {
  const text = (commentsText ?? "").trim();
  if (coreSources.length === 0 || !text) return coreSources;
  return [...coreSources, { name: INPUT_COMMENTS_SOURCE_NAME, text }];
}
