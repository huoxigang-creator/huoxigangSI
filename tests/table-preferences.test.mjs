import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync('lib/table-preferences.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const {clampTableColumnWidth, emptyTablePreferences, readTablePreferences, tablePreferenceKey, orderedRows, mergeVisibleOrder, moveTableRow, dropTableRow, orderedColumns, dropTableColumn} = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

test('坏掉、缺少或异常形状的本地存储恢复为默认偏好', () => {
  for (const raw of [null, '', '{', 'null', '[]', '3', '"text"', '{"hidden":false,"order":{}}']) assert.deepEqual(readTablePreferences(raw), {hidden: [], order: []});
  const first = emptyTablePreferences(), second = emptyTablePreferences(); first.hidden.push('name');
  assert.deepEqual(second, {hidden: [], order: []});
});

test('本地偏好仅保留合法列ID和行ID，去重且有长度和项数边界', () => {
  const result = readTablePreferences(JSON.stringify({hidden: ['name', 1, null, 'name', 'x'.repeat(513)], order: ['a', 'b', 'a', {}, 'c'], unwanted: 'ignored'}));
  assert.deepEqual(result, {hidden: ['name'], order: ['a', 'b', 'c']});
  assert.equal(readTablePreferences(JSON.stringify({order: Array.from({length: 5010}, (_, index) => 'id-' + index)})).order.length, 5000);
});

test('列宽兼容旧偏好，保留隐藏列与行排序并清理非法值', () => {
  assert.deepEqual(readTablePreferences('{"hidden":["金额"],"order":["b","a"]}'),{hidden:['金额'],order:['b','a']});
  const raw=JSON.stringify({hidden:['金额'],order:['b','a'],widths:{'勾选':36,'名称':240.4,'金额':1200,'窄列':35,'过宽':1201,'字符串':'80','负数':-1,'':100}});
  assert.deepEqual(readTablePreferences(raw),{hidden:['金额'],order:['b','a'],widths:{'勾选':36,'名称':240,'金额':1200}});
  for(const widths of [null,false,[],[80],{'错误':null}])assert.deepEqual(readTablePreferences(JSON.stringify({widths})),{hidden:[],order:[]});
});

test('列宽存储有项数边界，特殊键不污染对象原型', () => {
  const widths=Object.fromEntries(Array.from({length:510},(_,index)=>['column-'+index,100]));
  assert.equal(Object.keys(readTablePreferences(JSON.stringify({widths})).widths).length,500);
  const value=readTablePreferences('{"widths":{"__proto__":100,"constructor":150,"'+ 'x'.repeat(513)+'":200}}');
  assert.equal(Object.getPrototypeOf(value.widths),Object.prototype);assert.equal(Object.hasOwn(value.widths,'__proto__'),true);assert.equal(value.widths.__proto__,100);assert.equal(value.widths.constructor,150);assert.equal(Object.keys(value.widths).length,2);
});

test('普通列宽在80至1200像素内，勾选和序号允许36像素', () => {
  assert.equal(clampTableColumnWidth(-100),80);assert.equal(clampTableColumnWidth(10000),1200);assert.equal(clampTableColumnWidth(245.6),246);assert.equal(clampTableColumnWidth(NaN),80);assert.equal(clampTableColumnWidth(Infinity),80);assert.equal(clampTableColumnWidth(10,36),36);assert.equal(clampTableColumnWidth(50,36),50);
});

test('按账号、表格和父项目独立保存，含特殊字符的标识无串号碰撞', () => {
  const keys = [tablePreferenceKey('alice', 'quotes', 'project-a'), tablePreferenceKey('bob', 'quotes', 'project-a'), tablePreferenceKey('alice', 'payments', 'project-a'), tablePreferenceKey('alice', 'quotes', 'project-b'), tablePreferenceKey('alice|quotes', 'project-a', ''), tablePreferenceKey('alice', 'quotes|project-a', '')];
  assert.equal(new Set(keys).size, keys.length); assert.equal(tablePreferenceKey('alice', 'quotes', 'project-a'), keys[0]);
  assert.notEqual(tablePreferenceKey('甲"乙', '丙', ''), tablePreferenceKey('甲', '乙"丙', ''));
  const localStorage = new Map([[keys[0], '{"hidden":["金额"],"order":["a"]}']]);
  assert.deepEqual(readTablePreferences(localStorage.get(keys[1]) || null), {hidden: [], order: []});
});

test('自定义行排序生效，新增行按原输入顺序接在已有偏好后且不改变原数据', () => {
  const rows = [{id: 'a'}, {id: 'new-1'}, {id: 'b'}, {id: 'new-2'}, {id: 'c'}];
  const source = JSON.stringify(rows), order = ['c', 'deleted-row', 'a', 'b'];
  assert.deepEqual(orderedRows(rows, row => row.id, order).map(row => row.id), ['c', 'a', 'b', 'new-1', 'new-2']);
  assert.equal(JSON.stringify(rows), source); assert.deepEqual(order, ['c', 'deleted-row', 'a', 'b']);
});

test('筛选后移动只替换可见排序槽，隐藏行位置保留，清除筛选可正确复现', () => {
  const previous = ['a', 'b', 'c', 'd', 'e'];
  const merged = mergeVisibleOrder(previous, ['e', 'a', 'c']);
  assert.deepEqual(merged, ['e', 'b', 'a', 'd', 'c']);
  assert.deepEqual(orderedRows(['a', 'b', 'c', 'd', 'e'], value => value, merged), merged);
  assert.deepEqual(previous, ['a', 'b', 'c', 'd', 'e']);
});

test('筛选中新增行进入尾部槽，保留暂时隐藏和已删除行偏好', () => {
  const previous = ['a', 'hidden', 'b', 'deleted'];
  const merged = mergeVisibleOrder(previous, ['b', 'new', 'a']);
  assert.deepEqual(merged, ['b', 'hidden', 'new', 'deleted', 'a']);
  assert.deepEqual(orderedRows(['a', 'b', 'new'], value => value, merged), ['b', 'new', 'a']);
  assert.deepEqual(mergeVisibleOrder(merged, []), merged);
});

test('上移下移可双向移动一格，首尾和找不到的行不会越界', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(moveTableRow(ids, 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(moveTableRow(ids, 'b', 1), ['a', 'c', 'b']);
  assert.deepEqual(moveTableRow(ids, 'a', -1), ids); assert.deepEqual(moveTableRow(ids, 'c', 1), ids); assert.deepEqual(moveTableRow(ids, 'missing', 1), ids); assert.deepEqual(moveTableRow([], 'a', -1), []);
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('拖拽到目标位置支持向上和向下，相邻拖拽一致，原数组保持', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(dropTableRow(ids, 'a', 'd'), ['b', 'c', 'd', 'a']);
  assert.deepEqual(dropTableRow(ids, 'd', 'a'), ['d', 'a', 'b', 'c']);
  assert.deepEqual(dropTableRow(ids, 'b', 'c'), ['a', 'c', 'b', 'd']);
  assert.deepEqual(dropTableRow(ids, 'c', 'b'), ['a', 'c', 'b', 'd']);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd']);
});

test('拖拽同一行、缺少源或目标、空表安全返回副本', () => {
  const ids = ['a', 'b'];
  for (const args of [['a', 'a'], ['missing', 'b'], ['a', 'missing']]) {const result = dropTableRow(ids, ...args); assert.deepEqual(result, ids); assert.notEqual(result, ids);}
  assert.deepEqual(dropTableRow([], 'a', 'b'), []);
});

test('筛选列表拖拽后合并不移动筛选外行，正向与反向都保持槽位', () => {
  const original = ['a', 'x', 'b', 'y', 'c'];
  const visible = ['a', 'b', 'c'];
  assert.deepEqual(mergeVisibleOrder(original, dropTableRow(visible, 'a', 'c')), ['b', 'x', 'c', 'y', 'a']);
  assert.deepEqual(mergeVisibleOrder(original, dropTableRow(visible, 'c', 'a')), ['c', 'x', 'a', 'y', 'b']);
});

test('列顺序与行顺序独立，旧偏好兼容且列ID去重限量', () => {
  const value = readTablePreferences(JSON.stringify({hidden:['model'],order:['row-b','row-a'],columnOrder:['model','name','model',null,1,'','x'.repeat(513)],widths:{name:280}}));
  assert.deepEqual(value,{hidden:['model'],order:['row-b','row-a'],widths:{name:280},columnOrder:['model','name']});
  assert.equal(readTablePreferences(JSON.stringify({columnOrder:Array.from({length:600},(_,index)=>'field-'+index)})).columnOrder.length,500);
  for(const columnOrder of [null,{},false,[]])assert.deepEqual(readTablePreferences(JSON.stringify({columnOrder})),{hidden:[],order:[]});
});

test('持久列排序忽略过期ID，固定选择/操作原槽不移动，新字段保留稳定身份', () => {
  const columns=[{id:'selection',fixed:true},{id:'name'},{id:'model'},{id:'new'},{id:'actions',fixed:true}];
  const before=JSON.stringify(columns),result=orderedColumns(columns,['actions','model','deleted','name','selection']);
  assert.deepEqual(result.map(column=>column.id),['selection','model','name','new','actions']);
  assert.equal(result[1],columns[2]);assert.equal(result[2],columns[1]);assert.equal(JSON.stringify(columns),before);
});

test('拖动列保留隐藏列槽位，拒绝固定/未知/同一列目标且不修改源数据', () => {
  const columns=[{id:'selection',fixed:true},{id:'name'},{id:'model',hidden:true},{id:'quantity'},{id:'amount'},{id:'actions',fixed:true}],before=JSON.stringify(columns);
  assert.deepEqual(dropTableColumn(columns,'name','amount'),['selection','quantity','model','amount','name','actions']);
  for(const [from,to] of [['selection','amount'],['name','actions'],['name','model'],['unknown','amount'],['name','name']])assert.deepEqual(dropTableColumn(columns,from,to),columns.map(column=>column.id));
  assert.equal(JSON.stringify(columns),before);
});
