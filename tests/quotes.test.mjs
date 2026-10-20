import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const asURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const quotesURL = asURL(compile(readFileSync('lib/quotes.ts', 'utf8')));
const detailsURL = asURL(compile(readFileSync('lib/payment-details.ts', 'utf8')));
const businessURL = asURL(compile(readFileSync('lib/business.ts', 'utf8')).replace("from 'zod'", `from '${import.meta.resolve('zod')}'`).replaceAll("from './payment-details'", `from '${detailsURL}'`).replaceAll("from './quotes'", `from '${quotesURL}'`));
const catalogTypesURL = asURL(compile(readFileSync('lib/catalog-types.ts', 'utf8')).replace("from './payment-details'", `from '${detailsURL}'`));
const catalogURL = asURL(compile(readFileSync('lib/catalog.ts', 'utf8').replace(/^import \{env\} from 'cloudflare:workers';\r?\n/, '')).replace("from 'zod'", `from '${import.meta.resolve('zod')}'`).replace("from './catalog-types'", `from '${catalogTypesURL}'`).replace("from './quotes'", `from '${quotesURL}'`));
const {QUOTE_CATEGORIES, normalizeQuoteItem, quoteGroupKey, groupQuotes, getAdoptedQuotes} = await import(quotesURL);
const {quoteSchema, quoteTotal, summarize} = await import(businessURL);
const {createTrashService} = await import(asURL(compile(readFileSync('lib/trash.ts', 'utf8').replace(/^import .*?;\r?\n/gm, ''))));
const A = '10000000-0000-4000-a000-000000000001';
const B = '10000000-0000-4000-a000-000000000002';
const C = '10000000-0000-4000-a000-000000000003';
const line = (price = 100, category = '材料费用') => ({name: '测试明细', category, model: '18mm', unit: '张', quantity: 1, price, note: '测试备注'});

async function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('drizzle/0000_slippery_lenny_balinger.sql', 'utf8'));
  t.after(() => sqlite.close());
  const controls = {beforeBatch: null, auditFailure: false};
  const database = {
    prepare(sql) {
      let args = [];
      return {sql, get args() {return args;}, bind(...values) {args = values; return this;}, async all() {return {results: sqlite.prepare(sql).all(...args)};}};
    },
    async batch(statements) {
      if (controls.beforeBatch) {const callback = controls.beforeBatch; controls.beforeBatch = null; await callback();}
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => {
          if (controls.auditFailure && statement.args[2] === 'audit') throw new Error('simulated audit failure');
          return {meta: {changes: Number(sqlite.prepare(statement.sql).run(...statement.args).changes)}};
        });
        sqlite.exec('COMMIT'); return results;
      } catch (error) {sqlite.exec('ROLLBACK'); throw error;}
    },
  };
  globalThis.quoteTestEnv = {DB: database};
  const serviceURL = asURL(compile(readFileSync('lib/service.ts', 'utf8')).replace("import { env } from 'cloudflare:workers';", 'const env=globalThis.quoteTestEnv;').replace("import { env } from './local-env';", 'const env=globalThis.quoteTestEnv;').replace("from './business'", `from '${businessURL}'`)) + '#' + crypto.randomUUID();
  const {execute, state} = await import(serviceURL);
  const trash = createTrashService({database: () => database, bucket: () => undefined});
  const project = await execute('alice', 'create_project', {name: '合作项目', customer: '测试客户'});
  const quote = (group, title, price = 100, parent = project.id) => ({project_id: parent, ...(group === undefined ? {} : {subproject_id: group, subproject_name: group === A ? '小项目A' : group === B ? '小项目B' : '小项目C'}), title, items: [line(price)]});
  const record = id => {const row = sqlite.prepare('SELECT * FROM records WHERE id=?').get(id); return row && {...row, data: JSON.parse(row.data)};};
  const audits = action => sqlite.prepare("SELECT data FROM records WHERE kind='audit'").all().map(row => JSON.parse(row.data)).filter(row => !action || row.action === action);
  return {execute, state, trash, sqlite, controls, project, quote, record, audits, serviceURL};
}

