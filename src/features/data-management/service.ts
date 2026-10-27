"use client";

import { ENTITY_TABLES, recordPrimaryKey } from '@/domain/entities';
import { LEGACY_DB_NAME, LEGACY_TABLES, migrateLegacyTables, type LegacyTables } from '@/domain/migration/legacy';
import { parseBackupFile } from '@/domain/storage/backup-format';
import { db } from '@/shared/db/database';
import { writeTables, type ProgressHandler } from '@/shared/db/sync';

export type LegacyProbe = { status: 'found' | 'missing' | 'unavailable' };

/** 不支持安全枚举的浏览器改用文件导入，绝不以 open() 探测不存在的旧库。 */
export async function probeLegacyDatabase(): Promise<LegacyProbe> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return { status: 'unavailable' };
  const databases = await indexedDB.databases();
  return { status: databases.some(item => item.name === LEGACY_DB_NAME) ? 'found' : 'missing' };
}

export async function readLegacyDatabase(): Promise<LegacyTables> {
  if ((await probeLegacyDatabase()).status !== 'found') throw new Error('未发现同源旧库，请使用旧系统导出的 JSON 备份');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    // 防止枚举后源库恰好被删除时意外创建数据库。
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onerror = () => reject(request.error ?? new Error('读取旧库失败'));
    request.onblocked = () => reject(new Error('旧库被其他页面阻塞，请关闭旧系统页面后重试'));
    request.onsuccess = () => {
      const source = request.result;
      const names = LEGACY_TABLES.filter(name => source.objectStoreNames.contains(name));
      if (!names.length) { source.close(); resolve({}); return; }
      const transaction = source.transaction(names, 'readonly');
      const tables: LegacyTables = {};
      names.forEach(name => {
        const read = transaction.objectStore(name).getAll();
        read.onsuccess = () => { tables[name] = read.result; };
      });
      transaction.oncomplete = () => { source.close(); resolve(tables); };
      transaction.onabort = transaction.onerror = () => { source.close(); reject(transaction.error ?? new Error('读取旧库事务失败')); };
    };
  });
}

export async function migrateBrowserLegacy(onProgress?: ProgressHandler) {
  onProgress?.('正在只读读取旧库…');
  const { tables, report } = migrateLegacyTables(await readLegacyDatabase());
  const result = await writeTables(tables, { overwrite: false }, onProgress);
  return { ...result, report };
}

export function previewBackup(text: string) {
  const backup = parseBackupFile(text);
  for (const name of ENTITY_TABLES) {
    const seen = new Set<string>();
    for (const item of backup.tables[name] ?? []) {
      if (!item || typeof item !== 'object') throw new Error(`${name} 包含无效记录`);
      const key = recordPrimaryKey(name, item as unknown as Record<string, unknown>);
      if (!key) throw new Error(`${name} 包含缺少主键的记录`);
      if (seen.has(key)) throw new Error(`${name} 包含重复主键 ${key}`);
      seen.add(key);
    }
  }
  return backup;
}

export async function localTableCounts() {
  return db.transaction('r', db.tables, async () => Promise.all(ENTITY_TABLES.map(async name => ({
    table: name, total: await db.table(name).count(),
  }))));
}
