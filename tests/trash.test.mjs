import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

async function moduleFrom(source) {
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const {createTrashService, TrashError} = await moduleFrom(readFileSync('lib/trash.ts', 'utf8').replace(/^import .*?;\r?\n/gm, ''));
const routeSource = readFileSync('app/api/trash/route.ts', 'utf8').replace(/^import .*?;\r?\n/gm, '').replace('export async function POST', 'async function POST');
const {createRoute} = await moduleFrom('export function createRoute({trashExecute, TrashError}) {\n' + routeSource + '\nreturn POST;\n}');
const BASE = 'https://trash.test';
const UUID = '00000000-0000-4000-a000-000000000001';
const KEY = 'alice/project-a/files/' + UUID;
const PAYMENT = 'tx:alice:payment-one';
const PAYMENT_KEY = 'alice/project-a/payment-vouchers/' + encodeURIComponent(PAYMENT) + '/' + UUID;

test('独立待办可软删除和恢复，不要求不存在的父项目',async()=>{
 const app=setup();app.row('standalone-task','task','',{title:'独立任务',note:'备注'});
 await app.service.execute('alice','delete_record',{id:'standalone-task'});
 const removed=(await app.service.execute('alice','list')).records.find(r=>r.id==='standalone-task');assert.equal(removed.parentDeleted,false);
 await app.service.execute('alice','restore_record',{id:'standalone-task'});assert.equal(app.record('standalone-task').data.deleted,false);assert.equal(app.record('standalone-task').data.note,'备注');
});

test('全局材料可恢复，采购单按父项目恢复且保留材料快照和金额', async () => {
  const app = setup();
  app.row('material-one', 'material', '', {name: '测试板材', code: 'M-01', purchase_price: 19500});
  app.row('order-one', 'purchase_order', 'project-a', {number: 'CG-01', supplier: '测试供货商', total: 39000, items: [{material_id: 'material-one', name: '测试板材', price: 19500, quantity: 2, amount: 39000}]});
  await app.service.execute('alice', 'delete_record', {id: 'material-one'});
  const deletedMaterial = (await app.service.execute('alice', 'list')).records.find(row => row.id === 'material-one');
  assert.equal(deletedMaterial.parentDeleted, false);
  assert.equal(deletedMaterial.parentName, '');
  await app.service.execute('alice', 'restore_record', {id: 'material-one'});
  assert.equal(app.record('material-one').data.deleted, false);
  await app.service.execute('alice', 'delete_record', {id: 'order-one'});
  await app.service.execute('alice', 'delete_record', {id: 'project-a'});
  assert.equal((await app.service.execute('alice', 'list')).records.find(row => row.id === 'order-one').parentDeleted, true);
  await assert.rejects(app.service.execute('alice', 'restore_record', {id: 'order-one'}), {status: 404});
  await app.service.execute('alice', 'restore_record', {id: 'project-a'});
  await app.service.execute('alice', 'restore_record', {id: 'order-one'});
  assert.equal(app.record('order-one').data.total, 39000);
  assert.equal(app.record('order-one').data.items[0].price, 19500);
});

test('微信商户自动登记的收款不能移入回收站，普通收款可以', async () => {
  const app = setup();
  app.row('tx:wechat:one', 'transaction', 'project-a', {type: '收款', amount: 300000, category: '客户收款', payment_provider: 'wechat', wechat_transaction_id: 'wx-001', payment_order_id: 'qpay:share-1'});
  app.row('tx:alice:manual', 'transaction', 'project-a', {type: '收款', amount: 500, category: '定金'});
  await assert.rejects(app.service.execute('alice', 'delete_record', {id: 'tx:wechat:one'}), error => error.status === 409 && /不能删除/.test(error.message));
  assert.notEqual(app.record('tx:wechat:one').data.deleted, true);
  await app.service.execute('alice', 'delete_record', {id: 'tx:alice:manual'});
  assert.equal(app.record('tx:alice:manual').data.deleted, true);
});

test('材料编码和采购编号恢复时原子检查冲突，配置公司不可删除', async () => {
  const app = setup();
  app.row('company-one', 'company_profile', '', {name: '测试公司'});
  await assert.rejects(app.service.execute('alice', 'delete_record', {id: 'company-one'}), {status: 403});
  app.row('material-one', 'material', '', {name: '旧板', code: 'M-01'});
  await app.service.execute('alice', 'delete_record', {id: 'material-one'});
  app.controls.beforeBatch = () => app.row('material-two', 'material', '', {name: '新板', code: 'M-01'});
  await assert.rejects(app.service.execute('alice', 'restore_record', {id: 'material-one'}), {status: 409});
  assert.equal(app.record('material-one').data.deleted, true);
  app.row('order-one', 'purchase_order', 'project-a', {number: 'CG-01', total: 10000});
  await app.service.execute('alice', 'delete_record', {id: 'order-one'});
  app.controls.beforeBatch = () => app.row('order-two', 'purchase_order', 'project-a', {number: 'CG-01', total: 20000});
  await assert.rejects(app.service.execute('alice', 'restore_record', {id: 'order-one'}), {status: 409});
  assert.equal(app.record('order-one').data.deleted, true);
});

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE records(id TEXT PRIMARY KEY,owner TEXT,kind TEXT,project TEXT,data TEXT,created TEXT)');
  const objects = new Map(), calls = {head: [], batch: 0, put: 0, delete: 0};
  const controls = {auditFailure: false, beforeBatch: null};
  function row(id, kind, project, data, owner = 'alice') {
    sqlite.prepare('INSERT INTO records(id,owner,kind,project,data,created) VALUES(?,?,?,?,?,?)').run(id, owner, kind, project, typeof data === 'string' ? data : JSON.stringify(data), '2026-10-01T00:00:00Z');
  }
  row('project-a', 'project', 'project-a', {name: '桃李书院', budget: 0});
  row('project-b', 'project', 'project-b', {name: '其他项目', budget: 0});
  row('project-c', 'project', 'project-c', {name: '其他账号'}, 'bob');
  const database = {
    prepare(sql) {return {bind(...args) {return {sql, args, async all() {return {results: sqlite.prepare(sql).all(...args)};}};}};},
    async batch(statements) {
      calls.batch++;
      if (controls.beforeBatch) {const callback = controls.beforeBatch; controls.beforeBatch = null; callback();}
      sqlite.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) {
          if (controls.auditFailure && statement.sql.startsWith('INSERT INTO records(id,owner,kind,project,data,created) SELECT') && statement.args[2] === 'audit') throw new Error('audit failure');
          const value = sqlite.prepare(statement.sql).run(...statement.args);
          result.push({meta: {changes: Number(value.changes)}});
        }
        sqlite.exec('COMMIT'); return result;
      } catch (error) {sqlite.exec('ROLLBACK'); throw error;}
    },
  };
  const bucket = {
    async head(key) {calls.head.push(key); return objects.get(key) || null;},
    async put() {calls.put++; throw new Error('R2 writes forbidden');},
    async delete() {calls.delete++; throw new Error('R2 deletion forbidden');},
  };
  const service = createTrashService({database: () => database, bucket: () => bucket});
  const post = createRoute({trashExecute: service.execute, TrashError});
  function request(action, args = {}, {owner = 'alice', origin = BASE, site = 'same-origin'} = {}) {
    const headers = {'Content-Type': 'application/json', 'sec-fetch-site': site};
    if (owner) headers['oai-authenticated-user-id'] = owner;
    if (origin) headers.origin = origin;
    return post(new Request(BASE + '/api/trash', {method: 'POST', headers, body: JSON.stringify({action, args})}));
  }
  function record(id) {
    const result = sqlite.prepare('SELECT * FROM records WHERE id=?').get(id);
    return result ? {...result, data: JSON.parse(result.data)} : null;
  }
  function file(key = KEY, metadata = {name: '合同.pdf', category: '合同', created: '2026-10-01T00:00:00Z'}) {const object = {key, customMetadata: metadata, size: 3, uploaded: new Date('2026-10-01T00:00:00Z')}; objects.set(key, object); return object;}
  function audits() {return sqlite.prepare("SELECT * FROM records WHERE kind='audit'").all();}
  return {service, request, row, record, file, objects, sqlite, calls, audits, controls};
}

