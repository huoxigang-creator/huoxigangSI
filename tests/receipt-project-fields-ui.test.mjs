import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const project = {customer: '离线验收客户', created: '2026-10-02T03:00:00Z', status: '生产中'};
const fixtures = {
  projects: [
    {...project, id: 'root-a', name: '合作项目甲'},
    {...project, id: 'child-a', parent_id: 'root-a', name: '厨房柜'},
    {...project, id: 'child-b', parent_id: 'root-a', name: '客厅柜'},
    {...project, id: 'root-b', name: '历史报价项目'},
    {...project, id: 'customer', name: '整户客户', project_type: 'customer', discount_amount: 1000, rounding_amount: 500},
    {...project, id: 'draft', name: '未采纳订单'},
    {...project, id: 'deleted-root', name: '已删除项目', deleted: true},
  ],
  quotes: [
    {id: 'child-quote', project: 'child-a', title: '厨房报价', adopted: true, total: 10000},
    {id: 'child-draft', project: 'child-b', title: '客厅草稿', adopted: false, total: 9000},
    {id: 'legacy-quote', project: 'root-b', title: '旧报价小项目', adopted: true, total: 10000},
    {id: 'bedroom-quote', project: 'root-b', subproject_id: 'bedroom', subproject_name: '卧室柜', title: '已采纳版本', adopted: true, total: 20000, updated: '2026-10-14T02:00:00Z'},
    {id: 'bedroom-old', project: 'root-b', subproject_id: 'bedroom', subproject_name: '卧室柜', title: '历史来源版本', adopted: false, total: 30000, updated: '2026-10-10T02:00:00Z'},
    {id: 'customer-quote', project: 'customer', title: '整户报价', adopted: true, total: 30000},
    {id: 'draft-quote', project: 'draft', title: '尚未确认', adopted: false, total: 15000},
  ],
  transactions: [
    {id: 'root-old', project: 'root-a', type: '收款', amount: 2000},
    {id: 'child-received', project: 'child-a', type: '收款', amount: 2500},
    {id: 'root-b-old', project: 'root-b', type: '收款', amount: 1000},
    {id: 'bedroom-received', project: 'root-b', subproject_id: 'bedroom', type: '收款', amount: 3000},
    {id: 'bedroom-source-received', project: 'root-b', source_quote_id: 'bedroom-old', type: '收款', amount: 1500},
    {id: 'legacy-source-received', project: 'root-b', source_quote_id: 'legacy-quote', type: '收款', amount: 500},
    {id: 'customer-received', project: 'customer', type: '收款', amount: 4000},
    {id: 'ignored-void', project: 'root-a', type: '收款', amount: 900000, void: true},
    {id: 'ignored-deleted', project: 'root-a', type: '收款', amount: 900000, deleted: true},
  ],
};

// Real component state, callbacks and order resolver; no DOM, network or database writes.
function harness(overrides = {}) {
  const slots = [], cache = new Map(); let cursor = 0;
  const props = {...structuredClone(fixtures), initialProjectId: 'child-a', type: '收款', amount: '', ...overrides};
  const hooks = {...React,
    useState(initial) {const index = cursor++; slots[index] ??= {value: typeof initial === 'function' ? initial() : initial}; return [slots[index].value, value => {slots[index].value = typeof value === 'function' ? value(slots[index].value) : value;}];},
    useMemo(callback) {cursor++; return callback();},
  };
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const module = {exports: {}}; cache.set(path, module);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
    function localRequire(name) {
      if (name === 'react') return hooks;
      if (name.endsWith('.css')) return {};
      if (name.startsWith('.')) {const target = resolve(dirname(path), name); const file = [target, target + '.ts', target + '.tsx'].find(existsSync); assert.ok(file, 'Dependency exists: ' + name); return load(file);}
      return require(name);
    }
    runInNewContext('(function(exports,require,module){' + code + '\n})', {Date, Intl, Number, Math, String, Map, Set, console})(module.exports, localRequire, module);
    return module.exports;
  }
  const Component = load(resolve('app/receipt-project-fields.tsx')).default;
  return {props, render() {cursor = 0; return Component(props);}};
}
function nodes(value) {if (Array.isArray(value)) return value.flatMap(nodes); if (!React.isValidElement(value)) return []; return [value, ...nodes(value.props.children)];}
function text(value) {if (Array.isArray(value)) return value.map(text).join(''); if (React.isValidElement(value)) return text(value.props.children); return value == null || typeof value === 'boolean' ? '' : String(value);}
function find(tree, predicate) {const node = nodes(tree).find(predicate); assert.ok(node); return node;}
const control = (tree, label) => find(tree, node => node.props['aria-label'] === label);
const hidden = (tree, name) => find(tree, node => node.type === 'input' && node.props.type === 'hidden' && node.props.name === name);
const optionalHidden = (tree, name) => nodes(tree).find(node => node.type === 'input' && node.props.type === 'hidden' && node.props.name === name);
const balance = tree => control(tree, '所选订单收款情况');
const entry = (tree, label) => find(balance(tree), node => node.type === 'div' && React.Children.toArray(node.props.children).some(child => React.isValidElement(child) && child.type === 'dt' && text(child) === label));
const choose = (tree, label, value) => control(tree, label).props.onChange({target: {value}});

