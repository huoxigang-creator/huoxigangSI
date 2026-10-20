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
const {DEFAULT_COMPANY_NAME, catalogPriceCents, purchaseItemAmount, purchaseTotal, materialExpenseCategory} = await import(typesURL);
const catalogURL = asURL(compile(readFileSync('lib/catalog.ts', 'utf8').replace(/^import \{env\} from 'cloudflare:workers';\r?\n/, '')).replace("from 'zod'", `from '${import.meta.resolve('zod')}'`).replace("from './catalog-types'", `from '${typesURL}'`).replace("from './quotes'", `from '${quotesURL}'`));
const {createCatalogService, CatalogError, materialSchema} = await import(catalogURL);
const routeSource = readFileSync('app/api/catalog/route.ts', 'utf8').replace(/^import .*?;\r?\n/gm, '');
const {createRoute} = await import(asURL(compile("import {ZodError} from '" + import.meta.resolve('zod') + "';\nexport function createRoute({catalogExecute,CatalogError}){\n" + routeSource.replace('export async function POST', 'async function POST') + '\nreturn POST;\n}')));

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('drizzle/0000_slippery_lenny_balinger.sql', 'utf8')); t.after(() => sqlite.close());
  const controls = {beforeBatch: null, auditFailure: false};
  function seed(id, kind, project, value, owner = 'alice') {sqlite.prepare('INSERT INTO records(id,owner,kind,project,data,created) VALUES(?,?,?,?,?,?)').run(id, owner, kind, project, JSON.stringify(value), '2026-10-12T00:00:00Z');}
  seed('project-a', 'project', 'project-a', {name: '测试项目', budget: 0}); seed('project-b', 'project', 'project-b', {name: '其他项目', budget: 0}); seed('project-c', 'project', 'project-c', {name: '他人项目'}, 'bob');
  const database = {
    prepare(sql) {let args = []; return {sql, get args() {return args;}, bind(...values) {args = values; return this;}, async all() {return {results: sqlite.prepare(sql).all(...args)};}};},
    async batch(statements) {
      if (controls.beforeBatch) {const callback = controls.beforeBatch; controls.beforeBatch = null; await callback();}
      sqlite.exec('BEGIN'); try {const results = statements.map(statement => {if (controls.auditFailure && statement.args[2] === 'audit') throw new Error('audit failure'); const result = sqlite.prepare(statement.sql).run(...statement.args); return {meta: {changes: Number(result.changes)}};}); sqlite.exec('COMMIT'); return results;} catch (error) {sqlite.exec('ROLLBACK'); throw error;}
    },
  };
  const service = createCatalogService({database: () => database});
  const post = createRoute({catalogExecute: service.execute, CatalogError});
  function request(action, args = {}, {owner = 'alice', origin = 'https://catalog.test', site = 'same-origin'} = {}) {
    const headers = {'Content-Type': 'application/json', 'sec-fetch-site': site}; if (owner) headers['oai-authenticated-user-id'] = owner; if (origin) headers.origin = origin;
    return post(new Request('https://catalog.test/api/catalog', {method: 'POST', headers, body: JSON.stringify({action, args})}));
  }
  function record(id) {const row = sqlite.prepare('SELECT * FROM records WHERE id=?').get(id); return row ? {...row, data: JSON.parse(row.data)} : null;}
  function patch(id, fields) {const row = record(id); sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...row.data, ...fields}), id);}
  function audits(action) {return sqlite.prepare("SELECT data FROM records WHERE kind='audit'").all().map(row => JSON.parse(row.data)).filter(value => !action || value.action === action);}
  const material = overrides => ({name: '测试板材', code: 'BM001', attribute: '主材', unit: '张', purchase_price: 99.995, ...overrides});
  const item = overrides => ({name: '板材', brand: '测试品牌', model: 'E0', code: 'BM001', attribute: '主材', unit: '张', quantity: 1.5, price: 99.995, ...overrides});
  const order = overrides => ({project_id: 'project-a', number: 'CG001', supplier: '测试供应商', date: '2026-10-12', items: [item()], ...overrides});
  return {service, request, sqlite, controls, seed, record, patch, audits, material, item, order};
}