test('请求认证、同源、账号所有权、可信记录kind隔离', async () => {
  const app = setup();
  app.row('audit-one', 'audit', 'project-a', {action: 'example'});
  app.row('hardware-one', 'hardware', 'project-a', {items: []});
  assert.equal((await app.request('list', {}, {owner: null})).status, 401);
  assert.equal((await app.request('list', {}, {origin: null})).status, 403);
  assert.equal((await app.request('delete_record', {id: 'project-a'}, {origin: 'https://other.test'})).status, 403);
  assert.equal((await app.request('delete_record', {id: 'project-a'}, {site: 'cross-site'})).status, 403);
  assert.equal((await app.request('delete_record', {id: 'project-a'}, {owner: 'bob'})).status, 404);
  assert.equal((await app.request('delete_record', {id: 'audit-one', kind: 'project'})).status, 403);
  assert.equal((await app.request('delete_record', {id: 'hardware-one', kind: 'task'})).status, 403);
  assert.equal((await app.request('unknown')).status, 400);
  assert.equal(app.calls.batch, 0); assert.equal(app.record('project-a').data.deleted, undefined);
  const response = await app.request('list');
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), {ok: true, records: [], files: []});
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('记录仅软删、金额ID创建日期保留，重复操作幂等且审计原子', async () => {
  const app = setup();
  app.row('receipt-one', 'transaction', 'project-a', ' { "amount":2000000, "type":"收款", "category":"订金", "void":false } ');
  const original = app.record('receipt-one');
  const result = await app.service.execute('alice', 'delete_record', {id: 'receipt-one', amount: 1, kind: 'task'});
  assert.equal(result.ok, true); assert.equal(result.record.amount, 2000000); assert.equal(result.record.deleted, true);
  const deleted = app.record('receipt-one');
  assert.equal(deleted.kind, original.kind); assert.equal(deleted.id, original.id); assert.equal(deleted.created, original.created);
  assert.equal(deleted.data.amount, 2000000); assert.equal(deleted.data.type, '收款'); assert.equal(deleted.data.void, false);
  assert.equal(deleted.data.deleted_by, 'alice'); assert.match(deleted.data.deleted_at, /^\d{4}-/);
  assert.equal((await app.service.execute('alice', 'delete_record', {id: 'receipt-one'})).reused, true);
  assert.equal(app.audits().length, 1);
  await app.service.execute('alice', 'restore_record', {id: 'receipt-one'});
  assert.equal(app.record('receipt-one').data.deleted, false); assert.equal(app.record('receipt-one').data.amount, 2000000);
  assert.equal((await app.service.execute('alice', 'restore_record', {id: 'receipt-one'})).reused, true);
  assert.equal(app.audits().length, 2);
  app.controls.auditFailure = true;
  await assert.rejects(app.service.execute('alice', 'delete_record', {id: 'receipt-one'}));
  assert.equal(app.record('receipt-one').data.deleted, false); assert.equal(app.audits().length, 2);
});

