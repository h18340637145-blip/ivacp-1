import { apiFetch } from "@/shared/lib/api";
import type { MonthRange } from "@/domain/analysis/annual-statistics";
import type { TeamStatistics } from "@/domain/analysis/team-statistics";
import { reviveStatistics } from "./format";

/** GET /api/statistics/team：服务端镜像中全部成员的统计 */
export async function fetchTeamStatistics(range: MonthRange): Promise<TeamStatistics> {
  const query = new URLSearchParams({
    year: String(range.year),
    startMonth: String(range.startMonth),
    endMonth: String(range.endMonth),
  });
  const payload = await apiFetch<TeamStatistics>(`/api/statistics/team?${query}`);
  return {
    ...payload,
    generatedAt: new Date(payload.generatedAt),
    total: reviveStatistics(payload.total),
    members: payload.members.map((member) => ({ owner: member.owner, statistics: reviveStatistics(member.statistics) })),
  };
}
