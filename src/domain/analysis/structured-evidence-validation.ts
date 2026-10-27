import type { ValidationCheck, ValidationRun } from "@/domain/entities";

export interface EvidenceAssertion {
  type: "signal_value" | "time_window" | "reproduction" | "evidence_availability";
  subject: string;
  expected?: string;
  rawText: string;
  confidence: number;
}

export interface StructuredEvidenceInput {
  replyText: string;
  evidencePacketText?: string;
  signalSummary?: string;
  canTraceText?: string;
  extractText?: string;
  step4Text?: string;
  metricsText?: string;
}

export interface StructuredEvidenceResult {
  systemVerdict: ValidationRun["systemVerdict"];
  checks: Array<Omit<ValidationCheck, "id" | "runId" | "createdAt" | "source">>;
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

  const timeMatches = replyText.match(/\b\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\b/g) ?? [];
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

function validateAssertion(
  assertion: EvidenceAssertion,
  evidenceText: string,
): Omit<ValidationCheck, "id" | "runId" | "createdAt" | "source"> {
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

function summarizeVerdict(
  checks: Array<Omit<ValidationCheck, "id" | "runId" | "createdAt" | "source">>,
): ValidationRun["systemVerdict"] {
  if (checks.length === 0) return "unknown";
  if (checks.some((check) => check.status === "fail" && (check.confidence ?? 0) >= 0.7)) return "fail";
  if (checks.some((check) => check.status === "fail" || check.status === "warning")) return "warning";
  return "pass";
}

export function validateStructuredEvidence(input: StructuredEvidenceInput): StructuredEvidenceResult {
  const evidenceText = [
    input.evidencePacketText,
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

export interface GroundingItem {
  type: EvidenceAssertion["type"];
  subject: string;
  expected?: string;
  rawText: string;
  grounded: boolean;
  normalizedSubject: string;
  normalizedExpected?: string;
  evidenceSource?: string;
  evidenceExcerpt?: string;
  checkedEvidenceSources: string[];
  missReason?: GroundingMissReason;
}

export interface GroundingEvidenceSource {
  name: string;
  text: string;
}

export type GroundingMissReason =
  | "missing_evidence"
  | "subject_not_found"
  | "expected_not_found"
  | "subject_value_pair_not_found";

export interface GroundingResult {
  ratio: number;            // grounded / 可判定断言数；无可判定断言时为 1
  total: number;            // 可判定断言数（不含 evidence_availability 占位）
  grounded: GroundingItem[];
  ungrounded: GroundingItem[];
}

interface GroundingEvidenceIndex {
  rawText: string;
  normalizedText: string;
  lineSegments: string[];
  times: string[];
  numericValues: string[];
  props: string[];
  signals: string[];
  identifiers: string[];
  propertyIds: string[];
  propertyIdRecords: Array<{ values: string[]; excerpt: string }>;
  isStructuredJson: boolean;
}

function normalizeTimeToken(value: string): string | undefined {
  const match = (value ?? "").trim().match(
    /^(?:\d{4}[-/]\d{2}[-/]\d{2}[ Tt])?(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/,
  );
  if (!match) return undefined;
  const normalizedFraction = match[4]
    ? match[4].padEnd(6, "0").replace(/0+$/, "")
    : "";
  return `t${match[1]}${match[2]}${match[3]}${normalizedFraction ? `f${normalizedFraction}` : ""}`;
}

/** 秒级断言（无小数）可匹配同一秒内的毫秒级证据时间；带小数的断言仍须精确匹配。 */
function timeTokenMatches(evidenceToken: string, claimToken: string): boolean {
  if (evidenceToken === claimToken) return true;
  return !claimToken.includes("f") && evidenceToken.startsWith(`${claimToken}f`);
}

function normalizeGroundingText(value: string): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\b0x[0-9a-f]+\b/gi, (hexValue) => String(parseInt(hexValue, 16)))
    .replace(
      /\b(?:\d{4}[-/]\d{2}[-/]\d{2}[ t])?(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?\b/gi,
      (timestamp) => normalizeTimeToken(timestamp) ?? timestamp,
    )
    .replace(/[\s_\-:：.。/\\[\](){},;"'`=]+/g, "");
}

function uniqueMatches(source: string, pattern: RegExp): string[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  const values = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const value = match[1] ?? match[0];
    if (value) values.add(value);
  }
  return [...values];
}

function normalizeTokenList(values: string[]): string[] {
  return [...new Set(values.map(normalizeGroundingText).filter(Boolean))];
}

function normalizeTimeTokenList(values: string[]): string[] {
  return [...new Set(values.map(normalizeTimeToken).filter((value): value is string => Boolean(value)))];
}

function isNumericToken(value: string): boolean {
  return /^(?:0x[0-9a-f]+|-?\d+(?:\.\d+)?)$/i.test((value ?? "").trim());
}

function canonicalizeNumericToken(value: string): string | undefined {
  const trimmed = (value ?? "").trim();
  if (/^0x[0-9a-f]+$/i.test(trimmed)) return String(parseInt(trimmed, 16));
  const match = trimmed.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return undefined;
  const integer = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const isZero = integer === "0" && !fraction;
  return `${match[1] && !isZero ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function normalizeGroundingAssertionValue(value: string): string {
  return normalizeTimeToken(value)
    ?? (isNumericToken(value) ? canonicalizeNumericToken(value) : undefined)
    ?? normalizeGroundingText(value);
}

function isIdentifierLike(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]+$/.test((value ?? "").trim());
}

function expandNumericValues(values: string[]): string[] {
  const expanded = new Set<string>();
  for (const value of values) {
    const normalized = canonicalizeNumericToken(value);
    if (normalized) expanded.add(normalized);
  }
  return [...expanded];
}

function buildGroundingLineSegments(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildStructuredPropertyIdRecords(rawText: string): {
  records: Array<{ values: string[]; excerpt: string }>;
  isStructuredJson: boolean;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { records: [], isStructuredJson: false };
  }

  const records: Array<{ values: string[]; excerpt: string }> = [];
  const addValue = (values: string[], value: unknown) => {
    if (typeof value !== "string" && typeof value !== "number") return;
    const normalized = canonicalizeNumericToken(String(value));
    if (normalized) values.push(normalized);
  };
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    const values: string[] = [];
    addValue(values, record.decimalId);
    addValue(values, record.hexId);
    addValue(values, record.Property_ID);
    if (record.propertyId && typeof record.propertyId === "object" && !Array.isArray(record.propertyId)) {
      const propertyId = record.propertyId as Record<string, unknown>;
      addValue(values, propertyId.decimal);
      addValue(values, propertyId.hex);
    } else {
      addValue(values, record.propertyId);
    }
    const uniqueValues = [...new Set(values)];
    if (uniqueValues.length > 0) {
      records.push({ values: uniqueValues, excerpt: JSON.stringify(record) });
    }

    for (const [key, child] of Object.entries(record)) {
      if (key === "propertyId") continue;
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(parsed);
  return { records, isStructuredJson: true };
}

function isShortGroundingToken(value: string): boolean {
  const normalized = normalizeGroundingText(value);
  return normalized.length <= 2;
}

function exactSegmentValueMatch(segment: string, value: string): boolean {
  if (isNumericToken(value)) {
    const normalizedValue = canonicalizeNumericToken(value);
    const values = expandNumericValues(uniqueMatches(
      segment,
      /(?:^|(?<=[^A-Za-z0-9_]))(0x[0-9a-f]+|-?\d+(?:\.\d+)?)\b/gi,
    ));
    return normalizedValue ? values.includes(normalizedValue) : false;
  }
  if (isIdentifierLike(value)) {
    const normalizedValue = normalizeGroundingText(value);
    return normalizeTokenList(uniqueMatches(segment, /\b[A-Za-z][A-Za-z0-9_]+\b/g)).includes(normalizedValue);
  }
  return false;
}

interface GroundingPair {
  key: string;
  rawKey: string;
  value: string;
}

function extractGroundingPairs(line: string): GroundingPair[] {
  const pairRegex = /(?<![A-Za-z0-9_])(?:"([^"]+)"|'([^']+)'|([A-Za-z][A-Za-z0-9_]+))\s*(?:=|:|变为|为|是|value\s*|(?<=\s)val\s*[:=]?)\s*(?:"([^"]*)"|'([^']*)'|(0x[0-9a-f]+|-?\d+(?:\.\d+)?|null|[A-Za-z][A-Za-z0-9_]*))/gi;
  const pairs: GroundingPair[] = [];
  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(line)) !== null) {
    const key = match[1] ?? match[2] ?? match[3];
    const value = match[4] ?? match[5] ?? match[6];
    if (!key || value === undefined) continue;
    pairs.push({
      key: normalizeGroundingText(key),
      rawKey: key,
      value: normalizeGroundingAssertionValue(value),
    });
  }
  return pairs;
}

function buildGroundingEvidenceIndex(evidenceText: string): GroundingEvidenceIndex {
  const rawText = evidenceText ?? "";
  const structuredPropertyIds = buildStructuredPropertyIdRecords(rawText);
  const propValues = [
    ...uniqueMatches(rawText, /"prop"\s*:\s*"([^"]+)"/gi),
    ...uniqueMatches(rawText, /\bprop(?:erty)?\s*[:=]\s*([A-Za-z][A-Za-z0-9_]{2,})/gi),
  ];
  const signalValues = [
    ...uniqueMatches(rawText, /"(?:signal|signals|getSignals|setSignals|name)"\s*:\s*"([^"]+)"/gi),
    ...uniqueMatches(rawText, /\b[A-Za-z][A-Za-z0-9_]{2,}\s*(?==|为|是|:)/g),
  ];
  const propertyIdValues = [
    ...uniqueMatches(rawText, /\b(?:property[_\s-]*id|prop[_\s-]*id|Property_ID|id)\b[^0-9a-fx]{0,20}(0x[0-9a-f]+|\d+)/gi),
    ...uniqueMatches(rawText, /\b0x[0-9a-f]+\b/gi),
  ];
  const numericValues = uniqueMatches(
    rawText,
    /(?:^|(?<=[^A-Za-z0-9_]))(0x[0-9a-f]+|-?\d+(?:\.\d+)?)\b/gi,
  );
  const identifiers = uniqueMatches(rawText, /\b[A-Za-z][A-Za-z0-9_]+\b/g);
  const times = [
    ...uniqueMatches(rawText, /\b\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\b/g),
    ...uniqueMatches(rawText, /\b\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\b/g),
    ...uniqueMatches(rawText, /\b\d{2}:\d{2}\b/g),
  ];

  return {
    rawText,
    normalizedText: normalizeGroundingText(rawText),
    lineSegments: buildGroundingLineSegments(rawText),
    times: normalizeTimeTokenList(times),
    numericValues: expandNumericValues(numericValues),
    props: normalizeTokenList(propValues),
    signals: normalizeTokenList(signalValues),
    identifiers: normalizeTokenList(identifiers),
    propertyIds: expandNumericValues(propertyIdValues),
    propertyIdRecords: structuredPropertyIds.records,
    isStructuredJson: structuredPropertyIds.isStructuredJson,
  };
}

function evidenceIndexIncludes(index: GroundingEvidenceIndex, value?: string): boolean {
  if (!value) return false;
  const normalizedTime = normalizeTimeToken(value);
  if (normalizedTime) return index.times.some((time) => timeTokenMatches(time, normalizedTime));
  if (isNumericToken(value)) {
    const normalizedNumber = canonicalizeNumericToken(value);
    if (!normalizedNumber) return false;
    return index.numericValues.includes(normalizedNumber) || index.propertyIds.includes(normalizedNumber);
  }
  const normalizedValue = normalizeGroundingText(value);
  if (!normalizedValue) return false;
  if (isIdentifierLike(value)) {
    return index.identifiers.includes(normalizedValue)
      || index.props.includes(normalizedValue)
      || index.signals.includes(normalizedValue);
  }
  const shortToken = isShortGroundingToken(value);

  if (shortToken) {
    return index.numericValues.includes(normalizedValue) || index.propertyIds.includes(normalizedValue);
  }

  const rawValue = value.toLowerCase();
  if (index.rawText.toLowerCase().includes(rawValue)) return true;
  if (index.normalizedText.includes(normalizedValue)) return true;

  const buckets = [
    index.times,
    index.numericValues,
    index.props,
    index.signals,
    index.propertyIds,
  ];
  return buckets.some((bucket) => bucket.includes(normalizedValue));
}

/** 结论中常省略信号前缀（如 PowerMode 指 FLZCU_9_PowerMode），仅对足够长的标识符启用后缀别名。 */
function isSignalAliasCandidate(subject: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]{5,}$/.test((subject ?? "").trim());
}

function findGroundingPairSegment(
  index: GroundingEvidenceIndex,
  subject: string,
  expected?: string,
): string | undefined {
  const normalizedSubject = normalizeGroundingText(subject);
  const normalizedExpected = expected ? normalizeGroundingAssertionValue(expected) : undefined;
  if (!normalizedSubject) return undefined;

  const subjectSuffix = isSignalAliasCandidate(subject) ? `_${subject.trim().toLowerCase()}` : undefined;
  const keyMatches = (pair: GroundingPair) => pair.key === normalizedSubject
    || (subjectSuffix !== undefined && pair.rawKey.toLowerCase().endsWith(subjectSuffix));
  return index.lineSegments.find((segment) => extractGroundingPairs(segment).some((pair) => (
    keyMatches(pair) && (normalizedExpected === undefined || pair.value === normalizedExpected)
  )));
}

function normalizedTimesInSegment(segment: string): string[] {
  return normalizeTimeTokenList([
    ...uniqueMatches(segment, /\b\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\b/g),
    ...uniqueMatches(segment, /\b\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\b/g),
  ]);
}

function segmentIncludesGroundingValue(segment: string, value: string): boolean {
  const normalizedTime = normalizeTimeToken(value);
  if (normalizedTime) {
    return normalizedTimesInSegment(segment).some((time) => timeTokenMatches(time, normalizedTime));
  }
  if (isNumericToken(value) || isIdentifierLike(value)) {
    return exactSegmentValueMatch(segment, value);
  }
  const normalizedValue = normalizeGroundingText(value);
  return Boolean(normalizedValue) && normalizeGroundingText(segment).includes(normalizedValue);
}

function findGroundingMatchedSegment(
  index: GroundingEvidenceIndex,
  assertion: EvidenceAssertion,
): string | undefined {
  if (assertion.type === "signal_value") {
    if (normalizeGroundingText(assertion.subject) === "propertyid" && assertion.expected) {
      const expectedPropertyId = canonicalizeNumericToken(assertion.expected);
      const record = expectedPropertyId
        ? index.propertyIdRecords.find((candidate) => candidate.values.includes(expectedPropertyId))
        : undefined;
      if (record) return record.excerpt;
      if (index.isStructuredJson) return undefined;
    }
    return findGroundingPairSegment(index, assertion.subject, assertion.expected);
  }
  const expected = assertion.expected;
  if (!evidenceIndexIncludes(index, assertion.subject)
    || (expected && !evidenceIndexIncludes(index, expected))) {
    return undefined;
  }
  return index.lineSegments.find((segment) => (
    segmentIncludesGroundingValue(segment, assertion.subject)
      && (!expected || segmentIncludesGroundingValue(segment, expected))
  ))
    ?? index.lineSegments.find((segment) => segmentIncludesGroundingValue(segment, assertion.subject))
    ?? (expected
      ? index.lineSegments.find((segment) => segmentIncludesGroundingValue(segment, expected))
      : undefined);
}

function normalizeGroundingEvidenceSources(
  evidenceInput: string | GroundingEvidenceSource[],
): GroundingEvidenceSource[] {
  const sources = typeof evidenceInput === "string"
    ? [{ name: "combined_evidence", text: evidenceInput }]
    : Array.isArray(evidenceInput)
      ? evidenceInput
      : [];

  return sources
    .filter((source): source is GroundingEvidenceSource => Boolean(source && typeof source.text === "string"))
    .map((source) => ({ ...source, text: source.text.trim() }))
    .filter((source) => Boolean(source.text));
}

export function computeGrounding(
  replyText: string,
  evidenceInput: string | GroundingEvidenceSource[],
): GroundingResult {
  const evidenceSources = normalizeGroundingEvidenceSources(evidenceInput);
  const indexedSources = evidenceSources.map((source) => ({
    source,
    index: buildGroundingEvidenceIndex(source.text),
  }));
  const checkedEvidenceSources = evidenceSources.map((source) => source.name);
  const assertions = extractEvidenceAssertions(replyText ?? "");
  const grounded: GroundingItem[] = [];
  const ungrounded: GroundingItem[] = [];

  for (const assertion of assertions) {
    // evidence_availability / reproduction 为软性占位，不计入硬接地判定
    if (assertion.type === "evidence_availability" || assertion.type === "reproduction") {
      continue;
    }
    const isSignalValue = assertion.type === "signal_value";
    const subjectSources = indexedSources.filter(({ index }) => evidenceIndexIncludes(index, assertion.subject));
    const matchedEvidence = indexedSources
      .map(({ source, index }) => ({
        source,
        matchedSegment: findGroundingMatchedSegment(index, assertion),
      }))
      .find(({ matchedSegment }) => Boolean(matchedSegment));
    const isGrounded = Boolean(matchedEvidence);
    const item: GroundingItem = {
      type: assertion.type,
      subject: assertion.subject,
      expected: assertion.expected,
      rawText: assertion.rawText,
      grounded: isGrounded,
      normalizedSubject: normalizeGroundingAssertionValue(assertion.subject),
      normalizedExpected: assertion.expected
        ? normalizeGroundingAssertionValue(assertion.expected)
        : undefined,
      checkedEvidenceSources: [...checkedEvidenceSources],
    };
    if (matchedEvidence?.matchedSegment) {
      item.evidenceSource = matchedEvidence.source.name;
      item.evidenceExcerpt = matchedEvidence.matchedSegment.slice(0, 240);
    } else if (indexedSources.length === 0) {
      item.missReason = "missing_evidence";
    } else if (subjectSources.length === 0) {
      item.missReason = "subject_not_found";
    } else if (isSignalValue) {
      item.missReason = "subject_value_pair_not_found";
    } else {
      item.missReason = "expected_not_found";
    }
    (isGrounded ? grounded : ungrounded).push(item);
  }

  const total = grounded.length + ungrounded.length;
  const ratio = total === 0 ? 1 : grounded.length / total;
  return { ratio, total, grounded, ungrounded };
}