test('读取默认公司不落库、不种材料或采购；API登录、同源和no-store', async t => {
  const app = fixture(t);
  const value = await app.service.execute('alice', 'get_catalog');
  assert.equal(value.company.name, DEFAULT_COMPANY_NAME); assert.deepEqual(value.materials, []); assert.deepEqual(value.purchase_orders, []);
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM records').get().n, 3);
  assert.equal((await app.request('get_catalog', {}, {owner: null})).status, 401);
  assert.equal((await app.request('get_catalog', {}, {origin: null})).status, 403);
  assert.equal((await app.request('get_catalog', {}, {origin: 'https://other.test'})).status, 403);
  assert.equal((await app.request('get_catalog', {}, {site: 'cross-site'})).status, 403);
  const response = await app.request('get_catalog'); assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'private, no-store'); assert.equal((await response.json()).ok, true);
});

test('人工属性可保存编辑并用于采购，旧主辅材继续有效且不产生付款', async t => {
  const app = fixture(t);
  const labor = await app.service.execute('alice', 'create_material', app.material({name: '安装人工', attribute: '人工', code: 'LAB01', unit: '天', purchase_price: 350}));
  const updated = await app.service.execute('alice', 'update_material', {...app.material({name: '安装人工', attribute: '人工', code: 'LAB01', unit: '天', purchase_price: 400}), id: labor.id, revision: labor.revision});
  assert.equal(updated.attribute, '人工'); assert.equal(updated.purchase_price, 40000);
  const saved = await app.service.execute('alice', 'create_purchase_order', app.order({items: [app.item({material_id: updated.id, name: '安装人工', attribute: '人工', unit: '天', quantity: 2, price: 400}), app.item({attribute: '辅材', price: 10}), app.item({attribute: '主材', price: 20})]}));
  assert.deepEqual(saved.items.map(item => item.attribute), ['人工', '辅材', '主材']);
  assert.equal(saved.total, 84500);
  assert.equal((await app.service.execute('alice', 'get_catalog')).materials[0].attribute, '人工');
  assert.equal((await app.request('create_material', app.material({code: 'INVALID', attribute: '其他'}))).status, 400);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='transaction'").get().n, 0);
});

test('公司按owner唯一，修改需要revision且原子审计，不影响账目', async t => {
  const app = fixture(t);
  const company = await app.service.execute('alice', 'save_company', {name: ' 新公司名称 '});
  assert.equal(company.name, '新公司名称'); assert.equal(company.project, ''); assert.match(company.revision, /^[0-9a-f-]{36}$/);
  await assert.rejects(app.service.execute('alice', 'save_company', {name: '旧弹窗覆盖'}), error => error.status === 409);
  const updated = await app.service.execute('alice', 'save_company', {name: '修改后的公司', revision: company.revision});
  assert.equal(updated.id, company.id); assert.notEqual(updated.revision, company.revision); assert.equal(app.audits('save_company').length, 2);
  assert.equal((await app.service.execute('bob', 'get_catalog')).company.name, DEFAULT_COMPANY_NAME);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='transaction'").get().n, 0);
});

test('材料字段和分价格正确保存，活动code账号内唯一，可软删后复用', async t => {
  const app = fixture(t), first = await app.service.execute('alice', 'create_material', app.material({areas: ['厨房', '厨房', '卧室'], warehouse_enabled: true, warehouse: '主仓'}));
  assert.equal(first.purchase_price, 10000); assert.equal(first.sale_price, 0); assert.equal(first.project, ''); assert.equal(first.warehouse_enabled, true); assert.deepEqual(first.areas, ['厨房', '卧室']);
  await assert.rejects(app.service.execute('alice', 'create_material', app.material({name: '重复材料'})), error => error.status === 409);
  assert.equal((await app.service.execute('bob', 'create_material', app.material())).code, 'BM001');
  await assert.rejects(app.service.execute('bob', 'update_material', {...app.material(), id: first.id, revision: first.revision}), error => error.status === 404);
  app.patch(first.id, {deleted: true});
  const reusedCode = await app.service.execute('alice', 'create_material', app.material({name: '新材料'})); assert.notEqual(reusedCode.id, first.id); assert.equal((await app.service.execute('alice', 'get_catalog')).materials.length, 1);
});

