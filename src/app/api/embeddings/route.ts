import { z } from "zod";
import { embedTexts, normalizeEmbeddingInputs } from "@/server/ai/embeddings";
import { json, parseJson, route } from "@/server/http/route";
export const runtime = "nodejs";
const schema = z.object({ input: z.unknown().transform(normalizeEmbeddingInputs).pipe(z.array(z.string()).min(1, "缺少 input")) });
export const POST = route(async (request) => {
  const { input } = await parseJson(request, schema);
  return json(await embedTexts(input, request.signal));
}, "生成向量失败");
