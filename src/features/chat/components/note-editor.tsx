"use client";

import { useState } from "react";
import { ArrowLeft, History, RotateCcw } from "lucide-react";
import type { NoteRecord } from "@/domain/entities";
import { MAX_VERSIONS } from "@/domain/knowledge/notes-core";
import { formatDateTime } from "@/shared/lib/format";
import { errorMessage } from "@/shared/lib/errors";
import { Button } from "@/shared/ui/button";
import { Field } from "@/shared/ui/field";
import { Input, Textarea } from "@/shared/ui/input";
import { EmptyState } from "@/shared/ui/feedback";
import { toast } from "@/shared/ui/toast";
import { saveNote } from "../lib/notes-service";

interface NoteEditorProps {
  note: NoteRecord;
  onBack: () => void;
  onSaved: () => void;
}

export function NoteEditor({ note, onBack, onSaved }: NoteEditorProps) {
  const [draft, setDraft] = useState(note);
  const [tagText, setTagText] = useState(note.tags.join(", "));
  const [showVersions, setShowVersions] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await saveNote(draft, tagText);
      toast.success("笔记已保存");
      onSaved();
    } catch (error) {
      toast.error(`保存失败：${errorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-4 py-2">
        <Button variant="ghost" size="icon-sm" aria-label="返回笔记列表" onClick={onBack}>
          <ArrowLeft aria-hidden />
        </Button>
        <Button
          variant={showVersions ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={showVersions}
          onClick={() => setShowVersions((v) => !v)}
        >
          <History aria-hidden />
          历史版本（{draft.versions.length}）
        </Button>
        <span className="flex-1" />
        <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>
          保存
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {showVersions ? (
          <section aria-label="历史版本" className="mb-3 rounded-md border border-border bg-surface-2 p-2">
            {draft.versions.length === 0 ? (
              <EmptyState title="暂无历史版本" description="修改标题或正文并保存后会生成历史版本。" className="py-4" />
            ) : (
              <ul className="flex flex-col">
                {draft.versions.map((v, i) => (
                  <li key={`${v.savedAt}-${i}`} className="flex items-center gap-2 py-1 text-xs">
                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatDateTime(v.savedAt)}</span>
                    <span className="min-w-0 flex-1 truncate text-foreground" title={v.title}>
                      {v.title}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDraft({ ...draft, title: v.title, content: v.content });
                        setShowVersions(false);
                        toast.info("已载入历史版本，保存后生效");
                      }}
                    >
                      <RotateCcw aria-hidden />
                      恢复
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <div className="flex flex-col gap-3">
          <Field label="标题" htmlFor="note-title">
            <Input
              id="note-title"
              placeholder="未命名笔记"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </Field>
          <Field label="标签" htmlFor="note-tags" hint="逗号分隔，最多 10 个">
            <Input id="note-tags" placeholder="例如：信号, 车型A" value={tagText} onChange={(e) => setTagText(e.target.value)} />
          </Field>
          <Field
            label="正文"
            htmlFor="note-content"
            hint={`支持 Markdown。未归档笔记会自动加入对话检索；保存时保留最近 ${MAX_VERSIONS} 个历史版本。`}
          >
            <Textarea
              id="note-content"
              placeholder="Markdown 正文…"
              className="min-h-64 font-mono text-xs leading-relaxed"
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}