test('材料稳定ID重复提交同内容复用，不同内容与删除碰撞409；并发code仅一项', async t => {
  const app = fixture(t), id = crypto.randomUUID(), input = app.material({id});
  const first = await app.service.execute('alice', 'create_material', input);
  const retry = await app.service.execute('alice', 'create_material', input); assert.equal(retry.reused, true); assert.equal(retry.id, first.id); assert.equal(app.audits('create_material').length, 1);
  await assert.rejects(app.service.execute('alice', 'create_material', {...input, name: '不同内容'}), error => error.status === 409);
  app.patch(first.id, {deleted: true}); await assert.rejects(app.service.execute('alice', 'create_material', input), error => error.status === 409); assert.equal(app.record(first.id).data.deleted, true);
  app.controls.beforeBatch = async () => {await app.service.execute('alice', 'create_material', app.material({code: 'RACE', id: crypto.randomUUID()}));};
  await assert.rejects(app.service.execute('alice', 'create_material', app.material({code: 'RACE', id: crypto.randomUUID()})), error => error.status === 409);
  assert.equal((await app.service.execute('alice', 'get_catalog')).materials.filter(material => material.code === 'RACE').length, 1);
});

test('价格与4位数量逐行half-up，采购total分，溢出/非法数量和真实日期拒绝', async t => {
  assert.equal(catalogPriceCents(1.005), 101); assert.equal(purchaseItemAmount(0.5, 101), 51); assert.equal(purchaseItemAmount(0.0001, 5000), 1); assert.equal(purchaseTotal([{amount: 51}, {amount: 51}]), 102);
  const app = fixture(t), saved = await app.service.execute('alice', 'create_purchase_order', app.order({items: [app.item({quantity: 0.5, price: 1.005}), app.item({quantity: 0.5, price: 1.005})]}));
  assert.equal(saved.items[0].price, 101); assert.equal(saved.items[0].amount, 51); assert.equal(saved.total, 102);
  for (const quantity of [0, -1, 1.00001, 1000001]) assert.equal((await app.request('create_purchase_order', app.order({number: '', items: [app.item({quantity})]}))).status, 400);
  assert.equal((await app.request('create_purchase_order', app.order({number: '', items: [app.item({quantity: 1000000, price: 100000000})]}))).status, 400);
  assert.equal((await app.request('create_purchase_order', app.order({number: '', date: '2026-02-30'}))).status, 400);
});

test('采购按项目和材料owner授权，保存快照后材料编辑/删除不改变历史', async t => {
  const app = fixture(t), material = await app.service.execute('alice', 'create_material', app.material());
  const saved = await app.service.execute('alice', 'create_purchase_order', app.order({items: [app.item({material_id: material.id})]}));
  const original = JSON.stringify(saved.items);
  await app.service.execute('alice', 'update_material', {...app.material({name: '修改后的材料', purchase_price: 500}), id: material.id, revision: material.revision});
  app.patch(material.id, {deleted: true});
  const catalog = await app.service.execute('alice', 'get_catalog'); assert.equal(JSON.stringify(catalog.purchase_orders[0].items), original); assert.equal(catalog.materials.length, 0);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='transaction'").get().n, 0);
  assert.equal((await app.request('create_purchase_order', app.order({project_id: 'project-c'}))).status, 404);
  assert.equal((await app.request('create_purchase_order', app.order({project_id: 'project-c', items: [app.item({material_id: material.id})]}), {owner: 'bob'})).status, 404);
  await assert.rejects(app.service.execute('alice', 'update_purchase_order', {...app.order({project_id: 'project-b'}), id: saved.id, revision: saved.revision}), /不能移至其他项目/);
});

