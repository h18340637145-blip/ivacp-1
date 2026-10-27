"use client";

import type { Table } from "dexie";
import { ENTITY_TABLES, recordPrimaryKey, type EntityTableName } from "@/domain/entities";
import {
  BACKUP_FILE_FORMAT,
  BACKUP_FILE_VERSION,
  chunkBySize,
  parseBackupFile,
  type BackupFile,
  type BackupTables,
} from "@/domain/storage/backup-format";
import { deserializeRecord, serializeRecord } from "@/domain/storage/serialization";
import { apiFetch } from "@/shared/lib/api";
import { db } from "./database";

/**
 * IndexedDB ↔ 服务端 MySQL 镜像同步。
 * - 自动增量：Dexie hook 记录脏 id，3 秒去抖后推送；失败 60 秒后重试。
 * - 完整备份 / 恢复、文件导出 / 导入。
 */

const CLIENT_ID_KEY = "ivacp_backup_client_id";
const PENDING_KEY = "ivacp_backup_pending";
const FULL_BACKUP_AT_KEY = "ivacp_backup_full_at";
const LAST_SYNC_AT_KEY = "ivacp_backup_last_sync_at";
const BATCH_BYTES = 2 * 1024 * 1024;
const FLUSH_DELAY_MS = 3000;
const RETRY_DELAY_MS = 60_000;
const PULL_PAGE_SIZE = 200;

export interface ServerBackupStatus {
  configured: boolean;
  available?: boolean;
  owner?: string;
  tables?: Array<{ table: string; total: number; lastUpdated: string | null }>;
  clients?: Array<{ clientId: string; lastPushAt: string | null; lastFullBackupAt: string | null }>;
  owners?: Array<{ owner: string; total: number; lastUpdated: string | null }>;
  error?: string;
}

export interface AutoSyncState {
  enabled: boolean;
  pending: number;
  syncing: boolean;
  lastSyncAt: string | null;
  lastFullBackupAt: string | null;
  lastError: string | null;
}

export type ProgressHandler = (message: string) => void;

interface PushRecord {
  table: EntityTableName;
  id: string;
  data?: string;
  deleted?: boolean;
}

type AnyRow = Record<string, unknown>;

