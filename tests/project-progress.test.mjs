import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync('lib/project-progress.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const {progressStep, publicProgress, publicProgressText, upcomingProjectTasks, taskIsOverdue} = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

test('对业主进展仅包含名称、已登记阶段和人工说明，不包含内部业务信息', () => {
  const progress = publicProgress({
    name: '测试订单', status: '生产中', customer: '私人联系人', phone: '13900000000',
    budget: 123456, paid: 98765, contract: 200000, remaining: 101235,
    note: '内部利润说明', tasks: [{title: '催付工人工资', assignee: '内部负责人'}],
    logs: [{detail: '内部操作记录'}],
  }, Date.parse('2026-10-13T16:05:00Z'));
  assert.deepEqual(Object.keys(progress).sort(), ['asOf', 'name', 'stage', 'summary']);
  assert.equal(progress.asOf, '2026-10-14');
  const text = publicProgressText(progress, '预计本周联系确认安装时间');
  assert.match(text, /测试订单/);
  assert.match(text, /生产中/);
  assert.match(text, /预计本周联系确认安装时间/);
  for (const secret of ['私人联系人', '13900000000', '123456', '98765', '内部利润说明', '催付工人工资', '内部负责人', '内部操作记录']) assert.ok(!text.includes(secret));
});

test('未设置或未知阶段不会编造工作环节，收尾与已归档能正确定位', () => {
  assert.equal(progressStep('收尾中'), 5);
  assert.equal(progressStep('已归档'), 6);
  assert.equal(publicProgress({name: '测试', status: '内部成本 10000'}).stage, '未设置阶段');
  assert.equal(publicProgress({}).summary, '当前工作环节尚未登记。');
  assert.ok(!publicProgressText(publicProgress({name: '空任务项目', status: '设计中'})).includes('已完成设计'));
});

test('首页优先展示最近未完成的截止事项，未定时间在后，日期按北京时间判断', () => {
  const tasks = [
    {id: 'undated', title: '尚未安排'},
    {id: 'today', title: '今日安排', date: '2026-10-14'},
    {id: 'done', title: '已经完成', done: true, due_at: '2026-10-12T00:00:00Z'},
    {id: 'old', title: '过期安排', due_at: '2026-10-13T00:00:00Z'},
    {id: 'removed', title: '已删除', deleted: true, due_at: '2026-10-11T00:00:00Z'},
  ];
  assert.deepEqual(upcomingProjectTasks(tasks).map(task => task.id), ['old', 'today', 'undated']);
  assert.equal(taskIsOverdue(tasks[1], Date.parse('2026-10-14T10:00:00Z')), false);
  assert.equal(taskIsOverdue(tasks[1], Date.parse('2026-10-14T16:00:00Z')), true);
  assert.equal(tasks.length, 5);
});
