"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, Play, Search } from "lucide-react";
import { processTicket } from "@/features/tickets/services/process";
import { ticketHref, useProcessAction } from "@/features/tickets/use-process-action";
import { TICKET_SOURCE_LABEL, type TicketSource } from "@/domain/entities";
import { sameTicketIdentity } from "@/domain/issue-source/ticket-identity";
import { useRuleGroups } from "@/features/rule-groups/store";
import { IssueSceneBadge } from "@/features/tickets/components/issue-scene-badge";
import { db } from "@/shared/db/database";
import { useLiveData } from "@/shared/hooks/use-live-data";
import { formatDateTime } from "@/shared/lib/format";
import { errorMessage } from "@/shared/lib/errors";
import { toast } from "@/shared/ui/toast";
import { Button, EmptyState, ErrorState, Input, Page, PageHeader, Spinner, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui";
import { loadRuleGroupFilters } from "../filter-service";
import { useFilterAction } from "../use-filter-action";
import { SourceStatus } from "./source-status";

export function RuleGroupAnalysis({ id }: { id: string }) {
  const groups = useRuleGroups();
  const group = groups.ruleGroups.find((row) => row.id === id);
  const params = useSearchParams();
  const router = useRouter();
  const source: TicketSource = params.get("source") === "meegle" ? "meegle" : "jira";
  const [query, setQuery] = useState("");
  const filter = useFilterAction(groups.ruleGroups);
  const process = useProcessAction();
  const loader = useCallback(async () => {
    if (!group) return null;
    const [filters, tasks, results, snapshots] = await Promise.all([loadRuleGroupFilters(group), db.processTasks.where("ruleGroupId").equals(id).toArray(), db.processResults.where("ruleGroupId").equals(id).toArray(), db.snapshots.where("ruleGroupId").equals(id).toArray()]);
    return { ...filters, tasks, results, snapshotsById: new Map(snapshots.map((row) => [row.id, row])) };
  }, [group, id]);
  const state = useLiveData(loader);

  if (groups.error) return <Page><ErrorState error={groups.error} onRetry={() => void groups.load()} /></Page>;
  if (!groups.loaded) return <Page><Spinner label="正在读取规则组" /></Page>;
  if (!group) return <Page><EmptyState title="规则组不存在" description="配置可能已删除或尚未导入当前浏览器。" action={<Button asChild><Link href="/">返回规则组看板</Link></Button>} /></Page>;
  const data = state.data;
  const rows = data?.snapshots[source].filter((snapshot) => !query.trim() || `${snapshot.ticketKey} ${snapshot.title}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const running = data && Object.values(data.summary).some((value) => value.status === "running");
  return <Page width="full" className="space-y-5">
    <PageHeader title={group.name} description="按来源查看最新筛票结果和分析记录。" breadcrumbs={[{ label: "规则组看板", href: "/" }, { label: group.name }]} actions={<><Button variant="outline" loading={filter.running || Boolean(running)} onClick={() => void filter.run([group])}><Filter aria-hidden />筛选工单</Button><Button variant="primary" loading={process.running} disabled={!data || !Object.values(data.summary).some((row) => row.status === "completed" && row.issueCount > 0)} onClick={() => void process.run([group])}><Play aria-hidden />分析待处理工单</Button></>} />
    {state.error ? <ErrorState error={state.error} onRetry={state.reload} /> : state.loading ? <Spinner /> : data ? <>
      <div className="max-w-xl rounded-lg border border-border bg-surface p-4"><SourceStatus summary={data.summary} /></div>
      <Tabs value={source} onValueChange={(value) => router.replace(`/rule-groups/${encodeURIComponent(id)}?source=${value}`, { scroll: false })}>
        <TabsList aria-label="工单来源">{(["jira", "meegle"] as const).map((value) => <TabsTrigger value={value} key={value}>{TICKET_SOURCE_LABEL[value]} · {data.summary[value].issueCount}</TabsTrigger>)}</TabsList>
        <TabsContent value={source} className="space-y-4">
          <div className="flex flex-wrap items-center gap-3"><div className="relative w-full max-w-md"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden /><Input aria-label="搜索工单" placeholder="搜索票号或标题" className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} /></div><p className="text-xs text-muted-foreground">最近筛票：{formatDateTime(data.latest[source]?.createdAt)}</p></div>
          {data.summary[source].status === "failed" || data.summary[source].status === "expired" ? <ErrorState title={`${TICKET_SOURCE_LABEL[source]} 筛票失败`} error={data.summary[source].error ?? "请重新筛选"} onRetry={() => void filter.run([group])} /> : !rows.length ? <EmptyState title={data.summary[source].configured ? "当前没有命中的工单" : "尚未配置此来源"} description={data.summary[source].configured ? "执行筛选或调整查询条件后重试。" : "请管理员在规则组配置中填写查询语句。"} /> : <Table>
            <TableHeader><TableRow><TableHead>工单</TableHead><TableHead>标题</TableHead><TableHead>状态</TableHead><TableHead>分析</TableHead><TableHead>复核</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((snapshot) => {
              const tasks = data.tasks.filter((row) => sameTicketIdentity(data.snapshotsById.get(row.snapshotId), snapshot)).sort((a, b) => +b.createdAt - +a.createdAt);
              const result = data.results.filter((row) => sameTicketIdentity(data.snapshotsById.get(row.snapshotId), snapshot)).sort((a, b) => +b.createdAt - +a.createdAt)[0];
              return <TableRow key={snapshot.id}><TableCell className="font-mono text-xs"><Link className="text-primary hover:underline" href={ticketHref(snapshot)}>{snapshot.ticketKey}</Link></TableCell><TableCell className="min-w-60"><span className="mr-2">{snapshot.title}</span><IssueSceneBadge title={snapshot.title} /></TableCell><TableCell>{snapshot.stateName ?? "—"}</TableCell><TableCell>{tasks[0] ? <div className="space-y-1"><StatusBadge status={tasks[0].status} />{tasks[0].error ? <p className="max-w-xs text-xs text-destructive">{tasks[0].error}</p> : null}</div> : <StatusBadge status="pending" />}</TableCell><TableCell>{result ? <StatusBadge status={result.reviewStatus} /> : "—"}</TableCell><TableCell><Button variant="ghost" size="sm" disabled={tasks[0]?.status === "running"} onClick={() => void processTicket(snapshot, group, { reanalyze: Boolean(result) }).catch((error) => toast.error(errorMessage(error)))}>{result ? "重新分析" : "分析"}</Button></TableCell></TableRow>;
            })}</TableBody>
          </Table>}
        </TabsContent>
      </Tabs>
    </> : null}
  </Page>;
}
