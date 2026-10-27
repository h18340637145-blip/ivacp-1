import { isMysqlConfigured } from "@/server/db/mysql";
import { HttpError, badRequest, json, requireSession, route } from "@/server/http/route";
import { readTeamStatistics } from "@/server/statistics/team-statistics";

export const runtime = "nodejs";

function readInt(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

/** 团队统计：?year=&startMonth=&endMonth=（默认当年 1–12 月），汇总服务端镜像中所有账号的数据 */
export const GET = route(async (request) => {
  requireSession(request);
  if (!isMysqlConfigured()) throw new HttpError(503, "服务端未配置 MYSQL_URL，无法读取团队统计");
  const params = request.nextUrl.searchParams;
  const year = readInt(params.get("year"), new Date().getFullYear());
  const startMonth = readInt(params.get("startMonth"), 1);
  const endMonth = readInt(params.get("endMonth"), 12);
  const valid = year >= 2000 && year <= 2100
    && startMonth >= 1 && startMonth <= 12 && endMonth >= 1 && endMonth <= 12 && startMonth <= endMonth;
  if (!valid) throw badRequest("年份或月份范围无效");
  try {
    return json(await readTeamStatistics({ year, startMonth, endMonth }));
  } catch (error) {
    throw new HttpError(503, error instanceof Error && error.message ? error.message : "服务端数据库不可用");
  }
}, "服务端数据库不可用");
