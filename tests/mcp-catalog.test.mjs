import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const asURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const detailsURL = asURL(compile(readFileSync('lib/payment-details.ts', 'utf8')));
const quotesURL = asURL(compile(readFileSync('lib/quotes.ts', 'utf8')));
const typesURL = asURL(compile(readFileSync('lib/catalog-types.ts', 'utf8')).replace("from './payment-details'", `from '${detailsURL}'`));
const catalogURL = asURL(compile(readFileSync('lib/catalog.ts', 'utf8').replace(/^import \{env\} from 'cloudflare:workers';\r?\n/, '')).replace("from 'zod'", `from '${import.meta.resolve('zod')}'`).replace("from './catalog-types'", `from '${typesURL}'`).replace("from './quotes'", `from '${quotesURL}'`));
const {createCatalogService, CatalogError} = await import(catalogURL);
const routeSource = readFileSync('app/mcp/route.ts', 'utf8').replace(/^import .*?;\r?\n/gm, '').replaceAll('export async function', 'async function');
const {createRoute} = await import(asURL(compile('export function createRoute({execute,BusinessError,catalogExecute,CatalogError}){\n' + routeSource + '\nreturn POST;\n}')));

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('drizzle/0000_slippery_lenny_balinger.sql', 'utf8'));
  t.after(() => sqlite.close());
  const database = {
    prepare(sql) {let args = []; return {sql, get args() {return args;}, bind(...values) {args = values; return this;}, async all() {return {results: sqlite.prepare(sql).all(...args)};}};},
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => ({meta: {changes: Number(sqlite.prepare(statement.sql).run(...statement.args).changes)}}));
        sqlite.exec('COMMIT'); return results;
      } catch (error) {sqlite.exec('ROLLBACK'); throw error;}
    },
  };
  const catalog = createCatalogService({database: () => database});
  let businessCalls = 0;
  const POST = createRoute({catalogExecute: catalog.execute, CatalogError, BusinessError: class extends Error {}, execute: async () => {businessCalls++; throw new Error('Wrong service');}});
  function seed(id, owner, kind, data) {sqlite.prepare('INSERT INTO records(id,owner,kind,project,data,created) VALUES(?,?,?,?,?,?)').run(id, owner, kind, '', JSON.stringify(data), '2026-10-12T00:00:00Z');}
  seed('receipt', 'alice', 'transaction', {type: '收款', amount: 2000000});
  seed('payment', 'alice', 'transaction', {type: '付款', amount: 1055900});
  seed('original-material', 'alice', 'material', {name: '原材料', expense_category: '材料费用', sale_price: 9876, unit: '张'});
  seed('another-account-material', 'bob', 'material', {name: '其他账号五金', expense_category: '五金费用', sale_price: 500, unit: '个'});
  seed('deleted-material', 'alice', 'material', {name: '删除材料', deleted: true});
  function post(method, params = {}, owner = 'alice') {
    const headers = {'Content-Type': 'application/json'};
    if (owner) headers['oai-authenticated-user-id'] = owner;
    return POST(new Request('https://mcp.test/mcp', {method: 'POST', headers, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})}));
  }
  async function call(name, args = {}, owner = 'alice') {
    const response = await post('tools/call', {name, arguments: args}, owner);
    const body = await response.json();
    return {response, body, result: body.result && (body.result.isError ? body.result.content[0].text : JSON.parse(body.result.content[0].text))};
  }
  const rows = () => sqlite.prepare('SELECT * FROM records ORDER BY id').all();
  const finances = () => sqlite.prepare("SELECT * FROM records WHERE kind='transaction' ORDER BY id").all();
  return {sqlite, post, call, rows, finances, businessCalls: () => businessCalls};
}

const hardware = overrides => ({id: 'hardware-import-row-1', name: '缓冲抽屉轨道', model: '350mm', attribute: '辅材', expense_category: '五金费用', unit: '付', sale_price: 16, note: '导入来源：五金销售单价.xlsx / 五金汇总 / 第12行', ...overrides});