test('采购稳定ID同内容幂等，编号项目内唯一，同ID不同正文和软删拒绝', async t => {
  const app = fixture(t), id = crypto.randomUUID(), input = app.order({id});
  const first = await app.service.execute('alice', 'create_purchase_order', input), retry = await app.service.execute('alice', 'create_purchase_order', input);
  assert.equal(retry.reused, true); assert.equal(retry.id, first.id); assert.equal(app.audits('create_purchase_order').length, 1);
  await assert.rejects(app.service.execute('alice', 'create_purchase_order', {...input, supplier: '另一供应商'}), error => error.status === 409);
  await assert.rejects(app.service.execute('alice', 'create_purchase_order', app.order()), error => error.status === 409);
  assert.equal((await app.service.execute('alice', 'create_purchase_order', app.order({project_id: 'project-b'}))).number, 'CG001');
  app.patch(first.id, {deleted: true}); await assert.rejects(app.service.execute('alice', 'create_purchase_order', input), error => error.status === 409);
});

test('编辑历史已删材料行仅原样保留且消耗匹配，复制旧行不能新增无效引用', async t => {
  const app = fixture(t), material = await app.service.execute('alice', 'create_material', app.material());
  const item = app.item({material_id: material.id}), input = app.order({items: [item]});
  const saved = await app.service.execute('alice', 'create_purchase_order', input); app.patch(material.id, {deleted: true});
  const normalizedInput = {...input, items: [{...item, price: saved.items[0].price / 100}], id: saved.id, revision: saved.revision, note: '仅改备注'};
  const changed = await app.service.execute('alice', 'update_purchase_order', normalizedInput); assert.equal(changed.note, '仅改备注'); assert.deepEqual(changed.items, saved.items);
  await assert.rejects(app.service.execute('alice', 'update_purchase_order', {...normalizedInput, revision: changed.revision, items: [...normalizedInput.items, ...normalizedInput.items]}), error => error.status === 404);
  await assert.rejects(app.service.execute('alice', 'update_purchase_order', {...normalizedInput, revision: changed.revision, items: [{...normalizedInput.items[0], quantity: 2}]}), error => error.status === 404);
});

test('revision防旧弹窗覆盖，SQL CAS防读后删除/修改且审计不假成功', async t => {
  const app = fixture(t), first = await app.service.execute('alice', 'create_material', app.material());
  const second = await app.service.execute('alice', 'update_material', {...app.material({name: '新版本'}), id: first.id, revision: first.revision});
  await assert.rejects(app.service.execute('alice', 'update_material', {...app.material(), id: first.id, revision: first.revision}), error => error.status === 409);
  app.controls.beforeBatch = async () => {app.patch(first.id, {deleted: true});};
  await assert.rejects(app.service.execute('alice', 'update_material', {...app.material({name: '不能恢复'}), id: first.id, revision: second.revision}), error => error.status === 409);
  assert.equal(app.record(first.id).data.deleted, true); assert.equal(app.record(first.id).data.name, '新版本'); assert.equal(app.audits('update_material').length, 1);
});

test('父项目或新材料在采购保存期间被删，原子拒绝且无采购/假审计', async t => {
  const app = fixture(t), material = await app.service.execute('alice', 'create_material', app.material());
  app.controls.beforeBatch = async () => {app.patch(material.id, {deleted: true});};
  await assert.rejects(app.service.execute('alice', 'create_purchase_order', app.order({items: [app.item({material_id: material.id})]})), error => error.status === 409);
  app.controls.beforeBatch = async () => {app.patch('project-a', {deleted: true});};
  await assert.rejects(app.service.execute('alice', 'create_purchase_order', app.order()), error => error.status === 409);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='purchase_order'").get().n, 0); assert.equal(app.audits('create_purchase_order').length, 0);
});

