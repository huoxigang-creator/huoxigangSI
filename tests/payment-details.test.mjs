import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const compile = text => ts.transpileModule(text, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const asURL = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const detailsURL = asURL(compile(readFileSync('lib/payment-details.ts', 'utf8')));
const {paymentAmountCents, paymentDetailsInput, paymentDetailsTotal, getPaymentDetails} = await import(detailsURL);
const quotesURL = asURL(compile(readFileSync('lib/quotes.ts', 'utf8')));
const catalogTypesURL = asURL(compile(readFileSync('lib/catalog-types.ts', 'utf8')).replace("from './payment-details'", `from '${detailsURL}'`));
const catalogURL = asURL(compile(readFileSync('lib/catalog.ts', 'utf8').replace(/^import \{env\} from 'cloudflare:workers';\r?\n/, '')).replace("from 'zod'", `from '${import.meta.resolve('zod')}'`).replace("from './catalog-types'", `from '${catalogTypesURL}'`).replace("from './quotes'", `from '${quotesURL}'`));
const businessURL = asURL(compile(readFileSync('lib/business.ts', 'utf8')).replace("from 'zod'", `from '${import.meta.resolve('zod')}'`).replaceAll("from './payment-details'", `from '${detailsURL}'`).replaceAll("from './quotes'", `from '${quotesURL}'`));
const {transactionSchema} = await import(businessURL);

async function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('drizzle/0000_slippery_lenny_balinger.sql', 'utf8'));
  t.after(() => sqlite.close());
  function prepare(sql) {let params = []; return {bind(...values) {params = values; return this;}, async all() {return {results: sqlite.prepare(sql).all(...params)};}, run() {return sqlite.prepare(sql).run(...params);}};}
  globalThis.paymentTestEnv = {DB: {prepare, async batch(statements) {sqlite.exec('BEGIN'); try {const result = statements.map(statement => statement.run()); sqlite.exec('COMMIT'); return result;} catch (error) {sqlite.exec('ROLLBACK'); throw error;}}}};
  const serviceURL = asURL(compile(readFileSync('lib/service.ts', 'utf8')).replace("import { env } from 'cloudflare:workers';", 'const env=globalThis.paymentTestEnv;').replace("import { env } from './local-env';", 'const env=globalThis.paymentTestEnv;').replace("from './business'", `from '${businessURL}'`)) + '#' + crypto.randomUUID();
  const {execute, state} = await import(serviceURL);
  const project = await execute('alice', 'create_project', {name: '测试明细项目', customer: '测试客户'});
  const defaults = {project_id: project.id, type: '付款', amount: 10559, category: '材料', date: '2026-10-12', note: '核对材料费用', request_id: 'payment-details-001'};
  return {sqlite, execute, state, project, defaults, serviceURL};
}

test('草稿逐行精确取分、过滤空白行，并保留元输入与分合计契约', () => {
  const drafts = [{name: ' ', amount: ''}, {name: ' 板材款 ', amount: '9939'}, {name: '封边条款', amount: '620'}];
  assert.deepEqual(paymentDetailsInput(drafts), [{name: '板材款', amount: 9939}, {name: '封边条款', amount: 620}]);
  assert.equal(paymentDetailsTotal(drafts), 1055900);
  const fractional = [{name: '一', amount: '1.005'}, {name: '二', amount: '1.005'}];
  assert.deepEqual(paymentDetailsInput(fractional), [{name: '一', amount: 1.01}, {name: '二', amount: 1.01}]);
  assert.equal(paymentDetailsTotal(fractional), 202);
  assert.equal(paymentAmountCents('100.004'), 10000); assert.equal(paymentAmountCents('100.005'), 10001);
  assert.equal(paymentAmountCents('.015'), 2);
  assert.deepEqual(paymentDetailsInput([{name: '', amount: ' '}]), []); assert.equal(paymentDetailsTotal([]), 0);
});