test('旧报价不迁移、不重写金额，缺省明细补齐仅用于显示', () => {
  const quotes = [{id: 'q', project: 'p', title: '项目总价', adopted: true, total: 2400000, items: [{name: '原总价', unit: '项', quantity: 1, price: 24000}]}];
  const original = JSON.stringify(quotes);
  const result = summarize([{id: 'p', budget: 0}], quotes, [{project: 'p', type: '收款', amount: 2000000}, {project: 'p', type: '付款', amount: 1055900}])[0];
  assert.deepEqual([result.contract, result.received, result.paid, result.remaining, result.cash], [2400000, 2000000, 1055900, 400000, 944100]);
  assert.deepEqual(normalizeQuoteItem(quotes[0].items[0]), {name: '原总价', category: '材料费用', model: '', unit: '项', quantity: 1, price: 24000, note: ''});
  assert.equal(JSON.stringify(quotes), original); assert.equal(quoteGroupKey(quotes[0]), 'legacy');
});

test('四类报价明细规格与备注验证，沿用逐行单价先取分的金额规则', () => {
  assert.deepEqual(QUOTE_CATEGORIES, ['柜体', '人工费用', '材料费用', '五金费用']);
  const parsed = quoteSchema.parse({project_id: 'p', subproject_id: A.toUpperCase(), title: '报价', items: QUOTE_CATEGORIES.map(category => ({...line(1.005, category), quantity: 1.5}))});
  assert.equal(parsed.subproject_id, A); assert.equal(quoteTotal(parsed.items), 600);
  const legacy = quoteSchema.parse({project_id: 'p', title: '旧格式', items: [{name: '旧行', unit: '', quantity: 1, price: 0}]}).items[0];
  assert.equal(legacy.category, '材料费用'); assert.equal(legacy.model, ''); assert.equal(legacy.note, '');
  for (const item of [{...line(), category: '成本'}, {...line(), quantity: Infinity}, {...line(), quantity: 0}, {...line(), price: NaN}, {...line(), price: -1}, {...line(), model: 'x'.repeat(101)}, {...line(), note: 'x'.repeat(501)}]) assert.equal(quoteSchema.safeParse({project_id: 'p', title: '错误', items: [item]}).success, false);
  assert.equal(quoteSchema.safeParse({project_id: 'p', title: '500项', items: Array.from({length: 500}, () => line())}).success, true);
  assert.equal(quoteSchema.safeParse({project_id: 'p', title: '501项', items: Array.from({length: 501}, () => line())}).success, false);
  assert.equal(quoteSchema.safeParse({project_id: 'p', subproject_id: 'legacy', title: '保留组冲突', items: [line()]}).success, false);
  assert.equal(quoteSchema.safeParse({project_id: 'p', title: '金额精度超限', items: Array.from({length: 500}, () => ({...line(10000000), quantity: 100000}))}).success, false);
});

test('按小项目组合报价版本，最新采纳只计一次且父项目互不混合', () => {
  const versions = [
    {id: 'a1', project: 'p', subproject_id: A, subproject_name: '第一户', title: '第一版', total: 10000, adopted: true, updated: '2026-10-01'},
    {id: 'a2', project: 'p', subproject_id: A, subproject_name: '第一户', title: '第二版', total: 20000, adopted: true, updated: '2026-10-02'},
    {id: 'a3', project: 'p', subproject_id: A, title: '删除新版', total: 99000, adopted: true, deleted: true, updated: '2026-10-03'},
    {id: 'b', project: 'p', subproject_id: B, subproject_name: '第二户', title: '标准', total: 30000, adopted: true},
    {id: 'legacy-p', project: 'p', title: '原报价', total: 40000, adopted: true},
    {id: 'legacy-other', project: 'other', title: '另项目原报价', total: 50000, adopted: true},
  ];
  assert.deepEqual(getAdoptedQuotes(versions).map(quote => quote.id), ['a2', 'b', 'legacy-p', 'legacy-other']);
  const groups = groupQuotes(versions.filter(quote => quote.project === 'p'));
  assert.equal(groups.length, 3); const first = groups.find(group => group.id === A);
  assert.equal(first.name, '第一户'); assert.equal(first.total, 20000); assert.equal(first.adopted.id, 'a2'); assert.deepEqual(first.quotes.map(quote => quote.id), ['a2', 'a1']);
  assert.equal(summarize([{id: 'p', budget: 0}], versions, [])[0].contract, 90000);
});

