"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ScanSearch } from "lucide-react";
import { useLiveData } from "@/shared/hooks/use-live-data";
import { formatDateTime } from "@/shared/lib/format";
import { errorMessage } from "@/shared/lib/errors";
import { Badge, Button, ErrorState, Field, Input, Select, StatusBadge } from "@/shared/ui";
import { loadRecentDirectAnalyses, runDirectJiraAnalysis, type DirectAnalysisRow, type DirectAnalysisUpdate, type DirectJiraSite } from "../service";

const STATUS = { queued: "pending", running: "running", completed: "completed", failed: "failed", skipped: "cancelled" } as const;
const LABELS: Record<DirectAnalysisRow["status"], string> = { queued: "排队中", running: "分析中", completed: "已完成", failed: "失败", skipped: "未启动" };

export function DirectJiraAnalysis({ disabled }: { disabled?: boolean }) {
  const id = useId();
  const recent = useLiveData(useCallback(() => loadRecentDirectAnalyses(), []));
  const [key, setKey] = useState("");
  const [provider, setProvider] = useState<DirectJiraSite>("default");
  const [pending, setPending] = useState(false);
  const [update, setUpdate] = useState<DirectAnalysisUpdate>();
  const [error, setError] = useState<string>();
  const busy = useRef(false);
  const mounted = useRef(true);
  const lookup = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; lookup.current?.abort(); };
  }, []);

  async function submit() {
    if (busy.current || disabled) return;
    busy.current = true; setPending(true); setError(undefined); setUpdate(undefined);
    const controller = new AbortController(); lookup.current = controller;
    try {
      await runDirectJiraAnalysis(key, provider, { signal: controller.signal, onUpdate: (next) => {
        if (!mounted.current) return;
        if (next.phase !== "loading") lookup.current = undefined;
        setUpdate(next);
      } });
    } catch (error) { if (mounted.current) { setError(errorMessage(error)); setUpdate(undefined); } }
    finally { busy.current = false; lookup.current = undefined; if (mounted.current) setPending(false); }
  }
  const report = update?.report;
  const failures = report?.rows.filter(row => row.status === "failed").length ?? 0;
  const successes = report?.rows.filter(row => row.status === "completed").length ?? 0;
  return <section aria-label="指定 Jira 工单分析" className="rounded-xl border border-border bg-surface">
    <div className="flex items-start gap-3 p-4 pb-3"><span className="rounded-lg bg-primary-soft p-2 text-primary"><ScanSearch className="size-4" aria-hidden /></span><div className="min-w-0"><h2 className="text-sm font-semibold">指定 Jira 工单分析</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">按标题 [] 或【】中的车型分析当前站点全部匹配规则组。再次提交会重新分析并保留历史。</p></div></div>
    <form onSubmit={event => { event.preventDefault(); void submit(); }} className="grid items-end gap-3 px-4 pb-4 sm:grid-cols-[170px_minmax(0,1fr)_auto]">
      <Field label="Jira 站点" htmlFor={`${id}-provider`}><Select id={`${id}-provider`} value={provider} disabled={pending || disabled} options={[{ value: "default", label: "默认 Jira" }, { value: "bosch", label: "Bosch Jira" }]} onValueChange={value => setProvider(value as DirectJiraSite)} /></Field>
      <Field label="Jira 工单票号" htmlFor={`${id}-key`}><Input id={`${id}-key`} value={key} maxLength={120} disabled={pending || disabled} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="例如 CHER-129770" className="font-mono" onChange={event => setKey(event.target.value)} /></Field>
      <Button type="submit" variant="outline" disabled={disabled || !key.trim()} loading={pending}><ScanSearch aria-hidden />分析指定工单</Button>
    </form>
    {error ? <div className="px-4 pb-4"><ErrorState title="未能启动单票分析" error={error} /></div> : null}
    {!report && recent.error ? <div className="px-4 pb-4"><ErrorState title="最近单票分析读取失败" error={recent.error} onRetry={recent.reload} /></div> : null}
    {!report && recent.data?.length ? <div className="space-y-2 border-t border-border p-4"><h3 className="text-xs font-medium">最近单票分析 <span className="font-normal text-muted-foreground">· 每组保留最新任务，最多显示 8 项</span></h3><ul className="grid gap-2 lg:grid-cols-2">{recent.data.map(row => <li key={row.href} className="min-w-0 rounded-lg border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><Link href={row.href} aria-label={`打开${row.provider === "bosch" ? "Bosch Jira" : "默认 Jira"} ${row.ticketKey} · ${row.groupName}`} className="min-w-0 break-words text-xs text-primary hover:underline">{row.ticketKey} · {row.groupName} · {row.provider === "bosch" ? "Bosch Jira" : "默认 Jira"}</Link><StatusBadge status={row.status} /></div><p className="mt-1 text-[11px] text-muted-foreground">{formatDateTime(row.createdAt)}</p>{row.error ? <p className="mt-1 break-words text-xs text-destructive">{row.error}</p> : null}</li>)}</ul></div> : null}
    {update ? <div className="space-y-3 border-t border-border p-4">
      <p role="status" className="text-xs text-muted-foreground">{update.phase === "loading" ? "正在查询 Jira 工单并匹配车型…" : update.phase === "processing" ? `已匹配 ${report?.rows.length ?? 0} 个规则组，正在分析…` : `本轮结束：${successes} 个完成，${failures} 个失败；各组状态见下方。`}</p>
      {report ? <><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-medium">{report.key}</span><Badge tone="info">{report.provider === "bosch" ? "Bosch Jira" : "默认 Jira"}</Badge><Badge>{report.model}</Badge><span className="min-w-0 break-words text-xs">{report.title}</span></div>
        <ul className="grid gap-2 lg:grid-cols-2">{report.rows.map(row => <li key={row.groupId} className="min-w-0 rounded-lg border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="break-words text-xs font-medium">{row.groupName}</span><div className="flex items-center gap-2"><StatusBadge status={STATUS[row.status]} label={LABELS[row.status]} />{row.taskId || row.status === "running" ? <Link href={row.href} className="inline-flex items-center gap-1 text-xs text-primary hover:underline" aria-label={`查看 ${row.groupName} 的单票分析`}>查看详情<ArrowUpRight className="size-3" aria-hidden /></Link> : null}</div></div>{row.error ? <p className="mt-2 break-words text-xs text-destructive">{row.error}</p> : null}</li>)}</ul>
      </> : null}
    </div> : null}
  </section>;
}
