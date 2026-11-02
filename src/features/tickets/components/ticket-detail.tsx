"use client";
import { ConfigurationPanel } from "./configuration-panel";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Play, RotateCw, Send, Square, UserRound } from "lucide-react";
import type { TicketSource } from "@/domain/entities";
import { PROCESS_STAGE_LABEL } from "@/domain/entities";
import { canCommentResult } from "@/domain/issue-source/jira-workflow";
import { useSession } from "@/features/auth/session-store";
import { useLiveData } from "@/shared/hooks/use-live-data";
import { useAction } from "@/shared/hooks/use-action";
import { formatDateTime } from "@/shared/lib/format";
import { Button, Callout, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Page, PageHeader, Spinner, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui";
import { loadTicketDetail } from "../services/detail";
import { processTicket, stopProcess } from "../services/process";
import { ticketHref, useProcessAction } from "../use-process-action";
import { CanSignalChart } from "./can-signal-chart-client";
import { ReviewPanel } from "./review-panel";
import { BackfillDialog } from "./backfill-dialog";
import { VersionVhalPanel } from "./version-vhal-panel";
import { ArtifactsPanel } from "./artifacts-panel";
import { IssueSceneBadge } from "./issue-scene-badge";
import { AssigneeDialog } from "./assignee-dialog";
import { TicketContextPanel } from "./ticket-context-panel";

export function TicketDetail({ source, ticketKey }: { source: TicketSource; ticketKey: string }) {
  const params = useSearchParams();
  const { can } = useSession();
  const groupId = params.get("group") ?? params.get("ruleGroupId") ?? undefined;
  const projectKey = params.get("project") ?? params.get("projectKey") ?? undefined;
  const workItemTypeKey = params.get("type") ?? params.get("workItemTypeKey") ?? undefined;
  const provider = params.get("provider");
  const jiraProvider = provider === "bosch" || provider === "default" ? provider : undefined;
  const assignmentId = params.get("assignmentId") ?? undefined;
  const loader = useCallback(() => loadTicketDetail({ source, ticketKey, groupId, projectKey, workItemTypeKey, assignmentId, jiraProvider }), [source, ticketKey, groupId, projectKey, workItemTypeKey, assignmentId, jiraProvider]);
  const state = useLiveData(loader);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  useProcessAction();
  const context = state.data?.context;
  const run = useAction(async () => { if (context?.group) await processTicket(context.latestSnapshot, context.group, { reanalyze: Boolean(context.result) }); });
  const stop = useAction(async () => { if (context?.group) await stopProcess(context.task, context.latestSnapshot, context.group); }, { success: "分析已停止" });
  if (state.error) return <Page><ErrorState error={state.error} onRetry={state.reload} /></Page>;
  if (state.loading) return <Page><Spinner label="正在读取工单与分析记录" /></Page>;
  if (!context) return <Page className="space-y-4"><PageHeader title={ticketKey} breadcrumbs={[{ label: "规则组看板", href: "/" }, { label: ticketKey }]} />{state.data?.candidates.length ? <div className="space-y-2"><p className="text-sm text-muted-foreground">此票号存在多个项目或规则组，请选择上下文。</p>{state.data.candidates.map((row) => <Button key={row.id} asChild variant="outline"><Link href={ticketHref(row)}>{row.ruleGroupId} · {row.projectKey ?? (row.jiraProvider === "bosch" ? "Bosch Jira" : "默认 Jira")} · {row.title}</Link></Button>)}</div> : <EmptyState title="当前浏览器没有此工单" description="请先在规则组中筛选，或从服务器恢复分析数据。" />}</Page>;
  const { snapshot, latestSnapshot, result, group, task } = context;
  const running = task?.status === "running";
  const trustedSource = source !== "jira" || Boolean(snapshot.jiraProvider || group);
  const canBackfill = result && trustedSource && can("reviewer") && ((canCommentResult(result) && (source === "jira" || Boolean(result.manualReviewedAt))) || (result.commentStatus === "succeeded" && result.transitionStatus === "failed"));
  return <Page width="full" className="space-y-5">
    <PageHeader title={<span className="flex flex-wrap items-center gap-2"><span>{ticketKey} · {latestSnapshot.title}</span><IssueSceneBadge title={latestSnapshot.title} /></span>} description={`来源：${source === "jira" ? "Jira" : "飞书项目"} · ${latestSnapshot.stateName ?? "状态未知"}`} breadcrumbs={[{ label: "规则组看板", href: "/" }, { label: group?.name ?? latestSnapshot.ruleGroupId, href: `/rule-groups/${encodeURIComponent(latestSnapshot.ruleGroupId)}?source=${source}` }, { label: ticketKey }]}
      actions={<><Button variant="outline" loading={run.pending} disabled={!group || running} onClick={() => void run()}>{result ? <RotateCw aria-hidden /> : <Play aria-hidden />}{result ? "重新分析" : "开始分析"}</Button><Button variant="outline" loading={stop.pending} disabled={!group} onClick={() => void stop()}><Square aria-hidden />停止</Button>{trustedSource && can("reviewer") ? <Button variant="outline" onClick={() => setAssigneeOpen(true)}><UserRound aria-hidden />指派经办人</Button> : null}{canBackfill ? <Button variant="primary" onClick={() => setBackfillOpen(true)}><Send aria-hidden />{result.commentStatus === "succeeded" ? "重试状态流转" : "回填结论"}</Button> : null}</>} />
    {task ? <div className="flex flex-wrap items-center gap-2 text-xs"><StatusBadge status={task.status} /><span className="text-muted-foreground">{task.stage ? PROCESS_STAGE_LABEL[task.stage] : ""} · {formatDateTime(task.createdAt)}</span>{result?.tokenUsage !== undefined ? <span className="tabular text-muted-foreground">{result.tokenUsage.toLocaleString()} Token</span> : null}</div> : null}
    {task?.error ? <Callout tone="danger" title="本次分析未完成">{task.error}{result ? "；下方保留上次成功结果。" : ""}</Callout> : null}
    {running ? <Callout title="正在分析">可以保留页面等待；飞书分析刷新后会按本次运行检查可恢复结果。</Callout> : null}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        <Tabs defaultValue="conclusion"><div className="overflow-x-auto"><TabsList aria-label="分析内容"><TabsTrigger value="conclusion">结论</TabsTrigger><TabsTrigger value="signals">CAN 与日志</TabsTrigger><TabsTrigger value="context">工单上下文</TabsTrigger><TabsTrigger value="history">历史</TabsTrigger><TabsTrigger value="artifacts">过程产物</TabsTrigger></TabsList></div>
          <TabsContent value="conclusion">{result ? <Card><CardHeader><CardTitle>分析结论</CardTitle><StatusBadge status={result.commentStatus === "not_started" ? "pending" : result.commentStatus === "succeeded" ? "succeeded" : result.commentStatus === "failed" ? "failed" : "running"} label={result.commentStatus === "succeeded" ? "已回填" : "尚未回填"} /></CardHeader><CardContent><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7">{result.replyText}</pre></CardContent></Card> : <EmptyState title={running ? "正在生成分析结论" : "尚无分析结果"} description="开始分析后，结论与处理状态会保存到当前浏览器。" />}</TabsContent>
          <TabsContent value="signals">{result ? <CanSignalChart artifactKey={source === "meegle" ? `meegle-${ticketKey}` : ticketKey} traceData={result.traceData} ticks={result.ticks} chartImagePath={result.chartImage} signalSummary={result.signalSummary} /> : <EmptyState title="暂无信号数据" />}</TabsContent>
          <TabsContent value="context"><TicketContextPanel key={snapshot.id} snapshot={snapshot} /></TabsContent>
          <TabsContent value="history"><div className="space-y-3">{context.histories.length ? context.histories.map((history) => <Card key={history.id}><CardHeader><CardTitle>{formatDateTime(history.resultCreatedAt)}</CardTitle><StatusBadge status={history.reviewStatus} /></CardHeader><CardContent><pre className="whitespace-pre-wrap break-words text-sm leading-relaxed">{history.replyText}</pre><ConfigurationPanel resolution={history.configurationResolution} /><VersionVhalPanel check={history.versionVhalCheck} />{history.manualCorrectResult ? <p className="mt-3 whitespace-pre-wrap text-sm text-primary">人工正确结论：{history.manualCorrectResult}</p> : null}</CardContent></Card>) : <EmptyState title="暂无历史分析" description="重新分析前会归档当前结果。" />}</div></TabsContent>
          <TabsContent value="artifacts"><ArtifactsPanel key={result?.id} artifactRef={result?.artifactRef} /></TabsContent>
        </Tabs>
        <ConfigurationPanel resolution={result?.configurationResolution} />
        <VersionVhalPanel check={result?.versionVhalCheck} />
      </div>
      {result ? <div className="space-y-4"><ReviewPanel key={result.id} result={result} snapshot={snapshot} groupName={group?.name} validations={context.validations} />{result.commentError || result.transitionError ? <Callout tone="danger">{result.commentError || result.transitionError}</Callout> : null}</div> : null}
    </div>
    {backfillOpen && result ? <BackfillDialog key={result.id} result={result} snapshot={snapshot} group={group} onClose={() => setBackfillOpen(false)} /> : null}
    {assigneeOpen ? <AssigneeDialog snapshot={latestSnapshot} group={group} onClose={() => setAssigneeOpen(false)} /> : null}
  </Page>;
}
