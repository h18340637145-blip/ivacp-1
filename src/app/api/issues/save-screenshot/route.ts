import { z } from "zod";
import { saveChartScreenshot } from "@/server/charts/files";
import { json, parseJson, route } from "@/server/http/route";
export const runtime = "nodejs";
const schema = z.object({ issueKey: z.string().min(1), chartImagePath: z.string().min(1), imageBase64: z.string().min(1).max(28 * 1024 * 1024) });
export const POST = route(async (request) => {
  const body = await parseJson(request, schema);
  return json(await saveChartScreenshot(body.chartImagePath, body.imageBase64));
}, "保存截图失败");
