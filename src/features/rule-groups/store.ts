"use client";

import { arrayMove } from "@dnd-kit/sortable";
import { useEffect } from "react";
import { create } from "zustand";
import type { RuleGroup } from "@/domain/entities";
import { parseRuleGroupImport } from "@/domain/rule-groups/import";
import { db } from "@/shared/db/database";
import { downloadBlob } from "@/shared/db/sync";
import { newId } from "@/shared/lib/ids";
import { errorMessage } from "@/shared/lib/errors";

/** 规则组导出文件（与旧版 rule-groups-*.json 兼容） */
export interface RuleGroupExportFile {
  version: "1.0";
  exportedAt: string;
  ruleGroups: RuleGroup[];
}

export interface RuleGroupImportResult {
  added: number;
  updated: number;
}

export type RuleGroupInput = Omit<RuleGroup, "id" | "sortOrder" | "createdAt" | "updatedAt">;

interface RuleGroupState {
  ruleGroups: RuleGroup[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  add: (input: RuleGroupInput) => Promise<RuleGroup>;
  update: (id: string, patch: Partial<Omit<RuleGroup, "id" | "createdAt">>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reorder: (activeId: string, overId: string) => Promise<void>;
  exportFile: () => void;
  importFile: (file: File, mode: "merge" | "overwrite") => Promise<RuleGroupImportResult>;
}

/**
 * 规则组仓库：IndexedDB 为唯一数据源，store 只做缓存与排序。
 * 所有功能（看板、飞书项目、模板库、工单详情）都通过它读写规则组。
 */
export const useRuleGroupStore = create<RuleGroupState>((set, get) => ({
  ruleGroups: [],
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const ruleGroups = await db.ruleGroups.orderBy("sortOrder").toArray();
      set({ ruleGroups, loaded: true });
    } catch (error) {
      set({ error: errorMessage(error), loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  add: async (input) => {
    const now = new Date();
    const groups = await db.ruleGroups.toArray();
    const group: RuleGroup = {
      ...input,
      id: newId(),
      sortOrder: groups.length > 0 ? Math.max(...groups.map((item) => item.sortOrder)) + 1 : 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.ruleGroups.add(group);
    await get().load();
    return group;
  },

  update: async (id, patch) => {
    await db.ruleGroups.update(id, { ...patch, updatedAt: new Date() });
    await get().load();
  },

  remove: async (id) => {
    await db.ruleGroups.delete(id);
    await get().load();
  },

  reorder: async (activeId, overId) => {
    const groups = get().ruleGroups;
    const from = groups.findIndex((group) => group.id === activeId);
    const to = groups.findIndex((group) => group.id === overId);
    if (from === -1 || to === -1 || from === to) return;
    const now = new Date();
    const reordered = arrayMove(groups, from, to).map((group, index) => ({ ...group, sortOrder: index, updatedAt: now }));
    await db.transaction("rw", "ruleGroups", () => db.ruleGroups.bulkPut(reordered));
    set({ ruleGroups: reordered });
  },

  exportFile: () => {
    const payload: RuleGroupExportFile = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      ruleGroups: get().ruleGroups,
    };
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `rule-groups-${date}.json`);
  },

  importFile: async (file, mode) => {
    const incoming = parseRuleGroupImport(JSON.parse(await file.text()));
    const now = new Date();
    const normalize = (group: RuleGroup): RuleGroup => ({
      ...group,
      createdAt: group.createdAt ? new Date(group.createdAt) : now,
      updatedAt: now,
    });
    const result: RuleGroupImportResult = { added: 0, updated: 0 };

    await db.transaction("rw", "ruleGroups", async () => {
      if (mode === "overwrite") {
        await db.ruleGroups.clear();
        await db.ruleGroups.bulkAdd(incoming.map((group, index) => ({ ...normalize(group), sortOrder: index })));
        result.added = incoming.length;
      } else {
        const existing = await db.ruleGroups.toArray();
        const existingIds = new Set(existing.map((group) => group.id));
        const existingById = new Map(existing.map((group) => [group.id, group]));
        let order = existing.length > 0 ? Math.max(...existing.map((group) => group.sortOrder)) + 1 : 0;
        const rows = incoming.map((group) => {
          if (existingIds.has(group.id)) {
            result.updated += 1;
            const current = existingById.get(group.id)!;
            return { ...normalize(group), sortOrder: current.sortOrder, createdAt: current.createdAt };
          }
          result.added += 1;
          return { ...normalize(group), sortOrder: order++ };
        });
        await db.ruleGroups.bulkPut(rows);
      }
    });
    await get().load();
    return result;
  },
}));

/** 读取规则组；首次使用时自动从 IndexedDB 加载 */
export function useRuleGroups() {
  const state = useRuleGroupStore();
  const { loaded, loading, load } = state;
  useEffect(() => {
    if (!loaded && !loading) void load();
  }, [loaded, loading, load]);
  return state;
}