test('多个独立小项目同时采纳，合同合计相加，实际收付款不变', async t => {
  const app = await fixture(t);
  const legacy = await app.execute('alice', 'create_quote', app.quote(undefined, '原总价', 24000));
  const a = await app.execute('alice', 'create_quote', app.quote(A, '第一版', 100));
  const b = await app.execute('alice', 'create_quote', app.quote(B, '第一版', 200));
  for (const quote of [legacy, a, b]) await app.execute('alice', 'adopt_quote', {id: quote.id});
  await app.execute('alice', 'record_transaction', {project_id: app.project.id, type: '收款', amount: 20000, category: '已收款', date: '2026-10-12', request_id: 'quote-test-receipt'});
  await app.execute('alice', 'record_transaction', {project_id: app.project.id, type: '付款', amount: 10559, category: '材料付款', date: '2026-10-12', request_id: 'quote-test-payment'});
  const workspace = await app.state('alice');
  assert.equal(workspace.quotes.filter(quote => quote.adopted).length, 3);
  assert.deepEqual([workspace.projects[0].contract, workspace.projects[0].received, workspace.projects[0].paid, workspace.projects[0].cash], [2430000, 2000000, 1055900, 944100]);
  assert.equal((await app.execute('alice', 'get_report', {})).totals.contract, 2430000);
});

test('采纳同组新版本只替换这一户，旧MCP缺省报价仍是一组', async t => {
  const app = await fixture(t);
  const a1 = await app.execute('alice', 'create_quote', app.quote(A, 'A第一版', 100));
  const a2 = await app.execute('alice', 'create_quote', app.quote(A, 'A第二版', 150));
  const b = await app.execute('alice', 'create_quote', app.quote(B, 'B第一版', 200));
  const l1 = await app.execute('alice', 'create_quote', app.quote(undefined, '旧报价一', 300));
  const l2 = await app.execute('alice', 'create_quote', app.quote('', '旧报价二', 350));
  for (const quote of [a1, b, l1, a2, l2]) await app.execute('alice', 'adopt_quote', {id: quote.id});
  assert.equal(app.record(a1.id).data.adopted, false); assert.equal(app.record(a2.id).data.adopted, true); assert.equal(app.record(b.id).data.adopted, true);
  assert.equal(app.record(l1.id).data.adopted, false); assert.equal(app.record(l2.id).data.adopted, true);
  assert.equal((await app.state('alice')).projects[0].contract, 70000);
});

test('草稿修改不允许移动小项目或父项目，省略组信息保留已有归属', async t => {
  const app = await fixture(t), q = await app.execute('alice', 'create_quote', app.quote(A, '草稿'));
  const other = await app.execute('alice', 'create_project', {name: '另一个项目', customer: '测试客户'});
  await assert.rejects(app.execute('alice', 'update_quote', {...app.quote(B, '试图移动'), id: q.id}), /小项目/);
  await assert.rejects(app.execute('alice', 'update_quote', {...app.quote(A, '试图移父', 100, other.id), id: q.id}), /其他项目/);
  const saved = await app.execute('alice', 'update_quote', {...app.quote(undefined, '保留归属', 200), id: q.id});
  assert.equal(saved.subproject_id, A); assert.equal(saved.subproject_name, '小项目A'); assert.equal(saved.total, 20000);
  await assert.rejects(app.execute('alice', 'update_quote', {...app.quote('', '试图回旧组'), id: q.id}), /小项目/);
  assert.equal(app.record(q.id).data.subproject_id, A);
});

