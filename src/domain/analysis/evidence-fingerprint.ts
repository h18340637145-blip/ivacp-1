import type { RuleGroup } from "@/domain/entities";

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

function flattenStringValue(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenStringValue);
  return [];
}

function collectStringField(records: unknown[], field: string): string[] {
  return unique(records.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    return flattenStringValue((record as Record<string, unknown>)[field]);
  }));
}

function extractKeywords(text?: string): string[] {
  if (!text) return [];
  return unique(Array.from(text.matchAll(/[\p{Script=Han}A-Za-z0-9_]{2,}/gu)).map((match) => match[0])).slice(0, 20);
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
      ...collectStringField(signalRecords, "sourceTokens"),
      ...collectStringField(signalIdRecords, "matchedSignal"),
      ...collectStringField(signalIdRecords, "matchedSignals"),
      ...collectStringField(signalIdRecords, "sourceToken"),
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
  snapshot: { issueKey: string; summary: string };
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
    faultKeywords: extractKeywords(params.snapshot.summary),
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
