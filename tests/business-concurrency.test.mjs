import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const asURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const detailsURL = asURL(compile(readFileSync('lib/payment-details.ts', 'utf8')));
const quotesURL = asURL(compile(readFileSync('lib/quotes.ts', 'utf8')));
const businessURL = asURL(compile(readFileSync('lib/business.ts', 'utf8')).replace("from 'zod'", `from '${import.meta.resolve('zod')}'`).replaceAll("from './payment-details'", `from '${detailsURL}'`).replaceAll("from './quotes'", `from '${quotesURL}'`));
const {createTrashService} = await import(asURL(compile(readFileSync('lib/trash.ts', 'utf8').replace(/^import .*?;\r?\n/gm, ''))));

async function fixture(t, {sqliteResults = false} = {}) {
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
          const result = sqlite.prepare(statement.sql).run(...statement.args);
          return sqliteResults ? result : {meta: {changes: Number(result.changes)}};
        });
        sqlite.exec('COMMIT'); return results;
      } catch (error) {sqlite.exec('ROLLBACK'); throw error;}
    },
  };
  globalThis.concurrentBusinessEnv = {DB: database};
  const serviceURL = asURL(compile(readFileSync('lib/service.ts', 'utf8')).replace("import { env } from 'cloudflare:workers';", 'const env=globalThis.concurrentBusinessEnv;').replace("import { env } from './local-env';", 'const env=globalThis.concurrentBusinessEnv;').replace("from './business'", `from '${businessURL}'`)) + '#' + crypto.randomUUID();
  const {execute, state} = await import(serviceURL);
  const trash = createTrashService({database: () => database, bucket: () => undefined});
  const project = await execute('alice', 'create_project', {name: '并发测试项目', customer: '测试客户'});
  const payment = {project_id: project.id, type: '付款', amount: 100, payment_items: [{name: '材料', amount: 100}], category: '材料', note: '', date: '2026-10-12', request_id: 'concurrent-payment-001'};
  const quote = (title, price = 100) => ({project_id: project.id, title, items: [{name: '柜体', unit: '个', quantity: 1, price}]});
  function record(id) {const row = sqlite.prepare('SELECT * FROM records WHERE id=?').get(id); return row ? {...row, data: JSON.parse(row.data)} : null;}
  function audits(action) {return sqlite.prepare("SELECT * FROM records WHERE kind = 'audit'").all().map(row => JSON.parse(row.data)).filter(row => !action || row.action === action);}
  function adopted() {return sqlite.prepare("SELECT * FROM records WHERE kind = 'quote'").all().filter(row => {const data = JSON.parse(row.data); return data.adopted === true && !data.deleted;}).map(row => row.id);}
  return {execute, state, trash, sqlite, controls, project, payment, quote, record, audits, adopted};
}

test('同流水ID查无后另一请求已登记并软删，延迟INSERT拒绝且不重新入账', async t => {
  const app = await fixture(t); let first;
  app.controls.beforeBatch = async () => {
    first = await app.execute('alice', 'record_transaction', app.payment);
    await app.trash.execute('alice', 'delete_record', {id: first.id});
  };
  await assert.rejects(app.execute('alice', 'record_transaction', app.payment), error => error.status === 409 && /回收站/.test(error.message));
  const saved = app.record(first.id);
  assert.equal(saved.data.amount, 10000); assert.equal(saved.data.deleted, true); assert.equal(saved.data.void, false);
  assert.equal((await app.state('alice')).transactions.length, 0); assert.equal((await app.state('alice')).projects[0].paid, 0);
  assert.equal(app.audits('record_transaction').length, 1); assert.equal(app.audits('delete_record').length, 1);
});

test('同流水ID并发同内容幂等，不同内容409且第一笔金额不可覆盖', async t => {
  const app = await fixture(t); let first;
  app.controls.beforeBatch = async () => {first = await app.execute('alice', 'record_transaction', app.payment);};
  const repeated = await app.execute('alice', 'record_transaction', app.payment);
  assert.deepEqual(repeated, first); assert.equal(app.audits('record_transaction').length, 1);
  const second = {...app.payment, request_id: 'concurrent-payment-002', amount: 200, payment_items: [{name: '材料', amount: 200}]};
  app.controls.beforeBatch = async () => {first = await app.execute('alice', 'record_transaction', {...second, amount: 100, payment_items: [{name: '材料', amount: 100}]});};
  await assert.rejects(app.execute('alice', 'record_transaction', second), error => error.status === 409);
  assert.equal(app.record(first.id).data.amount, 10000); assert.equal(app.audits('record_transaction').length, 2);
});

