"use client";

import { useCallback, useState } from "react";
import { BarChart3, ClipboardCopy, Coins, Gauge, RefreshCw, Timer } from "lucide-react";
import type { AnnualStatistics, MonthRange } from "@/domain/analysis/annual-statistics";
import type { TeamMemberStatistics } from "@/domain/analysis/team-statistics";
import { buildStatisticsReport } from "@/domain/analysis/weekly-report";
import { useAsync } from "@/shared/hooks/use-async";
import { formatDateTime } from "@/shared/lib/format";
import {
  Button,
  Card,
  CardContent,
  Callout,
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  Stat,
  toast,
} from "@/shared/ui";
import { dwellText, rangeLabel, tokenText } from "../format";
import { loadLocalStatistics } from "../load-local-statistics";
import { fetchTeamStatistics } from "../services";
import { MemberTable } from "./member-table";
import { SourceSummary } from "./source-summary";

type Scope = "mine" | "team";

interface StatisticsResult {
  scope: Scope;
  total: AnnualStatistics;
  members: TeamMemberStatistics[];
}

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} 月` }));

async function loadStatistics(scope: Scope, range: MonthRange): Promise<StatisticsResult> {
  if (scope === "team") {
    try {
      const team = await fetchTeamStatistics(range);
      return { scope, total: team.total, members: team.members };
    } catch (error) {
      throw new Error(`无法读取团队统计：${error instanceof Error ? error.message : "请重试"}`);
    }
  }
  try {
    return { scope, total: await loadLocalStatistics(range), members: [] };
  } catch {
    throw new Error("无法读取本地统计数据，请重试。");
  }
}

export function StatisticsView() {
  const thisYear = new Date().getFullYear();
  const [scope, setScope] = useState<Scope>("mine");
  const [year, setYear] = useState(thisYear);
  const [startMonth, setStartMonth] = useState(1);
  const [endMonth, setEndMonth] = useState(12);
  const [applied, setApplied] = useState<MonthRange>({ year: thisYear, startMonth: 1, endMonth: 12 });
  const rangeInvalid = startMonth > endMonth;

  const { data, error, loading, reload } = useAsync(
    useCallback(() => loadStatistics(scope, applied), [scope, applied]),
  );
  const report = data?.total;

  function query() {
    if (rangeInvalid) return;
    setApplied({ year, startMonth, endMonth });
  }

  async function copyReport() {
    if (!data || error || loading) return;
    const markdown = buildStatisticsReport({
      title: data.scope === "team" ? "团队工单分析统计" : "我的工单分析统计",
      total: data.total,
      members: data.scope === "team" ? data.members : [],
    });
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success("已复制到剪贴板", { description: "Markdown 格式，可直接粘贴到飞书 / 邮件" });
    } catch {
      toast.error("复制失败，请检查浏览器剪贴板权限");
    }
  }

  const yearOptions = Array.from({ length: 5 }, (_, i) => ({ value: String(thisYear - i), label: `${thisYear - i} 年` }));

  return (
    <Page>
      <PageHeader
        title="统计报表"
        description={
          scope === "team"
            ? "服务器镜像中所有成员的备份记录 · 按所选年份与月份范围（含首尾月）· 同票取范围内最后一次成功分析"
            : "当前浏览器本地记录 · 按所选年份与月份范围（含首尾月）· 同票取范围内最后一次成功分析"
        }
        actions={
          <>
            <Button variant="outline" onClick={() => void reload()} loading={loading} disabled={rangeInvalid}>
              {!loading && <RefreshCw aria-hidden />}重新统计
            </Button>
            <Button variant="primary" onClick={() => void copyReport()} disabled={!report || loading || Boolean(error)}>
              <ClipboardCopy aria-hidden />复制统计报告
            </Button>
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-3">
          <SegmentedControl<Scope>
            aria-label="统计范围"
            value={scope}
            onValueChange={setScope}
            disabled={loading}
            options={[
              { value: "mine", label: "我的（本浏览器）" },
              { value: "team", label: "团队（服务器）" },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="年份" className="w-28" value={String(year)} onValueChange={(v) => setYear(Number(v))} options={yearOptions} />
            <Select aria-label="起始月份" className="w-24" value={String(startMonth)} onValueChange={(v) => setStartMonth(Number(v))} options={MONTH_OPTIONS} />
            <span className="text-sm text-muted-foreground">至</span>
            <Select aria-label="结束月份" className="w-24" value={String(endMonth)} onValueChange={(v) => setEndMonth(Number(v))} options={MONTH_OPTIONS} />
            <Button onClick={query} disabled={loading || rangeInvalid}>查询</Button>
          </div>
          {rangeInvalid ? (
            <p role="alert" className="text-sm text-destructive">起始月份不能晚于结束月份</p>
          ) : null}
        </CardContent>
      </Card>

      <div aria-live="polite" aria-busy={loading} className="space-y-4">
        {error ? <ErrorState title="统计失败" error={error} onRetry={() => void reload()} /> : null}

        {loading && !report ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : null}

        {report && !error ? (
          <div className={loading ? "space-y-4 opacity-60 transition-opacity" : "space-y-4"}>
            <h2 className="text-sm font-semibold text-foreground">
              {data?.scope === "team" ? "团队统计" : "我的统计"} · {report.year} 年 {rangeLabel(report)}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="处理票数" value={report.processedTickets} icon={<BarChart3 aria-hidden />} tone="primary" />
              <Stat label="成功分析次数" value={report.successfulRuns} icon={<Gauge aria-hidden />} />
              <Stat label="工作时间转入票数" value={report.handover.workHoursHandovers} hint="周一至周五 9:00–19:00（东八区）" />
              <Stat label="非工作时间转入票数" value={report.handover.offHoursHandovers} hint="含周末" tone="warning" />
              <Stat label="最大流转时间" value={dwellText(report.dwell.maxDwellMs)} icon={<Timer aria-hidden />} />
              <Stat label="最小流转时间" value={dwellText(report.dwell.minDwellMs)} icon={<Timer aria-hidden />} />
              <Stat label="平均流转时间" value={dwellText(report.dwell.avgDwellMs)} icon={<Timer aria-hidden />} tone="info" />
              <Stat
                label="Token（最大 / 每票平均）"
                value={`${tokenText(report.tokens.maxTokens)} / ${tokenText(report.tokens.avgTokens)}`}
                hint={`${report.tokens.tokenSampleCount} 张票有记录`}
                icon={<Coins aria-hidden />}
              />
            </div>

            {report.processedTickets === 0 ? (
              <EmptyState
                icon={<BarChart3 aria-hidden />}
                title="所选范围暂无成功处理记录"
                description={data?.scope === "team" ? "成员需要先把本地数据备份到服务器，团队统计才会包含其记录。" : "调整年份或月份范围后重新查询。"}
              />
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <SourceSummary title="Jira" description="复核状态混有 AI 判断" stats={report.jira} rateLabel="复核通过率（含 AI）" />
              <SourceSummary title="飞书项目" description="仅人工复核计入准确率" stats={report.meegle} rateLabel="人工复核准确率" />
            </div>

            {data?.scope === "team" ? <MemberTable members={data.members} /> : null}

            <Callout tone="info" title="统计口径">
              <div className="mt-1 space-y-1.5 leading-relaxed">
                <p>通过率 / 准确率 = 通过 ÷（通过 + 驳回）。未复核和无法确认人工复核的记录不进入分母。Jira 状态混有 AI 判断，不能作为人工准确率；飞书历史独有记录缺少人工时间时列为无法确认。</p>
                <p>流转时间 = 经办人停留时间，按处理票的最后一次分析取值；缺失（含历史记录、找不到接手时间）按默认 4 小时填充；流转时间恰为 4 小时的票不计入平均流转时间（最大 / 最小仍包含）。</p>
                <p>
                  Token = 该票最后一次分析与 AI 交互累计使用的 token（含图片识别；不含 AI 复核），未记录 token 的票不计入最大值与平均值。
                  接手时段按经办人改为目标人员的时间（东八区）划分：周一至周五 9:00–19:00 为工作时间，其余时间及周六周日为非工作时间；
                  找不到接手时间的票{report.handover.unknownHandovers ? `（本范围 ${report.handover.unknownHandovers} 张）` : ""}两类均不计入。
                </p>
                {data?.scope === "team" ? (
                  <p>团队合计为各成员统计之和（同一张票被多人处理时分别计入各自名下），数据来自各成员已备份到服务器的记录；尚未同步的本地数据不包含在内。</p>
                ) : (
                  <p>仅统计本地保留的成功结果，不含处理失败或其他浏览器数据。复核覆盖率使用上述分母 ÷ 处理票数；重跑计入分析次数，不重复计票。</p>
                )}
                {report.invalidRecords > 0 ? <p>已排除 {report.invalidRecords} 条身份或时间无效的记录。</p> : null}
                <p>统计时间：{formatDateTime(report.generatedAt)}（当前浏览器时区）</p>
              </div>
            </Callout>
          </div>
        ) : null}
      </div>
    </Page>
  );
}