test('半填、非正额、非法格式、名称与项数超限均为中文错误', () => {
  for (const row of [{name: '板材', amount: ''}, {name: '', amount: '1'}, {name: '板材', amount: '0'}, {name: '板材', amount: '-1'}, {name: '板材', amount: '0.004'}, {name: '板材', amount: '1e3'}, {name: '板材', amount: 'NaN'}, {name: '板材', amount: 'Infinity'}, {name: '板材', amount: '100000001'}, {name: '板'.repeat(101), amount: '1'}]) {
    assert.throws(() => paymentDetailsInput([row]), error => /[\u4e00-\u9fff]/.test(error.message));
  }
  assert.throws(() => paymentDetailsInput(Array.from({length: 101}, () => ({name: '材料', amount: '1'}))), /最多100项/);
});

test('合计预览容忍逐步输入与删除，半填及非法行跳过且提交仍报错', () => {
  assert.equal(paymentDetailsTotal([{name: '', amount: ''}]), 0);
  assert.equal(paymentDetailsTotal([{name: '板材款', amount: ''}]), 0);
  assert.equal(paymentDetailsTotal([{name: '', amount: '9939'}]), 0);
  assert.equal(paymentDetailsTotal([{name: '板材款', amount: '9939'}]), 993900);
  const mixed = [{name: '板材款', amount: '9939'}, {name: '封边条款', amount: '620'}, {name: '新条目', amount: ''}, {name: '错误输入', amount: 'abc'}, {name: '负额', amount: '-1'}, {name: '过小金额', amount: '0.004'}];
  assert.equal(paymentDetailsTotal(mixed), 1055900);
  assert.equal(paymentDetailsTotal(mixed.slice(1)), 62000);
  assert.equal(paymentDetailsTotal(mixed.slice(2)), 0);
  assert.throws(() => paymentDetailsInput(mixed), /都要填写/);
});

test('schema行级取分后要求合计等于入账总额，收款禁止非空明细', () => {
  const base = {project_id: 'project', type: '付款', amount: 2.02, category: '材料', date: '2026-10-12', request_id: 'request-001', payment_items: [{name: '材料一', amount: 1.005}, {name: '材料二', amount: 1.005}]};
  assert.equal(transactionSchema.parse(base).payment_items.length, 2);
  assert.throws(() => transactionSchema.parse({...base, amount: 2.01}), /付款明细合计必须与付款总额一致/);
  assert.throws(() => transactionSchema.parse({...base, type: '收款'}), /收款不能包含付款明细/);
  for (const amount of [0, -1, 0.004, Infinity, 100000001]) assert.throws(() => transactionSchema.parse({...base, payment_items: [{name: '材料', amount}]}), error => error.name === 'ZodError');
  assert.throws(() => transactionSchema.parse({...base, payment_items: [{name: ' ', amount: 2.02}]}), /名称不能为空/);
  assert.throws(() => transactionSchema.parse({...base, payment_items: Array.from({length: 101}, () => ({name: '材料', amount: 1}))}), /最多100项/);
  assert.equal(transactionSchema.parse({...base, type: '收款', payment_items: []}).payment_items.length, 0);
});

test('记录后明细持久化及读取均为分，金额总额保持且记账一次', async t => {
  const {execute, state, defaults, sqlite} = await fixture(t);
  const args = {...defaults, payment_items: [{name: ' 板材款 ', amount: 9939}, {name: '封边条款', amount: 620}]};
  const transaction = await execute('alice', 'record_transaction', args);
  assert.equal(transaction.amount, 1055900);
  assert.deepEqual(transaction.payment_items, [{name: '板材款', amount: 993900}, {name: '封边条款', amount: 62000}]);
  const stored = JSON.parse(sqlite.prepare('SELECT data FROM records WHERE id = ?').get(transaction.id).data);
  assert.deepEqual(stored.payment_items, transaction.payment_items);
  const projectData = await execute('alice', 'get_project', {id: defaults.project_id});
  assert.deepEqual(projectData.transactions[0].payment_items, transaction.payment_items); assert.equal(projectData.project.paid, 1055900);
  assert.deepEqual(await execute('alice', 'record_transaction', args), transaction);
  assert.equal((await state('alice')).transactions.length, 1); assert.equal((await state('alice')).logs.filter(value => value.action === 'record_transaction').length, 1);
});

