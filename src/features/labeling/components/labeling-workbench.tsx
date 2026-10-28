"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, RefreshCw, Search, Tags } from "lucide-react";
import { useSession } from "@/features/auth/session-store";
import type { LabelListFilter } from "@/domain/labeling/items";
import { LABEL_LIST_MAX_LIMIT } from "@/domain/labeling/items";
import { VERDICT_INFO } from "@/domain/labeling/schema";
import { useAsync } from "@/shared/hooks/use-async";
import { downloadBlob } from "@/shared/db/sync";
import { errorMessage } from "@/shared/lib/errors";
import { Badge, Button, Callout, ConfirmDialog, EmptyState, ErrorState, Field, Input, Page, PageHeader, Select, Spinner } from "@/shared/ui";
import { clearDraft } from "../draft-cache";
import { exportAnnotations, listLabelItems } from "../service";
import { LabelItemDetail } from "./label-item-detail";

export function LabelingWorkbench() {
  const { ready, user, can } = useSession();
  if (!ready) return <Page><Spinner label="正在加载当前账号" /></Page>;
  if (!user) return <Page><ErrorState error="请先登录后使用数据标注" /></Page>;
  return <Workbench key={user.username} owner={user.username} canEdit={can("reviewer")} />;
}

function Workbench({ owner, canEdit }: { owner: string; canEdit: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<LabelListFilter>({ status: "todo", reviewStatus: "all", scene: "all" });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const list = useAsync(useCallback(() => listLabelItems(filter), [filter]));
  useEffect(() => {
    if (!dirty && !busy) return;
    const leave = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.download || (anchor.target && anchor.target !== "_self")) return;
      const target = new URL(anchor.href, window.location.href);
      if (target.origin !== window.location.origin || (target.pathname === window.location.pathname && target.search === window.location.search)) return;
      event.preventDefault(); event.stopPropagation();
      if (busy) return;
      setDiscard(() => () => router.push(`${target.pathname}${target.search}${target.hash}`));
    };
    document.addEventListener("click", leave, true);
    return () => document.removeEventListener("click", leave, true);
  }, [dirty, busy, router]);
  function navigate(action: () => void) {
    if (busy) return;
    if (dirty) setDiscard(() => action);
    else action();
  }
  function changeFilter(patch: Partial<LabelListFilter>) {
    navigate(() => { setDirty(false); setSelected(undefined); setFilter({ ...filter, ...patch }); });
  }
  async function download() {
    setExporting(true); setExportError(undefined);
    try {
      const body = await exportAnnotations();
      downloadBlob(new Blob([body], { type: "application/x-ndjson;charset=utf-8" }), `labeled-data-${new Date().toISOString().slice(0, 10)}.jsonl`);
    } catch (error) { setExportError(errorMessage(error)); }
    finally { setExporting(false); }
  }
  const reload = list.reload;
  const onSaved = useCallback(() => { void reload(); }, [reload]);
  return <Page width="full" className="space-y-4">
    <PageHeader title="数据标注" description="核对分析证据，积累可靠的示例与评测真值。" breadcrumbs={[{ label: "规则组看板", href: "/" }, { label: "数据标注" }]} actions={<><Button variant="outline" disabled={busy || list.loading} onClick={() => navigate(() => { setDirty(false); setSelected(undefined); void list.reload(); })}><RefreshCw aria-hidden />刷新列表</Button><Button variant="primary" loading={exporting} onClick={() => void download()}><Download aria-hidden />导出 JSONL</Button></>} />
    <Callout title="当前账号的服务器镜像">列表来自已同步的 Jira 与飞书分析。标注按账号独立保存，不改变原始分析；导出包含当前账号全部有效标注，不受列表筛选影响。排除、无法标注和未选用途的数据不会导出。</Callout>
    {exportError ? <ErrorState title="导出失败" error={exportError} onRetry={() => void download()} /> : null}
    <div className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2 xl:grid-cols-5">
      <Field label="来源" htmlFor="label-source"><Select id="label-source" value={filter.source ?? "all"} disabled={busy} onValueChange={(value) => changeFilter({ source: value === "all" ? undefined : value as LabelListFilter["source"] })} options={[{ value: "all", label: "全部来源" }, { value: "jira", label: "Jira" }, { value: "meegle", label: "飞书项目" }]} /></Field>
      <Field label="标注状态" htmlFor="label-status"><Select id="label-status" value={filter.status} disabled={busy} onValueChange={(value) => changeFilter({ status: value as LabelListFilter["status"] })} options={[{ value: "todo", label: "未标注" }, { value: "done", label: "已标注" }, { value: "all", label: "全部状态" }]} /></Field>
      <Field label="原结果复核" htmlFor="label-review"><Select id="label-review" value={filter.reviewStatus} disabled={busy} onValueChange={(value) => changeFilter({ reviewStatus: value })} options={[{ value: "all", label: "全部复核状态" }, { value: "pending", label: "待复核" }, { value: "approved", label: "已通过" }, { value: "rejected", label: "已驳回" }]} /></Field>
      <Field label="问题场景" htmlFor="label-scene"><Select id="label-scene" value={filter.scene} disabled={busy} onValueChange={(value) => changeFilter({ scene: value as LabelListFilter["scene"] })} options={[{ value: "all", label: "全部场景" }, { value: "bench", label: "台架" }, { value: "vehicle", label: "实车" }, { value: "none", label: "未标注场景" }]} /></Field>
      <form onSubmit={(event) => { event.preventDefault(); changeFilter({ query: search.trim() }); }}><Field label="票号或标题" htmlFor="label-query"><div className="flex gap-1"><Input id="label-query" value={search} disabled={busy} placeholder="输入关键词" onChange={(event) => setSearch(event.target.value)} /><Button type="submit" size="icon" variant="outline" disabled={busy} aria-label="搜索标注条目"><Search aria-hidden /></Button></div></Field></form>
    </div>
    <div className="grid items-start gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
      <section aria-label="标注条目列表" className="min-w-0 rounded-xl border border-border bg-surface xl:sticky xl:top-20">
        <div className="border-b border-border p-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><Tags className="size-4 text-primary" aria-hidden />待核对条目</h2>{!list.loading && list.data && !list.error ? <p className="mt-1 text-xs text-muted-foreground">筛选匹配 {list.data.total} 条 · 本账号累计已标注 {list.data.annotated} 条</p> : null}</div>
        <div className="max-h-[28rem] overflow-y-auto p-2 xl:max-h-[calc(100dvh-25rem)]">
          {list.loading ? <div className="p-3"><Spinner label="正在读取镜像条目" /></div> : list.error ? <ErrorState error={list.error} onRetry={() => void list.reload()} /> : !list.data?.items.length ? <EmptyState title="没有符合条件的条目" description="可调整筛选；若镜像为空，请先在数据管理同步本地分析结果。" /> : <div className="space-y-1">{list.data.items.map((item) => <button key={item.itemId} type="button" disabled={busy} aria-current={selected === item.itemId ? "true" : undefined} onClick={() => { if (selected !== item.itemId) navigate(() => { setDirty(false); setSelected(item.itemId); }); }} className={`w-full min-w-0 space-y-2 rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${selected === item.itemId ? "border-primary/40 bg-primary-soft" : "border-transparent hover:border-border hover:bg-surface-2"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs font-medium">{item.issueKey}</span><Badge tone={item.annotated ? "success" : "neutral"}>{item.annotated ? item.verdict ? VERDICT_INFO[item.verdict].label : "已标注" : "未标注"}</Badge></div><p className="line-clamp-2 break-words text-sm font-medium">{item.title || "未提供标题"}</p><div className="flex flex-wrap gap-1"><Badge>{item.source === "jira" ? "Jira" : "飞书"}</Badge><Badge tone={item.scene === "bench" ? "warning" : item.scene === "vehicle" ? "info" : "neutral"}>{item.scene === "bench" ? "台架" : item.scene === "vehicle" ? "实车" : "未标注场景"}</Badge></div><p className="line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">{item.excerpt}</p>
          </button>)}</div>}
        </div>
        {list.data && list.data.total > list.data.items.length && !list.loading && !list.error ? <p className="border-t border-border p-3 text-xs text-warning">仅展示前 {LABEL_LIST_MAX_LIMIT} 条，请缩小筛选范围查看其余条目。</p> : null}
      </section>
      {selected ? <LabelItemDetail key={selected} owner={owner} itemId={selected} canEdit={canEdit} onDirty={setDirty} onBusy={setBusy} onSaved={onSaved} /> : <EmptyState className="min-h-72" title="选择一条分析开始核对" description="左侧选择条目后，这里会显示原分析、信号摘要、复核信息与独立标注。" />}
    </div>
    <ConfirmDialog open={!!discard} onOpenChange={(open) => { if (!open) setDiscard(null); }} title="放弃未保存的标注？" description="当前编辑尚未保存。继续切换将丢弃这些更改。" confirmText="放弃更改并继续" destructive onConfirm={() => { const action = discard; if (selected) { try { clearDraft(sessionStorage, owner, selected); } catch { /* 暂存不可用时仍允许明确放弃 */ } } setDirty(false); action?.(); }} />
  </Page>;
}
