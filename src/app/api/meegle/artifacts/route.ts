import { z } from "zod";
import { json, parseQuery, requireSession, route } from "@/server/http/route";
import { readMeegleArtifacts } from "@/server/meegle/artifacts";

export const runtime = "nodejs";

const schema = z.object({
  artifactRef: z.string().min(1, "artifactRef 为必填项"),
  file: z.string().optional(),
});

/** 列出 / 读取分析运行产物（白名单文件） */
export const GET = route(async (request) => {
  requireSession(request);
  const { artifactRef, file } = parseQuery(request, schema);
  return json(await readMeegleArtifacts(artifactRef, file));
}, "读取分析产物失败");
