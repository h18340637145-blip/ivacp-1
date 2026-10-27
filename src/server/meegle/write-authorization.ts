import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeAssigneeUserKeys as normalizeUserKeys } from "@/domain/meegle/assignee";

export interface MeegleAnalysisWriteClaims {
  action: "comment" | "transition";
  projectKey: string;
  workItemTypeKey: "issue";
  workItemId: string;
  resultId: string;
  body?: string;
  chartImagePath?: string;
  artifactRef?: string;
  transitionId?: string;
  analysisReceipt: string;
}

export interface MeegleAssigneeWriteClaims {
  action: "assignee";
  projectKey: string;
  workItemTypeKey: "issue";
  workItemId: string;
  expectedCurrentUserKeys: string[];
  targetUserKey: string;
  detailReceipt: string;
}

export type MeegleWriteClaims = MeegleAnalysisWriteClaims | MeegleAssigneeWriteClaims;

interface AnalysisReceiptClaims {
  projectKey: string;
  workItemTypeKey: "issue";
  workItemId: string;
  artifactRef: string;
}

interface DetailReceiptClaims {
  projectKey: string;
  workItemTypeKey: "issue";
  workItemId: string;
  assigneeRoleKey: string;
  assigneeUserKeys: string[];
  updatedAt: string;
}

type SignedClaims = MeegleWriteClaims & { exp: number };

function secret(): string {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be configured for Meegle write authorization");
  return "jira-analyzer-local-session-secret";
}

function signature(payload: string): Buffer {
  return createHmac("sha256", secret()).update(payload).digest();
}

export function createMeegleAnalysisReceipt(claims: AnalysisReceiptClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${signature(`analysis:${payload}`).toString("base64url")}`;
}

function normalizeDetailReceiptClaims(claims: DetailReceiptClaims): DetailReceiptClaims {
  return { ...claims, assigneeUserKeys: normalizeUserKeys(claims.assigneeUserKeys) };
}

export function createMeegleDetailReceipt(claims: DetailReceiptClaims): string {
  const payload = Buffer.from(JSON.stringify(normalizeDetailReceiptClaims(claims))).toString("base64url");
  return `${payload}.${signature(`detail:${payload}`).toString("base64url")}`;
}

export function verifyMeegleDetailReceipt(receipt: string, expected: DetailReceiptClaims): void {
  const [payload, encodedSignature] = receipt.split(".");
  if (!payload || !encodedSignature) throw new Error("工单详情凭据无效");
  const actual = Buffer.from(encodedSignature, "base64url");
  const calculated = signature(`detail:${payload}`);
  if (actual.length !== calculated.length || !timingSafeEqual(actual, calculated)) throw new Error("工单详情凭据无效");
  let claims: DetailReceiptClaims;
  try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DetailReceiptClaims; }
  catch { throw new Error("工单详情凭据无效"); }
  if (JSON.stringify(normalizeDetailReceiptClaims(claims)) !== JSON.stringify(normalizeDetailReceiptClaims(expected))) {
    throw new Error("工单详情凭据与工作项不匹配");
  }
}

export function verifyMeegleAnalysisReceipt(receipt: string, expected: Omit<AnalysisReceiptClaims, "artifactRef"> & { artifactRef?: string }): void {
  const [payload, encodedSignature] = receipt.split(".");
  if (!payload || !encodedSignature) throw new Error("分析结果凭据无效");
  const actual = Buffer.from(encodedSignature, "base64url");
  const calculated = signature(`analysis:${payload}`);
  if (actual.length !== calculated.length || !timingSafeEqual(actual, calculated)) throw new Error("分析结果凭据无效");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AnalysisReceiptClaims;
  if (claims.projectKey !== expected.projectKey || claims.workItemTypeKey !== expected.workItemTypeKey ||
      claims.workItemId !== expected.workItemId || (expected.artifactRef && claims.artifactRef !== expected.artifactRef)) {
    throw new Error("分析结果凭据与工作项不匹配");
  }
}

export function createMeegleWriteAuthorization(claims: MeegleWriteClaims): string {
  const payload = Buffer.from(JSON.stringify({ ...claims, exp: Date.now() + 2 * 60_000 } satisfies SignedClaims)).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function verifyMeegleWriteAuthorization(token: string | undefined, expected: MeegleWriteClaims): void {
  const [payload, encodedSignature] = token?.split(".") ?? [];
  if (!payload || !encodedSignature) throw new Error("缺少飞书写操作授权");
  const actual = Buffer.from(encodedSignature, "base64url");
  const calculated = signature(payload);
  if (actual.length !== calculated.length || !timingSafeEqual(actual, calculated)) throw new Error("飞书写操作授权无效");
  let claims: SignedClaims;
  try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SignedClaims; }
  catch { throw new Error("飞书写操作授权无效"); }
  const { exp, ...unsigned } = claims;
  if (exp < Date.now()) throw new Error("飞书写操作授权已过期");
  if (JSON.stringify(unsigned) !== JSON.stringify(expected)) throw new Error("飞书写操作授权与提交内容不匹配");
}

/**
 * 以固定字段顺序构造写操作声明。授权签发（/api/meegle/authorize）与写入校验
 * （comment / workflow / assignee）都必须经由这些函数，避免因字段顺序或多余字段导致签名比对失败。
 */
export function commentWriteClaims(input: {
  projectKey: string;
  workItemId: string;
  resultId: string;
  body: string;
  chartImagePath?: string;
  artifactRef?: string;
  analysisReceipt: string;
}): MeegleAnalysisWriteClaims {
  return {
    action: "comment",
    projectKey: input.projectKey,
    workItemTypeKey: "issue",
    workItemId: input.workItemId,
    resultId: input.resultId,
    body: input.body,
    chartImagePath: input.chartImagePath,
    artifactRef: input.artifactRef,
    analysisReceipt: input.analysisReceipt,
  };
}

export function transitionWriteClaims(input: {
  projectKey: string;
  workItemId: string;
  resultId: string;
  transitionId: string;
  analysisReceipt: string;
}): MeegleAnalysisWriteClaims {
  return {
    action: "transition",
    projectKey: input.projectKey,
    workItemTypeKey: "issue",
    workItemId: input.workItemId,
    resultId: input.resultId,
    transitionId: input.transitionId,
    analysisReceipt: input.analysisReceipt,
  };
}

export function assigneeWriteClaims(input: {
  projectKey: string;
  workItemId: string;
  expectedCurrentUserKeys: string[];
  targetUserKey: string;
  detailReceipt: string;
}): MeegleAssigneeWriteClaims {
  return {
    action: "assignee",
    projectKey: input.projectKey,
    workItemTypeKey: "issue",
    workItemId: input.workItemId,
    expectedCurrentUserKeys: normalizeUserKeys(input.expectedCurrentUserKeys),
    targetUserKey: input.targetUserKey,
    detailReceipt: input.detailReceipt,
  };
}