test('项目删除不批量改变孩子，恢复保留孩子自身删除，恢复孩子必须先恢复项目', async () => {
  const app = setup();
  app.row('quote-one', 'quote', 'project-a', {title: '报价', adopted: true, total: 2400000});
  app.row('task-one', 'task', 'project-a', {title: '跟踪', done: false});
  await app.service.execute('alice', 'delete_record', {id: 'task-one'});
  await app.service.execute('alice', 'delete_record', {id: 'project-a'});
  assert.equal(app.record('quote-one').data.deleted, undefined); assert.equal(app.record('task-one').data.deleted, true);
  const trash = await app.service.execute('alice', 'list');
  assert.equal(trash.records.length, 2);
  assert.equal(trash.records.find(row => row.id === 'task-one').parentDeleted, true);
  await assert.rejects(app.service.execute('alice', 'restore_record', {id: 'task-one'}), {status: 404});
  await app.service.execute('alice', 'restore_record', {id: 'project-a'});
  assert.equal(app.record('task-one').data.deleted, true); assert.equal(app.record('quote-one').data.deleted, undefined);
  await app.service.execute('alice', 'restore_record', {id: 'task-one'});
  assert.equal(app.record('task-one').data.deleted, false);
});

test('报价恢复时采纳竞争原子检查，已有采纳版则恢复草稿', async () => {
  const app = setup();
  app.row('old-quote', 'quote', 'project-a', {title: '原采纳报价', adopted: true, total: 2400000});
  await app.service.execute('alice', 'delete_record', {id: 'old-quote'});
  // A new quote is adopted after restore reads, before its atomic batch executes.
  app.controls.beforeBatch = () => app.row('new-quote', 'quote', 'project-a', {title: '新采纳报价', adopted: true, total: 3000000});
  const restored = await app.service.execute('alice', 'restore_record', {id: 'old-quote'});
  assert.equal(restored.restoredAsDraft, true); assert.equal(restored.record.adopted, false); assert.equal(restored.record.total, 2400000);
  assert.equal(app.record('new-quote').data.adopted, true);
  await app.service.execute('alice', 'delete_record', {id: 'new-quote'});
  const current = await app.service.execute('alice', 'restore_record', {id: 'new-quote'});
  assert.equal(current.record.adopted, true);
});

