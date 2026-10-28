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
});
export async function loadTerminalConfiguration(signal: AbortSignal): Promise<{
  targets: PublicRemoteShellTarget[];
  projects: TerminalProject[];
}> {
  const [targetData, projectData] = await Promise.all([
    apiFetch<unknown>("/api/terminal/targets", { signal }),
    apiFetch<unknown>("/api/terminal/projects", { signal }),
  ]);
  const targets = targetsSchema.safeParse(targetData);
  const projects = projectsSchema.safeParse(projectData);
  if (!targets.success || !projects.success)
    throw new Error("终端配置格式无效，请检查目标和项目配置后重试。");
  return { targets: targets.data.targets, projects: projects.data.projects };
}
export function resolveGatewayUrl() {
  const configured = process.env.NEXT_PUBLIC_REMOTE_SHELL_GATEWAY_URL?.trim();
  if (configured) return configured;
  if (typeof window === "undefined") return "ws://localhost:39222";
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:39222`;
}