test('MCP目录发现无需身份且不暴露数据或落库；定义只包含受限资料字段和元/分说明', async t => {
  const app = fixture(t), before = app.rows();
  const response = await app.post('tools/list', {}, null);
  assert.equal(response.status, 200);
  const {tools} = (await response.json()).result;
  const read = tools.find(value => value.name === 'get_catalog'), create = tools.find(value => value.name === 'create_material');
  assert.equal(read.annotations.readOnlyHint, true); assert.deepEqual(read.inputSchema.properties, {});
  assert.equal(create.annotations.readOnlyHint, false); assert.equal(create.annotations.destructiveHint, false);
  assert.deepEqual(create.inputSchema.required, ['name']); assert.equal(create.inputSchema.additionalProperties, false);
  assert.deepEqual(create.inputSchema.properties.expense_category.enum, ['柜体', '人工费用', '材料费用', '五金费用']);
  assert.deepEqual(create.inputSchema.properties.attribute.enum, ['主材', '辅材', '人工']);
  assert.equal(create.inputSchema.properties.name.maxLength, 100); assert.equal(create.inputSchema.properties.model.maxLength, 100); assert.equal(create.inputSchema.properties.unit.maxLength, 30);
  assert.equal(create.inputSchema.properties.areas.maxItems, 100); assert.equal(create.inputSchema.properties.note.maxLength, 2000);
  assert.equal(create.inputSchema.properties.sale_price.minimum, 0); assert.equal(create.inputSchema.properties.sale_price.maximum, 100000000);
  assert.match(create.inputSchema.properties.sale_price.description, /输入单位元.*返回单位分/);
  assert.match(create.inputSchema.properties.id.description, /重试必须复用/);
  assert.ok(!('owner' in create.inputSchema.properties)); assert.ok(!('project_id' in create.inputSchema.properties));
  assert.equal(JSON.stringify(tools).includes('其他账号五金'), false);
  assert.deepEqual(app.rows(), before); assert.equal(app.businessCalls(), 0);
});

test('MCP读取和创建缺少登录身份均401，未执行任何读取或写入', async t => {
  const app = fixture(t), before = app.rows();
  for (const [name, args] of [['get_catalog', {}], ['create_material', hardware()]]) {
    const result = await app.call(name, args, null);
    assert.equal(result.response.status, 401); assert.match(result.body.error, /登录身份/);
  }
  assert.deepEqual(app.rows(), before); assert.equal(app.businessCalls(), 0);
});

test('MCP目录只读当前账号活动记录，五金创建保留规格单位并按分存价，原材料和账目不变', async t => {
  const app = fixture(t), finances = app.finances();
  const original = app.rows().find(row => row.id === 'original-material');
  const beforeRead = app.rows(), read = await app.call('get_catalog');
  assert.deepEqual(read.result.materials.map(value => value.name), ['原材料']);
  assert.deepEqual(app.rows(), beforeRead);
  const created = await app.call('create_material', hardware({sale_price: 1.005, purchase_price: 0.5, owner: 'bob'}));
  assert.ok(!created.body.result.isError); assert.equal(created.result.sale_price, 101); assert.equal(created.result.purchase_price, 50);
  assert.equal(created.result.expense_category, '五金费用'); assert.equal(created.result.model, '350mm'); assert.equal(created.result.unit, '付');
  const record = app.rows().find(row => row.id === created.result.id); assert.equal(record.owner, 'alice');
  const bob = await app.call('get_catalog', {}, 'bob'); assert.deepEqual(bob.result.materials.map(value => value.name), ['其他账号五金']);
  const after = await app.call('get_catalog'); assert.equal(after.result.materials.find(value => value.id === created.result.id).sale_price, 101);
  assert.deepEqual(app.rows().find(row => row.id === 'original-material'), original); assert.deepEqual(app.finances(), finances); assert.equal(app.businessCalls(), 0);
});

test('MCP创建稳定ID同内容重试只留一条记录与审计，不同内容不覆盖或改变账目', async t => {
  const app = fixture(t), finances = app.finances();
  const first = await app.call('create_material', hardware());
  const repeat = await app.call('create_material', hardware());
  assert.equal(repeat.result.reused, true); assert.equal(repeat.result.id, first.result.id);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='material' AND id=?").get(first.result.id).n, 1);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='audit'").get().n, 1);
  const changed = await app.call('create_material', hardware({sale_price: 999}));
  assert.equal(changed.body.result.isError, true); assert.match(changed.result, /不同内容/);
  assert.equal((await app.call('get_catalog')).result.materials.find(value => value.id === first.result.id).sale_price, 1600);
  assert.deepEqual(app.finances(), finances);
});

test('MCP创建沿用后端价格、类别及长度校验，非法数据不生成材料或审计', async t => {
  const app = fixture(t), before = app.rows();
  for (const overrides of [{sale_price: -1}, {sale_price: 100000001}, {expense_category: '采购费用'}, {attribute: '五金'}, {name: ' '}, {model: 'x'.repeat(101)}, {unit: 'x'.repeat(31)}, {note: 'x'.repeat(2001)}, {conversion_factor: 0}]) {
    const result = await app.call('create_material', hardware(overrides));
    assert.equal(result.body.result.isError, true); assert.match(result.result, /输入字段不合法/);
  }
  assert.deepEqual(app.rows(), before); assert.equal(app.businessCalls(), 0);
});
