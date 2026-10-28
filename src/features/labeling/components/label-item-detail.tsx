"use client";

import { useCallback } from "react";
import { useAsync } from "@/shared/hooks/use-async";
import { Badge, Card, CardContent, CardHeader, ErrorState, Spinner, StatusBadge } from "@/shared/ui";
import { getLabelItem } from "../service";
import { AnnotationEditor } from "./annotation-editor";

interface Props { owner: string; itemId: string; canEdit: boolean; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; onSaved: () => void }

/** 由 itemId + username 作为组件 key；切换时不显示上一个条目的详情或草稿。 */
export function LabelItemDetail({ owner, itemId, canEdit, onDirty, onBusy, onSaved }: Props) {
  const detail = useAsync(useCallback(() => getLabelItem(itemId), [itemId]));
  if (detail.loading) return <Spinner label="正在读取分析证据与已有标注" />;
  if (detail.error || !detail.data) return <ErrorState title="无法读取标注条目" error={detail.error ?? "条目不存在"} onRetry={() => void detail.reload()} />;
  const item = detail.data;
  return <div className="min-w-0 space-y-4">
    <Card><CardHeader><div className="min-w-0 space-y-2"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-primary">{item.issueKey}</span><Badge>{item.source === "jira" ? "Jira" : "飞书项目"}</Badge><Badge tone={item.scene === "bench" ? "warning" : item.scene === "vehicle" ? "info" : "neutral"}>{item.scene === "bench" ? "台架" : item.scene === "vehicle" ? "实车" : "未标注场景"}</Badge></div><h2 className="break-words text-base font-semibold">{item.title || "未提供标题"}</h2></div></CardHeader>
      <CardContent className="space-y-4"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-muted-foreground">原结果复核</span><StatusBadge status={item.reviewStatus === "approved" || item.reviewStatus === "rejected" || item.reviewStatus === "pending" ? item.reviewStatus : "unknown"} label={item.reviewStatus === "pending" ? "待复核" : undefined} /></div><div><h3 className="mb-2 text-xs font-medium">AI 分析结论</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-3 font-sans text-sm leading-relaxed">{item.replyText || "没有分析结论"}</pre></div>
        {item.signalSummary ? <details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-xs font-medium">信号摘要</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{item.signalSummary}</pre></details> : null}
        {item.errorReason || item.manualCorrectResult ? <details className="rounded-md border border-border p-3" open><summary className="cursor-pointer text-xs font-medium">原人工复核信息</summary><div className="mt-2 space-y-2 whitespace-pre-wrap break-words text-xs"><p>{item.errorReason}</p><p>{item.manualCorrectResult}</p></div></details> : null}
        {item.aiReviewVerdict ? <details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-xs font-medium">AI 复核建议 · {item.aiReviewVerdict === "pass" ? "通过" : item.aiReviewVerdict === "fail" ? "不通过" : item.aiReviewVerdict}</summary><p className="mt-2 whitespace-pre-wrap break-words text-xs">{item.aiReviewReason || "无补充说明"}</p></details> : null}
      </CardContent>
    </Card>
    <AnnotationEditor owner={owner} item={item} canEdit={canEdit} onDirty={onDirty} onBusy={onBusy} onSaved={onSaved} />
  </div>;
}
