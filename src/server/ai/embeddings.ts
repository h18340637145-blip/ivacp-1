import { HttpError } from "@/server/http/route";

export async function embedTexts(input: string[], signal?: AbortSignal): Promise<{ model: string; embeddings: number[][] }> {
  const baseUrl = process.env.EMBEDING_BASE_URL?.replace(/\/+$/, "");
  if (!baseUrl) throw new Error("Embedding 环境变量未配置（EMBEDING_BASE_URL）");
  const model = process.env.EMBEDING_MODEL ?? "qwen3-embed-0.6b";
  const response = await fetch(baseUrl.endsWith("/embeddings") ? baseUrl : `${baseUrl}/embeddings`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${process.env.EMBEDING_API_KEY ?? "none"}` },
    body: JSON.stringify({ model, input }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) throw new HttpError(response.status, `Embedding HTTP ${response.status}: ${text.slice(0, 300)}`);
  let data: { data?: Array<{ embedding?: number[]; index?: number }>; model?: string; embeddings?: number[][] };
  try { data = JSON.parse(text); } catch { throw new HttpError(502, "Embedding 返回格式异常"); }
  const embeddings = data.embeddings ?? data.data?.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((item) => item.embedding ?? []) ?? [];
  if (embeddings.length !== input.length || embeddings.some((vector) => !Array.isArray(vector) || !vector.length || vector.some((number) => typeof number !== "number" || !Number.isFinite(number))) || embeddings.some((vector) => vector.length !== embeddings[0].length)) throw new HttpError(502, "Embedding 返回格式异常");
  return { model: data.model ?? model, embeddings };
}

/** 与旧接口兼容：先过滤空白及非字符串，再截取前 64 条。 */
export function normalizeEmbeddingInputs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 64);
}
