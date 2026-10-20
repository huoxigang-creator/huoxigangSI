import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync('lib/bulk-actions.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const {runBulkActions} = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('仅处理提供的勾选项，每项明确成功或失败，失败不阻止其他项', async () => {
  const called = [];
  const rows = [{id: 'chosen-a'}, {id: 'chosen-b'}, {id: 'chosen-c'}];
  const result = await runBulkActions(rows, async row => {called.push(row.id); if (row.id === 'chosen-b') throw new Error('项目仍已删除'); return {ok: true, id: row.id};});
  assert.deepEqual(called.sort(), rows.map(row => row.id));
  assert.equal(result.total, 3);
  assert.deepEqual(result.successIds, ['chosen-a', 'chosen-c']);
  assert.deepEqual(result.failedIds, ['chosen-b']);
  assert.equal(result.failures[0].error, '项目仍已删除');
  assert.equal(result.successes[0].result.id, 'chosen-a');
});

test('并发上限 3，完成乱序时结果仍按原选择顺序，等待全部完成', async () => {
  let active = 0, peak = 0, finished = 0;
  const rows = Array.from({length: 8}, (_, index) => ({id: String(index)}));
  const result = await runBulkActions(rows, async row => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, row.id === '0' ? 20 : 1));
    active--; finished++; return {restoredAsDraft: row.id === '2'};
  }, {concurrency: 99});
  assert.equal(peak, 3); assert.equal(active, 0); assert.equal(finished, 8);
  assert.deepEqual(result.successIds, rows.map(row => row.id));
  assert.equal(result.successes.filter(item => item.result.restoredAsDraft).length, 1);
});

test('重复 ID 只执行一次，空选择不调用，串行设置和非 Error 失败均有明确结果', async () => {
  let active = 0, peak = 0, called = 0;
  const result = await runBulkActions([{id: 'a'}, {id: 'a'}, {id: 'b'}], async row => {
    called++; active++; peak = Math.max(peak, active); await Promise.resolve(); active--;
    if (row.id === 'b') throw null; return true;
  }, {concurrency: 1});
  assert.equal(called, 2); assert.equal(peak, 1); assert.equal(result.total, 2);
  assert.equal(result.failures[0].error, '操作失败，请重试');
  assert.deepEqual(result.successIds, ['a']);
  const empty = await runBulkActions([], async () => {throw new Error('不应调用');});
  assert.deepEqual(empty, {total: 0, successes: [], failures: [], successIds: [], failedIds: []});
});

test('重试仅处理失败 ID，不重新执行此前成功项', async () => {
  const rows = [{id: 'a'}, {id: 'b'}, {id: 'c'}], calls = [];
  const first = await runBulkActions(rows, async row => {calls.push(row.id); if (row.id !== 'a') throw new Error('暂时失败'); return true;});
  const second = await runBulkActions(rows.filter(row => first.failedIds.includes(row.id)), async row => {calls.push(row.id); return true;});
  assert.deepEqual(second.successIds, ['b', 'c']);
  assert.equal(calls.filter(id => id === 'a').length, 1);
  assert.equal(second.failures.length, 0);
});