test('审计失败回滚资料写入，不碰任何旧财务记录，返回存储失败', async t => {
  const app = fixture(t); app.seed('tx-old', 'transaction', 'project-a', {type: '付款', amount: 993900, note: '板材款'});
  const original = JSON.stringify(app.record('tx-old'));
  app.controls.auditFailure = true;
  assert.equal((await app.request('create_material', app.material())).status, 500);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='material'").get().n, 0);
  assert.equal(JSON.stringify(app.record('tx-old')), original); assert.equal(app.audits().length, 0);
});

const GROUP_A = '10000000-0000-4000-a000-000000000001';
const GROUP_B = '10000000-0000-4000-a000-000000000002';
function seedQuote(app, id, {group = GROUP_A, project = 'project-a', owner = 'alice', name = '小项目甲', title = '报价版本', ...extra} = {}) {
  app.seed(id, 'quote', project, {title, subproject_id: group, subproject_name: name, adopted: false, total: 10000, ...extra}, owner);
}

test('材料费用分类向后兼容且不猜辅材为五金，编辑省略保留独立分类', async t => {
  const app = fixture(t);
  assert.equal(materialExpenseCategory({attribute: '人工'}), '人工费用');
  assert.equal(materialExpenseCategory({attribute: '辅材'}), '材料费用');
  assert.equal(materialExpenseCategory({attribute: '主材', expense_category: '五金费用'}), '五金费用');
  app.seed('legacy-labor', 'material', '', {name: '旧人工', attribute: '人工', unit: '张'});
  const before = JSON.stringify(app.record('legacy-labor'));
  const catalog = await app.service.execute('alice', 'get_catalog');
  assert.equal(catalog.materials[0].expense_category, undefined);
  assert.equal(JSON.stringify(app.record('legacy-labor')), before);
  const labor = await app.service.execute('alice', 'create_material', app.material({code: 'LAB', attribute: '人工'}));
  const auxiliary = await app.service.execute('alice', 'create_material', app.material({code: 'AUX', attribute: '辅材'}));
  const hardware = await app.service.execute('alice', 'create_material', app.material({code: 'HW', attribute: '辅材', expense_category: '五金费用'}));
  assert.equal(labor.expense_category, '人工费用'); assert.equal(auxiliary.expense_category, '材料费用');
  const edited = await app.service.execute('alice', 'update_material', {...app.material({code: 'HW', attribute: '主材'}), id: hardware.id, revision: hardware.revision});
  assert.equal(edited.expense_category, '五金费用');
  const recategorized = await app.service.execute('alice', 'update_material', {...app.material({code: 'HW', expense_category: '材料费用'}), id: edited.id, revision: edited.revision});
  assert.equal(recategorized.expense_category, '材料费用');
  assert.equal((await app.request('create_material', app.material({code: 'INVALID', expense_category: '其他费用'}))).status, 400);
  await assert.rejects(app.service.execute('bob', 'update_material', {...app.material({code: 'HW', expense_category: '人工费用'}), id: edited.id, revision: edited.revision}), error => error.status === 404);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='transaction'").get().n, 0);
});

test('采购显式关联小项目稳定ID与当前组名快照，原始4位数量精度不变', async t => {
  const app = fixture(t);
  seedQuote(app, 'quote-old', {name: '旧名称', updated: '2026-10-12T01:00:00Z'});
  seedQuote(app, 'quote-new', {name: '同组当前名称', updated: '2026-10-12T02:00:00Z'});
  const saved = await app.service.execute('alice', 'create_purchase_order', app.order({source_quote_id: 'quote-old', subproject_id: GROUP_B, subproject_name: '伪造名称', items: [app.item({quantity: 1.2345}), app.item({quantity: 0.0001, unit: '米'})]}));
  assert.equal(saved.source_quote_id, 'quote-old'); assert.equal(saved.subproject_id, GROUP_A); assert.equal(saved.subproject_name, '同组当前名称');
  assert.deepEqual(saved.items.map(item => [item.quantity, item.unit]), [[1.2345, '张'], [0.0001, '米']]);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='transaction'").get().n, 0);
  const basis = await app.service.execute('alice', 'get_purchase_quantity_basis', {project_id: 'project-a', source_quote_id: 'quote-new'});
  assert.equal(basis.order_count, 1); assert.equal(basis.subproject_id, GROUP_A);
  assert.deepEqual(basis.rows.map(row => [row.purchase_order_id, row.item_index, row.quantity, row.unit, row.attribute]), [[saved.id, 1, 1.2345, '张', '主材'], [saved.id, 2, 0.0001, '米', '主材']]);
  assert.equal('quantity' in basis, false); assert.equal('amount' in basis.rows[0], false);
});