test('并发原业务修改不被删除覆盖；项目在恢复孩子期间被删除则拒绝', async () => {
  const app = setup(); app.row('receipt', 'transaction', 'project-a', {amount: 2000000, type: '收款'});
  app.controls.beforeBatch = () => app.sqlite.prepare("UPDATE records SET data=json_set(data,'$.amount',1900000) WHERE id='receipt'").run();
  await assert.rejects(app.service.execute('alice', 'delete_record', {id: 'receipt'}), {status: 409});
  assert.equal(app.record('receipt').data.amount, 1900000); assert.equal(app.record('receipt').data.deleted, undefined); assert.equal(app.audits().length, 0);
  await app.service.execute('alice', 'delete_record', {id: 'receipt'});
  app.controls.beforeBatch = () => app.sqlite.prepare("UPDATE records SET data=json_set(data,'$.deleted',json('true')) WHERE id='project-a'").run();
  await assert.rejects(app.service.execute('alice', 'restore_record', {id: 'receipt'}), {status: 409});
  assert.equal(app.record('receipt').data.deleted, true);
});

test('文件软删不改R2，重复删除、恢复与重新删除幂等；合同及普通资料均可', async () => {
  const app = setup(); const original = app.file();
  const args = {project_id: 'project-a', key: KEY, file_type: 'project'};
  const first = await app.service.execute('alice', 'delete_file', args);
  assert.equal(first.ok, true); assert.equal(first.file.name, '合同.pdf');
  assert.equal(app.objects.get(KEY), original); assert.equal(app.calls.put, 0); assert.equal(app.calls.delete, 0);
  assert.deepEqual([...await app.service.getDeletedFileKeys('alice', 'project-a', 'project')], [KEY]);
  assert.equal((await app.service.execute('alice', 'delete_file', args)).reused, true); assert.equal(app.audits().length, 1);
  const list = await app.service.execute('alice', 'list'); assert.equal(list.files.length, 1); assert.equal(list.files[0].parentName, '桃李书院');
  await app.service.execute('alice', 'restore_file', {id: first.file.id});
  assert.equal((await app.service.getDeletedFileKeys('alice', 'project-a', 'project')).size, 0);
  assert.equal((await app.service.execute('alice', 'restore_file', {id: first.file.id})).reused, true);
  const again = await app.service.execute('alice', 'delete_file', args);
  assert.equal(again.file.id, first.file.id); assert.equal(app.audits().length, 3);
  app.file(KEY.replace(UUID, '00000000-0000-4000-a000-000000000002'), {name: '资料.xlsx', category: '项目资料'});
  await app.service.execute('alice', 'delete_file', {...args, key: KEY.replace(UUID, '00000000-0000-4000-a000-000000000002')});
  assert.equal((await app.service.getDeletedFileKeys('alice', 'project-a', 'project')).size, 2);
});