test('小项目UUID不能借用于其他项目、账号或已回收小项目', async t => {
  const app = await fixture(t), q = await app.execute('alice', 'create_quote', app.quote(A, '保留编号'));
  const other = await app.execute('alice', 'create_project', {name: '其他合作项目', customer: '测试客户'});
  const bob = await app.execute('bob', 'create_project', {name: '其他账号', customer: '测试客户'});
  await assert.rejects(app.execute('alice', 'create_quote', app.quote(A, '借用另项目', 100, other.id)), error => error.status === 409);
  await assert.rejects(app.execute('bob', 'create_quote', app.quote(A, '借用其他账号', 100, bob.id)), error => error.status === 409);
  await app.trash.execute('alice', 'delete_record', {id: q.id});
  await assert.rejects(app.execute('alice', 'create_quote', app.quote(A, '借用已删组', 100, other.id)), error => error.status === 409);
  const version = await app.execute('alice', 'create_quote', app.quote(A, '同一户的新版本'));
  assert.equal(version.subproject_id, A); assert.equal(app.record(q.id).data.deleted, true);
});

test('并发新小项目借用同UUID由原子INSERT拒绝，首个归属保持且无假审计', async t => {
  const app = await fixture(t), bob = await app.execute('bob', 'create_project', {name: '另账号项目', customer: '测试客户'}); let first;
  app.controls.beforeBatch = async () => {first = await app.execute('bob', 'create_quote', app.quote(C, '抢先保存', 100, bob.id));};
  await assert.rejects(app.execute('alice', 'create_quote', app.quote(C, '不应保存')), error => error.status === 409);
  assert.equal(app.record(first.id).owner, 'bob'); assert.equal((await app.state('alice')).quotes.length, 0); assert.equal(app.audits('create_quote').length, 1);
});

test('采纳目标CAS失效不会取消同组旧版或其他组采纳', async t => {
  const app = await fixture(t), old = await app.execute('alice', 'create_quote', app.quote(A, '旧采纳'));
  const target = await app.execute('alice', 'create_quote', app.quote(A, '新目标', 200));
  const other = await app.execute('alice', 'create_quote', app.quote(B, '另一户', 300));
  await app.execute('alice', 'adopt_quote', {id: old.id}); await app.execute('alice', 'adopt_quote', {id: other.id});
  app.controls.beforeBatch = async () => {await app.execute('alice', 'update_quote', {...app.quote(A, '目标被修改', 400), id: target.id});};
  await assert.rejects(app.execute('alice', 'adopt_quote', {id: target.id}), error => error.status === 409);
  assert.equal(app.record(old.id).data.adopted, true); assert.equal(app.record(other.id).data.adopted, true); assert.equal(app.record(target.id).data.adopted, false); assert.equal(app.record(target.id).data.total, 40000);
  assert.equal(app.audits('adopt_quote').length, 2);
});

test('采纳竞争实时清理同组版本，另一组并发采纳不受影响', async t => {
  const app = await fixture(t), old = await app.execute('alice', 'create_quote', app.quote(A, '旧版'));
  const b = await app.execute('alice', 'create_quote', app.quote(A, '新版B', 200));
  const c = await app.execute('alice', 'create_quote', app.quote(A, '新版C', 300));
  const other = await app.execute('alice', 'create_quote', app.quote(B, '另一户', 400));
  await app.execute('alice', 'adopt_quote', {id: old.id});
  app.controls.beforeBatch = async () => {await app.execute('alice', 'adopt_quote', {id: c.id}); await app.execute('alice', 'adopt_quote', {id: other.id});};
  await app.execute('alice', 'adopt_quote', {id: b.id});
  assert.equal(app.record(old.id).data.adopted, false); assert.equal(app.record(c.id).data.adopted, false); assert.equal(app.record(b.id).data.adopted, true); assert.equal(app.record(other.id).data.adopted, true);
  assert.equal((await app.state('alice')).projects[0].contract, 60000);
});

