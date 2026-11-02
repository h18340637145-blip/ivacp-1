import { apiFetch } from "@/shared/lib/api";
import type {
  PublicRemoteShellTarget,
  TerminalProject,
} from "@/domain/terminal/types";
import { z } from "zod";
const targetsSchema = z.object({
  targets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      environment: z.string(),
      riskLevel: z.enum(["normal", "critical"]),
      guardMode: z.enum(["soft", "strict"]),
    }),
  ),
});
const projectsSchema = z.object({
  projects: z.array(
    z.object({
      projectName: z.string(),
      mainPath: z.string(),
      scriptPath: z.string(),
      branches: z.array(
        z.object({
          name: z.string(),
          syncedVhal: z.object({ targetId: z.string(), raw: z.string().regex(/^\d{8}$/), platform: z.string(), version: z.string() }).optional(),
          repos: z.array(
            z.object({
              repoName: z.string(),
              repoPath: z.string(),
              branchName: z.string(),
              origin: z.string().optional(),
            }),
          ),
        }),
      ),
    }),
  ),
  configMissing: z.boolean(),
  canImportCanonical: z.boolean(),
});
export interface TerminalProjectConfig {
  projects: TerminalProject[];
  configMissing: boolean;
  canImportCanonical: boolean;
}
/** 加载可连接的终端目标列表（任意已登录用户可读） */
export async function loadTerminalTargets(signal: AbortSignal): Promise<PublicRemoteShellTarget[]> {
  const data = await apiFetch<unknown>("/api/terminal/targets", { signal });
  const parsed = targetsSchema.safeParse(data);
  if (!parsed.success) throw new Error("终端目标配置格式无效，请检查服务器配置后重试。");
  return parsed.data.targets;
}
/** 按目标加载当前生效的项目配置（named_first），附带缺失与可写位置信息 */
export async function loadTerminalProjects(targetId: string, signal: AbortSignal): Promise<TerminalProjectConfig> {
  const data = await apiFetch<unknown>(`/api/terminal/projects?target=${encodeURIComponent(targetId)}`, { signal });
  const parsed = projectsSchema.safeParse(data);
  if (!parsed.success) throw new Error("终端项目配置格式无效，请检查服务器配置后重试。");
  return { projects: parsed.data.projects, configMissing: parsed.data.configMissing, canImportCanonical: parsed.data.canImportCanonical };
}
const importResultSchema = z.object({
  file: z.string(),
  backup: z.string().nullable(),
  scope: z.enum(["canonical", "named"]),
  projectCount: z.number(),
});
/** 导入 project.json 到服务端（管理员写规范文件，其它用户写目标专属文件） */
export async function importProjectConfig(targetId: string, projects: unknown[], signal?: AbortSignal) {
  const data = await apiFetch<unknown>("/api/terminal/projects/import", {
    method: "POST",
    body: JSON.stringify({ targetId, projects }),
    signal,
  });
  const parsed = importResultSchema.safeParse(data);
  if (!parsed.success) throw new Error("导入结果格式无效，请刷新后确认配置是否写入。");
  return parsed.data;
}
/** 触发浏览器下载当前生效的 project.json */
export async function exportProjectConfig(targetId: string) {
  const response = await fetch(`/api/terminal/projects/export?target=${encodeURIComponent(targetId)}`, {
    credentials: "same-origin",
  });
  if (!response.ok) {
    let message = "导出失败，请稍后重试。";
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* 保留默认文案 */
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const fileName = match?.[1] ?? "project.json";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return fileName;
}
export function resolveGatewayUrl() {
  const configured = process.env.NEXT_PUBLIC_REMOTE_SHELL_GATEWAY_URL?.trim();
  if (configured) return configured;
  if (typeof window === "undefined") return "ws://localhost:39222";
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:39222`;
}
