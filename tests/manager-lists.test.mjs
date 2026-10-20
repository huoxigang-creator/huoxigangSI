import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {setImmediate as nextTurn} from 'node:timers/promises';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRows = [
  {id: 'project-a', name: '离线项目甲', customer: '甲', status: '设计中', contract: 10000, received: 5000, remaining: 5000},
  {id: 'project-b', name: '离线项目乙', customer: '乙', status: '生产中', contract: 20000, received: 10000, remaining: 10000},
];
const quoteRows = [
  {id: 'quote-a', title: '草稿报价', created: '2026-10-12T01:00:00Z', adopted: false, total: 12000, items: [{name: '离线明细'}]},
  {id: 'quote-b', title: '采纳报价', created: '2026-10-12T01:00:00Z', adopted: true, total: 15000, items: []},
];
const taskRows = [{id: 'task-a', project: 'project-a', title: '离线任务', assignee: '甲', date: '2026-10-12', due_at: '2026-10-12T04:00:00Z', done: false}];
const paymentRows = [{id: 'payment-a', project: 'project-a', type: '付款', category: '人工费', amount: 10000, date: '2026-10-12', note: '', void: false}];

// Execute the real selection hook and list JSX with a small headless hook host.
// Calls and promises stay local: no DOM, fetch, database, or production mutation.
function harness({request = async () => ({ok: true})} = {}) {
  const slots = [], cache = new Map(), effects = [], requests = [], confirmations = [];
  let cursor = 0;
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = {value: typeof initial === 'function' ? initial() : initial};
      return [slots[index].value, update => {slots[index].value = typeof update === 'function' ? update(slots[index].value) : update;}];
    },
    useRef(initial) {const index = cursor++; if (!slots[index]) slots[index] = {value: {current: initial}}; return slots[index].value;},
    useMemo(create, dependencies) {const index = cursor++; if (!slots[index] || !same(slots[index].dependencies, dependencies)) slots[index] = {value: create(), dependencies}; return slots[index].value;},
    useCallback(callback, dependencies) {return hooks.useMemo(() => callback, dependencies);},
    useEffect(effect, dependencies) {const index = cursor++; if (!slots[index] || !same(slots[index].dependencies, dependencies)) {slots[index] = {dependencies}; effects.push(effect);}},
  };
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const module = {exports: {}}; cache.set(path, module);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
    function localRequire(name) {
      if (name === 'react') return hooks;
      if (name === 'lucide-react') return new Proxy({}, {get: (_target, key) => function Icon() {return String(key);}});
      if (name.endsWith('.css')) return {};
      if (name.endsWith('/trash-client')) return {trashRequest: async (action, args) => {requests.push({action, args: JSON.parse(JSON.stringify(args))}); return request(action, args);}};
      if (name.startsWith('.')) {
        const base = resolve(dirname(path), name), target = [base, base + '.ts', base + '.tsx'].find(existsSync);
        assert.ok(target, 'Local module exists: ' + name);
        return load(target);
      }
      return require(name);
    }
    const evaluate = runInNewContext('(function(exports, require, module) {' + code + '\n})', {console, Intl, Date, Set, Map, Error, window: {confirm: message => {confirmations.push(message); return true;}, prompt: () => '离线作废原因'}});
    evaluate(module.exports, localRequire, module);
    return module.exports;
  }
  const lists = load(resolve(sourceRoot, 'app/manager-lists.tsx'));
  function render(name, props) {
    cursor = 0; effects.length = 0;
    const tree = lists[name](props);
    for (const effect of effects.splice(0)) effect();
    return tree;
  }
  return {render, requests, confirmations};
}
function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !node.props) return [];
  return [node, ...elements(node.props.children)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return text(node.props?.children);
}
function button(tree, label) {
  const found = elements(tree).find(node => node.type === 'button' && text(node) === label);
  assert.ok(found, 'Button exists: ' + label); return found;
}
function checkbox(tree, label) {
  const found = elements(tree).find(node => node.props.label === label);
  assert.ok(found, 'Checkbox exists: ' + label); return found;
}
function toolbar(tree) {return elements(tree).find(node => typeof node.type === 'function' && node.type.name === 'SelectionToolbar');}
function feedback(tree) {return elements(tree).find(node => typeof node.type === 'function' && node.type.name === 'Feedback').props.message;}
const defaults = items => ({items, scope: 'offline-list', busy: false, projects: projectRows, open() {}, onSelect() {}, onCopy() {}, async mutate() {}, async onDeleted() {}});
async function settled() {await nextTurn(); await nextTurn();}

test('所有核心列表有前置选择和集中删除，无单行删除', () => {
  const definitions = [['ProjectList', projectRows], ['TaskList', taskRows], ['TransactionList', paymentRows], ['QuoteList', quoteRows]];
  for (const [name, rows] of definitions) {
    const app = harness(), tree = app.render(name, defaults(rows));
    assert.equal(toolbar(tree).props.selection, 0);
    assert.equal(elements(tree).filter(node => node.props.label?.startsWith('选择')).length, rows.length);
    assert.equal(elements(tree).filter(node => node.props.label?.startsWith('全选当前')).length, 1);
    const deleteButtons = elements(tree).filter(node => node.type === 'button' && text(node).includes('删除'));
    assert.equal(deleteButtons.length, 1); assert.equal(text(deleteButtons[0]), '删除所选');
    assert.equal(deleteButtons[0].props.disabled, true);
  }
});