test('采购关联只接受本账号同父项目活动报价，拒绝已删除及不存在引用', async t => {
  const app = fixture(t);
  seedQuote(app, 'other-parent', {project: 'project-b'}); seedQuote(app, 'other-owner', {owner: 'bob'}); seedQuote(app, 'deleted-quote', {deleted: true});
  for (const source_quote_id of ['other-parent', 'other-owner', 'deleted-quote', 'missing-quote']) {
    await assert.rejects(app.service.execute('alice', 'create_purchase_order', app.order({source_quote_id})), error => error.status === 404);
  }
  assert.equal((await app.request('create_purchase_order', app.order({source_quote_id: ''}))).status, 400);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='purchase_order'").get().n, 0);
  assert.equal(app.audits('create_purchase_order').length, 0);
});

test('既有关联省略或同source重试保留快照，来源报价改名删除后不丢关联', async t => {
  const app = fixture(t); seedQuote(app, 'quote-linked');
  const input = app.order({id: crypto.randomUUID(), source_quote_id: 'quote-linked'});
  const saved = await app.service.execute('alice', 'create_purchase_order', input);
  app.patch('quote-linked', {subproject_name: '来源改名', deleted: true});
  const retry = await app.service.execute('alice', 'create_purchase_order', input);
  assert.equal(retry.reused, true); assert.equal(retry.subproject_name, '小项目甲'); assert.equal(app.audits('create_purchase_order').length, 1);
  const edited = await app.service.execute('alice', 'update_purchase_order', {...app.order({id: saved.id, revision: saved.revision, note: '调整数量', items: [app.item({quantity: 2.3456})]} )});
  assert.equal(edited.source_quote_id, saved.source_quote_id); assert.equal(edited.subproject_id, GROUP_A); assert.equal(edited.subproject_name, '小项目甲'); assert.equal(edited.items[0].quantity, 2.3456);
  const basis = await app.service.execute('alice', 'get_purchase_quantity_basis', {project_id: 'project-a', source_quote_id: 'quote-linked'});
  assert.equal(basis.rows[0].quantity, 2.3456); assert.equal(basis.subproject_name, '小项目甲');
});

test('未关联历史采购不按同名编号匹配，可明确补关联；legacy组按父项目隔离', async t => {
  const app = fixture(t);
  seedQuote(app, 'legacy-a', {group: '', name: '', title: '相同名称'});
  seedQuote(app, 'legacy-b', {group: '', name: '', title: '相同名称', project: 'project-b'});
  const old = await app.service.execute('alice', 'create_purchase_order', app.order({number: '相同名称'}));
  assert.equal(old.source_quote_id, undefined); assert.equal(old.subproject_id, undefined);
  const unchanged = await app.service.execute('alice', 'update_purchase_order', app.order({id: old.id, revision: old.revision, number: '相同名称', note: '仅改备注'}));
  let basis = await app.service.execute('alice', 'get_purchase_quantity_basis', {project_id: 'project-a', source_quote_id: 'legacy-a'});
  assert.equal(basis.rows.length, 0); assert.equal(basis.unlinked_order_count, 1);
  const linked = await app.service.execute('alice', 'update_purchase_order', app.order({id: old.id, revision: unchanged.revision, number: '相同名称', source_quote_id: 'legacy-a'}));
  assert.equal(linked.subproject_id, 'legacy'); assert.equal(linked.subproject_name, '相同名称');
  basis = await app.service.execute('alice', 'get_purchase_quantity_basis', {project_id: 'project-b', source_quote_id: 'legacy-b'});
  assert.equal(basis.rows.length, 0);
  assert.equal((await app.service.execute('alice', 'get_purchase_quantity_basis', {project_id: 'project-a', subproject_id: 'legacy'})).order_count, 1);
});

