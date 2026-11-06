import type { AnnualStatistics, SourceStatistics } from "./annual-statistics";

export interface ReportMember {
  owner: string;
  statistics: AnnualStatistics;
}

const pct = (value: number | null) => (value === null ? "暂无数据" : `${value.toFixed(1)}%`);

function dwell(ms: number | null): string {
  if (ms === null) return "暂无数据";
  const minutes = Math.round(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return `${days ? `${days} 天 ` : ""}${hours} 小时 ${minutes % 60} 分`;
}

const tokenText = (value: number | null) => (value === null ? "暂无数据" : Math.round(value).toLocaleString("zh-CN"));

function sourceLine(label: string, s: SourceStatistics): string {
  return `| ${label} | ${s.processedTickets} | ${s.successfulRuns} | ${s.startedTickets} | ${s.startedRuns} | ${s.approved} | ${s.rejected} | ${s.pending} | ${pct(s.rate)} | ${pct(s.coverage)} |`;
}

/** 生成可粘贴到飞书 / Docupedia / 邮件的 Markdown 统计报告 */
export function buildStatisticsReport(input: {
  title: string;
  total: AnnualStatistics;
  members?: ReportMember[];
}): string {
  const { total, members = [] } = input;
  const range = total.startMonth === 1 && total.endMonth === 12 ? "全年" : `${total.startMonth}–${total.endMonth} 月`;
  const lines = [
    `# ${input.title}（${total.year} 年 ${range}）`,
    "",
    `- 处理票数：**${total.processedTickets}**，成功分析次数：**${total.successfulRuns}**`,
    `- 开始分析票数（含失败）：**${total.startedTickets}**，分析次数（含重复与失败）：**${total.startedRuns}**`,
    `- 流转时间：平均 ${dwell(total.dwell.avgDwellMs)}，最长 ${dwell(total.dwell.maxDwellMs)}，最短 ${dwell(total.dwell.minDwellMs)}`,
    `- Token：最大 ${tokenText(total.tokens.maxTokens)}，平均每票 ${tokenText(total.tokens.avgTokens)}（${total.tokens.tokenSampleCount} 张票有记录）`,
    `- 接手时段：工作时间（周一至周五 9:00–19:00）${total.handover.workHoursHandovers} 张，非工作时间（含周末）${total.handover.offHoursHandovers} 张`,
    "",
    "| 来源 | 处理票数 | 成功分析次数 | 开始分析票数 | 分析次数 | 通过 | 驳回 | 未复核 | 通过率 | 覆盖率 |",
    "|---|---|---|---|---|---|---|---|---|---|",
    sourceLine("Jira", total.jira),
    sourceLine("飞书项目", total.meegle),
  ];
  if (members.length > 0) {
    lines.push("", "## 成员明细", "", "| 成员 | 处理票数 | 成功分析次数 | 开始分析票数 | 分析次数 | 通过 | 驳回 | 未复核 | 通过率 | 覆盖率 |", "|---|---|---|---|---|---|---|---|---|---|");
    for (const { owner, statistics: m } of members) {
      const approved = m.jira.approved + m.meegle.approved;
      const rejected = m.jira.rejected + m.meegle.rejected;
      const pending = m.jira.pending + m.meegle.pending;
      const denominator = approved + rejected;
      const rate = denominator ? (approved / denominator) * 100 : null;
      const coverage = m.processedTickets ? (denominator / m.processedTickets) * 100 : 0;
      lines.push(`| ${owner} | ${m.processedTickets} | ${m.successfulRuns} | ${m.startedTickets} | ${m.startedRuns} | ${approved} | ${rejected} | ${pending} | ${pct(rate)} | ${pct(coverage)} |`);
    }
  }
  lines.push(
    "",
    "> 通过率 = 通过 ÷（通过 + 驳回）；未复核不进入分母。开始分析票数 / 分析次数含分析失败与进行中，分析次数含同票重复分析。团队合计为各成员之和，仅含已备份到服务器的记录。",
    `> 生成时间：${total.generatedAt.toLocaleString("zh-CN")}`,
    "",
  );
  return lines.join("\n");
}
