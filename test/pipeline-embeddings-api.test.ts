import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/embeddings/route";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("embedding API compatibility", () => {
 it("filters invalid/blank entries then truncates the first 64 valid strings", async () => {
  vi.stubEnv("EMBEDING_BASE_URL", "https://embedding.invalid/v1/");
  const provider = vi.fn(async (_url: string, options: RequestInit) => {
   const body = JSON.parse(options.body as string);
   return Response.json({ embeddings: body.input.map(() => [1, 2]) });
  });
  vi.stubGlobal("fetch", provider);
  const input = [null, "  ", 1, ...Array.from({ length: 65 }, (_, index) => ` text-${index} `)];
  const response = await POST(new NextRequest("http://localhost/api/embeddings", { method: "POST", body: JSON.stringify({ input }) }), { params: Promise.resolve({}) });
  expect(response.status).toBe(200);
  const sent = JSON.parse(provider.mock.calls[0][1].body as string).input;
  expect(sent).toHaveLength(64); expect(sent[0]).toBe("text-0"); expect(sent[63]).toBe("text-63");
 });
});
