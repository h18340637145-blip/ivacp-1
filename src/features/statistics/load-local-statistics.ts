import { db } from "@/shared/db/database";
import { calculateAnnualStatistics, type AnnualStatistics, type MonthRange } from "@/domain/analysis/annual-statistics";
import { buildStatisticsRuns } from "@/domain/analysis/statistics-records";

/** 当前浏览器 IndexedDB 中的统计（处理结果 + 分析历史） */
export async function loadLocalStatistics(range?: MonthRange): Promise<AnnualStatistics> {
  return db.transaction("r", [db.processResults, db.analysisHistories], async () => {
    const [processResults, analysisHistories] = await Promise.all([db.processResults.toArray(), db.analysisHistories.toArray()]);
    return calculateAnnualStatistics(buildStatisticsRuns({ processResults, analysisHistories }), new Date(), range);
  });
}
