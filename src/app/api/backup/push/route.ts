import { z } from "zod";
import { badRequest, json, parseJson, route } from "@/server/http/route";
import { requireBackupOwner } from "@/server/backup/owner";
import { pushRecords, validateRecords } from "@/server/db/mirror";

export const runtime = "nodejs";

const schema = z.object({
  clientId: z.string().optional(),
  backupRunId: z.string().optional(),
  records: z.array(z.unknown()),
});

export const POST = route(async (request) => {
  const { username } = requireBackupOwner(request);
  const body = await parseJson(request, schema);
  let records;
  try {
    records = validateRecords(body.records);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "records 无效");
  }
  return json(await pushRecords({ owner: username, clientId: body.clientId, backupRunId: body.backupRunId, records }));
}, "写入服务端数据库失败");