test('文件归属metadata、owner项目付款路径校验；不存在文件不能创建回收标记', async () => {
  const app = setup(); app.file();
  const args = {project_id: 'project-a', key: KEY, file_type: 'project'};
  await assert.rejects(app.service.execute('bob', 'delete_file', args), {status: 404});
  await assert.rejects(app.service.execute('alice', 'delete_file', {...args, project_id: 'project-b'}), {status: 403});
  await assert.rejects(app.service.execute('alice', 'delete_file', {...args, key: 'alice/project-a/' + UUID}), {status: 403});
  await assert.rejects(app.service.execute('alice', 'delete_file', {...args, key: KEY.replace(UUID, '../anything')}), {status: 403});
  await assert.rejects(app.service.execute('alice', 'delete_file', {...args, key: KEY.replace(UUID, '00000000-0000-4000-a000-000000000002')}), {status: 404});
  app.file(KEY, {name: '旧五金.xlsx', type: '五金汇总'});
  await assert.rejects(app.service.execute('alice', 'delete_file', args), {status: 403});
  assert.equal(app.calls.batch, 0);
});

test('付款单据可恢复作废历史单，付款删除须先恢复；回收标记隔离付款', async () => {
  const app = setup();
  app.row(PAYMENT, 'transaction', 'project-a', {type: '付款', amount: 80000, void: true, category: '材料'});
  app.row('receipt', 'transaction', 'project-a', {type: '收款', amount: 2000000});
  app.file(PAYMENT_KEY, {name: '付款单.pdf', project_id: 'project-a', transaction_id: PAYMENT});
  const args = {project_id: 'project-a', transaction_id: PAYMENT, key: PAYMENT_KEY, file_type: 'payment'};
  const first = await app.service.execute('alice', 'delete_file', args);
  assert.deepEqual([...await app.service.getDeletedFileKeys('alice', 'project-a', 'payment', PAYMENT)], [PAYMENT_KEY]);
  await assert.rejects(app.service.getDeletedFileKeys('alice', 'project-a', 'payment', 'other'), {status:404});
  await app.service.execute('alice', 'delete_record', {id: PAYMENT});
  assert.equal((await app.service.execute('alice', 'list')).files[0].paymentDeleted, true);
  await assert.rejects(app.service.execute('alice', 'restore_file', {id: first.file.id}), {status: 404});
  await app.service.execute('alice', 'restore_record', {id: PAYMENT});
  await app.service.execute('alice', 'restore_file', {id: first.file.id});
  assert.equal(app.record(PAYMENT).data.void, true); assert.equal(app.record(PAYMENT).data.amount, 80000);
  await assert.rejects(app.service.execute('alice', 'delete_file', {...args, transaction_id: 'receipt'}), {status: 404});
  app.file(PAYMENT_KEY, {name: '错误归属.pdf', project_id: 'project-b', transaction_id: PAYMENT});
  await assert.rejects(app.service.execute('alice', 'delete_file', args), {status: 403});
});

test('文件父项目删除不会改独立回收标记，恢复文件需有效项目和原对象', async () => {
  const app = setup(); app.file();
  const first = await app.service.execute('alice', 'delete_file', {project_id: 'project-a', key: KEY, file_type: 'project'});
  await app.service.execute('alice', 'delete_record', {id: 'project-a'});
  const trash = await app.service.execute('alice', 'list'); assert.equal(trash.files[0].parentDeleted, true);
  await assert.rejects(app.service.execute('alice', 'restore_file', {id: first.file.id}), {status: 404});
  await app.service.execute('alice', 'restore_record', {id: 'project-a'});
  assert.equal((await app.service.getDeletedFileKeys('alice', 'project-a', 'project')).size, 1);
  app.objects.delete(KEY);
  await assert.rejects(app.service.execute('alice', 'restore_file', {id: first.file.id}), {status: 404});
  assert.equal(app.record(first.file.id).data.deleted, true);
});

test('owner路径编码隔离且文件审计失败回滚D1，原R2对象保持', async () => {
  const app = setup(); app.row('project-d', 'project', 'project-d', {name: '路径账号项目'}, 'alice/bob');
  const key = 'alice%2Fbob/project-d/files/' + UUID, original = app.file(key);
  const args = {project_id: 'project-d', key, file_type: 'project'};
  app.controls.auditFailure = true;
  await assert.rejects(app.service.execute('alice/bob', 'delete_file', args));
  assert.equal((await app.service.getDeletedFileKeys('alice/bob', 'project-d', 'project')).size, 0);
  assert.equal(app.objects.get(key), original); assert.equal(app.calls.put, 0); assert.equal(app.calls.delete, 0);
  app.controls.auditFailure = false;
  await app.service.execute('alice/bob', 'delete_file', args);
  assert.equal((await app.service.getDeletedFileKeys('alice/bob', 'project-d', 'project')).size, 1);
  assert.equal((await app.service.getDeletedFileKeys('alice', 'project-d', 'project')).size, 0);
});

