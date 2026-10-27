import { beforeEach, expect, it, vi } from 'vitest';
const pools = vi.hoisted(() => ({ old: {query: vi.fn()}, current: {query: vi.fn()} }));
vi.mock('@/server/db/mysql', () => ({ getLegacyPool: async () => pools.old, getPool: async () => pools.current }));
vi.mock('@/server/db/mirror', () => ({ pushRecords: vi.fn() }));
import * as migration from '@/server/migration/legacy-mysql';
beforeEach(() => {
  pools.old.query.mockReset(); pools.current.query.mockReset();
  pools.old.query.mockImplementation(async (sql: string) => {
    if (sql.includes('information_schema')) return [[{total:1}]];
    if (sql.includes('DISTINCT owner')) return [[{owner:'alice'}]];
    if (sql.includes('table_name, data')) return [[{ table_name:'ruleGroups', data: JSON.stringify({id:'g',name:'old'}) }, {table_name:'issueProcessResults',data:'{broken'}]];
    return [[{total:2}]];
  });
  pools.current.query.mockImplementation(async (sql: string) => sql.includes('record_id') ? [[{record_id:'g'}]] : [[]]);
});
it('预检报告转换、冲突与坏行，且不会向任何库写入业务数据', async () => {
  const preview = await migration.previewLegacyMysql();
  expect(preview.owners[0]).toMatchObject({ owner:'alice', conflicts:1 });
  expect(preview.owners[0].report.warnings.join(' ')).toContain('JSON');
  expect(preview.owners[0].report.read.issueProcessResults).toBe(1);
  expect(preview.templates.read).toBe(2);
  for (const [sql] of [...pools.old.query.mock.calls, ...pools.current.query.mock.calls]) expect(sql.trim().startsWith('SELECT')).toBe(true);
});
