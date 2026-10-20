import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {setImmediate as nextTurn} from 'node:timers/promises';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url), root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = {kind: 'material', project: '', created: '2026-10-12T01:00:00Z', updated: '2026-10-12T01:00:00Z', revision: 'offline-revision', category: '', brand: '', style: '', model: '测试型号', unit: '个', origin: '', package_name: '', areas: ['测试区域'], purchase_price: 12345, sale_price: 20000, market_price: 25000, internal_price: 10000, contract_price: 15000, loss_rate: 2, conversion_factor: 1, special_code: '', other_code: '', note: '匿名备注', warehouse_enabled: false, warehouse: ''};
const materials = [
  {...base, id: 'labor-old', name: '历史安装人工', code: 'L01', attribute: '人工'},
  {...base, id: 'material-old', name: '历史板材', code: 'M01', attribute: '主材'},
  {...base, id: 'auxiliary-old', name: '历史辅材', code: 'A01', attribute: '辅材'},
  {...base, id: 'hardware-new', name: '匿名铰链', code: 'H01', attribute: '辅材', expense_category: '五金费用'},
  {...base, id: 'explicit-labor', name: '分类加工人工', code: 'L02', attribute: '主材', expense_category: '人工费用'},
];

// Exercise the real component and selection hook against an isolated in-memory catalog.
// No DOM, browser session, production fetch or real records participate in these tests.
function harness() {
  const slots = [], cache = new Map(), effects = [], requests = [], confirmations = [], changes = [];
  let cursor = 0, serial = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {...React,
    useContext(context) {return context._currentValue;},
    useState(initial) {const i = cursor++; if (!slots[i]) slots[i] = {value: typeof initial === 'function' ? initial() : initial}; return [slots[i].value, value => {slots[i].value = typeof value === 'function' ? value(slots[i].value) : value;}];},
    useRef(initial) {const i = cursor++; if (!slots[i]) slots[i] = {value: {current: initial}}; return slots[i].value;},
    useMemo(create, deps) {const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = {value: create(), deps}; return slots[i].value;},
    useCallback(callback, deps) {return hooks.useMemo(() => callback, deps);},
    useEffect(effect, deps) {const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) {slots[i] = {deps}; effects.push(effect);}},
  };
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const module = {exports: {}}; cache.set(path, module);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
    function localRequire(name) {
      if (name === 'react') return hooks;
      if (name === 'lucide-react') return new Proxy({}, {get: (_target, key) => function Icon() {return String(key);}});
      if (name.endsWith('.css')) return {};
      if (name.startsWith('.')) {const pathBase = resolve(dirname(path), name), target = [pathBase, pathBase + '.ts', pathBase + '.tsx'].find(existsSync); assert.ok(target, 'Module exists: ' + name); return load(target);}
      return require(name);
    }
    const fetch = async (url, options) => {
      const input = JSON.parse(options.body); requests.push({url, ...input});
      const result = input.action === 'get_catalog' ? {company: {name: '匿名公司'}, materials, purchase_orders: []} : {};
      return {ok: true, json: async () => ({ok: true, result})};
    };
    const evaluate = runInNewContext('(function(exports,require,module){' + code + '\n})', {console, Intl, Date, Set, Map, Error, Number, String, BigInt, fetch, crypto: {randomUUID: () => `00000000-0000-4000-a000-${String(++serial).padStart(12, '0')}`}, window: {confirm: message => {confirmations.push(message); return true;}, addEventListener() {}, removeEventListener() {}}});
    evaluate(module.exports, localRequire, module); return module.exports;
  }
  const Configuration = load(resolve(root, 'app/configuration.tsx')).default;
  const props = {onChanged: async () => {changes.push(true);}, expenseCategory: '材料费用'};
  function render(overrides = {}) {cursor = 0; effects.length = 0; const tree = Configuration({...props, ...overrides}); for (const effect of effects.splice(0)) effect(); return tree;}
  return {render, requests, confirmations, changes};
}
function elements(node) {if (Array.isArray(node)) return node.flatMap(elements); if (!node || typeof node !== 'object' || !node.props) return []; return [node, ...elements(node.props.children)];}
function text(node) {if (Array.isArray(node)) return node.map(text).join(''); if (node === null || node === undefined || typeof node === 'boolean') return ''; return typeof node === 'object' ? text(node.props?.children) : String(node);}
function find(tree, predicate, label) {const node = elements(tree).find(predicate); assert.ok(node, label); return node;}
function button(tree, name) {return find(tree, node => node.type === 'button' && text(node) === name && node.props.className !== 'link', 'Button: ' + name);}
function choice(tree, label) {return find(tree, node => node.type === 'select' && node.props['aria-label'] === label, 'Choice: ' + label);}
function input(tree, name) {return find(tree, node => node.type === 'input' && node.props.name === name, 'Input: ' + name);}
function checkbox(tree, label) {return find(tree, node => node.props.label === label, 'Checkbox: ' + label);}
function rows(tree) {return elements(tree).filter(node => node.type === 'tr' && node.props['data-row-id']).map(node => node.props['data-row-id']);}
function writes(app) {return app.requests.filter(request => request.action !== 'get_catalog');}
async function settle() {await nextTurn(); await nextTurn();}
async function start(app, expenseCategory) {app.render({expenseCategory}); await settle(); return app.render({expenseCategory});}
async function save(app, expenseCategory) {const tree = app.render({expenseCategory}), dialog = find(tree, node => node.props['aria-labelledby'] === 'material-editor-title', 'Editor dialog'); await find(dialog, node => node.type === 'form', 'Editor form').props.onSubmit({preventDefault() {}}); await settle(); return app.render({expenseCategory});}