test('付款移至独立项目后旧回收单据按当前流水授权，原R2和回收行origin不变', async () => {
 const app=setup();app.row('child-a','project','child-a',{name:'独立甲',parent_id:'project-a'});
 app.row(PAYMENT,'transaction','project-a',{type:'付款',amount:1055900,date:'2026-10-14',note:'保留金额及日期'});
 const original=app.file(PAYMENT_KEY,{name:'原付款单.pdf',project_id:'project-a',transaction_id:PAYMENT});
 const removed=await app.service.execute('alice','delete_file',{project_id:'project-a',transaction_id:PAYMENT,key:PAYMENT_KEY,file_type:'payment'});
 app.sqlite.prepare("UPDATE records SET project=?,data=json_set(data,'$.voucher_project_id',?) WHERE id=?").run('child-a','project-a',PAYMENT);
 const file=(await app.service.execute('alice','list')).files.find(file=>file.id===removed.file.id);
 assert.equal(file.project_id,'child-a');assert.equal(file.voucher_project_id,'project-a');assert.equal(file.parentName,'独立甲');assert.equal(file.parentDeleted,false);assert.equal(file.paymentDeleted,false);
 assert.deepEqual([...await app.service.getDeletedFileKeys('alice','child-a','payment',PAYMENT)],[PAYMENT_KEY]);
 await assert.rejects(app.service.getDeletedFileKeys('alice','project-a','payment',PAYMENT),{status:404});
 await app.service.execute('alice','restore_file',{id:removed.file.id,project_id:'project-b',voucher_project_id:'project-b'});
 assert.equal(app.record(removed.file.id).project,'project-a');assert.equal(app.record(removed.file.id).data.project_id,'project-a');assert.equal(app.record(removed.file.id).data.deleted,false);
 assert.equal((await app.service.getDeletedFileKeys('alice','child-a','payment',PAYMENT)).size,0);
 const again=await app.service.execute('alice','delete_file',{project_id:'child-a',transaction_id:PAYMENT,key:PAYMENT_KEY,file_type:'payment',voucher_project_id:'project-b'});
 assert.equal(again.file.id,removed.file.id);assert.equal(app.record(again.file.id).project,'project-a');assert.equal(app.objects.get(PAYMENT_KEY),original);assert.equal(original.customMetadata.project_id,'project-a');
 assert.equal(app.calls.put,0);assert.equal(app.calls.delete,0);assert.equal(app.record(PAYMENT).data.amount,1055900);assert.equal(app.record(PAYMENT).data.date,'2026-10-14');
});

test('单据origin子项目删除不妨碍当前兄弟项目恢复，当前root删除仍阻止操作', async () => {
 const app=setup();for(const name of ['origin-child','current-child','next-child'])app.row(name,'project',name,{name,parent_id:'project-a'});
 app.row(PAYMENT,'transaction','origin-child',{type:'付款',amount:10000});
 const key='alice/origin-child/payment-vouchers/'+encodeURIComponent(PAYMENT)+'/'+UUID;
 app.file(key,{name:'原子项目付款单.pdf',project_id:'origin-child',transaction_id:PAYMENT});
 const removed=await app.service.execute('alice','delete_file',{project_id:'origin-child',transaction_id:PAYMENT,key,file_type:'payment'});
 app.sqlite.prepare("UPDATE records SET project=?,data=json_set(data,'$.voucher_project_id',?) WHERE id=?").run('current-child','origin-child',PAYMENT);
 app.sqlite.prepare("UPDATE records SET data=json_set(data,'$.deleted',json('true')) WHERE id=?").run('origin-child');
 let file=(await app.service.execute('alice','list')).files[0];assert.equal(file.parentName,'current-child');assert.equal(file.parentDeleted,false);
 await app.service.execute('alice','restore_file',{id:removed.file.id});
 await app.service.execute('alice','delete_file',{project_id:'current-child',transaction_id:PAYMENT,key,file_type:'payment'});
 app.sqlite.prepare('UPDATE records SET project=? WHERE id=?').run('next-child',PAYMENT);
 assert.deepEqual([...await app.service.getDeletedFileKeys('alice','next-child','payment',PAYMENT)],[key]);assert.equal(app.record(removed.file.id).project,'origin-child');
 app.sqlite.prepare("UPDATE records SET data=json_set(data,'$.deleted',json('true')) WHERE id=?").run('project-a');
 file=(await app.service.execute('alice','list')).files[0];assert.equal(file.parentDeleted,true);
 await assert.rejects(app.service.execute('alice','restore_file',{id:removed.file.id}),{status:404});
 await assert.rejects(app.service.getDeletedFileKeys('alice','next-child','payment',PAYMENT),{status:404});
 assert.equal(app.calls.put,0);assert.equal(app.calls.delete,0);
});