test('数量基数按同组全部活动采购原行读取，排除删除、其他组、其他账号，不混合单位且全程只读', async t => {
  const app = fixture(t); seedQuote(app, 'qa1'); seedQuote(app, 'qa2'); seedQuote(app, 'qb', {group: GROUP_B, name: '乙'});
  const a = await app.service.execute('alice', 'create_purchase_order', app.order({number: 'A1', source_quote_id: 'qa1', items: [app.item({quantity: 3.1234, unit: '张'}), app.item({quantity: 8.7654, unit: '米', attribute: '人工'})]}));
  await app.service.execute('alice', 'create_purchase_order', app.order({number: 'A2', source_quote_id: 'qa2', items: [app.item({quantity: 2, unit: '根'})]}));
  const removed = await app.service.execute('alice', 'create_purchase_order', app.order({number: 'REMOVED', source_quote_id: 'qa1'})); app.patch(removed.id, {deleted: true});
  await app.service.execute('alice', 'create_purchase_order', app.order({number: 'B1', source_quote_id: 'qb'}));
  app.seed('bob-order', 'purchase_order', 'project-a', {...app.record(a.id).data, number: 'BOB'}, 'bob');
  const before = JSON.stringify(app.sqlite.prepare('SELECT * FROM records ORDER BY id').all());
  const basis = await app.service.execute('alice', 'get_purchase_quantity_basis', {project_id: 'project-a', subproject_id: GROUP_A});
  assert.equal(basis.order_count, 2); assert.equal(basis.rows.length, 3); assert.deepEqual(basis.rows.map(row => row.quantity).sort(), [2, 3.1234, 8.7654]);
  assert.deepEqual(new Set(basis.rows.map(row => row.unit)), new Set(['张', '米', '根']));
  assert.equal(JSON.stringify(app.sqlite.prepare('SELECT * FROM records ORDER BY id').all()), before);
  await assert.rejects(app.service.execute('alice', 'get_purchase_quantity_basis', {project_id: 'project-c', subproject_id: GROUP_A}), error => error.status === 404);
  await assert.rejects(app.service.execute('alice', 'get_purchase_quantity_basis', {project_id: 'project-a', source_quote_id: 'qa1', subproject_id: GROUP_B}), error => error.status === 400);
  await assert.rejects(app.service.execute('alice', 'get_purchase_quantity_basis', {project_id: 'project-b', subproject_id: GROUP_A}), error => error.status === 404);
  assert.equal((await app.request('get_purchase_quantity_basis', {project_id: 'project-a'})).status, 400);
});

test('保存前来源报价被删除、转移或改名，SQL关联条件拒绝且不产生假审计', async t => {
  for (const fields of [{deleted: true}, {subproject_name: '竞态改名'}]) {
    const app = fixture(t); seedQuote(app, 'race-quote');
    app.controls.beforeBatch = () => {app.patch('race-quote', fields);};
    await assert.rejects(app.service.execute('alice', 'create_purchase_order', app.order({source_quote_id: 'race-quote'})), error => error.status === 409);
    assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='purchase_order'").get().n, 0); assert.equal(app.audits('create_purchase_order').length, 0);
  }
  const app = fixture(t); seedQuote(app, 'moved-quote');
  app.controls.beforeBatch = () => {app.sqlite.prepare('UPDATE records SET project=? WHERE id=?').run('project-b', 'moved-quote');};
  await assert.rejects(app.service.execute('alice', 'create_purchase_order', app.order({source_quote_id: 'moved-quote'})), error => error.status === 409);
  assert.equal(app.audits('create_purchase_order').length, 0);
});

