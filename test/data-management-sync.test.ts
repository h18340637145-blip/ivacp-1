import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/shared/db/database';
import { installAutoSync, flushAutoSync, getAutoSyncState } from '@/shared/db/sync';
const storage = new Map<string,string>();
beforeEach(async () => {
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  vi.stubGlobal('window', {localStorage:{getItem:(key:string) => storage.get(key) ?? null, setItem:(key:string,value:string) => storage.set(key,value), removeItem:(key:string) => storage.delete(key)}});
  vi.stubGlobal('document', {addEventListener:vi.fn()});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url === '/api/backup/status' ? {configured:true,available:true} : {}), {status:200})));
  await db.open();
});
afterEach(async () => { vi.clearAllTimers(); vi.useRealTimers(); await db.delete(); vi.unstubAllGlobals(); });
it('首次自动同步仅补齐本地记录，不自动 finalize 删除已有服务器镜像；失败事务不入增量队列', async () => {
  await db.ruleGroups.put({id:'g',name:'本地组'} as never);
  await installAutoSync();
  await flushAutoSync();
  await vi.advanceTimersByTimeAsync(50);
  const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
  expect(urls).toContain('/api/backup/push');
  expect(urls).not.toContain('/api/backup/finalize');
  expect(getAutoSyncState().lastFullBackupAt).toBeNull();
  vi.mocked(fetch).mockClear();
  await expect(db.transaction('rw', db.ruleGroups, async () => {
    await db.ruleGroups.put({id:'rollback',name:'必须回滚'} as never);
    throw new Error('回滚');
  })).rejects.toThrow('回滚');
  await vi.advanceTimersByTimeAsync(3500);
  await flushAutoSync();
  expect(getAutoSyncState().pending).toBe(0);
  expect(vi.mocked(fetch).mock.calls).toHaveLength(0);
  expect(await db.ruleGroups.get('rollback')).toBeUndefined();
  await db.ruleGroups.update('g', {name:'已提交编辑'});
  await vi.advanceTimersByTimeAsync(3500);
  await flushAutoSync();
  const push = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === '/api/backup/push');
  expect(push).toBeDefined();
  expect(JSON.parse(String(push?.[1]?.body)).records[0].data).toContain('已提交编辑');
});
