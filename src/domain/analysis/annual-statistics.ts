import { DEFAULT_DWELL_MS, isWorkingHoursInChina } from "./handover";

export interface StatisticsRun {
  source: "jira" | "meegle";
  resultId: string;
  ticketKey: string;
  processedAt: Date | string;
  reviewStatus: "pending" | "approved" | "rejected";
  historical?: boolean;
  manualReviewed?: boolean;
  /** 流转（停留）时间毫秒；为空时统计按默认 4 小时填充 */
  dwellMs?: number;
  /** 与 AI 交互累计使用的 token 数；历史记录或未记录时为空 */
  tokenUsage?: number;
  /** 经办人改为目标人员的时间；缺失时不计入接手时段统计 */
  handoverAt?: Date | string;
}

/** 一次开始分析（无论成功、失败或仍在进行） */
export interface StatisticsAttempt {
  source: "jira" | "meegle";
  attemptId: string;
  ticketKey: string;
  startedAt: Date | string;
}

/** 开始分析口径：含失败与进行中的分析 */
export interface AttemptStatistics {
  /** 范围内开始过分析的票数（按票去重） */
  startedTickets: number;
  /** 范围内开始分析的次数（同票重复分析分别计入） */
  startedRuns: number;
}

export interface DwellStatistics {
  maxDwellMs: number | null;
  minDwellMs: number | null;
  avgDwellMs: number | null;
  /** 参与平均值的票数（流转时间恰为 4 小时的票不计入），团队合并时作权重 */
  avgSampleCount: number;
}

export interface TokenStatistics {
  maxTokens: number | null;
  avgTokens: number | null;
  totalTokens: number;
  /** 有 token 记录的票数，团队合并时作平均值权重 */
  tokenSampleCount: number;
}

/** 转到目标经办人头上的票数：正常工作时间（周一至周五 09:00–19:00，东八区）/ 非工作时间（含周末）/ 无接手时间 */
export interface HandoverPeriodStatistics {
  workHoursHandovers: number;
  offHoursHandovers: number;
  unknownHandovers: number;
}

export interface SourceStatistics extends DwellStatistics, TokenStatistics, HandoverPeriodStatistics, AttemptStatistics {
  processedTickets: number;
  successfulRuns: number;
  approved: number;
  rejected: number;
  pending: number;
  unconfirmed: number;
  rate: number | null;
  coverage: number;
}

export interface AnnualStatistics {
  year: number;
  startMonth: number;
  endMonth: number;
  generatedAt: Date;
  jira: SourceStatistics;
  meegle: SourceStatistics;
  dwell: DwellStatistics;
  tokens: TokenStatistics;
  handover: HandoverPeriodStatistics;
  processedTickets: number;
  successfulRuns: number;
  startedTickets: number;
  startedRuns: number;
  invalidRecords: number;
}

export interface MonthRange {
  year: number;
  startMonth: number; // 1-12
  endMonth: number; // 1-12，含
}

function summarizeDwell(values: number[]): DwellStatistics {
  if (!values.length) return { maxDwellMs: null, minDwellMs: null, avgDwellMs: null, avgSampleCount: 0 };
  // 流转时间恰为 4 小时的票（含缺失时的默认填充值）不纳入平均值
  const averaged = values.filter((value) => value !== DEFAULT_DWELL_MS);
  return {
    maxDwellMs: Math.max(...values),
    minDwellMs: Math.min(...values),
    avgDwellMs: averaged.length ? averaged.reduce((sum, value) => sum + value, 0) / averaged.length : null,
    avgSampleCount: averaged.length,
  };
}

export function summarizeTokens(values: number[]): TokenStatistics {
  const totalTokens = values.reduce((sum, value) => sum + value, 0);
  return {
    maxTokens: values.length ? Math.max(...values) : null,
    avgTokens: values.length ? totalTokens / values.length : null,
    totalTokens,
    tokenSampleCount: values.length,
  };
}

export function mergeHandover(items: HandoverPeriodStatistics[]): HandoverPeriodStatistics {
  const sum = (pick: (item: HandoverPeriodStatistics) => number) => items.reduce((total, item) => total + pick(item), 0);
  return {
    workHoursHandovers: sum((item) => item.workHoursHandovers),
    offHoursHandovers: sum((item) => item.offHoursHandovers),
    unknownHandovers: sum((item) => item.unknownHandovers),
  };
}

