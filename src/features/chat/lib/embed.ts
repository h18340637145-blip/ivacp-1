/** 调用 /api/embeddings 批量向量化（每批 32 条）；任一批失败返回 null，调用方降级为关键词检索 */
export async function embedTexts(input: string[]): Promise<number[][] | null> {
  try {
    const out: number[][] = [];
    for (let i = 0; i < input.length; i += 32) {
      const batch = input.slice(i, i + 32);
      const res = await fetch("/api/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: batch }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { embeddings?: number[][] };
      if (!data.embeddings || data.embeddings.length !== batch.length) return null;
      out.push(...data.embeddings);
    }
    return out;
  } catch {
    return null;
  }
}

/** 单条向量化，失败返回 undefined */
export async function embedOne(text: string): Promise<number[] | undefined> {
  return (await embedTexts([text]))?.[0];
}
