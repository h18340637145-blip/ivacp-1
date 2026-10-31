import { z } from "zod";
import type { ModelFileConfig } from "@/domain/entities";

const text = z.string().default("");
const jsonFiles = z.union([z.string(), z.array(z.string()).transform(items => items.join(", "))]).default("");

/** 规则组备份与团队模板使用相同车型文件格式，兼容旧版 JSON 数组与逗号分隔 DBC。 */
export const modelFilesSchema = z.record(z.string(), z.object({
  aliases: z.array(z.string()).optional(),
  json: jsonFiles,
  dbc: z.union([
    z.array(z.string()),
    z.string().transform(value => value.split(",").map(item => item.trim()).filter(Boolean)),
  ]).default([]),
  proto: text,
})).default({});

export function parseModelFiles(input: unknown) {
  return modelFilesSchema.parse(input);
}

/** 只匹配显式别名原文；同车型重复登记不会产生多个候选。 */
export function modelAliasCandidates(token: string, modelToFiles: Record<string, ModelFileConfig>): string[] {
  if (!token.trim()) return [];
  return Object.entries(modelToFiles)
    .filter(([, config]) => config.aliases?.includes(token))
    .map(([modelKey]) => modelKey);
}

/** 无命中或跨车型歧义时均返回 undefined，由调用方整体回退。 */
export function resolveModelAlias(token: string, modelToFiles: Record<string, ModelFileConfig>): string | undefined {
  const candidates = modelAliasCandidates(token, modelToFiles);
  return candidates.length === 1 ? candidates[0] : undefined;
}
