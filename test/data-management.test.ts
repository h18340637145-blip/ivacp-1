import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeTables, restoreFromServer } from '@/shared/db/sync';
import { vi } from 'vitest';
import { db } from '@/shared/db/database';
import { LEGACY_DB_NAME } from '@/domain/migration/legacy';
import { probeLegacyDatabase, readLegacyDatabase, migrateBrowserLegacy, previewBackup } from '@/features/data-management/service';

async function createLegacy() {
  const legacy = new Dexie(LEGACY_DB_NAME);
  legacy.version(1).stores({ ruleGroups: 'id', issueProcessTasks: 'id', issueProcessResults: 'id', meegleAssignments: 'id', meegleProcessTasks: 'id', meegleProcessResults: 'id' });
  await legacy.open();
  await legacy.table('ruleGroups').put({ id: 'g', name: '原始组', jql: '', createdAt: new Date(0) });
  await legacy.table('issueProcessTasks').put({ id: 'task', ruleGroupId: 'g', issueKey: 'J-1', snapshotId: 's' });
  await legacy.table('issueProcessResults').put({ id: 'result', processTaskId: 'task', issueKey: 'J-1' });
  await legacy.table('meegleAssignments').put({ id: 'a', workItemId: 42, ruleGroupId: 'g', latestTaskId: 'task', latestResultId: 'result' });
  await legacy.table('meegleProcessTasks').put({ id: 'task', assignmentId: 'a', workItemId: 42, ruleGroupId: 'g' });
  await legacy.table('meegleProcessResults').put({ id: 'result', processTaskId: 'task', assignmentId: 'a', workItemId: 42 });
  legacy.close();
}
beforeEach(async () => { await db.open(); });
afterEach(async () => { await db.delete(); await Dexie.delete(LEGACY_DB_NAME); });

describe('数据管理迁移', () => {
  it('探测不存在的旧库不会创建它', async () => {
    expect(await probeLegacyDatabase()).toEqual({ status: 'missing' });
    expect((await indexedDB.databases()).some(item => item.name === LEGACY_DB_NAME)).toBe(false);
  });
  it('迁移保留关系、源库不变且重复迁移不覆盖当前数据', async () => {
    await createLegacy();
    const before = await readLegacyDatabase();
    const first = await migrateBrowserLegacy();
    expect(first.written).toBeGreaterThan(0);
    const assignment = await db.assignments.get('a');
    expect(assignment?.latestTaskId).toBe('meegle:task');
    expect(assignment?.latestResultId).toBe('meegle:result');
    expect((await db.processResults.get('meegle:result'))?.processTaskId).toBe('meegle:task');
    await db.ruleGroups.update('g', { name: '当前编辑' });
    expect((await migrateBrowserLegacy()).written).toBe(0);
    expect((await db.ruleGroups.get('g'))?.name).toBe('当前编辑');
    expect(await readLegacyDatabase()).toEqual(before);
  });
  it('预览旧JSON时转换结构但不写本地', async () => {
    const preview = previewBackup(JSON.stringify({ format: 'jira-analyzer-indexeddb-backup', tables: { issueProcessResults: [{ id: 'r', issueKey: 'J-1' }] } }));
    expect(preview.legacyReport).toBeDefined();
    expect(preview.tables.processResults?.[0].ticketKey).toBe('J-1');
    expect(await db.processResults.count()).toBe(0);
  });
});

it('跨表写入失败回滚全部导入，不留下部分关系', async () => {
  await expect(writeTables({ ruleGroups: [{ id: 'new', name: 'new' }], processResults: [{}] } as never, { overwrite: false })).rejects.toBeDefined();
  expect(await db.ruleGroups.count()).toBe(0);
});
it('恢复中途网络失败保留原本地数据库', async () => {
  const mock = vi.spyOn(globalThis, 'fetch');
  mock.mockResolvedValueOnce(new Response(JSON.stringify({ records: [{id:'g', data: JSON.stringify({id:'g', name:'remote'})}], nextAfterId: null }), {status:200}));
  mock.mockRejectedValueOnce(new Error('断网'));
  try {
    await expect(restoreFromServer({overwrite:true})).rejects.toThrow('断网');
    expect(await db.ruleGroups.count()).toBe(0);
  } finally { mock.mockRestore(); }
});

