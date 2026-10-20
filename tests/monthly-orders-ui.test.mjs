import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const base = {created: '2026-10-01T02:00:00Z', status: '设计中', customer: '测试客户'};
const root = {...base, id: 'root', name: '合作客户', customer: '张先生'};
const child = {...base, id: 'child', parent_id: 'root', name: '厨房柜', customer: '张先生', status: '收尾中', order_date: '2026-10-02'};
const customer = {...base, id: 'customer', name: '云顶全屋', customer: '李女士', project_type: 'customer', status: '已完工', order_date: '2026-10-05'};
const grouped = {...base, id: 'grouped', name: '桃李书院', customer: '王先生', order_date: '2026-10-04'};
const previous = {...base, id: 'previous', name: '上月订单', order_date: '2026-09-30'};
const data = {
  projects: [root, child, customer, grouped, previous],
  quotes: [
    {id: 'child-quote', project: 'child', title: '厨房报价', adopted: true, total: 10000},
    {id: 'customer-quote', project: 'customer', title: '客户草稿', adopted: false, total: 20000},
    {id: 'group-a', project: 'grouped', subproject_id: 'bedroom', subproject_name: '卧室柜', title: '第一版', adopted: true, total: 30000},
    {id: 'group-a-old', project: 'grouped', subproject_id: 'bedroom', subproject_name: '卧室柜', title: '旧版', adopted: false, total: 50000},
    {id: 'group-b', project: 'grouped', subproject_id: 'study', subproject_name: '书柜', title: '第一版', adopted: true, total: 40000},
  ],
  transactions: [
    {id: 'parent-old', project: 'root', type: '收款', amount: 5000, date: '2026-10-10'},
    {id: 'child-payment', project: 'child', type: '收款', amount: 3000, date: '2026-09-20'},
    {id: 'group-old', project: 'grouped', type: '收款', amount: 4000, date: '2026-10-10'},
    {id: 'group-payment', project: 'grouped', subproject_id: 'study', type: '收款', amount: 20000, date: '2026-10-10'},
  ],
};

// Exercise real UI callbacks and order aggregation entirely offline.
function harness(busy = false, workspace = data) {
  const slots = [], cache = new Map(), selections = [];
  let cursor = 0;
  const hooks = {...React,
    useState(initial) {const index = cursor++; slots[index] ??= {value: typeof initial === 'function' ? initial() : initial}; return [slots[index].value, value => {slots[index].value = typeof value === 'function' ? value(slots[index].value) : value;}];},
    useMemo(callback) {cursor++; return callback();},
  };
  class FixedDate extends Date {constructor(value) {super(arguments.length ? value : '2026-10-14T08:00:00Z');}}
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const module = {exports: {}}; cache.set(path, module);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
    function localRequire(name) {
      if (name === 'react') return hooks;
      if (name === 'lucide-react') return new Proxy({}, {get: () => () => null});
      if (name.endsWith('.css')) return {};
      if (name.endsWith('/managed-table')) return {__esModule: true, default: props => React.createElement('table', props)};
      if (name.startsWith('.')) {const target = resolve(dirname(path), name); return load([target, target + '.ts', target + '.tsx'].find(existsSync));}
      return require(name);
    }
    runInNewContext('(function(exports,require,module){' + code + '\n})', {Date: FixedDate, Intl, Number, Math, String, Map, Set, console})(module.exports, localRequire, module);
    return module.exports;
  }
  const Component = load(resolve('app/monthly-orders.tsx')).default;
  return {selections, render() {cursor = 0; return Component({data: workspace, busy, onSelect: (project, subprojectId) => selections.push({project, subprojectId})});}};
}

function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!React.isValidElement(value)) return [];
  return [value, ...nodes(value.props.children)];
}
function text(value) {
  if (Array.isArray(value)) return value.map(text).join('');
  if (React.isValidElement(value)) return text(value.type?.name === 'Balance' ? value.type(value.props) : value.props.children);
  return value == null || typeof value === 'boolean' ? '' : String(value);
}
function find(tree, predicate) {const node = nodes(tree).find(predicate); assert.ok(node); return node;}
const control = (tree, label) => find(tree, node => node.props['aria-label'] === label);
const row = (tree, id) => find(tree, node => node.type === 'tr' && node.props['data-row-id'] === id);