test('归一化明细允许同分重试，但名称、分额、顺序或明细有无改变409', async t => {
  const {execute, state, defaults} = await fixture(t);
  const args = {...defaults, amount: 2.02, payment_items: [{name: '材料一', amount: 1.005}, {name: '材料二', amount: 1.005}]};
  const original = await execute('alice', 'record_transaction', args);
  assert.deepEqual(await execute('alice', 'record_transaction', {...args, payment_items: [{name: ' 材料一 ', amount: 1.01}, {name: '材料二', amount: 1.014}]}), original);
  for (const items of [[{name: '其他名称', amount: 1.01}, {name: '材料二', amount: 1.01}], [{name: '材料一', amount: 1}, {name: '材料二', amount: 1.02}], [{name: '材料二', amount: 1.01}, {name: '材料一', amount: 1.01}], undefined, []]) {
    await assert.rejects(execute('alice', 'record_transaction', {...args, payment_items: items}), error => error.status === 409);
  }
  assert.equal((await state('alice')).transactions.length, 1); assert.equal((await state('alice')).projects[0].paid, 202);
});

test('无明细请求与有明细同样按十进制四舍五入取分，省略/空数组同义', async t => {
  const {execute, defaults} = await fixture(t);
  const args = {...defaults, amount: 1.005};
  const payment = await execute('alice', 'record_transaction', args);
  assert.equal(payment.amount, 101); assert.equal(payment.payment_items, undefined);
  assert.deepEqual(await execute('alice', 'record_transaction', {...args, payment_items: []}), payment);
  const receipt = await execute('alice', 'record_transaction', {...defaults, type: '收款', amount: 20000, request_id: 'legacy-receipt-001'});
  assert.equal(receipt.amount, 2000000); assert.equal(receipt.payment_items, undefined);
  await assert.rejects(execute('alice', 'record_transaction', {...defaults, amount: 1.005, payment_items: [{name: '新明细', amount: 1.005}]}), error => error.status === 409);
});

test('微信商户自动登记的收款不能作废，普通手工收款仍可作废', async t => {
  const {execute, state, defaults, sqlite} = await fixture(t);
  const manual = await execute('alice', 'record_transaction', {...defaults, type: '收款', amount: 500, request_id: 'manual-receipt-001'});
  const wechatData = {type: '收款', amount: 300000, category: '客户收款', date: '2026-10-13', note: '微信支付自动登记', void: false, payment_provider: 'wechat', wechat_transaction_id: 'wx-001', payment_order_id: 'qpay:share-1', updated: '2026-10-13T00:00:00Z'};
  sqlite.prepare('INSERT INTO records(id,owner,kind,project,data,created) VALUES(?,?,?,?,?,?)').run('tx:wechat:1', 'alice', 'transaction', defaults.project_id, JSON.stringify(wechatData), '2026-10-13T00:00:00Z');
  const before = sqlite.prepare('SELECT data FROM records WHERE id = ?').get('tx:wechat:1').data;
  await assert.rejects(execute('alice', 'void_transaction', {id: 'tx:wechat:1', reason: '误操作'}), error => error.status === 409 && /不能作废/.test(error.message));
  assert.equal(sqlite.prepare('SELECT data FROM records WHERE id = ?').get('tx:wechat:1').data, before);
  assert.equal((await execute('alice', 'void_transaction', {id: manual.id, reason: '登记错误'})).void, true);
  assert.equal((await state('alice')).projects[0].received, 300000);
});

test('预算与收款按同一十进制规则取分', async t => {
  const {execute} = await fixture(t);
  assert.equal((await execute('alice', 'create_project', {name: '预算取分', customer: '客户', budget: 1.005})).budget, 101);
});