function table(name: EntityTableName): Table<AnyRow, string> {
  return db.table(name) as Table<AnyRow, string>;
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function getBackupClientId(): string {
  const storage = safeStorage();
  const existing = storage?.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  storage?.setItem(CLIENT_ID_KEY, id);
  return id;
}

export async function fetchServerBackupStatus(): Promise<ServerBackupStatus> {
  try {
    return await apiFetch<ServerBackupStatus>("/api/backup/status");
  } catch (error) {
    return { configured: true, available: false, error: error instanceof Error ? error.message : "服务端不可用" };
  }
}

async function pushBatches(records: PushRecord[], backupRunId?: string, onBatch?: (done: number) => void) {
  let done = 0;
  for (const batch of chunkBySize(records, BATCH_BYTES)) {
    await apiFetch("/api/backup/push", {
      method: "POST",
      json: { clientId: getBackupClientId(), backupRunId, records: batch },
    });
    done += batch.length;
    onBatch?.(done);
  }
}

// ─── 写入工具（文件导入 / 服务端恢复 / 旧库迁移共用） ─────────────────────────

/** 把一组表数据合并写入 IndexedDB；overwrite=false 时只补齐本地缺失的记录 */
export async function writeTables(
  tables: BackupTables,
  options: { overwrite: boolean },
  onProgress?: ProgressHandler,
): Promise<{ written: number; total: number }> {
  let written = 0;
  let total = 0;
  for (const name of ENTITY_TABLES) {
    const rows = (tables[name] ?? []) as unknown as AnyRow[];
    if (rows.length === 0) continue;
    onProgress?.(`正在写入 ${name}（${rows.length} 条）...`);
    total += rows.length;
    written += await mergeRows(name, rows, options.overwrite);
  }
  return { written, total };
}

async function mergeRows(name: EntityTableName, rows: AnyRow[], overwrite: boolean): Promise<number> {
  if (rows.length === 0) return 0;
  if (overwrite) {
    await table(name).bulkPut(rows);
    return rows.length;
  }
  const existing = await table(name).bulkGet(rows.map((row) => recordPrimaryKey(name, row)));
  const missing = rows.filter((_, index) => !existing[index]);
  if (missing.length > 0) await table(name).bulkPut(missing);
  return missing.length;
}

export async function countLocalRecords(): Promise<number> {
  let total = 0;
  for (const name of ENTITY_TABLES) total += await table(name).count();
  return total;
}

// ─── 文件导出 / 导入 ─────────────────────────────────────────────────────────

export async function exportBackupFile(onProgress?: ProgressHandler): Promise<{ fileName: string; total: number }> {
  const tables: BackupTables = {};
  let total = 0;
  for (const name of ENTITY_TABLES) {
    onProgress?.(`正在读取 ${name}...`);
    const rows = await table(name).toArray();
    (tables as Record<string, unknown[]>)[name] = rows;
    total += rows.length;
  }
  const file: BackupFile = {
    format: BACKUP_FILE_FORMAT,
    version: BACKUP_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `ivacp-backup-${stamp}.json`;
  downloadBlob(new Blob([serializeRecord(file)], { type: "application/json" }), fileName);
  return { fileName, total };
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 导入备份文件；兼容旧系统备份（自动迁移为新结构） */
export async function importBackupFile(
  file: File,
  options: { overwrite: boolean },
  onProgress?: ProgressHandler,
): Promise<{ written: number; total: number; legacy: boolean }> {
  const backup = parseBackupFile(await file.text());
  if (backup.legacyReport) onProgress?.("检测到旧系统备份，已转换为新数据结构");
  const result = await writeTables(backup.tables, options, onProgress);
  return { ...result, legacy: Boolean(backup.legacyReport) };
}

// ─── 服务端完整备份 / 恢复 ───────────────────────────────────────────────────

export async function pushFullBackup(onProgress?: ProgressHandler): Promise<{ total: number; markedDeleted: number }> {
  await flushAutoSync();
  const backupRunId = `${getBackupClientId().slice(0, 16)}-${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();
  let total = 0;
  for (const name of ENTITY_TABLES) {
    const rows = await table(name).toArray();
    if (rows.length === 0) continue;
    const records: PushRecord[] = rows
      .map((row) => ({ table: name, id: recordPrimaryKey(name, row), data: serializeRecord(row) }))
      .filter((record) => record.id);
    await pushBatches(records, backupRunId, (done) => onProgress?.(`正在上传 ${name}（${done}/${records.length}）...`));
    total += records.length;
  }
  const { markedDeleted } = await apiFetch<{ markedDeleted: number }>("/api/backup/finalize", {
    method: "POST",
    json: { clientId: getBackupClientId(), backupRunId, startedAt, tables: [...ENTITY_TABLES] },
  });
  const now = new Date().toISOString();
  safeStorage()?.setItem(FULL_BACKUP_AT_KEY, now);
  safeStorage()?.setItem(LAST_SYNC_AT_KEY, now);
  updateState({ lastFullBackupAt: now, lastSyncAt: now, lastError: null });
  return { total, markedDeleted };
}

export async function restoreFromServer(
  options: { overwrite: boolean },
  onProgress?: ProgressHandler,
): Promise<{ written: number; total: number }> {
  await flushAutoSync();
  let written = 0;
  let total = 0;
  suppressDepth += 1;
  try {
    for (const name of ENTITY_TABLES) {
      let after: string | null = "";
      while (after !== null) {
        const query = new URLSearchParams({ table: name, limit: String(PULL_PAGE_SIZE) });
        if (after) query.set("after", after);
        const page: { records: Array<{ id: string; data: string }>; nextAfterId: string | null } = await apiFetch(
          `/api/backup/pull?${query.toString()}`,
        );
        const rows = page.records.map((record) => deserializeRecord<AnyRow>(record.data));
        total += rows.length;
        written += await mergeRows(name, rows, options.overwrite);
        if (rows.length > 0) onProgress?.(`正在恢复 ${name}（累计 ${total} 条）...`);
        after = page.nextAfterId;
      }
    }
  } finally {
    suppressDepth -= 1;
  }
  return { written, total };
}

// ─── 自动增量同步 ────────────────────────────────────────────────────────────

let installed = false;
let suppressDepth = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;
const pending = new Map<EntityTableName, Set<string>>();
const listeners = new Set<(state: AutoSyncState) => void>();
let state: AutoSyncState = {
  enabled: false,
  pending: 0,
  syncing: false,
  lastSyncAt: null,
  lastFullBackupAt: null,
  lastError: null,
};

function pendingCount(): number {
  let count = 0;
  for (const ids of pending.values()) count += ids.size;
  return count;
}

function updateState(patch: Partial<AutoSyncState>) {
  state = { ...state, ...patch, pending: pendingCount() };
  for (const listener of listeners) listener(state);
}

export function getAutoSyncState(): AutoSyncState {
  return state;
}

export function subscribeAutoSync(listener: (state: AutoSyncState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

function persistPending() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const serialized: Record<string, string[]> = {};
    for (const [name, ids] of pending) if (ids.size > 0) serialized[name] = [...ids];
    const storage = safeStorage();
    if (Object.keys(serialized).length === 0) storage?.removeItem(PENDING_KEY);
    else storage?.setItem(PENDING_KEY, JSON.stringify(serialized));
  }, 0);
}

function markDirty(name: EntityTableName, id: unknown) {
  if (suppressDepth > 0 || typeof id !== "string" || !id) return;
  let ids = pending.get(name);
  if (!ids) {
    ids = new Set();
    pending.set(name, ids);
  }
  ids.add(id);
  persistPending();
  scheduleFlush(FLUSH_DELAY_MS);
}

function scheduleFlush(delay: number) {
  if (!state.enabled) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushAutoSync();
  }, delay);
  updateState({});
}

async function doFlush(): Promise<void> {
  if (pending.size === 0) return;
  const snapshot = new Map<EntityTableName, string[]>();
  for (const [name, ids] of pending) snapshot.set(name, [...ids]);
  pending.clear();
  updateState({ syncing: true });
  const records: PushRecord[] = [];
  try {
    for (const [name, ids] of snapshot) {
      const rows = await table(name).bulkGet(ids);
      ids.forEach((id, index) => {
        const row = rows[index];
        records.push(row ? { table: name, id, data: serializeRecord(row) } : { table: name, id, deleted: true });
      });
    }
    await pushBatches(records);
    const now = new Date().toISOString();
    safeStorage()?.setItem(LAST_SYNC_AT_KEY, now);
    persistPending();
    updateState({ syncing: false, lastSyncAt: now, lastError: null });
  } catch (error) {
    for (const [name, ids] of snapshot) {
      const target = pending.get(name) ?? new Set<string>();
      ids.forEach((id) => target.add(id));
      pending.set(name, target);
    }
    persistPending();
    updateState({ syncing: false, lastError: error instanceof Error ? error.message : "同步失败" });
    scheduleFlush(RETRY_DELAY_MS);
  }
}

export function flushAutoSync(): Promise<void> {
  if (!state.enabled) return Promise.resolve();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const run = (flushing ?? Promise.resolve()).then(doFlush);
  flushing = run.finally(() => {
    if (flushing === run) flushing = null;
  });
  return run;
}

function restorePendingFromStorage() {
  const raw = safeStorage()?.getItem(PENDING_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const name of ENTITY_TABLES) {
      const ids = parsed[name];
      if (Array.isArray(ids)) ids.forEach((id) => markDirty(name, id));
    }
  } catch {
    safeStorage()?.removeItem(PENDING_KEY);
  }
}

/** 在批量写入期间暂停自动同步标记（例如从服务端恢复） */
export async function withoutAutoSync<T>(fn: () => Promise<T>): Promise<T> {
  suppressDepth += 1;
  try {
    return await fn();
  } finally {
    suppressDepth -= 1;
  }
}

/**
 * 服务端配置了 MySQL 时启用自动增量同步。首次在本浏览器启用时，后台执行一次完整备份，
 * 把已有的本地数据补齐到服务器。
 */
export async function installAutoSync(): Promise<boolean> {
  if (installed || typeof window === "undefined") return state.enabled;
  const status = await fetchServerBackupStatus();
  if (!status.configured || status.available === false) {
    updateState({ enabled: false, lastError: status.available === false ? status.error ?? "服务端不可用" : null });
    return false;
  }
  installed = true;
  for (const name of ENTITY_TABLES) {
    const target = table(name);
    target.hook("creating", function onCreating(primKey, obj) {
      const id = (primKey as unknown) ?? recordPrimaryKey(name, obj);
      this.onsuccess = () => markDirty(name, id);
    });
    target.hook("updating", function onUpdating(_mods, primKey) {
      this.onsuccess = () => markDirty(name, primKey);
    });
    target.hook("deleting", function onDeleting(primKey) {
      this.onsuccess = () => markDirty(name, primKey);
    });
  }
  const storage = safeStorage();
  updateState({
    enabled: true,
    lastSyncAt: storage?.getItem(LAST_SYNC_AT_KEY) ?? null,
    lastFullBackupAt: storage?.getItem(FULL_BACKUP_AT_KEY) ?? null,
  });
  restorePendingFromStorage();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushAutoSync();
  });
  if (!storage?.getItem(FULL_BACKUP_AT_KEY)) {
    void pushFullBackup().catch((error) => {
      updateState({ lastError: `首次完整备份失败：${error instanceof Error ? error.message : "未知错误"}` });
    });
  }
  return true;
}
