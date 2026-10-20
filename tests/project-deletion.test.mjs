import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync('lib/project-deletion.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const {projectDeletionWarning} = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('没有收付款的项目删除时不追加提醒', () => {
  assert.equal(projectDeletionWarning([]), '');
  assert.equal(projectDeletionWarning([{name: '空项目', received: 0, paid: 0}, {name: '旧项目'}]), '');
});

test('有收付款的项目逐个列出金额（分转元），超过5个汇总', () => {
  const warning = projectDeletionWarning([{name: '桃李书院6-2-1302', received: 2000000, paid: 1055900}, {name: '空项目'}, {name: '云顶', received: 150000}]);
  assert.match(warning, /不再计入经营统计/);
  assert.match(warning, /桃李书院6-2-1302：已收 ¥20,000\.00，已付 ¥10,559\.00/);
  assert.match(warning, /云顶：已收 ¥1,500\.00，已付 ¥0\.00/);
  assert.doesNotMatch(warning, /空项目/);
  const many = projectDeletionWarning(Array.from({length: 7}, (_, i) => ({name: '项目' + i, paid: 100})));
  assert.match(many, /另有 2 个项目/);
});