test('跨账号不能使用项目或读取付款明细，错误明细不入账', async t => {
  const {execute, state, defaults} = await fixture(t);
  await assert.rejects(execute('bob', 'record_transaction', {...defaults, payment_items: [{name: '材料', amount: 10559}]}), error => error.status === 404);
  await assert.rejects(execute('bob', 'get_project', {id: defaults.project_id}), error => error.status === 404);
  await assert.rejects(execute('', 'record_transaction', defaults), error => error.status === 401);
  await assert.rejects(execute('alice', 'record_transaction', {...defaults, payment_items: [{name: '板材', amount: 9939}]}), /付款明细合计必须与付款总额一致/);
  assert.equal((await state('alice')).transactions.length, 0); assert.equal((await state('bob')).transactions.length, 0);
});

test('软删除的原request重试409，不恢复、不改金额或删除标记', async t => {
  const {execute, defaults, sqlite} = await fixture(t);
  const args = {...defaults, payment_items: [{name: '材料', amount: 10559}]};
  const transaction = await execute('alice', 'record_transaction', args);
  const stored = JSON.parse(sqlite.prepare('SELECT data FROM records WHERE id = ?').get(transaction.id).data);
  stored.deleted = true; stored.deleted_at = '2026-10-12T00:00:00Z';
  sqlite.prepare('UPDATE records SET data = ? WHERE id = ?').run(JSON.stringify(stored), transaction.id);
  const original = sqlite.prepare('SELECT data FROM records WHERE id = ?').get(transaction.id).data;
  await assert.rejects(execute('alice', 'record_transaction', args), error => error.status === 409 && /流水已移入回收站/.test(error.message));
  assert.equal(sqlite.prepare('SELECT data FROM records WHERE id = ?').get(transaction.id).data, original);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM records WHERE kind = 'transaction'").get().total, 1);
});

test('旧板材款9939与封边条款620仅映射显示，其他备注保留且不写原记录', () => {
  for (const tx of [{type: '付款', amount: 993900, note: '板材款'}, {type: '付款', amount: 62000, note: '封边条款'}]) {
    const before = JSON.stringify(tx); Object.freeze(tx);
    assert.deepEqual(getPaymentDetails(tx), {items: [{name: tx.note, amount: tx.amount}], note: ''});
    assert.equal(JSON.stringify(tx), before);
  }
  assert.deepEqual(getPaymentDetails({type: '付款', amount: 100, note: '板材款，已核对'}), {items: [], note: '板材款，已核对'});
  assert.deepEqual(getPaymentDetails({type: '收款', amount: 100, note: '板材款'}), {items: [], note: '板材款'});
  assert.deepEqual(getPaymentDetails({type: '付款', amount: 100, payment_items: [{name: '材料', amount: 100}], note: '普通备注'}), {items: [{name: '材料', amount: 100}], note: '普通备注'});
});

test('MCP record_transaction暴露可选明细与元/分说明，旧参数仍不要求新字段', async t => {
  const {serviceURL} = await fixture(t);
  const routeURL = asURL(compile(readFileSync('app/mcp/route.ts', 'utf8')).replace("from '../../lib/service'", `from '${serviceURL}'`).replace("from '../../lib/catalog'", `from '${catalogURL}'`));
  const {POST} = await import(routeURL);
  const response = await POST(new Request('https://mcp.test/mcp', {method: 'POST', body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list'})}));
  const tool = (await response.json()).result.tools.find(value => value.name === 'record_transaction');
  const field = tool.inputSchema.properties.payment_items;
  assert.equal(field.type, 'array'); assert.equal(field.maxItems, 100); assert.match(field.description, /输入元/); assert.match(field.description, /单位分/);
  assert.deepEqual(field.items.required, ['name', 'amount']); assert.equal(tool.inputSchema.required.includes('payment_items'), false);
});