test('配置三个费用类别分别筛选，历史人工归人工，旧辅材仍归材料且不猜成五金', async () => {
  const app = harness();
  assert.deepEqual(rows(await start(app, '人工费用')), ['labor-old', 'explicit-labor']);
  assert.deepEqual(rows(app.render({expenseCategory: '材料费用'})), ['material-old', 'auxiliary-old']);
  assert.deepEqual(rows(app.render({expenseCategory: '五金费用'})), ['hardware-new']);
  assert.equal(writes(app).length, 0);
});

test('各类别新建资料默认正确费用类型与属性，保存显式类型和元价格', async () => {
  for (const [category, entryName, attribute] of [['人工费用', '人工', '人工'], ['材料费用', '材料', '主材'], ['五金费用', '五金', '辅材']]) {
    const app = harness(); let tree = await start(app, category); button(tree, '新增' + entryName).props.onClick(); tree = app.render({expenseCategory: category});
    assert.equal(choice(tree, '费用类型').props.value, category); assert.equal(choice(tree, '材料属性').props.value, attribute);
    input(tree, 'name').props.onChange({target: {value: '匿名新增' + entryName}}); input(tree, 'purchase_price').props.onChange({target: {value: '12.34'}}); await save(app, category);
    const submitted = writes(app); assert.equal(submitted.length, 1); assert.equal(submitted[0].action, 'create_material'); assert.equal(submitted[0].args.expense_category, category); assert.equal(submitted[0].args.attribute, attribute); assert.equal(submitted[0].args.purchase_price, 12.34); assert.equal(app.changes.length, 1);
  }
});

test('编辑旧人工和复制五金保留费用类型、价钱与明细，复制使用新ID并清空代码', async () => {
  const edit = harness(); let tree = await start(edit, '人工费用'); checkbox(tree, '选择材料 历史安装人工').props.onChange(); tree = edit.render({expenseCategory: '人工费用'}); button(tree, '编辑').props.onClick(); tree = edit.render({expenseCategory: '人工费用'});
  assert.equal(choice(tree, '费用类型').props.value, '人工费用'); assert.equal(input(tree, 'purchase_price').props.value, '123.45'); await save(edit, '人工费用');
  assert.equal(writes(edit)[0].action, 'update_material'); assert.equal(writes(edit)[0].args.id, 'labor-old'); assert.equal(writes(edit)[0].args.revision, 'offline-revision'); assert.equal(writes(edit)[0].args.expense_category, '人工费用');
  const copy = harness(); tree = await start(copy, '五金费用'); checkbox(tree, '选择材料 匿名铰链').props.onChange(); tree = copy.render({expenseCategory: '五金费用'}); button(tree, '复制').props.onClick(); tree = copy.render({expenseCategory: '五金费用'});
  assert.equal(choice(tree, '费用类型').props.value, '五金费用'); assert.equal(input(tree, 'name').props.value, '匿名铰链（副本）'); assert.equal(input(tree, 'code').props.value, ''); assert.equal(input(tree, 'purchase_price').props.value, '123.45'); await save(copy, '五金费用');
  assert.equal(writes(copy)[0].action, 'create_material'); assert.notEqual(writes(copy)[0].args.id, 'hardware-new'); assert.equal(writes(copy)[0].args.expense_category, '五金费用'); assert.deepEqual(writes(copy)[0].args.areas, ['测试区域']); assert.ok(!('revision' in writes(copy)[0].args));
});

test('切换类别立即清空选择，批量删除只处理当前类别所选记录并保留回收站提示', async () => {
  const app = harness(); let tree = await start(app, '人工费用'); checkbox(tree, '全选当前材料').props.onChange(); tree = app.render({expenseCategory: '人工费用'}); assert.equal(button(tree, '删除所选').props.disabled, false);
  tree = app.render({expenseCategory: '五金费用'}); assert.equal(button(tree, '删除所选').props.disabled, true); await button(tree, '删除所选').props.onClick(); assert.equal(writes(app).length, 0);
  checkbox(tree, '全选当前材料').props.onChange(); tree = app.render({expenseCategory: '五金费用'}); await button(tree, '删除所选').props.onClick(); await settle();
  assert.deepEqual(writes(app).map(request => [request.url, request.action, request.args.id]), [['/api/trash', 'delete_record', 'hardware-new']]); assert.match(app.confirmations[0], /回收站恢复.*采购单.*快照保留/); assert.equal(app.changes.length, 1);
});

test('用户可明确修改费用类别；搜索仅过滤当前类别且不会向其他记录写入', async () => {
  const app = harness(); let tree = await start(app, '材料费用'); checkbox(tree, '选择材料 历史辅材').props.onChange(); tree = app.render({expenseCategory: '材料费用'}); button(tree, '编辑').props.onClick(); tree = app.render({expenseCategory: '材料费用'}); choice(tree, '费用类型').props.onChange({target: {value: '五金费用'}}); await save(app, '材料费用');
  assert.equal(writes(app).length, 1); assert.equal(writes(app)[0].args.id, 'auxiliary-old'); assert.equal(writes(app)[0].args.expense_category, '五金费用'); assert.equal(writes(app)[0].args.attribute, '辅材');
  tree = app.render({expenseCategory: '材料费用'}); find(tree, node => node.type === 'input' && node.props['aria-label'] === '搜索材料', 'Search').props.onChange({target: {value: '匿名铰链'}}); tree = app.render({expenseCategory: '材料费用'}); assert.deepEqual(rows(tree), []); assert.equal(writes(app).length, 1);
});
