import { z } from "zod";
import { isEntityTableName, type EntityTableName } from "@/domain/entities";
import { json, parseJson, route } from "@/server/http/route";
import { requireBackupOwner } from "@/server/backup/owner";
import { finalizeFullBackup } from "@/server/db/mirror";

export const runtime = "nodejs";

const schema = z.object({
  clientId: z.string().min(1),
  backupRunId: z.string().min(1),
  startedAt: z.iso.datetime(),
  tables: z.array(z.string().refine(isEntityTableName, "表名无效")).min(1),
});

export const POST = route(async (request) => {
  const { username } = requireBackupOwner(request);
  const body = await parseJson(request, schema);
  return json(await finalizeFullBackup({
    owner: username,
    clientId: body.clientId,
    backupRunId: body.backupRunId,
    startedAt: new Date(body.startedAt),
    tables: body.tables as EntityTableName[],
  }));
}, "完成备份失败");
