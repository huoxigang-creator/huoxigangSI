import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const asURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const quotesURL = asURL(compile(readFileSync('lib/quotes.ts', 'utf8')));
const detailsURL = asURL(compile(readFileSync('lib/payment-details.ts', 'utf8')));
const businessURL = asURL(compile(readFileSync('lib/business.ts', 'utf8')).replace("from 'zod'", `from '${import.meta.resolve('zod')}'`).replaceAll("from './quotes'", `from '${quotesURL}'`).replaceAll("from './payment-details'", `from '${detailsURL}'`));
const overviewURL = asURL(compile(readFileSync('lib/order-overview.ts', 'utf8')).replace("from './quotes'", `from '${quotesURL}'`));
const {buildOrderRows, receiptTargets, shanghaiDate, shanghaiMonth} = await import(overviewURL);
const {transactionGroupKey} = await import(quotesURL);
const {summarize} = await import(businessURL);
const A = '20000000-0000-4000-a000-000000000001', B = '20000000-0000-4000-a000-000000000002';
const line = price => ({name: '衣柜', unit: '项', quantity: 1, price});

async function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('drizzle/0000_slippery_lenny_balinger.sql', 'utf8'));
  t.after(() => sqlite.close());
  const controls = {beforeBatch: null};
  const database = {
    prepare(sql) {let args = []; return {sql, get args() {return args;}, bind(...values) {args = values; return this;}, async all() {return {results: sqlite.prepare(sql).all(...args)};}};},
    async batch(statements) {
      if (controls.beforeBatch) {const callback = controls.beforeBatch; controls.beforeBatch = null; await callback();}
      sqlite.exec('BEGIN');
      try {const results = statements.map(statement => ({meta: {changes: Number(sqlite.prepare(statement.sql).run(...statement.args).changes)}})); sqlite.exec('COMMIT'); return results;}
      catch (error) {sqlite.exec('ROLLBACK'); throw error;}
    },
  };
  globalThis.orderOverviewTestEnv = {DB: database};
  const serviceURL = asURL(compile(readFileSync('lib/service.ts', 'utf8')).replace("import { env } from 'cloudflare:workers';", 'const env=globalThis.orderOverviewTestEnv;').replace("import { env } from './local-env';", 'const env=globalThis.orderOverviewTestEnv;').replace("from './business'", `from '${businessURL}'`)) + '#' + crypto.randomUUID();
  const {execute, state} = await import(serviceURL);
  const receipt = (project_id, request_id, amount = 10, extras = {}) => execute('alice', 'record_transaction', {project_id, request_id, amount, type: '收款', category: '定金', date: '2026-10-14', ...extras});
  const quote = async (project, price, extras = {}) => {const value = await execute('alice', 'create_quote', {project_id: project.id, title: '报价', items: [line(price)], ...extras}); await execute('alice', 'adopt_quote', {id: value.id}); return value;};
  return {sqlite, controls, execute, state, receipt, quote, serviceURL};
}

test('接单日期有效、收尾中可保存；更新省略日期保留旧值，旧记录按北京时间回退', async t => {
  const app = await fixture(t);
  const p = await app.execute('alice', 'create_project', {name: '项目', customer: '客户', status: '收尾中', order_date: '2026-09-30'});
  assert.equal(p.status, '收尾中');
  const updated = await app.execute('alice', 'update_project', {id: p.id, name: '项目更新', customer: '客户', status: '收尾中'});
  assert.equal(updated.order_date, '2026-09-30');
  await assert.rejects(app.execute('alice', 'update_project', {id: p.id, name: '项目', customer: '客户', order_date: '2026-02-30'}), /日期/);
  assert.equal(buildOrderRows([{...p, created: '2026-10-01T00:00:00Z'}], [], [])[0].orderDate, '2026-09-30');
  const [legacy] = buildOrderRows([{id: 'old', name: '旧订单', created: '2026-09-30T18:10:00Z'}], [], []);
  assert.equal(legacy.orderDate, '2026-10-01'); assert.equal(legacy.dateSource, 'created');
  assert.equal(legacy.receivable, null); assert.equal(legacy.remaining, null);
  const cleared = await app.execute('alice', 'update_project', {id: p.id, name: '项目更新', customer: '客户', order_date: ''});
  assert.equal(cleared.order_date, '');
  assert.equal((await app.state('alice')).projects[0].order_date, '');
  assert.equal(shanghaiDate('2026-09-30T16:00:00Z'), '2026-10-01');
  assert.equal(shanghaiMonth('2026-09-30T16:00:00Z'), '2026-10');
});

