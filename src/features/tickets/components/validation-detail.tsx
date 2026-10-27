"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { TicketSource, Verdict } from "@/domain/entities";
import { useSession } from "@/features/auth/session-store";
import { db } from "@/shared/db/database";
import { useLiveData } from "@/shared/hooks/use-live-data";
import { useAction } from "@/shared/hooks/use-action";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Field, Page, PageHeader, Select, Spinner, StatusBadge, Textarea } from "@/shared/ui";
import { loadValidationRunWithChecks, overrideValidationVerdict, VERDICT_LABEL } from "../services/validation";

export function ValidationDetail({ runId, source, ticketKey }: { runId: string; source: TicketSource; ticketKey: string }) {
  const state = useLiveData(useCallback(async () => {
    const value = await loadValidationRunWithChecks(runId);
    if (!value) return null;
    const result = await db.processResults.get(value.run.resultId);
    return result?.source === source && result.ticketKey === ticketKey ? { ...value, result } : null;
  }, [runId, source, ticketKey]));
  const { can, username } = useSession();
  const [verdict, setVerdict] = useState<Verdict>("unknown");
  const [reason, setReason] = useState("");
  const save = useAction(async (reset = false) => {
    if (!reset && !reason.trim()) throw new Error("请填写人工改判原因");
    await overrideValidationVerdict({ runId, verdict: reset ? undefined : verdict, reason, by: username });
  }, { success: "人工判定已保存" });
  if (state.error) return <Page><ErrorState error={state.error} onRetry={state.reload} /></Page>;
  if (state.loading) return <Page><Spinner /></Page>;
  if (!state.data) return <Page><EmptyState title="校验记录不存在或不属于此工单" /></Page>;
  const { run, checks, result } = state.data;
  const href = `/tickets/${source}/${encodeURIComponent(ticketKey)}?group=${encodeURIComponent(result.ruleGroupId)}`;
  return <Page className="space-y-5"><PageHeader title={`${ticketKey} · 一致性校验`} breadcrumbs={[{ label: "规则组看板", href: "/" }, { label: ticketKey, href }, { label: "校验详情" }]} actions={<Button variant="outline" asChild><Link href={href}>返回分析结果</Link></Button>} />
    <div className="flex flex-wrap items-center gap-3 text-sm"><span>当前判定</span><StatusBadge status={run.validationStatus} /><span className="text-muted-foreground">系统判定：{VERDICT_LABEL[run.systemVerdict]}</span></div>
    {checks.length ? <div className="space-y-3">{checks.map((check) => <Card key={check.id}><CardHeader><CardTitle>{check.type}</CardTitle><StatusBadge status={check.status} /></CardHeader><CardContent className="space-y-2 text-sm"><p>{check.message}</p>{check.expected ? <p className="break-words text-xs text-muted-foreground">预期：{check.expected}</p> : null}{check.actual ? <p className="break-words text-xs text-muted-foreground">实际：{check.actual}</p> : null}</CardContent></Card>)}</div> : <EmptyState title="当前没有可核验的证据子项" />}
    {run.manualVerdict ? <p className="whitespace-pre-wrap text-sm">人工改判：{VERDICT_LABEL[run.manualVerdict]} · {run.manualVerdictBy} · {run.manualVerdictReason}</p> : null}
    {can("reviewer") ? <Card><CardHeader><CardTitle>人工改判</CardTitle></CardHeader><CardContent className="space-y-4"><Field label="人工判定" htmlFor="validation-verdict"><Select id="validation-verdict" value={verdict} onValueChange={(value) => setVerdict(value as Verdict)} options={(Object.keys(VERDICT_LABEL) as Verdict[]).map((value) => ({ value, label: VERDICT_LABEL[value] }))} /></Field><Field label="改判原因" htmlFor="validation-reason" required><Textarea id="validation-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field><div className="flex gap-2"><Button variant="primary" loading={save.pending} onClick={() => void save(false)}>保存改判</Button>{run.manualVerdict ? <Button variant="outline" disabled={save.pending} onClick={() => void save(true)}>撤销改判</Button> : null}</div></CardContent></Card> : null}
  </Page>;
}