export function calculateAnnualStatistics(
  records: StatisticsRun[],
  now = new Date(),
  range?: MonthRange,
  attempts: StatisticsAttempt[] = [],
): AnnualStatistics {
  const year = range?.year ?? now.getFullYear();
  const startMonth = range?.startMonth ?? 1;
  const endMonth = range?.endMonth ?? 12;
  const start = new Date(year, startMonth - 1, 1).getTime();
  const end = range
    ? Math.min(new Date(year, endMonth, 1).getTime() - 1, now.getTime())
    : now.getTime();
  const runs = new Map<string, StatisticsRun>();
  for (const record of records) {
    const key = `${record.source}:${record.resultId}`;
    const existing = runs.get(key);
    if (!existing || (existing.historical && !record.historical)) runs.set(key, record);
  }
  let invalidRecords = 0;
  const allDwells: number[] = [];
  const allTokens: number[] = [];
  const summarize = (source: StatisticsRun["source"]): SourceStatistics => {
    const latest = new Map<string, StatisticsRun>();
    let successfulRuns = 0;
    for (const record of runs.values()) {
      if (record.source !== source) continue;
      const time = new Date(record.processedAt).getTime();
      if (!Number.isFinite(time) || !record.ticketKey || !record.resultId) {
        invalidRecords++;
        continue;
      }
      if (time < start || time > end) continue;
      successfulRuns++;
      const previous = latest.get(record.ticketKey);
      const previousTime = previous ? new Date(previous.processedAt).getTime() : -Infinity;
      if (!previous || time > previousTime || (time === previousTime && record.resultId > previous.resultId)) {
        latest.set(record.ticketKey, record);
      }
    }
    const result: SourceStatistics = {
      processedTickets: latest.size, successfulRuns, approved: 0, rejected: 0,
      pending: 0, unconfirmed: 0, rate: null, coverage: 0,
      maxDwellMs: null, minDwellMs: null, avgDwellMs: null, avgSampleCount: 0,
      maxTokens: null, avgTokens: null, totalTokens: 0, tokenSampleCount: 0,
      workHoursHandovers: 0, offHoursHandovers: 0, unknownHandovers: 0,
      startedTickets: 0, startedRuns: 0,
    };
    const startedTickets = new Set<string>();
    const startedIds = new Set<string>();
    for (const attempt of attempts) {
      if (attempt.source !== source || !attempt.ticketKey || !attempt.attemptId || startedIds.has(attempt.attemptId)) continue;
      const time = new Date(attempt.startedAt).getTime();
      if (!Number.isFinite(time) || time < start || time > end) continue;
      startedIds.add(attempt.attemptId);
      startedTickets.add(attempt.ticketKey);
    }
    result.startedTickets = startedTickets.size;
    result.startedRuns = startedIds.size;
    const dwells = [...latest.values()].map((record) => Number.isFinite(record.dwellMs) ? record.dwellMs as number : DEFAULT_DWELL_MS);
    Object.assign(result, summarizeDwell(dwells));
    allDwells.push(...dwells);
    const tokens = [...latest.values()]
      .map((record) => record.tokenUsage)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
    Object.assign(result, summarizeTokens(tokens));
    allTokens.push(...tokens);
    for (const record of latest.values()) {
      const handoverTime = record.handoverAt ? new Date(record.handoverAt).getTime() : NaN;
      if (!Number.isFinite(handoverTime)) result.unknownHandovers++;
      else if (isWorkingHoursInChina(handoverTime)) result.workHoursHandovers++;
      else result.offHoursHandovers++;
      if (record.reviewStatus === "pending") result.pending++;
      else if (source === "meegle" && !record.manualReviewed) result.unconfirmed++;
      else result[record.reviewStatus]++;
    }
    const reviewed = result.approved + result.rejected;
    result.rate = reviewed ? result.approved / reviewed * 100 : null;
    result.coverage = latest.size ? reviewed / latest.size * 100 : 0;
    return result;
  };
  const jira = summarize("jira");
  const meegle = summarize("meegle");
  return { year, startMonth, endMonth, generatedAt: now, jira, meegle, dwell: summarizeDwell(allDwells),
    tokens: summarizeTokens(allTokens), handover: mergeHandover([jira, meegle]), invalidRecords,
    processedTickets: jira.processedTickets + meegle.processedTickets,
    successfulRuns: jira.successfulRuns + meegle.successfulRuns,
    startedTickets: jira.startedTickets + meegle.startedTickets,
    startedRuns: jira.startedRuns + meegle.startedRuns };
}