test('新建项目、报价、任务遇已有ID不覆盖，不绕过软删除或跨kind', async t => {
  const app = await fixture(t);
  const q = await app.execute('alice', 'create_quote', app.quote('原报价'));
  const original = app.record(q.id).data; const auditBefore = app.audits().length;
  await assert.rejects(app.execute('alice', 'create_project', {id: q.id, name: '覆盖项目', customer: '其他客户'}), error => error.status === 409);
  await assert.rejects(app.execute('alice', 'create_task', {id: q.id, project_id: app.project.id, title: '覆盖任务'}), error => error.status === 409);
  assert.deepEqual(app.record(q.id).data, original); assert.equal(app.audits().length, auditBefore);
  await app.trash.execute('alice', 'delete_record', {id: q.id});
  const deleted = app.record(q.id).data;
  await assert.rejects(app.execute('alice', 'create_quote', {...app.quote('覆盖已删除报价'), id: q.id}), error => error.status === 409);
  assert.deepEqual(app.record(q.id).data, deleted);
});

test('项目/任务读后被删除，CAS更新409且删除标记保留，没有假审计', async t => {
  const app = await fixture(t);
  const task = await app.execute('alice', 'create_task', {project_id: app.project.id, title: '原任务'});
  app.controls.beforeBatch = async () => {await app.trash.execute('alice', 'delete_record', {id: task.id});};
  await assert.rejects(app.execute('alice', 'update_task', {id: task.id, project_id: app.project.id, title: '不应保存'}), error => error.status === 409);
  assert.equal(app.record(task.id).data.deleted, true); assert.equal(app.record(task.id).data.title, '原任务');
  assert.equal(app.audits('update_task').length, 0);
  app.controls.beforeBatch = async () => {await app.trash.execute('alice', 'delete_record', {id: app.project.id});};
  await assert.rejects(app.execute('alice', 'update_project', {id: app.project.id, name: '不应保存的项目', customer: '测试客户'}), error => error.status === 409);
  assert.equal(app.record(app.project.id).data.deleted, true); assert.equal(app.record(app.project.id).data.name, '并发测试项目'); assert.equal(app.audits('update_project').length, 0);
});

test('读后并发编辑导致旧快照更新409，保留先完成的新版内容', async t => {
  const app = await fixture(t), q = await app.execute('alice', 'create_quote', app.quote('原报价'));
  app.controls.beforeBatch = async () => {await app.execute('alice', 'update_quote', {...app.quote('先完成的报价', 300), id: q.id});};
  await assert.rejects(app.execute('alice', 'update_quote', {...app.quote('过期覆盖', 900), id: q.id}), error => error.status === 409);
  assert.equal(app.record(q.id).data.title, '先完成的报价'); assert.equal(app.record(q.id).data.total, 30000); assert.equal(app.audits('update_quote').length, 1);
});

test('父项目读后删除阻止子记录新增、更新和作废', async t => {
  const app = await fixture(t), tx = await app.execute('alice', 'record_transaction', app.payment);
  app.controls.beforeBatch = async () => {await app.trash.execute('alice', 'delete_record', {id: app.project.id});};
  await assert.rejects(app.execute('alice', 'void_transaction', {id: tx.id, reason: '不应作废'}), error => error.status === 409);
  assert.equal(app.record(tx.id).data.void, false); assert.equal(app.record(tx.id).data.amount, 10000); assert.equal(app.audits('void_transaction').length, 0);
  const other = await fixture(t);
  other.controls.beforeBatch = async () => {await other.trash.execute('alice', 'delete_record', {id: other.project.id});};
  await assert.rejects(other.execute('alice', 'record_transaction', other.payment), error => error.status === 409);
  assert.equal(other.sqlite.prepare("SELECT COUNT(*) AS count FROM records WHERE kind='transaction'").get().count, 0); assert.equal(other.audits('record_transaction').length, 0);
});

test('流水读后被删除，作废CAS拒绝且金额/void/删除状态均保持', async t => {
  const app = await fixture(t), tx = await app.execute('alice', 'record_transaction', app.payment);
  app.controls.beforeBatch = async () => {await app.trash.execute('alice', 'delete_record', {id: tx.id});};
  await assert.rejects(app.execute('alice', 'void_transaction', {id: tx.id, reason: '不应恢复该笔'}), error => error.status === 409);
  const saved = app.record(tx.id).data;
  assert.equal(saved.deleted, true); assert.equal(saved.void, false); assert.equal(saved.amount, 10000); assert.equal(app.audits('void_transaction').length, 0);
});

