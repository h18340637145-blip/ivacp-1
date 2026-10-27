"use client";

import { useState } from "react";
import type { ProcessResult, RuleGroup, TicketSnapshot } from "@/domain/entities";
import type { MeegleTransitionOption } from "@/domain/meegle/contracts";
import { defaultCommentBody } from "@/domain/issue-source/jira-workflow";
import { useAction } from "@/shared/hooks/use-action";
import { apiFetch } from "@/shared/lib/api";
import { Button, Callout, Checkbox, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Select, Textarea } from "@/shared/ui";
import { backfillResult } from "../services/backfill";

export function BackfillDialog({ result, snapshot, group, onClose }: { result: ProcessResult; snapshot: TicketSnapshot; group?: RuleGroup; onClose: () => void }) {
  const [body, setBody] = useState(() => defaultCommentBody(result));
  const [withChart, setWithChart] = useState(Boolean(result.chartImage));
  const [transitions, setTransitions] = useState<MeegleTransitionOption[]>([]);
  const [transitionId, setTransitionId] = useState("none");
  const [retryInterrupted, setRetryInterrupted] = useState(false);
  const loadTransitions = useAction(async () => {
    const query = new URLSearchParams({ projectKey: snapshot.projectKey ?? "", workItemTypeKey: snapshot.workItemTypeKey ?? "issue", workItemId: result.ticketKey });
    const data = await apiFetch<{ transitions: MeegleTransitionOption[] }>(`/api/meegle/workflow?${query}`);
    setTransitions(data.transitions ?? []);
  });
  const save = useAction(async () => {
    await backfillResult({ resultId: result.id, snapshot, group, body, chartImagePath: withChart ? result.chartImage : undefined, transition: transitions.find((row) => String(row.id) === transitionId), retryInterrupted });
    onClose();
  }, { success: "回填操作已完成" });
  return <Dialog open onOpenChange={(open) => { if (!open && !save.pending) onClose(); }}><DialogContent size="lg" hideClose={save.pending}>
    <DialogHeader><DialogTitle>确认回填到{result.source === "jira" ? " Jira" : "飞书项目"}</DialogTitle><DialogDescription>核对正文和附图后提交。已成功回填的结果不会重复发表评论。</DialogDescription></DialogHeader>
    <DialogBody className="space-y-4">{result.commentStatus === "succeeded" ? <Callout tone="success">评论已成功。可单独重试尚未完成的状态流转。</Callout> : null}
      {result.commentStatus === "commenting" || result.commentStatus === "uploading" ? <Callout tone="warning" title="回填正在进行或之前已中断"><p>请先核对原票，避免重复评论。正在进行的回填会保留 10 分钟保护时间。</p><label className="mt-2 flex min-h-11 items-center gap-2"><Checkbox checked={retryInterrupted} onCheckedChange={(value) => setRetryInterrupted(value === true)} disabled={save.pending} />我已确认原任务停止，且原票没有相同评论</label></Callout> : null}
      <Field label="回填正文" htmlFor="backfill-body" required><Textarea id="backfill-body" rows={10} value={body} disabled={save.pending || result.commentStatus === "succeeded"} onChange={(e) => setBody(e.target.value)} /></Field>
      {result.chartImage ? <label className="flex min-h-11 items-center gap-2 text-sm"><Checkbox checked={withChart} onCheckedChange={(value) => setWithChart(value === true)} disabled={save.pending || result.commentStatus === "succeeded"} />附上当前 CAN 时序图</label> : null}
      {result.source === "meegle" ? <div className="space-y-3"><Button variant="outline" loading={loadTransitions.pending} onClick={() => void loadTransitions()}>加载可用状态流转</Button><Field label="评论成功后的状态流转（可选）" htmlFor="backfill-transition"><Select id="backfill-transition" value={transitionId} onValueChange={setTransitionId} disabled={save.pending} options={[{ value: "none", label: "仅回填评论" }, ...transitions.map((row) => ({ value: String(row.id), label: row.state_name || row.state_key }))]} /></Field></div> : null}
    </DialogBody><DialogFooter><Button variant="ghost" onClick={onClose} disabled={save.pending}>取消</Button><Button variant="primary" loading={save.pending} disabled={!body.trim()} onClick={() => void save()}>确认回填</Button></DialogFooter>
  </DialogContent></Dialog>;
}