test('付款单据来源仅从当前owner流水推导，客户端origin、外账号和跨root来源不能授权', async () => {
 const app=setup();app.row('child-a','project','child-a',{name:'独立甲',parent_id:'project-a'});
 app.row(PAYMENT,'transaction','child-a',{type:'付款',amount:10000,voucher_project_id:'project-a'});
 app.file(PAYMENT_KEY,{name:'原付款单.pdf',project_id:'project-a',transaction_id:PAYMENT});
 const args={project_id:'child-a',transaction_id:PAYMENT,key:PAYMENT_KEY,file_type:'payment',voucher_project_id:'project-b'};
 await assert.rejects(app.service.execute('bob','delete_file',args),{status:404});
 await assert.rejects(app.service.execute('alice','delete_file',{...args,project_id:'project-a'}),{status:404});
 await assert.rejects(app.service.execute('alice','delete_file',{...args,key:PAYMENT_KEY.replace('/project-a/','/project-b/')}),{status:403});
 const removed=await app.service.execute('alice','delete_file',args);assert.equal(removed.file.project,'project-a');
 app.sqlite.prepare("UPDATE records SET data=json_set(data,'$.voucher_project_id',?) WHERE id=?").run('project-b',PAYMENT);
 const heads=app.calls.head.length;
 await assert.rejects(app.service.execute('alice','restore_file',{id:removed.file.id}),{status:403});
 await assert.rejects(app.service.getDeletedFileKeys('alice','child-a','payment',PAYMENT),{status:403});
 assert.equal(app.calls.head.length,heads);assert.equal(app.record(removed.file.id).data.deleted,true);
});

test('恢复期间再次分配付款由当前项目和raw data原子保护，刷新重试复用同一回收行', async () => {
 const app=setup();for(const name of ['child-a','child-b'])app.row(name,'project',name,{name,parent_id:'project-a'});
 app.row(PAYMENT,'transaction','child-a',{type:'付款',amount:10000,voucher_project_id:'project-a'});
 const original=app.file(PAYMENT_KEY,{name:'原付款单.pdf',project_id:'project-a',transaction_id:PAYMENT});
 const removed=await app.service.execute('alice','delete_file',{project_id:'child-a',transaction_id:PAYMENT,key:PAYMENT_KEY,file_type:'payment'});
 const auditCount=app.audits().length;
 app.controls.beforeBatch=()=>app.sqlite.prepare("UPDATE records SET project=?,data=json_set(data,'$.updated',?) WHERE id=?").run('child-b','new-assignment',PAYMENT);
 await assert.rejects(app.service.execute('alice','restore_file',{id:removed.file.id}),{status:409});
 assert.equal(app.record(removed.file.id).data.deleted,true);assert.equal(app.audits().length,auditCount);assert.equal(app.objects.get(PAYMENT_KEY),original);
 await app.service.execute('alice','restore_file',{id:removed.file.id});assert.equal(app.record(removed.file.id).data.deleted,false);assert.equal(app.record(removed.file.id).project,'project-a');assert.equal(app.audits().length,auditCount+1);
 assert.equal(app.calls.put,0);assert.equal(app.calls.delete,0);
});
