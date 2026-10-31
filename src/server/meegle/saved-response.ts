import { configurationResolutionSchema } from "@/domain/analysis/effective-configuration";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { versionVhalCheckSchema } from "@/domain/analysis/version-vhal";

const responseSchema = z.object({
  configurationResolution: configurationResolutionSchema.optional(),
  versionVhalCheck: versionVhalCheckSchema.optional(),
  issueKey: z.string(), replyText: z.string().min(1), model: z.string(), mode: z.string().optional(), elapsedMs: z.number().finite().optional(),
  stages: z.record(z.string(), z.string()).default({}), tokenUsage: z.number().finite().nonnegative().optional(), signalSummary: z.string().optional(),
  traceData: z.record(z.string(), z.object({ x: z.array(z.string()), y: z.array(z.number().finite()) })).optional(),
  ticks: z.record(z.string(), z.object({ labels: z.array(z.string()), ticks: z.array(z.number().finite()) })).optional(),
  reviewEvidence: z.object({ carModel: z.string().optional(), props: z.array(z.string()), signalTokens: z.array(z.string()), propertyIds: z.array(z.string()) }).optional(),
});

/** 只恢复当前 run 写出的字段；签名、工单身份和图片路径由服务端重新生成。 */
export async function readSavedProcessResponse(directory: string, issueKey: string, reply: string) {
  try {
    const value = responseSchema.parse(JSON.parse(await fs.readFile(path.join(directory, "process-response.json"), "utf8")));
    return value.issueKey === issueKey && value.replyText.trim() === reply.trim() ? value : undefined;
  } catch { return undefined; }
}