test('已采纳报价恢复仅检查同组，其他组仍可同时采纳且金额不变', async t => {
  const app = await fixture(t), a = await app.execute('alice', 'create_quote', app.quote(A, 'A', 100));
  const b = await app.execute('alice', 'create_quote', app.quote(B, 'B', 200));
  await app.execute('alice', 'adopt_quote', {id: a.id}); await app.trash.execute('alice', 'delete_record', {id: a.id});
  await app.execute('alice', 'adopt_quote', {id: b.id});
  const restored = await app.trash.execute('alice', 'restore_record', {id: a.id});
  assert.equal(restored.restoredAsDraft, false); assert.equal(restored.record.adopted, true); assert.equal(restored.record.subproject_id, A); assert.equal(restored.record.total, 10000);
  assert.equal(app.record(b.id).data.adopted, true); assert.equal((await app.state('alice')).projects[0].contract, 30000);
});

test('同组新采纳已存在时旧版恢复草稿，实时恢复竞争不产生双采纳', async t => {
  const app = await fixture(t), old = await app.execute('alice', 'create_quote', app.quote(A, '旧版本', 100));
  const next = await app.execute('alice', 'create_quote', app.quote(A, '当前版本', 200));
  await app.execute('alice', 'adopt_quote', {id: old.id}); await app.trash.execute('alice', 'delete_record', {id: old.id});
  app.controls.beforeBatch = async () => {await app.execute('alice', 'adopt_quote', {id: next.id});};
  const restored = await app.trash.execute('alice', 'restore_record', {id: old.id});
  assert.equal(restored.restoredAsDraft, true); assert.equal(restored.record.adopted, false); assert.equal(restored.record.total, 10000); assert.equal(restored.record.subproject_id, A);
  assert.equal(app.record(next.id).data.adopted, true); assert.equal((await app.state('alice')).projects[0].contract, 20000);
});

test('读后恢复的同组采纳在新采纳批次清理，其他组不变', async t => {
  const app = await fixture(t), old = await app.execute('alice', 'create_quote', app.quote(A, '可恢复版本'));
  const target = await app.execute('alice', 'create_quote', app.quote(A, '新版本', 200));
  const other = await app.execute('alice', 'create_quote', app.quote(B, '另一户', 300));
  await app.execute('alice', 'adopt_quote', {id: old.id}); await app.execute('alice', 'adopt_quote', {id: other.id}); await app.trash.execute('alice', 'delete_record', {id: old.id});
  app.controls.beforeBatch = async () => {await app.trash.execute('alice', 'restore_record', {id: old.id});};
  await app.execute('alice', 'adopt_quote', {id: target.id});
  assert.equal(app.record(old.id).data.deleted, false); assert.equal(app.record(old.id).data.adopted, false); assert.equal(app.record(other.id).data.adopted, true); assert.equal(app.record(target.id).data.adopted, true);
});

test('子报价和采用仍隔离账号，审计失败回滚整个同组采纳操作', async t => {
  const app = await fixture(t), a = await app.execute('alice', 'create_quote', app.quote(A, '原版'));
  const b = await app.execute('alice', 'create_quote', app.quote(A, '新版本', 200));
  const other = await app.execute('alice', 'create_quote', app.quote(B, '另一户', 300));
  await app.execute('alice', 'adopt_quote', {id: a.id}); await app.execute('alice', 'adopt_quote', {id: other.id});
  await assert.rejects(app.execute('bob', 'adopt_quote', {id: b.id}), error => error.status === 404);
  await assert.rejects(app.trash.execute('bob', 'delete_record', {id: a.id}), error => error.status === 404);
  app.controls.auditFailure = true;
  await assert.rejects(app.execute('alice', 'adopt_quote', {id: b.id}), /audit failure/);
  assert.equal(app.record(a.id).data.adopted, true); assert.equal(app.record(other.id).data.adopted, true); assert.equal(app.record(b.id).data.adopted, false); assert.equal(app.audits('adopt_quote').length, 2);
});

