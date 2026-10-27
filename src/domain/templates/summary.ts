/** 团队模板库列表项：每个模板的最新版本，附累计应用次数与版本数（GET /api/templates） */
export interface TemplateSummary {
  templateKey: string;
  version: number;
  name: string;
  description: string;
  tags: string[];
  author: string;
  createdAt: string;
  checksum: string;
  applyCount: number;
  versionCount: number;
}

/** 删除权限：作者本人或管理员 */
export function canDeleteTemplate(template: Pick<TemplateSummary, "author">, actor: { username: string; isAdmin: boolean }): boolean {
  return actor.isAdmin || template.author === actor.username;
}

/** 模板库搜索：名称 / 标识 / 作者 / 描述 / 标签，大小写不敏感 */
export function filterTemplates<T extends Pick<TemplateSummary, "name" | "templateKey" | "author" | "description" | "tags">>(
  templates: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return templates;
  return templates.filter((t) =>
    [t.name, t.templateKey, t.author, t.description, ...t.tags].some((value) => value.toLowerCase().includes(q)),
  );
}

/** 逗号（中英文）或空白分隔的标签输入 → 标签数组（去重与截断由 buildTemplate 完成） */
export function parseTagInput(raw: string): string[] {
  return raw
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}
