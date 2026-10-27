"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Download, FileUp, Search, Trash2, Upload, Wand2 } from "lucide-react";
import type { RuleGroup } from "@/domain/entities";
import {
  buildTemplate,
  parseTemplate,
  slugifyTemplateKey,
  templateFileName,
  templateToRuleGroupInput,
  type RuleGroupTemplate,
} from "@/domain/templates/rule-group-template";
import { canDeleteTemplate, filterTemplates, parseTagInput, type TemplateSummary } from "@/domain/templates/summary";
import { useSession } from "@/features/auth/session-store";
import { useRuleGroups } from "@/features/rule-groups/store";
import { useAction } from "@/shared/hooks/use-action";
import { useAsync } from "@/shared/hooks/use-async";
import { formatDate } from "@/shared/lib/format";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Page,
  PageHeader,
  Select,
  Skeleton,
  Tooltip,
} from "@/shared/ui";
import {
  deleteTemplate,
  downloadTemplateFile,
  fetchTemplate,
  fetchTemplates,
  markTemplateApplied,
  publishTemplate,
} from "../services";

const appliedMessage = (template: RuleGroupTemplate) =>
  `已应用为新规则组「${template.name}（模板 v${template.version}）」，请核对 CAN 配置路径后使用`;

export function TemplateLibraryView() {
  const { username, can } = useSession();
  const canManage = can("admin");
  const { ruleGroups, add } = useRuleGroups();
  const library = useAsync(fetchTemplates, []);

  const [groupId, setGroupId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState<{ message: string; groupId: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TemplateSummary | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedGroup = ruleGroups.find((group) => group.id === groupId);
  const visible = filterTemplates(library.data ?? [], query);

  function selectGroup(id: string) {
    setGroupId(id);
    const group = ruleGroups.find((item) => item.id === id);
    if (group) setName(group.name);
  }

  function localTemplate(group: RuleGroup): RuleGroupTemplate {
    const finalName = name.trim() || group.name;
    return buildTemplate(group, {
      templateKey: slugifyTemplateKey(finalName),
      version: 1,
      name: finalName,
      description,
      tags: parseTagInput(tags),
      author: username,
    });
  }

  async function applyTemplate(template: RuleGroupTemplate) {
    const group = await add(templateToRuleGroupInput(template));
    const message = appliedMessage(template);
    setApplied({ message, groupId: group.id });
    return message;
  }

  const publish = useAction(
    async () => {
      if (!selectedGroup) throw new Error("请先选择要发布的规则组");
      const { template, created } = await publishTemplate(localTemplate(selectedGroup));
      await library.reload();
      return created
        ? `已发布「${template.name}」v${template.version}`
        : `配置与「${template.name}」v${template.version} 相同，未生成新版本`;
    },
    { success: (message) => message, error: "发布失败" },
  );

  const exportFile = useAction(
    async () => {
      if (!selectedGroup) throw new Error("请先选择要导出的规则组");
      const template = localTemplate(selectedGroup);
      downloadTemplateFile(templateFileName(template), template);
      return `已导出模板文件：${templateFileName(template)}`;
    },
    { success: (message) => message, error: "导出失败" },
  );

  const importFile = useAction(
    async (file: File) => {
      if (!canManage) throw new Error("仅管理员可应用模板");
      const template = parseTemplate(JSON.parse(await file.text()));
      return applyTemplate(template);
    },
    { success: "已从文件应用模板", error: "应用失败" },
  );

  const applyRemote = useAction(
    async (item: TemplateSummary) => {
      setBusyKey(item.templateKey);
      try {
        const template = await fetchTemplate(item.templateKey);
        const message = await applyTemplate(template);
        await markTemplateApplied(template.templateKey, template.version);
        await library.reload();
        return message;
      } finally {
        setBusyKey(null);
      }
    },
    { success: "已应用模板", error: "应用失败" },
  );

  const downloadRemote = useAction(
    async (item: TemplateSummary) => {
      const template = await fetchTemplate(item.templateKey);
      downloadTemplateFile(templateFileName(template), template);
      return `已下载 ${templateFileName(template)}`;
    },
    { success: (message) => message, error: "下载失败" },
  );

  const removeRemote = useAction(
    async (item: TemplateSummary) => {
      await deleteTemplate(item.templateKey);
      await library.reload();
      return `已删除「${item.name}」`;
    },
    { success: (message) => message, error: "删除失败" },
  );

  return (
    <Page>
      <PageHeader
        title="团队模板库"
        description="把「JQL / MQL + 提示词 + 车型文件路径」打包成模板，团队成员一键复用；重复发布同名模板会生成新版本。"
      />

      {applied ? (
        <Callout tone="success" title="模板已应用" className="mb-4">
          <p>
            {applied.message}。
            <Link href={`/rule-groups/${applied.groupId}`} className="ml-1 text-primary underline-offset-4 hover:underline">
              查看规则组
            </Link>
          </p>
        </Callout>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="h-fit">
          <CardHeader>
            <div>
              <CardTitle>发布 / 导出我的规则组</CardTitle>
              <CardDescription>模板包含提示词与本机文件路径，不含凭据和票据数据；发布后全组成员可见。</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="规则组" htmlFor="tpl-group" required>
              <Select
                id="tpl-group"
                aria-label="选择规则组"
                placeholder={ruleGroups.length ? "选择规则组…" : "暂无规则组"}
                value={groupId}
                onValueChange={selectGroup}
                options={ruleGroups.map((group) => ({ value: group.id, label: group.name }))}
              />
            </Field>
            <Field label="模板名称" htmlFor="tpl-name" hint="默认同规则组名称；同名模板再次发布会生成新版本">
              <Input id="tpl-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="模板名称" />
            </Field>
            <Field label="适用场景说明" htmlFor="tpl-desc">
              <Input id="tpl-desc" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder="可选" />
            </Field>
            <Field label="标签" htmlFor="tpl-tags" hint="逗号或空格分隔，最多 8 个">
              <Input id="tpl-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="例如：吉利, CAN" />
            </Field>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="primary" onClick={() => void publish()} loading={publish.pending} disabled={!groupId}>
                {!publish.pending && <Upload aria-hidden />}发布到团队库
              </Button>
              <Button variant="outline" onClick={() => void exportFile()} disabled={!groupId}>
                <Download aria-hidden />导出模板文件
              </Button>
              <Tooltip content={canManage ? "从模板文件创建新规则组" : "仅管理员可应用模板"}>
                <span tabIndex={canManage ? -1 : 0}>
                  <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={!canManage} loading={importFile.pending}>
                    {!importFile.pending && <FileUp aria-hidden />}从文件应用
                  </Button>
                </span>
              </Tooltip>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-label="选择模板文件"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void importFile(file);
                }}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <div>
              <CardTitle>团队库{library.data ? `（${visible.length}）` : ""}</CardTitle>
              <CardDescription>每个模板显示最新版本；应用会创建一个新的规则组，不影响已有规则组</CardDescription>
            </div>
            <div className="relative w-full sm:w-60">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
              <Input
                aria-label="搜索模板"
                placeholder="搜索名称 / 标签 / 作者"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {library.error ? <ErrorState title="无法读取团队模板库" error={library.error} onRetry={() => void library.reload()} /> : null}
            {library.loading && !library.data ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24" />)}
              </div>
            ) : null}
            {library.data && !library.error && visible.length === 0 ? (
              <EmptyState
                icon={<Wand2 aria-hidden />}
                title={query ? "没有匹配的模板" : "暂无模板"}
                description={query ? "换个关键字试试。" : "在左侧选择规则组并发布，团队成员即可一键复用。"}
              />
            ) : null}
            <ul className="space-y-2">
              {visible.map((item) => (
                <li key={item.templateKey} className="rounded-md border border-border p-3 transition-colors hover:border-border-strong">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-foreground">
                      {item.name}
                      <Badge tone="neutral" className="ml-2 align-middle">v{item.version}</Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.author} · {formatDate(item.createdAt)} · 共 <span className="tabular">{item.versionCount}</span> 个版本 · 已应用{" "}
                      <span className="tabular">{item.applyCount}</span> 次
                    </p>
                  </div>
                  {item.description ? <p className="mt-1 text-sm text-muted-foreground">{item.description}</p> : null}
                  {item.tags.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {item.tags.map((tag) => <Badge key={tag} tone="outline">#{tag}</Badge>)}
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Tooltip content={canManage ? "创建为新规则组" : "仅管理员可应用模板"}>
                      <span tabIndex={canManage ? -1 : 0}>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canManage || (busyKey !== null && busyKey !== item.templateKey)}
                          loading={busyKey === item.templateKey}
                          onClick={() => void applyRemote(item)}
                        >
                          应用
                        </Button>
                      </span>
                    </Tooltip>
                    <Button size="sm" variant="ghost" onClick={() => void downloadRemote(item)}>
                      <Download aria-hidden />下载
                    </Button>
                    {canDeleteTemplate(item, { username, isAdmin: canManage }) ? (
                      <Button size="sm" variant="destructive-outline" onClick={() => setPendingDelete(item)}>
                        <Trash2 aria-hidden />删除
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="删除模板"
        description={pendingDelete ? `确认从团队库删除「${pendingDelete.name}」的全部版本？已应用生成的规则组不受影响。` : undefined}
        confirmText="删除"
        destructive
        onConfirm={async () => {
          if (pendingDelete) await removeRemote(pendingDelete);
        }}
      />
    </Page>
  );
}