test('MCP报价工具暴露四类明细与小项目版本语义，单价读写单位明确', async t => {
  const app = await fixture(t);
  const routeURL = asURL(compile(readFileSync('app/mcp/route.ts', 'utf8')).replace("from '../../lib/service'", `from '${app.serviceURL}'`).replace("from '../../lib/catalog'", `from '${catalogURL}'`));
  const {POST} = await import(routeURL);
  const response = await POST(new Request('https://quote.test/mcp', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list'})}));
  const tools = (await response.json()).result.tools;
  const create = tools.find(tool => tool.name === 'create_quote'), adopt = tools.find(tool => tool.name === 'adopt_quote');
  assert.deepEqual(create.inputSchema.properties.items.items.properties.category.enum, QUOTE_CATEGORIES);
  assert.equal(create.inputSchema.properties.items.maxItems, 500); assert(create.inputSchema.properties.subproject_id);
  assert.match(adopt.description, /只替换同一小项目/); assert.match(tools.find(tool => tool.name === 'get_workspace').description, /price.*元/);
});

const hugeQuote = (app, group, rows) => ({...app.quote(group, '精度边界测试'), items: Array.from({length: rows}, () => ({...line(10000000), quantity: 90000}))});

test('各组采纳汇总仍必须在整数分可精确计算范围内，拒绝不取消原采纳', async t => {
  const app = await fixture(t), old = await app.execute('alice', 'create_quote', app.quote(A, '正常旧版'));
  const other = await app.execute('alice', 'create_quote', hugeQuote(app, B, 50));
  const target = await app.execute('alice', 'create_quote', hugeQuote(app, A, 51));
  await app.execute('alice', 'adopt_quote', {id: old.id}); await app.execute('alice', 'adopt_quote', {id: other.id});
  await assert.rejects(app.execute('alice', 'adopt_quote', {id: target.id}), /超出可准确计算/);
  assert.equal(app.record(old.id).data.adopted, true); assert.equal(app.record(other.id).data.adopted, true); assert.equal(app.record(target.id).data.adopted, false); assert.equal(app.audits('adopt_quote').length, 2);
  assert.equal((await app.state('alice')).projects[0].contract, 4500000000010000);
});

test('另一组并发采纳令总额超限，原子合计条件同时保护目标CAS和同组取消', async t => {
  const app = await fixture(t), old = await app.execute('alice', 'create_quote', app.quote(A, '正常旧版'));
  const target = await app.execute('alice', 'create_quote', hugeQuote(app, A, 51));
  const other = await app.execute('alice', 'create_quote', hugeQuote(app, B, 50));
  await app.execute('alice', 'adopt_quote', {id: old.id});
  app.controls.beforeBatch = async () => {await app.execute('alice', 'adopt_quote', {id: other.id});};
  await assert.rejects(app.execute('alice', 'adopt_quote', {id: target.id}), error => error.status === 409);
  assert.equal(app.record(old.id).data.adopted, true); assert.equal(app.record(target.id).data.adopted, false); assert.equal(app.record(other.id).data.adopted, true); assert.equal(app.audits('adopt_quote').length, 2);
});

test('临近可精确计算上限的两组采纳有效，仍使用原行级rounding', async t => {
  const app = await fixture(t), a = await app.execute('alice', 'create_quote', hugeQuote(app, A, 50));
  const b = await app.execute('alice', 'create_quote', hugeQuote(app, B, 50));
  await app.execute('alice', 'adopt_quote', {id: a.id}); await app.execute('alice', 'adopt_quote', {id: b.id});
  const contract = (await app.state('alice')).projects[0].contract;
  assert.equal(contract, 9000000000000000); assert.equal(Number.isSafeInteger(contract), true);
});

test('恢复独立小项目使合同总额超限时恢复草稿，报价金额和其他组采纳保留', async t => {
  const app = await fixture(t), a = await app.execute('alice', 'create_quote', hugeQuote(app, A, 51));
  const b = await app.execute('alice', 'create_quote', hugeQuote(app, B, 50));
  await app.execute('alice', 'adopt_quote', {id: a.id}); await app.trash.execute('alice', 'delete_record', {id: a.id}); await app.execute('alice', 'adopt_quote', {id: b.id});
  const restored = await app.trash.execute('alice', 'restore_record', {id: a.id});
  assert.equal(restored.record.deleted, false); assert.equal(restored.record.adopted, false); assert.equal(restored.restoredAsDraft, true); assert.equal(restored.record.total, 4590000000000000);
  assert.equal(app.record(b.id).data.adopted, true); assert.equal((await app.state('alice')).projects[0].contract, 4500000000000000);
});