test('采纳目标读后删除或父项目删除，不取消原采纳报价且无假审计', async t => {
  const app = await fixture(t), old = await app.execute('alice', 'create_quote', app.quote('原采纳', 100)), target = await app.execute('alice', 'create_quote', app.quote('新目标', 200));
  await app.execute('alice', 'adopt_quote', {id: old.id});
  app.controls.beforeBatch = async () => {await app.trash.execute('alice', 'delete_record', {id: target.id});};
  await assert.rejects(app.execute('alice', 'adopt_quote', {id: target.id}), error => error.status === 409);
  assert.deepEqual(app.adopted(), [old.id]); assert.equal(app.record(target.id).data.deleted, true); assert.equal(app.audits('adopt_quote').length, 1);
  const fresh = await app.execute('alice', 'create_quote', app.quote('第三报价', 300));
  app.controls.beforeBatch = async () => {await app.trash.execute('alice', 'delete_record', {id: app.project.id});};
  await assert.rejects(app.execute('alice', 'adopt_quote', {id: fresh.id}), error => error.status === 409);
  assert.equal(app.record(old.id).data.adopted, true); assert.equal(app.record(fresh.id).data.adopted, false); assert.equal(app.audits('adopt_quote').length, 1);
});

test('采纳目标读后已修改，不取消现有采纳，失败更新无审计', async t => {
  const app = await fixture(t), old = await app.execute('alice', 'create_quote', app.quote('原采纳')), target = await app.execute('alice', 'create_quote', app.quote('目标报价'));
  await app.execute('alice', 'adopt_quote', {id: old.id});
  app.controls.beforeBatch = async () => {await app.execute('alice', 'update_quote', {...app.quote('修改后的目标', 500), id: target.id});};
  await assert.rejects(app.execute('alice', 'adopt_quote', {id: target.id}), error => error.status === 409);
  assert.deepEqual(app.adopted(), [old.id]); assert.equal(app.record(target.id).data.total, 50000); assert.equal(app.record(target.id).data.adopted, false); assert.equal(app.audits('adopt_quote').length, 1);
});

test('恢复报价在采纳读取之后完成，实时取消恢复版本保证唯一采纳', async t => {
  const app = await fixture(t), old = await app.execute('alice', 'create_quote', app.quote('可恢复报价')), target = await app.execute('alice', 'create_quote', app.quote('目标报价'));
  await app.execute('alice', 'adopt_quote', {id: old.id}); await app.trash.execute('alice', 'delete_record', {id: old.id});
  app.controls.beforeBatch = async () => {await app.trash.execute('alice', 'restore_record', {id: old.id}); assert.deepEqual(app.adopted(), [old.id]);};
  await app.execute('alice', 'adopt_quote', {id: target.id});
  assert.deepEqual(app.adopted(), [target.id]); assert.equal(app.record(old.id).data.deleted, false); assert.equal(app.record(old.id).data.adopted, false);
});

test('采纳先完成再恢复旧采纳，恢复为草稿且金额不变', async t => {
  const app = await fixture(t), old = await app.execute('alice', 'create_quote', app.quote('已删旧采纳', 300)), target = await app.execute('alice', 'create_quote', app.quote('当前采纳', 500));
  await app.execute('alice', 'adopt_quote', {id: old.id}); await app.trash.execute('alice', 'delete_record', {id: old.id}); await app.execute('alice', 'adopt_quote', {id: target.id});
  const restored = await app.trash.execute('alice', 'restore_record', {id: old.id});
  assert.equal(restored.restoredAsDraft, true); assert.equal(app.record(old.id).data.total, 30000); assert.deepEqual(app.adopted(), [target.id]);
});

test('两个采纳交错，后批次从数据库即时清除另一采纳版本', async t => {
  const app = await fixture(t), a = await app.execute('alice', 'create_quote', app.quote('A')), b = await app.execute('alice', 'create_quote', app.quote('B')), c = await app.execute('alice', 'create_quote', app.quote('C'));
  await app.execute('alice', 'adopt_quote', {id: a.id});
  app.controls.beforeBatch = async () => {await app.execute('alice', 'adopt_quote', {id: c.id});};
  await app.execute('alice', 'adopt_quote', {id: b.id});
  assert.deepEqual(app.adopted(), [b.id]); assert.equal(app.record(a.id).data.adopted, false); assert.equal(app.record(c.id).data.adopted, false); assert.equal(app.audits('adopt_quote').length, 3);
});

test('审计写入故障整体回滚采纳取消和目标更新，不假报成功', async t => {
  const app = await fixture(t), a = await app.execute('alice', 'create_quote', app.quote('原采纳')), b = await app.execute('alice', 'create_quote', app.quote('目标报价'));
  await app.execute('alice', 'adopt_quote', {id: a.id});
  const beforeA = app.record(a.id).data, beforeB = app.record(b.id).data;
  app.controls.auditFailure = true;
  await assert.rejects(app.execute('alice', 'adopt_quote', {id: b.id}), /audit failure/);
  assert.deepEqual(app.record(a.id).data, beforeA); assert.deepEqual(app.record(b.id).data, beforeB); assert.equal(app.audits('adopt_quote').length, 1);
});

