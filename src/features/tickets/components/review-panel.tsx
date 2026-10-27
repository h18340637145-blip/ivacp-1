"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ClipboardCheck, ShieldCheck, X } from "lucide-react";
import type { ProcessResult, TicketSnapshot, ValidationRun } from "@/domain/entities";
import { REJECT_REASON_CODES, REJECT_REASONS, type RejectReasonCode } from "@/domain/analysis/reject-reasons";
import { useSession } from "@/features/auth/session-store";
import { useAction } from "@/shared/hooks/use-action";
import { Button, Callout, Card, CardContent, CardHeader, CardTitle, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Select, StatusBadge, Textarea } from "@/shared/ui";
import { aiReviewResult, approveResult, rejectResult } from "../services/review";
import { runValidation } from "../services/validation";
import { ticketHref } from "../use-process-action";

export function ReviewPanel({ result, snapshot, groupName, validations }: { result: ProcessResult; snapshot: TicketSnapshot; groupName?: string; validations: ValidationRun[] }) {
  const { can } = useSession();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [category, setCategory] = useState<RejectReasonCode>();
  const [detail, setDetail] = useState("");
  const [correct, setCorrect] = useState("");
  const target = { result, issueSummary: snapshot.title, ruleGroupName: groupName, rawData: snapshot.rawData };
  const approve = useAction(async () => { await approveResult(target); }, { success: "人工复核已通过" });
  const ai = useAction(async () => { await aiReviewResult(target); }, { success: "AI 复核已完成" });
  const reject = useAction(async () => { await rejectResult(target, { category, detail, correctResult: correct }); setRejectOpen(false); }, { success: "已保存驳回原因与正确结论" });
  const validate = useAction(async () => { await runValidation(result); }, { success: "一致性校验已完成" });
  const busy = approve.pending || ai.pending || reject.pending || validate.pending;
  const validation = validations[0];
  const base = ticketHref(snapshot).split("?");
  return <>
    <Card><CardHeader><CardTitle>复核与校验</CardTitle><StatusBadge status={result.reviewStatus} /></CardHeader>
      <CardContent className="space-y-4">
        {result.aiReviewVerdict ? <Callout tone={result.aiReviewVerdict === "fail" ? "warning" : "info"} title={`AI 建议：${result.aiReviewVerdict === "pass" ? "通过" : result.aiReviewVerdict === "fail" ? "驳回" : "未知"}`}>{result.aiReviewReason}</Callout> : null}
        {result.source === "meegle" ? <p className="text-xs text-muted-foreground">AI 复核只提供建议。人工通过或填写正确结论后才能回填。</p> : null}
        {result.manualCorrectResult ? <div className="space-y-1 text-xs"><p className="font-medium">人工正确结论</p><p className="whitespace-pre-wrap">{result.manualCorrectResult}</p><p className="text-muted-foreground">{result.errorReason}</p></div> : null}
        {can("reviewer") ? <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => void ai()}><ShieldCheck aria-hidden />AI 复核</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => void approve()}><Check aria-hidden />人工通过</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => setRejectOpen(true)}><X aria-hidden />人工驳回</Button></div> : null}
        <div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" loading={validate.pending} onClick={() => void validate()}><ClipboardCheck aria-hidden />一致性校验</Button>{validation ? <Link className="text-xs text-primary hover:underline" href={`${base[0]}/validation/${encodeURIComponent(validation.id)}?${base[1]}`}>查看校验 · {validation.validationStatus}</Link> : null}</div>
      </CardContent>
    </Card>
    <Dialog open={rejectOpen} onOpenChange={(open) => { if (!reject.pending) setRejectOpen(open); }}><DialogContent><DialogHeader><DialogTitle>人工驳回</DialogTitle><DialogDescription>选择错误类型并填写正确结论，保存后会生成同场景纠错样本。</DialogDescription></DialogHeader><DialogBody className="space-y-4"><Field label="错误类型" htmlFor="reject-category" required><Select id="reject-category" value={category} onValueChange={(value) => setCategory(value as RejectReasonCode)} options={REJECT_REASON_CODES.map((code) => ({ value: code, label: REJECT_REASONS[code].label }))} /></Field><Field label="补充说明" htmlFor="reject-detail" required={category === "other"}><Textarea id="reject-detail" value={detail} onChange={(e) => setDetail(e.target.value)} /></Field><Field label="正确结论" htmlFor="reject-correct" required><Textarea id="reject-correct" rows={5} value={correct} onChange={(e) => setCorrect(e.target.value)} /></Field></DialogBody><DialogFooter><Button variant="ghost" onClick={() => setRejectOpen(false)} disabled={reject.pending}>取消</Button><Button variant="primary" loading={reject.pending} onClick={() => void reject()}>保存人工驳回</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