test('删除只发送所选 ID，结果含数量且单项编辑保留原记录', async () => {
  const app = harness(), opened = [], deleted = [], props = {...defaults(projectRows), open: (...args) => opened.push(args), onDeleted: async ids => deleted.push(Array.from(ids))};
  let tree = app.render('ProjectList', props);
  checkbox(tree, '选择项目 离线项目乙').props.onChange();
  tree = app.render('ProjectList', props);
  button(tree, '编辑').props.onClick();
  assert.equal(opened[0][0], '项目'); assert.equal(opened[0][1], projectRows[1]);
  button(tree, '删除所选').props.onClick(); await settled();
  assert.deepEqual(app.requests, [{action: 'delete_record', args: {id: 'project-b'}}]);
  assert.deepEqual(deleted, [['project-b']]);
  assert.match(app.confirmations[0], /所选 1 条.*可恢复/);
  tree = app.render('ProjectList', props);
  assert.equal(toolbar(tree).props.selection, 0); assert.match(feedback(tree), /已删除 1 条，失败 0 条/);
});

test('部分失败保持失败勾选，重试不再请求成功项', async () => {
  let fail = true;
  const app = harness({request: async (_action, args) => {if (args.id === 'project-b' && fail) throw Error('离线模拟冲突'); return {ok: true};}});
  const deleted = [], props = {...defaults(projectRows), onDeleted: async ids => deleted.push(Array.from(ids))};
  let tree = app.render('ProjectList', props); checkbox(tree, '全选当前项目').props.onChange();
  tree = app.render('ProjectList', props); button(tree, '删除所选').props.onClick(); await settled();
  tree = app.render('ProjectList', props);
  assert.deepEqual(deleted, [['project-a']]); assert.equal(toolbar(tree).props.selection, 1);
  assert.equal(checkbox(tree, '选择项目 离线项目甲').props.checked, false);
  assert.equal(checkbox(tree, '选择项目 离线项目乙').props.checked, true);
  assert.match(feedback(tree), /已删除 1 条，失败 1 条.*离线模拟冲突.*失败项仍勾选/);
  fail = false; button(tree, '删除所选').props.onClick(); await settled();
  assert.deepEqual(app.requests.map(row => row.args.id), ['project-a', 'project-b', 'project-b']);
});

test('页面/筛选作用域切换与不可见行会立即清理勾选', () => {
  const app = harness(); let props = defaults(projectRows), tree = app.render('ProjectList', props);
  checkbox(tree, '全选当前项目').props.onChange(); tree = app.render('ProjectList', props);
  assert.equal(toolbar(tree).props.selection, 2);
  props = {...props, scope: 'other-page|other-filter'}; tree = app.render('ProjectList', props);
  assert.equal(toolbar(tree).props.selection, 0); assert.equal(button(tree, '删除所选').props.disabled, true);
  checkbox(tree, '全选当前项目').props.onChange(); tree = app.render('ProjectList', {...props, items: [projectRows[1]]});
  assert.equal(toolbar(tree).props.selection, 1); assert.equal(checkbox(tree, '选择项目 离线项目乙').props.checked, true);
});

test('批量进行时工具栏与勾选锁定，旧按钮重复点击也不重复删除', async () => {
  let finish; const pending = new Promise(resolve => {finish = resolve;});
  const app = harness({request: async () => pending}), props = defaults(projectRows);
  let tree = app.render('ProjectList', props); checkbox(tree, '选择项目 离线项目甲').props.onChange();
  tree = app.render('ProjectList', props); const oldDelete = button(tree, '删除所选'); oldDelete.props.onClick(); oldDelete.props.onClick();
  tree = app.render('ProjectList', props);
  assert.equal(toolbar(tree).props.busy, true);
  for (const node of elements(tree).filter(node => node.type === 'button' || node.props.label?.startsWith('选择') || node.props.label?.startsWith('全选'))) assert.equal(node.props.disabled, true);
  assert.equal(app.requests.length, 1); finish({ok: true}); await settled();
  assert.equal(toolbar(app.render('ProjectList', props)).props.busy, false);
});

test('收付款不提供复制或编辑；报价单项复制/编辑与任务编辑保留记录', () => {
  const app = harness(), opened = [], copied = [], props = {...defaults(paymentRows), open: (...args) => opened.push(args)};
  let tree = app.render('TransactionList', props); checkbox(tree, '全选当前流水').props.onChange(); tree = app.render('TransactionList', props);
  assert.equal(elements(tree).some(node => node.type === 'button' && ['复制', '编辑'].includes(text(node))), false);
  button(tree, '明细 / 单据').props.onClick(); assert.equal(opened[0][0], '付款单据'); assert.equal(opened[0][1], paymentRows[0]);
  const quotes = harness(), qp = {...defaults(quoteRows), open: (...args) => opened.push(args), onCopy: row => copied.push(row)};
  tree = quotes.render('QuoteList', qp); checkbox(tree, '选择报价 草稿报价').props.onChange(); tree = quotes.render('QuoteList', qp);
  button(tree, '编辑').props.onClick(); button(tree, '复制').props.onClick();
  assert.equal(opened[1][0], '报价'); assert.equal(opened[1][1], quoteRows[0]); assert.equal(copied[0], quoteRows[0]);
  checkbox(tree, '选择报价 草稿报价').props.onChange(); checkbox(tree, '选择报价 采纳报价').props.onChange(); tree = quotes.render('QuoteList', qp);
  assert.equal(button(tree, '编辑').props.disabled, true); assert.equal(button(tree, '复制').props.disabled, false);
  const tasks = harness(), tp = {...defaults(taskRows), open: (...args) => opened.push(args)};
  tree = tasks.render('TaskList', tp); checkbox(tree, '选择任务 离线任务').props.onChange(); tree = tasks.render('TaskList', tp);
  button(tree, '编辑').props.onClick(); assert.equal(opened[2][0], '任务'); assert.equal(opened[2][1], taskRows[0]);
});
