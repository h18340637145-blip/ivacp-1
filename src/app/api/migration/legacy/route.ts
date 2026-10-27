import { z } from "zod";
import { json, parseJson, requireSession, route } from "@/server/http/route";
import { listMigrationRuns, migrateLegacyMysql } from "@/server/migration/legacy-mysql";

export const runtime = "nodejs";
export const maxDuration = 300;

/** 最近的服务端迁移记录 */
export const GET = route(async (request) => {
  requireSession(request, "admin");
  return json({ runs: await listMigrationRuns() });
}, "读取迁移记录失败");

const schema = z.object({
  overwrite: z.boolean().optional(),
  owners: z.array(z.string().min(1)).optional(),
});

/** 一键迁移旧系统 MySQL 数据（仅管理员） */
export const POST = route(async (request) => {
  const session = requireSession(request, "admin");
  const body = await parseJson(request, schema);
  const report = await migrateLegacyMysql({ ...body, operator: session.username });
  return json(report);
}, "迁移旧系统数据失败");
