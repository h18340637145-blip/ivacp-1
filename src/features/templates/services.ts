import { apiFetch } from "@/shared/lib/api";
import type { RuleGroupTemplate } from "@/domain/templates/rule-group-template";
import type { TemplateSummary } from "@/domain/templates/summary";

const base = (key: string) => `/api/templates/${encodeURIComponent(key)}`;

export async function fetchTemplates(): Promise<TemplateSummary[]> {
  return (await apiFetch<{ templates: TemplateSummary[] }>("/api/templates")).templates;
}

export async function fetchTemplate(templateKey: string, version?: number): Promise<RuleGroupTemplate> {
  const query = version ? `?version=${version}` : "";
  return (await apiFetch<{ template: RuleGroupTemplate }>(`${base(templateKey)}${query}`)).template;
}

export async function publishTemplate(template: RuleGroupTemplate): Promise<{ template: RuleGroupTemplate; created: boolean }> {
  return apiFetch("/api/templates", { method: "POST", json: template });
}

export async function deleteTemplate(templateKey: string): Promise<void> {
  await apiFetch(base(templateKey), { method: "DELETE" });
}

/** 记录应用次数；失败不影响已创建的规则组 */
export async function markTemplateApplied(templateKey: string, version: number): Promise<void> {
  await apiFetch(`${base(templateKey)}/applied`, { method: "POST", json: { version } }).catch(() => undefined);
}

export function downloadTemplateFile(fileName: string, template: RuleGroupTemplate) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
