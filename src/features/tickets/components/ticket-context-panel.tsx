"use client";

import { useEffect, useMemo, useState } from "react";
import type { TicketSnapshot } from "@/domain/entities";
import { extractSafeRichImageAttachments, type MeegleWorkItemIdentity } from "@/domain/meegle/work-item-detail";
import type { MeegleContextView } from "@/domain/meegle/context-view";
import { TicketCachedImage, TicketRichContent } from "./ticket-rich-content";
import { apiFetch } from "@/shared/lib/api";
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
  const identity = useMemo<MeegleWorkItemIdentity>(() => ({ projectKey: snapshot.projectKey ?? "", workItemTypeKey: "issue", workItemId: snapshot.workItemId !== undefined ? String(snapshot.workItemId) : snapshot.ticketKey.replace(/^meegle-/, "") }), [snapshot.projectKey, snapshot.ticketKey, snapshot.workItemId]);
  const identityKey = JSON.stringify([snapshot.source, identity]);
  const [viewState, setViewState] = useState<{ key: string; view: MeegleContextView; revision: number } | null>(null);
  const [request, setRequest] = useState({ key: "", pending: false, error: "" });
  const [refresh, setRefresh] = useState({ key: "", count: 0 });
  const view = viewState?.key === identityKey ? viewState.view : null;
  const detail = view?.detail;
  useEffect(() => {
    if (snapshot.source !== "meegle") return;
    const controller = new AbortController();
    const query = new URLSearchParams({ ...identity, ...(refresh.key === identityKey && refresh.count ? { refresh: "1" } : {}) });
    queueMicrotask(() => { if (!controller.signal.aborted) setRequest({ key: identityKey, pending: true, error: "" }); });
    void apiFetch<MeegleContextView>(`/api/meegle/context-view?${query}`, { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      if (data.detail) setViewState((previous) => ({ key: identityKey, view: data, revision: (previous?.revision ?? 0) + 1 }));
      setRequest({ key: identityKey, pending: false, error: data.warning || (!data.detail ? "原票详情不完整，当前仍展示分析时快照" : "") });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setRequest({ key: identityKey, pending: false, error: `${error instanceof Error ? error.message : "原票读取失败"}；保留已有内容，可刷新重试` });
    });
    return () => controller.abort();
  }, [identity, identityKey, snapshot.source, refresh]);
  const pending = request.key === identityKey && request.pending;
  const warning = request.key === identityKey ? request.error : "";
  const raw = snapshot.rawData;
  const comments = detail?.comments ?? (Array.isArray(raw.comments) ? raw.comments : []).map((value: Record<string, unknown>, index: number) => ({
    id: String(value.id ?? index), authorName: display(value.authorName ?? value.author ?? value.creator), createdAt: String(value.createdAt ?? value.created ?? value.created_at ?? ""), body: display(snapshot.source === "meegle" ? value.richBody ?? value.body ?? value.content : value.body ?? value.content), attachments: (Array.isArray(value.attachments) ? value.attachments : []) as Array<{ url: string; name: string; kind: string }>,
  }));
  const renderContent = (body: string) => snapshot.source === "meegle"
    ? <TicketRichContent key={viewState?.revision ?? 0} body={body} identity={identity} images={view?.images} />
    : <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{body}</pre>;
  const attachments = (Array.isArray(raw.attachments) ? raw.attachments : []) as Array<Record<string, unknown>>;
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle>基本信息</CardTitle>{snapshot.source === "meegle" ? <Button variant="outline" size="sm" loading={pending} onClick={() => setRefresh((value) => ({ key: identityKey, count: value.count + 1 }))}>刷新原票详情</Button> : null}</CardHeader><CardContent className="space-y-4">
      {snapshot.source === "meegle" ? <p role={warning ? "status" : undefined} className="text-xs text-muted-foreground">{pending ? "正在读取原票详情…" : warning || (view ? `${view.source === "cache" ? "本地缓存" : "原票详情"}${view.cachedAt ? ` · ${formatDateTime(view.cachedAt)}` : ""}` : "分析时快照")}</p> : null}
      <dl className="space-y-3 text-sm">{[["票号", snapshot.ticketKey], ["标题", snapshot.title], ["项目", snapshot.projectName ?? raw.project], ["状态", snapshot.stateName], ["经办人", detail?.assigneeRole?.members.map((member) => member.name).join("、") || raw.assignee], ["优先级", raw.priority]].map(([name, value]) => <div key={String(name)} className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]"><dt className="text-muted-foreground">{display(name)}</dt><dd className="whitespace-pre-wrap break-words">{display(value)}</dd></div>)}</dl>
      {detail?.fields.length ? <details><summary className="cursor-pointer text-xs text-muted-foreground">全部工单字段</summary><dl className="mt-3 space-y-2">{detail.fields.map((field) => <div key={field.key} className="grid gap-1 text-xs sm:grid-cols-[9rem_minmax(0,1fr)]"><dt className="text-muted-foreground">{field.name}</dt><dd className="whitespace-pre-wrap break-words">{display(field.value)}</dd></div>)}</dl></details> : null}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>问题描述</CardTitle></CardHeader><CardContent>{detail?.descriptionFields.length ? detail.descriptionFields.map((field) => <section key={field.key} className="mb-4 last:mb-0"><h3 className="mb-1 text-xs font-medium text-muted-foreground">{field.name}</h3>{renderContent(display(field.value))}</section>) : renderContent(display(snapshot.source === "meegle" ? raw.descriptionRich ?? raw.description : raw.description))}</CardContent></Card>
    <Card><CardHeader><CardTitle>评论与附件</CardTitle></CardHeader><CardContent className="space-y-4">{comments.length ? comments.map((comment) => {
      const inlineImages = new Set(snapshot.source === "meegle" ? extractSafeRichImageAttachments(comment.body).map((image) => image.url) : []);
      return <article key={comment.id} className="space-y-2 border-b border-border pb-4 last:border-0"><p className="text-xs text-muted-foreground">{comment.authorName} · {formatDateTime(comment.createdAt)}</p>{renderContent(comment.body)}{comment.attachments.map((attachment, index) => snapshot.source === "meegle" && attachment.kind === "image" ? (!inlineImages.has(attachment.url) ? <TicketCachedImage key={`${attachment.url}:${index}:${viewState?.revision ?? 0}`} originalUrl={attachment.url} alt={attachment.name} identity={identity} images={view?.images} /> : null) : externalUrl(attachment.url) ? <a key={`${attachment.url}:${index}`} href={externalUrl(attachment.url)} target="_blank" rel="noopener noreferrer" className="mr-3 inline-block break-all text-xs text-primary hover:underline">{attachment.name}</a> : null)}</article>; }) : <EmptyState title="快照中暂无评论" />}{attachments.length ? <div className="space-y-2"><h3 className="text-xs font-medium">工单附件</h3>{attachments.map((attachment, index) => {
      const url = externalUrl(attachment.contentUrl ?? attachment.url);
      return url ? <a key={`${url}:${index}`} href={url} target="_blank" rel="noopener noreferrer" className="block break-all text-xs text-primary hover:underline">{display(attachment.filename ?? attachment.name)}</a> : <p key={index} className="break-words text-xs text-muted-foreground">{display(attachment.filename ?? attachment.name)}</p>;
    })}</div> : null}</CardContent></Card>
    <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-xs text-muted-foreground">分析时原始快照</summary><pre className="mt-3 max-h-[50vh] overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{JSON.stringify(raw, null, 2)}</pre></details>
  </div>;
}
