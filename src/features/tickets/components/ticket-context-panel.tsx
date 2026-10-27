"use client";

import { useState } from "react";
import type { TicketSnapshot } from "@/domain/entities";
import type { MeegleWorkItemDetail } from "@/domain/meegle/work-item-detail";
import { apiFetch } from "@/shared/lib/api";
import { useAction } from "@/shared/hooks/use-action";
import { formatDateTime } from "@/shared/lib/format";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/shared/ui";

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
function externalUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}

export function TicketContextPanel({ snapshot }: { snapshot: TicketSnapshot }) {
  const [detail, setDetail] = useState<MeegleWorkItemDetail | null>(null);
  const load = useAction(async () => {
    const query = new URLSearchParams({ projectKey: snapshot.projectKey ?? "", workItemTypeKey: snapshot.workItemTypeKey ?? "issue", workItemId: snapshot.ticketKey });
    const data = await apiFetch<{ detail: MeegleWorkItemDetail | null }>(`/api/meegle/workitem?${query}`);
    if (!data.detail) throw new Error("原票详情不完整，当前仍展示分析时快照");
    setDetail(data.detail);
  });
  const raw = snapshot.rawData;
  const comments = detail?.comments ?? (Array.isArray(raw.comments) ? raw.comments : []).map((value: Record<string, unknown>, index: number) => ({
    id: String(value.id ?? index), authorName: display(value.author ?? value.creator), createdAt: String(value.created ?? value.created_at ?? ""), body: display(value.body ?? value.content), attachments: [] as Array<{ url: string; name: string; kind: string }>,
  }));
  const attachments = (Array.isArray(raw.attachments) ? raw.attachments : []) as Array<Record<string, unknown>>;
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle>基本信息</CardTitle>{snapshot.source === "meegle" ? <Button variant="outline" size="sm" loading={load.pending} onClick={() => void load()}>读取原票详情</Button> : null}</CardHeader><CardContent className="space-y-4">
      <dl className="space-y-3 text-sm">{[["票号", snapshot.ticketKey], ["标题", snapshot.title], ["项目", snapshot.projectName ?? raw.project], ["状态", snapshot.stateName], ["经办人", detail?.assigneeRole?.members.map((member) => member.name).join("、") || raw.assignee], ["优先级", raw.priority]].map(([name, value]) => <div key={String(name)} className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]"><dt className="text-muted-foreground">{display(name)}</dt><dd className="whitespace-pre-wrap break-words">{display(value)}</dd></div>)}</dl>
      {detail?.fields.length ? <details><summary className="cursor-pointer text-xs text-muted-foreground">全部工单字段</summary><dl className="mt-3 space-y-2">{detail.fields.map((field) => <div key={field.key} className="grid gap-1 text-xs sm:grid-cols-[9rem_minmax(0,1fr)]"><dt className="text-muted-foreground">{field.name}</dt><dd className="whitespace-pre-wrap break-words">{display(field.value)}</dd></div>)}</dl></details> : null}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>问题描述</CardTitle></CardHeader><CardContent><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{detail?.descriptionFields.length ? detail.descriptionFields.map((field) => `${field.name}\n${display(field.value)}`).join("\n\n") : display(raw.description)}</pre></CardContent></Card>
    <Card><CardHeader><CardTitle>评论与附件</CardTitle></CardHeader><CardContent className="space-y-4">{comments.length ? comments.map((comment) => <article key={comment.id} className="space-y-2 border-b border-border pb-4 last:border-0"><p className="text-xs text-muted-foreground">{comment.authorName} · {formatDateTime(comment.createdAt)}</p><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{comment.body}</pre>{comment.attachments.map((attachment, index) => externalUrl(attachment.url) ? <a key={`${attachment.url}:${index}`} href={externalUrl(attachment.url)} target="_blank" rel="noopener noreferrer" className="mr-3 inline-block break-all text-xs text-primary hover:underline">{attachment.name}</a> : null)}</article>) : <EmptyState title="快照中暂无评论" />}{attachments.length ? <div className="space-y-2"><h3 className="text-xs font-medium">工单附件</h3>{attachments.map((attachment, index) => {
      const url = externalUrl(attachment.contentUrl ?? attachment.url);
      return url ? <a key={`${url}:${index}`} href={url} target="_blank" rel="noopener noreferrer" className="block break-all text-xs text-primary hover:underline">{display(attachment.filename ?? attachment.name)}</a> : <p key={index} className="break-words text-xs text-muted-foreground">{display(attachment.filename ?? attachment.name)}</p>;
    })}</div> : null}</CardContent></Card>
    <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-xs text-muted-foreground">分析时原始快照</summary><pre className="mt-3 max-h-[50vh] overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{JSON.stringify(raw, null, 2)}</pre></details>
  </div>;
}
