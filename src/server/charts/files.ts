import fs from "node:fs/promises";
import path from "node:path";
import { badRequest, notFound } from "@/server/http/route";

export function resolveChartImageFile(chartImagePath: string): string | null {
  const prefix = "/api/charts/";
  if (!chartImagePath.startsWith(prefix)) return null;
  const relative = chartImagePath.slice(prefix.length);
  if (!relative.startsWith("log/") || relative.includes("\\") || relative.includes("%") || relative.includes("\0") || relative.split("/").some((segment) => segment === "." || segment === "..")) return null;
  const root = path.resolve(process.cwd(), "log");
  const file = path.resolve(root, relative.slice("log/".length));
  const contained = path.relative(root, file);
  if (!contained || contained.startsWith("..") || path.isAbsolute(contained) || !file.endsWith(".png")) return null;
  return file;
}

/** 解析真实路径，阻止通过日志目录内的符号链接访问目录外文件。 */
export async function resolveExistingChartFile(chartImagePath: string): Promise<string> {
  const file = resolveChartImageFile(chartImagePath);
  if (!file) throw badRequest("图片路径无效");
  let real: string;
  try { real = await fs.realpath(file); } catch { throw notFound("图片不存在"); }
  const root = await fs.realpath(path.resolve(process.cwd(), "log"));
  const relative = path.relative(root, real);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw badRequest("图片路径无效");
  return real;
}

export async function readChart(chartImagePath: string): Promise<Uint8Array> {
  return new Uint8Array(await fs.readFile(await resolveExistingChartFile(chartImagePath)));
}

export async function saveChartScreenshot(chartImagePath: string, imageBase64: string) {
  const file = await resolveExistingChartFile(chartImagePath);
  const encoded = imageBase64.replace(/^data:image\/png;base64,/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw badRequest("截图不是有效的 PNG 数据");
  const data = Buffer.from(encoded, "base64");
  if (data.length > 20 * 1024 * 1024 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw badRequest("截图不是有效的 PNG 数据或超过 20MB");
  await fs.writeFile(file, data);
  return { success: true, path: file, chartImagePath };
}