test('按月份统计客户家数，真实子项目与旧报价版本不重复，容器历史款可见', () => {
  const app = harness(), tree = app.render();
  const metrics = nodes(tree).filter(node => node.props.className?.startsWith('monthlyOrderMetric '));
  assert.match(text(metrics[0]), /本月接单3家4 项订单/);
  assert.match(text(metrics[1]), /进行中2项/);
  assert.match(text(metrics[2]), /收尾中1项/);
  assert.match(text(metrics[3]), /已完工1项/);
  assert.equal(nodes(tree).filter(node => node.type === 'tr' && node.props['data-row-id']).length, 4);
  const notice = find(tree, node => node.props.className === 'monthlyAllocationNotice');
  assert.match(text(notice), /¥90\.00/);
  assert.doesNotMatch(text(notice), /¥130\.00/);
  assert.match(text(row(tree, 'customer')), /应收未确定/);
  assert.match(text(row(tree, 'child')), /¥30\.00.*¥70\.00/);
  assert.match(text(row(tree, 'grouped:study')), /¥200\.00.*¥200\.00/);
});

test('订单名称进入真实子项目，旧小项目同时保留稳定分组ID', () => {
  const app = harness(), tree = app.render();
  control(tree, '进入项目 厨房柜').props.onClick();
  control(tree, '进入项目 书柜').props.onClick();
  assert.equal(app.selections[0].project.id, child.id);
  assert.equal(app.selections[0].subprojectId, undefined);
  assert.equal(app.selections[1].project.id, grouped.id);
  assert.equal(app.selections[1].subprojectId, 'study');
});

test('筛选与搜索可组合，切换月份恢复状态并仅显示该月接单', () => {
  const app = harness(); let tree = app.render();
  const filters = find(tree, node => node.props['aria-label'] === '订单状态筛选');
  find(filters, node => node.type === 'button' && text(node) === '收尾中').props.onClick(); tree = app.render();
  assert.equal(nodes(tree).filter(node => node.type === 'tr' && node.props['data-row-id']).length, 1);
  control(tree, '搜索订单或客户').props.onChange({target: {value: ' 王先生 '}}); tree = app.render();
  assert.match(text(tree), /没有符合条件的订单/);
  find(tree, node => node.type === 'button' && text(node) === '查看本月全部订单').props.onClick(); tree = app.render();
  control(tree, '上个月').props.onClick(); tree = app.render();
  assert.equal(control(tree, '接单月份').props.value, '2026-09');
  assert.equal(nodes(tree).filter(node => node.type === 'tr' && node.props['data-row-id']).length, 1);
  assert.match(text(row(tree, 'previous')), /上月订单/);
  control(tree, '接单月份').props.onChange({target: {value: '2026-13'}}); tree = app.render();
  assert.equal(control(tree, '接单月份').props.value, '2026-09');
});

test('更新期间禁止订单跳转和筛选，不修改任何业务记录', () => {
  const app = harness(true), tree = app.render(), before = JSON.stringify(data);
  for (const node of nodes(tree).filter(node => node.type === 'button' || node.type === 'input')) assert.equal(node.props.disabled, true);
  assert.equal(app.selections.length, 0);
  assert.equal(JSON.stringify(data), before);
});

test('月度订单与收款表单按source_quote_id旧关联计算余额，草稿仍显示未确定', () => {
  const workspace = structuredClone(data);
  workspace.transactions.push({id: 'source-only', project: 'grouped', source_quote_id: 'group-b', type: '收款', amount: 3000, date: '2026-09-15'});
  const tree = harness(false, workspace).render();
  assert.match(text(row(tree, 'grouped:study')), /¥230\.00.*¥170\.00/);
  assert.match(text(find(tree, node => node.props.className === 'monthlyAllocationNotice')), /¥90\.00/);
  assert.match(text(row(tree, 'customer')), /应收未确定/);
  assert.doesNotMatch(text(row(tree, 'customer')), /已结清/);
});
