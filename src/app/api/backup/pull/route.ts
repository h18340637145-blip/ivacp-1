import { z } from "zod";
import { isEntityTableName, type EntityTableName } from "@/domain/entities";
import { json, parseQuery, route } from "@/server/http/route";
import { requireBackupOwner } from "@/server/backup/owner";
import { pullRecords } from "@/server/db/mirror";

export const runtime = "nodejs";

const schema = z.object({
  table: z.string().refine(isEntityTableName, "table 无效"),
  after: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export const GET = route(async (request) => {
  const { username } = requireBackupOwner(request);
  const query = parseQuery(request, schema);
  return json(await pullRecords({
    owner: username,
    table: query.table as EntityTableName,
    afterId: query.after,
    limit: query.limit,
  }));
}, "读取服务端数据库失败");