test('MCP公布只读采购数量接口，分发catalog并保留登录和精确授权错误', async t => {
  const app = fixture(t); seedQuote(app, 'mcp-quote');
  await app.service.execute('alice', 'create_purchase_order', app.order({source_quote_id: 'mcp-quote'}));
  const source = readFileSync('app/mcp/route.ts', 'utf8').replace(/^import .*?;\r?\n/gm, '').replaceAll('export async function', 'async function');
  const module = await import(asURL(compile('export function createMcpRoute({execute,BusinessError,catalogExecute,CatalogError}){\n' + source + '\nreturn {POST};\n}')));
  class BusinessError extends Error {}
  const {POST} = module.createMcpRoute({execute: () => {throw new BusinessError('不应进入业务写接口');}, BusinessError, catalogExecute: app.service.execute, CatalogError});
  const request = (method, params, owner = 'alice') => POST(new Request('https://catalog.test/mcp', {method: 'POST', headers: owner ? {'oai-authenticated-user-id': owner} : {}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})}));
  const list = (await (await request('tools/list')).json()).result.tools;
  const tool = list.find(value => value.name === 'get_purchase_quantity_basis');
  assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.destructiveHint, false); assert.deepEqual(tool.inputSchema.required, ['project_id']); assert.match(tool.description, /不登记付款/);
  const called = (await (await request('tools/call', {name: tool.name, arguments: {project_id: 'project-a', source_quote_id: 'mcp-quote'}})).json()).result;
  assert.equal(called.isError, undefined); assert.equal(JSON.parse(called.content[0].text).rows[0].quantity, 1.5);
  const denied = (await (await request('tools/call', {name: tool.name, arguments: {project_id: 'project-a', source_quote_id: 'mcp-quote'}}, 'bob')).json()).result;
  assert.equal(denied.isError, true); assert.match(denied.content[0].text, /无权访问/);
  assert.equal((await request('tools/call', {name: tool.name, arguments: {project_id: 'project-a', source_quote_id: 'mcp-quote'}}, null)).status, 401);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='transaction'").get().n, 0);
});

const hardwareRouteSource = readFileSync('app/api/hardware-import/route.ts','utf8').replace(/^import .*?;\r?\n/gm,'');
const {makeHardwareRoute} = await import(asURL(compile("import {z,ZodError} from '"+import.meta.resolve('zod')+"';\nexport function makeHardwareRoute({catalogExecute,CatalogError,materialSchema}){\n"+hardwareRouteSource.replace('export async function POST','async function POST')+'\nreturn POST;}')));
test('五金导入接口验证登录同源、全量预校验、分项结果与稳定ID重试', async t => {
 const app=fixture(t), post=makeHardwareRoute({catalogExecute:app.service.execute,CatalogError,materialSchema});
 const item={id:crypto.randomUUID(),name:'导入铰链',code:'HJ001',unit:'个',expense_category:'五金费用',attribute:'辅材',purchase_price:12.35};
 const request=(items,owner='alice',origin='https://catalog.test')=>post(new Request('https://catalog.test/api/hardware-import',{method:'POST',headers:{'Content-Type':'application/json',...(owner?{'oai-authenticated-user-id':owner}:{}),origin},body:JSON.stringify({items})}));
 assert.equal((await request([item],null)).status,401);assert.equal((await request([item],'alice','https://evil.test')).status,403);
 assert.equal((await request([item,{...item,id:crypto.randomUUID(),purchase_price:-1}])).status,400);assert.equal(app.record(item.id),null);
 const response=await request([item,{...item,id:crypto.randomUUID()}]);assert.equal(response.status,200);const body=await response.json();assert.deepEqual(body.results.map(r=>r.ok),[true,false]);
 assert.equal(app.record(item.id).data.purchase_price,1235);assert.equal(app.record(item.id).data.expense_category,'五金费用');
 assert.equal((await (await request([item])).json()).results[0].ok,true);assert.equal(app.audits('create_material').length,1);
 assert.equal((await request([{...item,expense_category:'材料费用'}])).status,400);
});