test('真实独立项目初始选择提交子项目ID，未分配父款不抵扣该子项目余额', () => {
  const app = harness(), tree = app.render();
  assert.equal(control(tree, '所属项目').props.value, 'root-a');
  assert.equal(control(tree, '所属小项目').props.value, 'child-a');
  assert.equal(control(tree, '所属小项目').props.required, true);
  assert.equal(hidden(tree, 'project_id').props.value, 'child-a');
  assert.equal(optionalHidden(tree, 'subproject_id'), undefined);
  assert.equal(text(entry(tree, '应收金额')), '应收金额¥100.00');
  assert.equal(text(entry(tree, '累计已收')), '累计已收¥25.00');
  assert.equal(text(entry(tree, '当前待收')), '当前待收¥75.00');
  const note = find(tree, node => node.props.className === 'receiptUnallocated');
  assert.match(text(note), /¥20\.00.*尚未抵扣/);
  assert.doesNotMatch(text(entry(tree, '当前待收')), /¥55\.00/);
});

test('换合作项目清除旧归属，多目标收款必须选择，新选择提交稳定旧报价组ID', () => {
  const app = harness(); let tree = app.render();
  choose(tree, '所属项目', 'root-b'); tree = app.render();
  assert.equal(hidden(tree, 'project_id').props.value, 'root-b');
  assert.equal(control(tree, '所属小项目').props.value, '');
  assert.equal(control(tree, '所属小项目').props.required, true);
  assert.equal(optionalHidden(tree, 'subproject_id'), undefined);
  assert.equal(nodes(tree).some(node => node.props['aria-label'] === '所选订单收款情况'), false);
  choose(tree, '所属小项目', 'root-b:bedroom'); tree = app.render();
  assert.equal(hidden(tree, 'project_id').props.value, 'root-b');
  assert.equal(hidden(tree, 'subproject_id').props.value, 'bedroom');
  choose(tree, '所属小项目', 'root-b:legacy'); tree = app.render();
  assert.equal(hidden(tree, 'subproject_id').props.value, 'legacy');
  choose(tree, '所属项目', 'root-a'); tree = app.render();
  assert.equal(control(tree, '所属小项目').props.value, '');
  assert.equal(optionalHidden(tree, 'subproject_id'), undefined);
});

test('客户整户不展示小项目选择，优惠抹零已计入应收', () => {
  const app = harness({initialProjectId: 'customer'}), tree = app.render();
  assert.equal(hidden(tree, 'project_id').props.value, 'customer');
  assert.equal(optionalHidden(tree, 'subproject_id'), undefined);
  assert.equal(nodes(tree).some(node => node.props['aria-label'] === '所属小项目'), false);
  assert.equal(text(entry(tree, '应收金额')), '应收金额¥285.00');
  assert.equal(text(entry(tree, '当前待收')), '当前待收¥245.00');
  assert.match(text(balance(tree)), /本客户：整户客户/);
  assert.equal(nodes(control(tree, '所属项目')).some(node => node.type === 'option' && node.props.value === 'deleted-root'), false);
});

test('本次金额更新登记后余额，超额明确提示，草稿应收保持未确定', () => {
  const app = harness({amount: '25.00'}); let tree = app.render();
  assert.equal(text(entry(tree, '本次登记后待收')), '本次登记后待收¥50.00');
  app.props.amount = '80.00'; tree = app.render();
  assert.equal(text(entry(tree, '本次登记后待收')), '本次登记后待收¥0.00');
  assert.match(text(balance(tree)), /本次金额超过当前待收 ¥5\.00/);
  app.props.amount = '-25'; tree = app.render();
  assert.equal(nodes(balance(tree)).some(node => node.type === 'dt' && text(node) === '本次登记后待收'), false);
  choose(tree, '所属项目', 'draft'); app.props.amount = '20.00'; tree = app.render();
  assert.match(text(entry(tree, '应收金额')), /尚未确定/);
  assert.equal(text(entry(tree, '当前待收')), '当前待收尚未确定');
  assert.equal(nodes(balance(tree)).some(node => node.type === 'dt' && text(node) === '本次登记后待收'), false);
});

test('付款可留合作项目公共付款或指定子项目，金额不模拟收款后的待收', () => {
  const app = harness({initialProjectId: 'root-a', type: '付款', amount: '25.00'}); let tree = app.render();
  assert.equal(control(tree, '所属小项目').props.required, false);
  assert.equal(control(tree, '所属小项目').props.value, '');
  assert.match(text(control(tree, '所属小项目')), /合作项目公共付款/);
  assert.equal(hidden(tree, 'project_id').props.value, 'root-a');
  assert.equal(optionalHidden(tree, 'subproject_id'), undefined);
  choose(tree, '所属小项目', 'child-a'); tree = app.render();
  assert.equal(hidden(tree, 'project_id').props.value, 'child-a');
  assert.equal(nodes(balance(tree)).some(node => node.type === 'dt' && text(node) === '本次登记后待收'), false);
  choose(tree, '所属小项目', ''); tree = app.render();
  assert.equal(hidden(tree, 'project_id').props.value, 'root-a');
});

test('source_quote_id旧收款归到正确报价组，未分配提示只包含真正未分配款', () => {
  const app = harness({initialProjectId: 'root-b'}); let tree = app.render();
  const before = JSON.stringify(app.props);
  choose(tree, '所属小项目', 'root-b:bedroom'); tree = app.render();
  assert.equal(text(entry(tree, '累计已收')), '累计已收¥45.00');
  assert.equal(text(entry(tree, '当前待收')), '当前待收¥155.00');
  assert.match(text(find(tree, node => node.props.className === 'receiptUnallocated')), /¥10\.00/);
  choose(tree, '所属小项目', 'root-b:legacy'); tree = app.render();
  assert.equal(text(entry(tree, '累计已收')), '累计已收¥5.00');
  assert.equal(text(entry(tree, '当前待收')), '当前待收¥95.00');
  assert.equal(JSON.stringify(app.props), before);
});