test('真实子项目独立核算且父容器不计订单，父级旧流水只提示未分配', async t => {
  const app = await fixture(t), root = await app.execute('alice', 'create_project', {name: '合作客户', customer: '李先生'});
  const a = await app.execute('alice', 'create_project', {parent_id: root.id, name: '项目甲', customer: '李先生', order_date: '2026-10-02'});
  const b = await app.execute('alice', 'create_project', {parent_id: root.id, name: '项目乙', customer: '李先生', order_date: '2026-10-03'});
  await app.quote(a, 100); await app.quote(b, 200);
  await app.receipt(a.id, 'child-payment-a', 30); await app.receipt(b.id, 'child-payment-b', 40); await app.receipt(root.id, 'root-legacy-payment', 50);
  const data = await app.state('alice'), rows = buildOrderRows(data.projects, data.quotes, data.transactions);
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.rootId === root.id && !row.subprojectId));
  assert.deepEqual(rows.find(row => row.projectId === a.id).remaining, 7000);
  assert.deepEqual(rows.find(row => row.projectId === b.id).remaining, 16000);
  const targets = receiptTargets(root, data.projects, data.quotes, data.transactions);
  assert.equal(targets.targets.length, 2); assert.equal(targets.unallocated, 5000);
  assert.equal(data.projects.find(project => project.id === root.id).unallocated_received, 5000);
  const report = await app.execute('alice', 'get_report', {});
  assert.equal(report.totals.received, 12000); assert.equal(report.totals.contract, 30000);
});

test('旧报价组分别计算、采纳新版去重、明确legacy归属；无组旧款不自动抵扣', async t => {
  const app = await fixture(t), root = await app.execute('alice', 'create_project', {name: '老合作项目', customer: '客户'});
  await app.quote(root, 100, {subproject_id: A, subproject_name: 'A房'});
  await app.quote(root, 150, {subproject_id: A, subproject_name: 'A房'});
  await app.quote(root, 80, {subproject_id: B, subproject_name: 'B房'});
  await app.quote(root, 20);
  const tx = await app.receipt(root.id, 'old-group-a-receipt', 50, {subproject_id: A.toUpperCase()});
  assert.equal(tx.subproject_id, A);
  await app.receipt(root.id, 'old-group-b-receipt', 90, {subproject_id: B});
  await app.receipt(root.id, 'old-group-legacy-receipt', 5, {subproject_id: 'legacy'});
  await app.receipt(root.id, 'old-group-unassigned', 10);
  await app.receipt(root.id, 'old-group-cost', 7, {subproject_id: A, type: '付款', category: '材料'});
  const data = await app.state('alice'), before = JSON.stringify(data), rows = buildOrderRows(data.projects, data.quotes, data.transactions);
  assert.equal(rows.length, 3);
  const a = rows.find(row => row.subprojectId === A), b = rows.find(row => row.subprojectId === B), legacy = rows.find(row => row.subprojectId === 'legacy');
  assert.deepEqual([a.contract, a.received, a.remaining, a.unallocated], [15000, 5000, 10000, 1000]);
  assert.deepEqual([b.received, b.remaining, b.overpaid], [9000, 0, 1000]);
  assert.deepEqual([legacy.received, legacy.remaining], [500, 1500]);
  assert.equal(receiptTargets(root, data.projects, data.quotes, data.transactions).unallocated, 1000);
  assert.equal(JSON.stringify(data), before);
  assert.equal(data.projects[0].received, 15500); assert.equal(data.projects[0].paid, 700);
});

test('组归属校验拒绝跨项目/终端客户；稳定请求重复一次，换组请求拒绝', async t => {
  const app = await fixture(t), p = await app.execute('alice', 'create_project', {name: '合作甲', customer: '客户'}), other = await app.execute('alice', 'create_project', {name: '合作乙', customer: '客户'});
  await app.quote(p, 100, {subproject_id: A}); await app.quote(p, 200, {subproject_id: B});
  const first = await app.receipt(p.id, 'idempotent-project-a', 10, {subproject_id: A});
  const replay = await app.receipt(p.id, 'idempotent-project-a', 10, {subproject_id: A});
  assert.equal(first.id, replay.id); assert.equal((await app.state('alice')).transactions.length, 1);
  await assert.rejects(app.receipt(p.id, 'idempotent-project-a', 10, {subproject_id: B}), error => error.status === 409);
  await assert.rejects(app.receipt(other.id, 'wrong-project-group', 10, {subproject_id: A}), /不属于/);
  const customer = await app.execute('alice', 'create_project', {project_type: 'customer', name: '客户整户', customer: '客户'});
  await assert.rejects(app.receipt(customer.id, 'customer-group-refused', 10, {subproject_id: A}), /整户/);
  await app.execute('alice', 'void_transaction', {id: first.id, reason: '测试作废'});
  const data = await app.state('alice');
  assert.equal(buildOrderRows(data.projects, data.quotes, data.transactions).find(row => row.subprojectId === A).received, 0);
});

