"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, NotebookPen, Pin, PinOff, Plus, Search, Trash2 } from "lucide-react";
import type { NoteRecord } from "@/domain/entities";
import { errorMessage } from "@/shared/lib/errors";
import { formatRelative } from "@/shared/lib/format";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import { Label } from "@/shared/ui/field";
import { EmptyState, ErrorState, Skeleton } from "@/shared/ui/feedback";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { toast } from "@/shared/ui/toast";
import { deleteNote, filterNotes, listNotes, newNoteDraft, patchNote } from "../lib/notes-service";
import { NoteEditor } from "./note-editor";

export function NotesPanel({ userId }: { userId: string }) {
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<NoteRecord | null>(null);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<NoteRecord | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setNotes(await listNotes(userId));
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const allTags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))], [notes]);
  const visible = useMemo(
    () => filterNotes(notes, { query, tag: tagFilter, archived: showArchived }),
    [notes, query, tagFilter, showArchived],
  );

  const patch = async (note: NoteRecord, changes: Partial<Pick<NoteRecord, "pinned" | "archived">>) => {
    try {
      await patchNote(note, changes);
      await load();
      if ("archived" in changes) toast.success(changes.archived ? "已归档，不再参与对话检索" : "已取消归档");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (editing) {
    return (
      <NoteEditor
        key={editing.id}
        note={editing}
        onBack={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="搜索笔记"
            placeholder="搜索标题、正文、标签…"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button variant="primary" size="icon" aria-label="新建笔记" onClick={() => setEditing(newNoteDraft(userId))}>
          <Plus aria-hidden />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Switch id="notes-archived" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="notes-archived" className="text-xs text-muted-foreground">
            已归档
          </Label>
        </div>
        {allTags.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tagFilter === t}
            onClick={() => setTagFilter(tagFilter === t ? "" : t)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs transition-colors",
              tagFilter === t
                ? "border-primary bg-primary-soft text-foreground"
                : "border-border text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            )}
          >
            #{t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : loadError ? (
          <ErrorState error={loadError} onRetry={load} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<NotebookPen aria-hidden />}
            title={showArchived ? "暂无已归档笔记" : notes.length ? "没有匹配的笔记" : "暂无笔记"}
            description={showArchived ? undefined : "笔记会自动加入对话检索，适合记录排查经验与常用结论。"}
            action={
              showArchived || notes.length ? undefined : (
                <Button size="sm" variant="primary" onClick={() => setEditing(newNoteDraft(userId))}>
                  <Plus aria-hidden />
                  新建笔记
                </Button>
              )
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((n) => (
              <li
                key={n.id}
                className={cn(
                  "rounded-md border px-3 py-2",
                  n.pinned ? "border-primary/40 bg-primary-soft" : "border-border bg-surface",
                )}
              >
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate rounded-sm text-left text-sm font-medium text-foreground hover:underline"
                    onClick={() => setEditing(n)}
                    title={n.title}
                  >
                    {n.pinned ? <Pin className="mr-1 inline size-3 text-primary" aria-label="已置顶" /> : null}
                    {n.title}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={n.pinned ? "取消置顶" : "置顶"}
                    aria-pressed={n.pinned}
                    onClick={() => void patch(n, { pinned: !n.pinned })}
                  >
                    {n.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={n.archived ? "取消归档" : "归档"}
                    onClick={() => void patch(n, { archived: !n.archived })}
                  >
                    {n.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="删除笔记" onClick={() => setPendingDelete(n)}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{n.content || "（空）"}</p>
                <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-subtle-foreground">
                  <span>{formatRelative(n.updatedAt)}更新</span>
                  {n.tags.length ? <span>{n.tags.map((t) => `#${t}`).join(" ")}</span> : null}
                  {n.versions.length ? <span>{n.versions.length} 个历史版本</span> : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="删除笔记"
        description={pendingDelete ? `确定删除「${pendingDelete.title}」及其全部历史版本吗？此操作不可撤销。` : undefined}
        confirmText="删除"
        destructive
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deleteNote(pendingDelete.id);
          await load();
        }}
      />
    </div>
  );
}
