import { z } from "zod";

const text = z.string().default("");
const jsonFiles = z.union([z.string(), z.array(z.string()).transform(items => items.join(", "))]).default("");

/** 规则组备份与团队模板使用相同车型文件格式，兼容旧版 JSON 数组与逗号分隔 DBC。 */
export const modelFilesSchema = z.record(z.string(), z.object({
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
