"use client";

import { buildValidationCoreResult } from "@/domain/analysis/validation-core";
import type { ProcessResult, ValidationCheck, ValidationRun, Verdict } from "@/domain/entities";
import { db } from "@/shared/db/database";
import { newId } from "@/shared/lib/ids";

/** 一致性校验（证据校验）服务：Jira / 飞书通用，结果按 resultId 关联 */

export const VERDICT_LABEL: Record<Verdict, string> = {
  pass: "一致",
  fail: "冲突",
  warning: "存疑",
  unknown: "未知",
};

export async function loadValidationRuns(resultId: string): Promise<ValidationRun[]> {
  const runs = await db.validationRuns.where("resultId").equals(resultId).toArray();
  return runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function loadValidationRunWithChecks(runId: string): Promise<{ run: ValidationRun; checks: ValidationCheck[] } | null> {
  const run = await db.validationRuns.get(runId);
  if (!run) return null;
  const checks = await db.validationChecks.where("runId").equals(runId).toArray();
  checks.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return { run, checks };
}

export async function loadChecksForRun(runId: string): Promise<ValidationCheck[]> {
  return (await loadValidationRunWithChecks(runId))?.checks ?? [];
}

export async function runValidation(result: Pick<ProcessResult, "id" | "source" | "replyText" | "signalSummary">): Promise<ValidationRun> {
  const core = buildValidationCoreResult({ replyText: result.replyText, signalSummary: result.signalSummary });
  const createdAt = new Date();
  const run: ValidationRun = {
    id: newId(),
    source: result.source,
    resultId: result.id,
    validationStatus: core.systemVerdict,
    systemVerdict: core.systemVerdict,
    diffSeconds: 0,
    detail: { ...core.detail, checks: core.checks },
    createdAt,
  };
  const checks: ValidationCheck[] = core.checks.map((check) => ({
    ...check,
    id: newId(),
    source: result.source,
    runId: run.id,
    createdAt,
  }));
  await db.transaction("rw", [db.validationRuns, db.validationChecks], async () => {
    await db.validationRuns.add(run);
    if (checks.length > 0) await db.validationChecks.bulkAdd(checks);
  });
  return run;
}

/** 人工改判；verdict 为 undefined 表示撤销改判，恢复系统结论 */
export async function overrideValidationVerdict(input: {
  runId: string;
  verdict: Verdict | undefined;
  reason?: string;
  by: string;
}): Promise<ValidationRun> {
  const run = await db.validationRuns.get(input.runId);
  if (!run) throw new Error("未找到校验记录");
  const next: ValidationRun = {
    ...run,
    manualVerdict: input.verdict,
    validationStatus: input.verdict ?? run.systemVerdict,
    manualVerdictAt: new Date(),
    manualVerdictBy: input.by,
    manualVerdictReason: input.reason?.trim() || undefined,
  };
  await db.validationRuns.put(next);
  return next;
}
