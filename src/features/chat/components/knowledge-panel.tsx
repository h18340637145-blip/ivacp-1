"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DatabaseZap, FileText, FileUp, Library, Search, Trash2 } from "lucide-react";
import type { KnowledgeDoc } from "@/domain/entities";
import { errorMessage } from "@/shared/lib/errors";
import { formatBytes, formatDateTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { Callout, EmptyState, ErrorState, Skeleton } from "@/shared/ui/feedback";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { toast } from "@/shared/ui/toast";
import { importProcessedHistory } from "../lib/import-history";
import {
  ACCEPTED_FILE_TYPES,
  deleteKnowledgeDoc,
  listKnowledgeDocs,
  searchDocs,
  uploadKnowledgeFiles,
} from "../lib/knowledge-service";

interface KnowledgePanelProps {
  userId: string;
  onCountChange: (count: number) => void;
}

export function KnowledgePanel({ userId, onCountChange }: KnowledgePanelProps) {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"upload" | "import" | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "warning" | "danger" | "success"; text: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<KnowledgeDoc | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await listKnowledgeDocs(userId);
      setDocs(list);
      onCountChange(list.length);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [userId, onCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => searchDocs(docs, query), [docs, query]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("upload");
    setNotice(null);
    try {
      const { added, notices } = await uploadKnowledgeFiles(userId, Array.from(files));
      if (notices.length) setNotice({ tone: "warning", text: notices.join("；") });
      if (added) toast.success(`已添加 ${added} 个文档`);
      await load();
    } catch (error) {
      setNotice({ tone: "danger", text: `上传失败：${errorMessage(error)}` });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const importHistory = async () => {
    setBusy("import");
    setNotice({ tone: "info", text: "正在导入…" });
    try {
      const r = await importProcessedHistory(userId, (d, t) => setNotice({ tone: "info", text: `正在导入 ${d}/${t}…` }));
      setNotice(
        r.total
          ? {
              tone: r.withVectors ? "success" : "warning",
              text: `已导入 ${r.total} 条（Jira ${r.jira}、飞书 ${r.meegle}、历史分析 ${r.histories}、人工标注 ${r.samples}）${r.withVectors ? "" : "；向量服务不可用，仅关键词检索"}`,
            }
          : { tone: "info", text: "本浏览器暂无已处理票、历史分析或人工标注" },
      );
      await load();
    } catch (error) {
      setNotice({ tone: "danger", text: `导入失败：${errorMessage(error)}` });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (doc: KnowledgeDoc) => {
    await deleteKnowledgeDoc(doc.id);
    await load();
    toast.success("已删除文档");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPTED_FILE_TYPES}
        hidden
        aria-hidden
        onChange={(e) => void upload(e.target.files)}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="primary" size="sm" loading={busy === "upload"} disabled={!!busy} onClick={() => fileRef.current?.click()}>
          <FileUp aria-hidden />
          上传文档
        </Button>
        <Button size="sm" variant="outline" loading={busy === "import"} disabled={!!busy} onClick={() => void importHistory()}>
          <DatabaseZap aria-hidden />
          导入处理记录
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        支持 .txt / .md / .json / .csv / .log，单个文件不超过 2MB；导入处理记录会把本浏览器中的分析结果、历史分析与人工标注加入知识库，可重复导入。
      </p>

      {notice ? <Callout tone={notice.tone}>{notice.text}</Callout> : null}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          aria-label="检索知识库"
          placeholder="检索票号、信号、结论…"
          className="pl-8"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : loadError ? (
          <ErrorState error={loadError} onRetry={load} />
        ) : docs.length === 0 ? (
          <EmptyState icon={<Library aria-hidden />} title="知识库为空" description="上传文档或导入处理记录后，对话会优先依据这些资料回答。" />
        ) : visible.length === 0 ? (
          <EmptyState icon={<Search aria-hidden />} title="没有匹配的文档" description="换个关键词试试。" />
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((d) => {
              const vector = d.chunks.some((c) => c.embedding);
              return (
                <li key={d.id} className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2">
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground" title={d.name}>
                      {d.name}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="tabular-nums">{d.chunks.length} 段</span>
                      <span className="tabular-nums">{formatBytes(d.size)}</span>
                      <span>{formatDateTime(d.createdAt)}</span>
                      <Badge tone={vector ? "success" : "neutral"}>{vector ? "向量检索" : "关键词检索"}</Badge>
                      {d.source === "import" ? <Badge tone="info">导入</Badge> : null}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label={`删除 ${d.name}`} onClick={() => setPendingDelete(d)}>
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              );
            })}
            {docs.length > visible.length && !query ? (
              <li className="text-center text-xs text-muted-foreground">仅显示前 {visible.length} 个文档，请使用检索缩小范围</li>
            ) : null}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="删除文档"
        description={pendingDelete ? `确定从知识库删除「${pendingDelete.name}」吗？此操作不可撤销。` : undefined}
        confirmText="删除"
        destructive
        onConfirm={() => (pendingDelete ? remove(pendingDelete) : undefined)}
      />
    </div>
  );
}