test('组最后一个报价在写入前删除时原子拒绝收款，不产生流水或审计', async t => {
  const app = await fixture(t), p = await app.execute('alice', 'create_project', {name: '合作甲', customer: '客户'});
  const quote = await app.quote(p, 100, {subproject_id: A});
  app.controls.beforeBatch = () => app.sqlite.prepare("UPDATE records SET data=json_set(data,'$.deleted',json('true')) WHERE id=?").run(quote.id);
  await assert.rejects(app.receipt(p.id, 'group-removed-concurrently', 10, {subproject_id: A}), error => error.status === 409);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='transaction'").get().n, 0);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='audit' AND json_extract(data,'$.action')='record_transaction'").get().n, 0);
});

test('终端客户整户一单并扣优惠抹零，无采纳报价余额未确定', () => {
  const projects = [{id: 'customer', project_type: 'customer', name: '整户', customer: '张先生', order_date: '2026-10-10', discount_amount: 1000, rounding_amount: 20}, {id: 'draft', name: '草稿'}];
  const quotes = [{id: 'q1', project: 'customer', adopted: true, total: 10000, updated: '2026-10-01'}, {id: 'q2', project: 'customer', adopted: true, total: 12000, updated: '2026-10-02'}];
  const transactions = [{project: 'customer', type: '收款', amount: 5000}, {project: 'customer', type: '付款', amount: 3000}, {project: 'customer', type: '收款', amount: 9000, void: true}, {project: 'customer', type: '收款', amount: 9000, deleted: true}];
  const rows = buildOrderRows(projects, quotes, transactions), customer = rows.find(row => row.projectId === 'customer');
  assert.deepEqual([customer.contract, customer.receivable, customer.received, customer.remaining], [12000, 10980, 5000, 5980]);
  assert.equal(rows.find(row => row.projectId === 'draft').remaining, null);
});

test('既有source_quote_id可靠关联计入对应小项目，未知或跨项目来源仍未分配', () => {
  const projects = [{id: 'root', owner: 'alice', name: '合作项目', project_type: 'project'}];
  const quotes = [{id: 'qa', project: 'root', owner: 'alice', subproject_id: A, adopted: true, total: 10000}, {id: 'qb', project: 'root', owner: 'alice', subproject_id: B, adopted: true, total: 20000}, {id: 'foreign', project: 'other', owner: 'bob', subproject_id: A}];
  const linked = {project: 'root', owner: 'alice', type: '收款', amount: 3000, source_quote_id: 'qa'};
  const transactions = [linked, {project: 'root', type: '收款', amount: 1000, source_quote_id: 'unknown'}, {project: 'root', owner: 'alice', type: '收款', amount: 500, source_quote_id: 'foreign'}, {project: 'root', type: '收款', amount: 200}];
  const before = JSON.stringify(transactions), rows = buildOrderRows(projects, quotes, transactions);
  assert.equal(transactionGroupKey(linked, quotes), A);
  assert.equal(transactionGroupKey({...linked, owner: 'bob'}, quotes), null);
  assert.equal(rows.find(row => row.subprojectId === A).received, 3000);
  assert.equal(rows.find(row => row.subprojectId === A).remaining, 7000);
  assert.equal(rows.find(row => row.subprojectId === B).received, 0);
  assert.equal(receiptTargets(projects[0], projects, quotes, transactions).unallocated, 1700);
  const [summary] = summarize(projects, quotes, transactions);
  assert.equal(summary.unallocated_received, 1700); assert.equal(summary.received, 4700);
  assert.equal(JSON.stringify(transactions), before);
});

test('MCP公布接单日期、收尾中与旧组收付款归属', async t => {
  const app = await fixture(t);
  const routeURL = asURL(compile(readFileSync('app/mcp/route.ts', 'utf8')).replace("from '../../lib/service'", `from '${app.serviceURL}'`).replace("import { catalogExecute, CatalogError } from '../../lib/catalog';", 'const catalogExecute=()=>{}; class CatalogError extends Error {}'));
  const {POST} = await import(routeURL);
  const response = await POST(new Request('https://test.local/mcp', {method: 'POST', body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list'})}));
  const tools = (await response.json()).result.tools;
  assert.ok(tools.find(tool => tool.name === 'create_project').inputSchema.properties.status.enum.includes('收尾中'));
  assert.ok(tools.find(tool => tool.name === 'update_project').inputSchema.properties.order_date);
  const datePattern = new RegExp(tools.find(tool => tool.name === 'update_project').inputSchema.properties.order_date.pattern);
  assert.ok(datePattern.test('2026-10-14')); assert.ok(datePattern.test('')); assert.equal(datePattern.test('2026/10/14'), false);
  assert.ok(tools.find(tool => tool.name === 'record_transaction').inputSchema.properties.subproject_id);
});