test('支持SQLite changes测试结果，原始快照不出现在JSON响应', async t => {
  const app = await fixture(t, {sqliteResults: true});
  const transaction = await app.execute('alice', 'record_transaction', app.payment); assert.equal(transaction.amount, 10000);
  const project = await app.execute('alice', 'update_project', {id: app.project.id, name: '更名后的项目', customer: '测试客户'}); assert.equal(project.name, '更名后的项目');
  const state = await app.state('alice'); assert(Object.getOwnPropertySymbols(state).length > 0); assert.equal(Object.keys(state).some(key => /snapshot|raw/i.test(key)), false);
  assert.equal(JSON.stringify(state).includes('raw record snapshots'), false); assert.equal(JSON.parse(JSON.stringify(state)).projects[0].name, '更名后的项目');
});


test('合作项目下多个项目具有独立ID，报价收付款利润分开汇总',async t=>{
 const app=await fixture(t);const a=await app.execute('alice','create_project',{parent_id:app.project.id,name:'项目甲',customer:'客户'}),b=await app.execute('alice','create_project',{parent_id:app.project.id,name:'项目乙',customer:'客户'});assert.notEqual(a.id,b.id);assert.equal(a.parent_id,app.project.id);
 const q=await app.execute('alice','create_quote',{...app.quote('甲报价',200),project_id:a.id});await app.execute('alice','adopt_quote',{id:q.id});
 await app.execute('alice','record_transaction',{...app.payment,project_id:a.id,type:'收款',payment_items:undefined,amount:150,request_id:'child-income-a'});
 await app.execute('alice','record_transaction',{...app.payment,project_id:a.id,amount:100,request_id:'child-payment-a'});
 await app.execute('alice','record_transaction',{...app.payment,project_id:b.id,amount:50,payment_items:[{name:'乙材料',amount:50}],request_id:'child-payment-b'});
 const state=await app.state('alice'),pa=state.projects.find(p=>p.id===a.id),pb=state.projects.find(p=>p.id===b.id),root=state.projects.find(p=>p.id===app.project.id);assert.equal(pa.contract,20000);assert.equal(pa.received,15000);assert.equal(pa.paid,10000);assert.equal(pa.cash,5000);assert.equal(pb.paid,5000);assert.equal(pb.contract,0);assert.equal(root.contract,0);assert.equal(root.paid,0);
 const onlyA=await app.execute('alice','get_project',{id:a.id});assert.ok(onlyA.transactions.every(row=>row.project===a.id));assert.equal(onlyA.quotes.length,1);
 const edited=await app.execute('alice','update_project',{id:a.id,name:'项目甲改名',customer:'客户'});assert.equal(edited.parent_id,app.project.id);
 await assert.rejects(app.execute('alice','update_project',{id:a.id,parent_id:b.id,name:'移动',customer:'客户'}),/不能移动/);
 await assert.rejects(app.execute('alice','create_project',{parent_id:a.id,name:'第三层',customer:'客户'}),/只能/);
 await assert.rejects(app.execute('bob','create_project',{parent_id:app.project.id,name:'越权',customer:'客户'}),error=>error.status===404);
});
test('存在下属项目阻止删除合作项目；恢复孩子先恢复合作项目',async t=>{
 const app=await fixture(t),child=await app.execute('alice','create_project',{parent_id:app.project.id,name:'甲',customer:'客户'});
 await assert.rejects(app.trash.execute('alice','delete_record',{id:app.project.id}),/独立项目/);
 await app.trash.execute('alice','delete_record',{id:child.id});await app.trash.execute('alice','delete_record',{id:app.project.id});await assert.rejects(app.trash.execute('alice','restore_record',{id:child.id}),error=>error.status===404);
 await app.trash.execute('alice','restore_record',{id:app.project.id});await app.trash.execute('alice','restore_record',{id:child.id});assert.equal(app.record(child.id).data.parent_id,app.project.id);
});
test('创建独立项目与合作项目删除竞争由数据库原子保护',async t=>{
 const app=await fixture(t);app.controls.beforeBatch=async()=>{await app.trash.execute('alice','delete_record',{id:app.project.id});};await assert.rejects(app.execute('alice','create_project',{parent_id:app.project.id,name:'延迟甲',customer:'客户'}),error=>error.status===409);assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='project'").get().n,1);
});
