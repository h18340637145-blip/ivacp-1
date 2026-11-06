import { db } from "@/shared/db/database";
import { calculateAnnualStatistics, type AnnualStatistics, type MonthRange } from "@/domain/analysis/annual-statistics";
import { buildStatisticsAttempts, buildStatisticsRuns } from "@/domain/analysis/statistics-records";

/** 当前浏览器 IndexedDB 中的统计（处理结果 + 分析历史 + 分析任务） */
export async function loadLocalStatistics(range?: MonthRange): Promise<AnnualStatistics> {
  return db.transaction("r", [db.processResults, db.analysisHistories, db.snapshots, db.assignments, db.processTasks], async () => {
    const [processResults, analysisHistories, snapshots, assignments, processTasks] = await Promise.all([
      db.processResults.toArray(), db.analysisHistories.toArray(), db.snapshots.toArray(), db.assignments.toArray(), db.processTasks.toArray(),
    ]);
    const tables = { processResults, analysisHistories, snapshots, assignments, processTasks };
    return calculateAnnualStatistics(buildStatisticsRuns(tables), new Date(), range, buildStatisticsAttempts(tables));
  });
}
