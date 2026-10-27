import { computeGrounding, type GroundingEvidenceSource } from "@/domain/analysis/structured-evidence-validation";
import { isPlaceholderExtractText } from "@/domain/analysis/grounding-evidence-sources";

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
  /** 上层时间减 CAN trace 时间的疑似整小时时钟偏差（如 UTC 与北京时间相差 8 小时）。 */
  suspectedClockOffsetHours?: number;
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

export function parseEvidenceTime(value?: string, referenceDate?: string): number | null {
  const raw = value?.trim();
  if (!raw) return null;

  const fullMatch = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/,
  );
  const timeOnlyMatch = raw.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  const referenceMatch = referenceDate
    ?.trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)?$/);

  const parts = fullMatch
    ? {
        year: fullMatch[1],
        month: fullMatch[2],
        day: fullMatch[3],
        hour: fullMatch[4],
        minute: fullMatch[5],
        second: fullMatch[6],
        millisecond: fullMatch[7] ?? "000",
      }
    : timeOnlyMatch && referenceMatch
      ? {
          year: referenceMatch[1],
          month: referenceMatch[2],
          day: referenceMatch[3],
          hour: timeOnlyMatch[1],
          minute: timeOnlyMatch[2],
          second: timeOnlyMatch[3],
          millisecond: timeOnlyMatch[4] ?? "000",
        }
      : null;

  if (!parts) return null;

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const millisecond = Number(parts.millisecond.padEnd(3, "0"));

  const timestamp = new Date(year, month - 1, day, hour, minute, second, millisecond).getTime();
  if (!Number.isFinite(timestamp)) return null;

  const parsed = new Date(timestamp);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute ||
    parsed.getSeconds() !== second ||
    parsed.getMilliseconds() !== millisecond
  ) {
    return null;
  }

  return timestamp;
}

export function computeTimeWindowOverlap(input: BuildEvidencePacketInput): boolean | null {
  const comment = input.commentTimeWindow;
  if (!comment || !input.traceStartTime || !input.traceEndTime) return null;

  const referenceDate = input.traceStartTime || comment.start;
  const commentStartMs = parseEvidenceTime(comment.start, referenceDate);
  const commentEndMs = parseEvidenceTime(comment.end, referenceDate);
  const traceStartMs = parseEvidenceTime(input.traceStartTime, comment.start);
  const traceEndMs = parseEvidenceTime(input.traceEndTime, comment.start);

  if (
    commentStartMs === null ||
    commentEndMs === null ||
    traceStartMs === null ||
    traceEndMs === null
  ) {
    return null;
  }

  return commentStartMs <= traceEndMs && traceStartMs <= commentEndMs;
}

const HOUR_MS = 60 * 60 * 1000;
const CLOCK_OFFSET_TOLERANCE_MS = 60 * 1000;
const MAX_CLOCK_OFFSET_HOURS = 12;

/**
 * 时间窗不重叠时，若将上层时间窗平移整 N 小时（|N|≤12）后完全落入 CAN trace 时间窗（容差 60 秒），
 * 视为两端时钟存在整小时偏差（常见为 UTC 与北京时间相差 8 小时），返回最小的 N；否则返回 undefined。
 */
export function detectClockOffsetHours(input: BuildEvidencePacketInput): number | undefined {
  const comment = input.commentTimeWindow;
  if (!comment || !input.traceStartTime || !input.traceEndTime) return undefined;
  if (comment.source === "fallback" || comment.source === "trace_timestamp") return undefined;
  if (computeTimeWindowOverlap(input) !== false) return undefined;

  const referenceDate = input.traceStartTime || comment.start;
  const commentStartMs = parseEvidenceTime(comment.start, referenceDate);
  const commentEndMs = parseEvidenceTime(comment.end, referenceDate);
  const traceStartMs = parseEvidenceTime(input.traceStartTime, comment.start);
  const traceEndMs = parseEvidenceTime(input.traceEndTime, comment.start);
  if (commentStartMs === null || commentEndMs === null || traceStartMs === null || traceEndMs === null) {
    return undefined;
  }

  const offsets = Array.from({ length: MAX_CLOCK_OFFSET_HOURS }, (_, index) => index + 1)
    .flatMap((hours) => [hours, -hours]);
  return offsets.find((hours) => {
    const shiftedStart = commentStartMs - hours * HOUR_MS;
    const shiftedEnd = commentEndMs - hours * HOUR_MS;
    return shiftedStart >= traceStartMs - CLOCK_OFFSET_TOLERANCE_MS
      && shiftedEnd <= traceEndMs + CLOCK_OFFSET_TOLERANCE_MS;
  });
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
    if (match.matchedSignal && !existing.signals.includes(match.matchedSignal)) {
      existing.signals.push(match.matchedSignal);
    }
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
    if (source === "extract" && isPlaceholderExtractText(text ?? "")) continue;
    const content = text ?? "";
    const lines = content.trim().split(/\r?\n/).filter(Boolean);
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

  const suspectedClockOffsetHours = detectClockOffsetHours(input);
  if (suspectedClockOffsetHours !== undefined) {
    riskFlags.push("suspected_clock_offset");
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
      overlap: computeTimeWindowOverlap(input),
      ...(suspectedClockOffsetHours !== undefined ? { suspectedClockOffsetHours } : {}),
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
  /** 提供时按来源接地（与在线 U3 一致），优先于 evidenceText。 */
  evidenceSources?: GroundingEvidenceSource[];
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
  const timeWindow = input.evidencePacket?.timeWindow;
  const misalignedWithoutOffset = timeWindow?.overlap === false && timeWindow.suspectedClockOffsetHours === undefined;
  if (misalignedWithoutOffset || timeWindow?.source === "fallback") {
    categories.add("time_window_mismatch");
  }
  if (input.evidencePacket && input.evidencePacket.logHits.length === 0) {
    categories.add("log_evidence_missing");
  }

  const grounding = computeGrounding(input.replyText, input.evidenceSources ?? input.evidenceText);
  for (const item of grounding.ungrounded) missing.add(item.rawText);
  if (grounding.ungrounded.length > 0) {
    categories.add("ungrounded_conclusion");
  }

  const hasLowConfidenceText = /低置信度|证据不足|无法判断/.test(input.replyText);
  if (input.evidencePacket && input.evidencePacket.missingEvidence.length > 0 && !hasLowConfidenceText) {
    categories.add("low_confidence_evidence");
  }

  return {
    errorCategories: Array.from(categories),
    riskFlags: Array.from(riskFlags),
    topMissingEvidence: Array.from(missing).slice(0, 8),
  };
}
