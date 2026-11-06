import {
  calculateAnnualStatistics,
  type AnnualStatistics,
  type DwellStatistics,
  type MonthRange,
  type SourceStatistics,
  type TokenStatistics,
  mergeHandover,
} from "./annual-statistics";
import { buildStatisticsAttempts, buildStatisticsRuns, type RawStatisticsTables } from "./statistics-records";

export interface TeamMemberStatistics {
  owner: string;
  statistics: AnnualStatistics;
}

export interface TeamStatistics {
  year: number;
  startMonth: number;
  endMonth: number;
  generatedAt: Date;
  /** 各成员统计之和；同一张票被多人处理时分别计入各自名下 */
  total: AnnualStatistics;
  members: TeamMemberStatistics[];
}

function mergeDwell(items: DwellStatistics[]): DwellStatistics {
  const ranged = items.filter((item) => item.maxDwellMs !== null && item.minDwellMs !== null);
  const averaged = items.filter((item) => item.avgSampleCount > 0 && item.avgDwellMs !== null);
  const weight = averaged.reduce((sum, item) => sum + item.avgSampleCount, 0);
  return {
    maxDwellMs: ranged.length ? Math.max(...ranged.map((item) => item.maxDwellMs as number)) : null,
    minDwellMs: ranged.length ? Math.min(...ranged.map((item) => item.minDwellMs as number)) : null,
    avgDwellMs: weight ? averaged.reduce((sum, item) => sum + (item.avgDwellMs as number) * item.avgSampleCount, 0) / weight : null,
    avgSampleCount: weight,
  };
}

function mergeTokens(items: TokenStatistics[]): TokenStatistics {
  const totalTokens = items.reduce((sum, item) => sum + item.totalTokens, 0);
  const tokenSampleCount = items.reduce((sum, item) => sum + item.tokenSampleCount, 0);
  const maxima = items.filter((item) => item.maxTokens !== null).map((item) => item.maxTokens as number);
  return {
    maxTokens: maxima.length ? Math.max(...maxima) : null,
    avgTokens: tokenSampleCount ? totalTokens / tokenSampleCount : null,
    totalTokens,
    tokenSampleCount,
  };
}

export function mergeSourceStatistics(items: SourceStatistics[]): SourceStatistics {
  const sum = (pick: (item: SourceStatistics) => number) => items.reduce((total, item) => total + pick(item), 0);
  const processedTickets = sum((item) => item.processedTickets);
  const approved = sum((item) => item.approved);
  const rejected = sum((item) => item.rejected);
  const reviewed = approved + rejected;
  return {
    processedTickets,
    successfulRuns: sum((item) => item.successfulRuns),
    startedTickets: sum((item) => item.startedTickets),
    startedRuns: sum((item) => item.startedRuns),
    approved,
    rejected,
    pending: sum((item) => item.pending),
    unconfirmed: sum((item) => item.unconfirmed),
    rate: reviewed ? approved / reviewed * 100 : null,
    coverage: processedTickets ? reviewed / processedTickets * 100 : 0,
    ...mergeDwell(items),
    ...mergeTokens(items),
    ...mergeHandover(items),
  };
}

export function mergeAnnualStatistics(items: AnnualStatistics[], range: { year: number; startMonth: number; endMonth: number }, now: Date): AnnualStatistics {
  const jira = mergeSourceStatistics(items.map((item) => item.jira));
  const meegle = mergeSourceStatistics(items.map((item) => item.meegle));
  return {
    ...range,
    generatedAt: now,
    jira,
    meegle,
    dwell: mergeDwell([jira, meegle]),
    tokens: mergeTokens([jira, meegle]),
    handover: mergeHandover([jira, meegle]),
    processedTickets: jira.processedTickets + meegle.processedTickets,
    successfulRuns: jira.successfulRuns + meegle.successfulRuns,
    startedTickets: jira.startedTickets + meegle.startedTickets,
    startedRuns: jira.startedRuns + meegle.startedRuns,
    invalidRecords: items.reduce((total, item) => total + item.invalidRecords, 0),
  };
}

export function buildTeamStatistics(
  rawByOwner: Map<string, RawStatisticsTables>,
  now = new Date(),
  range?: MonthRange,
): TeamStatistics {
  const members = [...rawByOwner.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([owner, tables]) => ({ owner, statistics: calculateAnnualStatistics(buildStatisticsRuns(tables), now, range, buildStatisticsAttempts(tables)) }))
    .filter((member) => member.statistics.successfulRuns > 0 || member.statistics.startedRuns > 0 || member.statistics.invalidRecords > 0);
  const first = members[0]?.statistics ?? calculateAnnualStatistics([], now, range);
  const rangeInfo = { year: first.year, startMonth: first.startMonth, endMonth: first.endMonth };
  return {
    ...rangeInfo,
    generatedAt: now,
    total: mergeAnnualStatistics(members.map((member) => member.statistics), rangeInfo, now),
    members,
  };
}