it('安全枚举不可用时不打开旧库', async () => {
  const original = indexedDB.databases;
  Object.defineProperty(indexedDB, 'databases', {value: undefined, configurable:true});
  const open = vi.spyOn(indexedDB, 'open');
  try {
    expect(await probeLegacyDatabase()).toEqual({status:'unavailable'});
    expect(open).not.toHaveBeenCalled();
  } finally { open.mockRestore(); Object.defineProperty(indexedDB, 'databases', {value:original, configurable:true}); }
});
it('预览拒绝没有主键的备份记录，不进入导入确认', () => {
  expect(() => previewBackup(JSON.stringify({format:'ivacp-backup', version:1, tables:{ruleGroups:[{name:'缺少ID'}]}}))).toThrow('主键');
});
it('源库迁移写入失败不留下任何新库记录', async () => {
  await createLegacy();
  const before = await readLegacyDatabase();
  const hook = () => { throw new Error('磁盘不可写'); };
  db.processResults.hook('creating', hook);
  try {
    await expect(migrateBrowserLegacy()).rejects.toThrow('磁盘不可写');
    expect(await db.ruleGroups.count()).toBe(0);
    expect(await db.processTasks.count()).toBe(0);
    expect(await readLegacyDatabase()).toEqual(before);
  } finally { db.processResults.hook('creating').unsubscribe(hook); }
});
it('恢复合并跳过当前值并补齐关系，覆盖恢复只替换同 ID', async () => {
  await db.ruleGroups.put({id:'g', name:'当前值'} as never);
  await db.ruleGroups.put({id:'local-only', name:'保留值'} as never);
  const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const name = new URL(String(input), 'http://localhost').searchParams.get('table');
    const records = name === 'ruleGroups' ? [{id:'g',data:JSON.stringify({id:'g',name:'服务器值'})}] : name === 'processResults' ? [{id:'r',data:JSON.stringify({id:'r',ruleGroupId:'g'})}] : [];
    return new Response(JSON.stringify({records, nextAfterId:null}),{status:200});
  });
  try {
    const merge = await restoreFromServer({overwrite:false});
    expect(merge.written).toBe(1);
    expect((await db.ruleGroups.get('g'))?.name).toBe('当前值');
    expect((await db.processResults.get('r'))?.ruleGroupId).toBe('g');
    await restoreFromServer({overwrite:true});
    expect((await db.ruleGroups.get('g'))?.name).toBe('服务器值');
    expect((await db.ruleGroups.get('local-only'))?.name).toBe('保留值');
  } finally {mock.mockRestore();}
});
it('导出在同一只读事务读取所有表，并发分析不会产生缺失快照的任务', async () => {
  const { exportBackupFile } = await import('@/shared/db/sync');
  await db.snapshots.put({id:'snapshot-before', title:'原有快照'} as never);
  await db.processTasks.put({id:'task-before', snapshotId:'snapshot-before'} as never);
  const anchor = {href:'',download:'',click:vi.fn()};
  vi.stubGlobal('document', {createElement:() => anchor});
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-data-export');
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  let concurrent: Promise<unknown> | undefined;
  try {
    await exportBackupFile(message => {
      if (message === '正在读取 assignments...') {
        concurrent = Dexie.ignoreTransaction(() => db.transaction('rw', db.snapshots, db.processTasks, async () => {
          await db.snapshots.put({id:'snapshot-concurrent', title:'并发分析快照'} as never);
          await db.processTasks.put({id:'task-concurrent', snapshotId:'snapshot-concurrent'} as never);
        }));
      }
    });
    await concurrent;
    const blob = createUrl.mock.calls[0][0] as Blob;
    const backup = previewBackup(await blob.text());
    const snapshotIds = new Set(backup.tables.snapshots?.map(snapshot => snapshot.id));
    expect(backup.tables.processTasks?.every(task => snapshotIds.has(task.snapshotId))).toBe(true);
    expect(backup.tables.processTasks?.map(task => task.id)).toEqual(['task-before']);
    expect(await db.processTasks.get('task-concurrent')).toBeDefined();
    expect(anchor.click).toHaveBeenCalledOnce();
  } finally { createUrl.mockRestore(); revokeUrl.mockRestore(); vi.unstubAllGlobals(); }
});
