import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync('app/api/payment-vouchers/handlers.ts', 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
}).outputText;
const {createPaymentVoucherHandlers} = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const base = 'https://vouchers.test';
const p1 = 'project-a', p2 = 'project-b', p3 = 'project-c';
const tx1 = 'tx:alice:payment-one', tx2 = 'tx:alice:payment-two', tx3 = 'tx:bob:payment-three', voidTx = 'tx:alice:void-payment';
const id = () => crypto.randomUUID();

function setup({pageSize = 1000, ready = true, deletedKeys} = {}) {
  const stored = new Map();
  const calls = {authorize: [], put: [], head: [], get: [], list: []};
  const faults = {};
  const projects = {
    alice: {[p1]: [{id: tx1, project: p1, type: '付款'}, {id: tx2, project: p1, type: '付款'}, {id: 'receipt', project: p1, type: '收款'}, {id: 'wrong-project', project: p2, type: '付款'}, {id: voidTx, project: p1, type: '付款', void: true}], [p2]: [{id: 'second-project', project: p2, type: '付款'}]},
    bob: {[p3]: [{id: tx3, project: p3, type: '付款'}]},
    'ali/ce': {[p1]: [{id: 'tx:ali/ce:request/one', project: p1, type: '付款'}]},
  };
  const checkFault = method => {if (faults[method]) throw new Error('simulated R2 failure');};
  const bucket = {
    async head(key) {calls.head.push(key); checkFault('head'); return stored.get(key) || null;},
    async put(key, value, options) {
      calls.put.push({key, options}); checkFault('put');
      assert.equal(options.onlyIf.get('If-None-Match'), '*', 'uploads must be atomic create only');
      assert(options.sha256 instanceof ArrayBuffer, 'R2 upload integrity checksum required');
      if (stored.has(key) || faults.nullPut) return null;
      const object = {key, body: new Uint8Array(value), size: value.byteLength, uploaded: new Date(), customMetadata: options.customMetadata, httpMetadata: options.httpMetadata};
      stored.set(key, object);
      checkFault('putAfterCommit');
      return object;
    },
    async get(key) {calls.get.push(key); checkFault('get'); return stored.get(key) || null;},
    async list(options) {
      calls.list.push(options); checkFault('list');
      const values = [...stored.values()].filter(value => value.key.startsWith(options.prefix));
      const from = Number(options.cursor || 0), next = from + pageSize;
      return {objects: values.slice(from, next), truncated: next < values.length, ...(next < values.length ? {cursor: String(next)} : {})};
    },
  };
  const handlers = createPaymentVoucherHandlers({
    bucket: () => ready ? bucket : undefined,
    ...(deletedKeys ? {deletedKeys} : {}),
    async authorize(owner, project) {
      calls.authorize.push({owner, project});
      const transactions = projects[owner]?.[project];
      if (!transactions) throw Object.assign(new Error('project denied'), {status: 404});
      return {project: {id: project}, transactions};
    },
  });
  function get({owner = 'alice', project = p1, transaction = tx1, key} = {}) {
    const query = new URLSearchParams({project_id: project, transaction_id: transaction});
    if (key !== undefined) query.set('key', key);
    return handlers.GET(new Request(base + '/api/payment-vouchers?' + query, {headers: owner ? {'oai-authenticated-user-id': owner} : {}}));
  }
  function post({owner = 'alice', project = p1, transaction = tx1, attachment = id(), name = '付款单据.pdf', content = new Uint8Array([1, 2, 3]), origin = base, site = 'same-origin', voucherProject} = {}) {
    const form = new FormData();
    form.set('project_id', project); form.set('transaction_id', transaction); form.set('attachment_id', attachment); form.set('file', new File([content], name));
    if (voucherProject !== undefined) form.set('voucher_project_id', voucherProject);
    const headers = {'sec-fetch-site': site};
    if (owner) headers['oai-authenticated-user-id'] = owner;
    if (origin) headers.origin = origin;
    return handlers.POST(new Request(base + '/api/payment-vouchers', {method: 'POST', headers, body: form}));
  }
  return {get, post, stored, calls, faults, projects};
}

test('未登录、跨账号、无付款、收款和流水所属项目错误均拒绝', async () => {
  const app = setup();
  assert.equal((await app.get({owner: null})).status, 401);
  assert.equal((await app.post({owner: null})).status, 401);
  for (const options of [{owner: 'bob'}, {project: p2}, {transaction: 'not-found'}, {transaction: 'receipt'}, {transaction: 'wrong-project'}]) {
    assert.equal((await app.get(options)).status, 404);
    assert.equal((await app.post(options)).status, 404);
  }
  assert.equal(app.calls.head.length, 0); assert.equal(app.calls.put.length, 0); assert.equal(app.calls.list.length, 0);
});

test('付款改小项目后原单据可列出下载，新单据仍写最初origin且旧项目不再授权', async () => {
  const app = setup(), first = await (await app.post()).json();
  const payment = app.projects.alice[p1].find(row => row.id === tx1);
  app.projects.alice[p1] = app.projects.alice[p1].filter(row => row.id !== tx1);
  app.projects.alice[p2].push({...payment, project: p2, voucher_project_id: p1});
  const listed = await (await app.get({project: p2})).json();
  assert.deepEqual(listed.files.map(file => file.key), [first.file.key]);
  assert.equal((await app.get({project: p2, key: first.file.key})).status, 200);
  assert.equal((await app.get({project: p1})).status, 404);
  const uploaded = await (await app.post({project: p2, name: '新的单据.pdf'})).json();
  assert.match(uploaded.file.key, /^alice\/project-a\/payment-vouchers\//);
  assert.equal(uploaded.file.project_id, p1);
  assert.equal(app.calls.authorize.at(-1).project, p2);
  const movedAgain = 'project-d'; app.projects.alice[movedAgain] = [{...payment, project: movedAgain, voucher_project_id: p1}];
  app.projects.alice[p2] = app.projects.alice[p2].filter(row => row.id !== tx1);
  assert.equal((await (await app.get({project: movedAgain})).json()).files.length, 2);
  assert.equal((await app.get({project: p2})).status, 404);
});

test('origin只能来自授权的付款，客户端不能改命名空间或跨付款/跨账号取文件', async () => {
  const app = setup(), payment = app.projects.alice[p1].find(row => row.id === tx1);
  app.projects.alice[p1] = app.projects.alice[p1].filter(row => row.id !== tx1);
  app.projects.alice[p2].push({...payment, project: p2, voucher_project_id: p1});
  const uploaded = await (await app.post({project: p2, voucherProject: p3})).json();
  assert.equal(uploaded.file.project_id, p1);
  assert.match(uploaded.file.key, /^alice\/project-a\//);
  assert.equal((await app.get({owner: 'bob', project: p2, key: uploaded.file.key})).status, 404);
  assert.equal((await app.get({project: p1, transaction: tx2, key: uploaded.file.key})).status, 403);
  const wrongPrefix = uploaded.file.key.replace('/project-a/', '/project-b/');
  assert.equal((await app.get({project: p2, key: wrongPrefix})).status, 403);
  assert.equal(app.calls.put.length, 1);
});

test('移动付款的回收站查询继续按当前project鉴权，删除的原origin单据仍隐藏', async () => {
  const deleted = new Set(), queries = [], app = setup({deletedKeys: async (owner, project, transaction) => {queries.push({owner, project, transaction}); return deleted;}});
  const first = await (await app.post()).json();
  const payment = app.projects.alice[p1].find(row => row.id === tx1);
  app.projects.alice[p1] = app.projects.alice[p1].filter(row => row.id !== tx1);
  app.projects.alice[p2].push({...payment, project: p2, voucher_project_id: p1});
  deleted.add(first.file.key);
  assert.deepEqual((await (await app.get({project: p2})).json()).files, []);
  assert.equal((await app.get({project: p2, key: first.file.key})).status, 404);
  assert.equal(queries.at(-1).project, p2);
  assert.equal(queries.at(-1).transaction, tx1);
});

test('必须同源上传并校验UUID、文件类型、非空与10MB上限', async () => {
  const app = setup();
  for (const options of [{origin: null}, {origin: 'https://other.test'}, {site: 'cross-site'}]) assert.equal((await app.post(options)).status, 403);
  assert.equal((await app.post({attachment: 'not-uuid'})).status, 400);
  for (const name of ['x.html', 'x.js', 'x.svg', 'x.exe', 'x.zip', 'x.dwg', 'x.pdf.exe']) assert.equal((await app.post({name})).status, 400);
  assert.equal((await app.post({content: new Uint8Array(0)})).status, 400);
  assert.equal((await app.post({content: new Uint8Array(10 * 1024 * 1024 + 1)})).status, 400);
  assert.equal(app.calls.put.length, 0);
  assert.equal((await app.post({name: '边界.PDF', content: new Uint8Array(10 * 1024 * 1024)})).status, 200);
});

test('支持常见单据类型，新文件隔离且不修改付款资料', async () => {
  const app = setup();
  const financialBefore = JSON.stringify(app.projects);
  for (const extension of ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'xlsx', 'xls', 'doc', 'docx']) {
    const response = await app.post({name: '单据.' + extension});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reused, false);
    assert.match(body.file.key, /^alice\/project-a\/payment-vouchers\/tx%3Aalice%3Apayment-one\/[0-9a-f-]{36}$/);
    assert.equal(body.file.transaction_id, tx1); assert.equal(body.file.project_id, p1); assert.equal(body.file.size, 3);
  }
  assert.equal(JSON.stringify(app.projects), financialBefore);
  assert.equal(app.calls.authorize.length, 9);
});

test('同附件同内容幂等返回原文件，不同内容409且不覆盖', async () => {
  const app = setup(), attachment = id();
  const first = await (await app.post({attachment})).json();
  const again = await (await app.post({attachment: attachment.toUpperCase()})).json();
  assert.equal(again.reused, true); assert.deepEqual(again.file, first.file);
  const renamed = await (await app.post({attachment, name: '重新命名.pdf'})).json();
  assert.equal(renamed.file.name, '付款单据.pdf', 'first upload metadata must be preserved');
  const conflict = await app.post({attachment, content: new Uint8Array([9, 8, 7])});
  assert.equal(conflict.status, 409);
  assert.equal(app.calls.put.length, 1); assert.equal(app.stored.size, 1);
  assert.deepEqual([...app.stored.get(first.file.key).body], [1, 2, 3]);
});

test('并发同UUID仅创建一次，同内容重试成功、不同内容冲突', async () => {
  const app = setup(), attachment = id();
  const same = await Promise.all([app.post({attachment}), app.post({attachment})]);
  assert.deepEqual(same.map(value => value.status), [200, 200]);
  assert.equal(app.stored.size, 1);
  const payloads = await Promise.all(same.map(value => value.json()));
  assert.equal(payloads.filter(value => !value.reused).length, 1);
  const other = setup(), otherId = id();
  const conflict = await Promise.all([other.post({attachment: otherId}), other.post({attachment: otherId, content: new Uint8Array([6, 5, 4])})]);
  assert.deepEqual(conflict.map(value => value.status).sort(), [200, 409]);
  assert.equal(other.stored.size, 1);
});

test('跨项目与跨付款下载隔离，下载为安全附件且禁止缓存', async () => {
  const app = setup();
  const uploaded = await (await app.post()).json(), key = uploaded.file.key;
  for (const options of [{transaction: tx2, key}, {owner: 'bob', project: p3, transaction: tx3, key}, {project: p2, transaction: 'second-project', key}, {key: key + '/suffix'}, {key: 'alice/project-a/files/' + id()}]) assert.equal((await app.get(options)).status, 403);
  assert.equal(app.calls.get.length, 0);
  const response = await app.get({key});
  assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.match(response.headers.get('Content-Disposition'), /^attachment; filename\*=UTF-8''/);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff'); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  assert.equal((await app.get({key: key.slice(0, key.lastIndexOf('/') + 1) + id()})).status, 404);
});

test('列表完整分页，仅指定付款附件，不混入通用文件或别的付款', async () => {
  const app = setup({pageSize: 1});
  for (let i = 0; i < 7; i++) await app.post({name: '单据' + i + '.pdf'});
  await app.post({transaction: tx2});
  app.stored.set('alice/project-a/files/' + id(), {key: 'alice/project-a/files/' + id(), customMetadata: {name: '通用.pdf'}});
  const response = await app.get();
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const body = await response.json(); assert.equal(body.files.length, 7);
  assert.equal(app.calls.list.length, 7); assert(app.calls.list.every(call => call.prefix === 'alice/project-a/payment-vouchers/tx%3Aalice%3Apayment-one/'));
  assert(body.files.every(file => file.transaction_id === tx1 && file.name !== '通用.pdf'));
});

test('作废后保留读取和原附件重试，但拒绝新的附件', async () => {
  const app = setup(), attachment = id();
  const uploaded = await (await app.post({attachment})).json();
  app.projects.alice[p1].find(value => value.id === tx1).void = true;
  assert.equal((await app.get({key: uploaded.file.key})).status, 200);
  assert.equal((await app.get()).status, 200);
  assert.equal((await app.post({attachment})).status, 200);
  assert.equal((await app.post()).status, 409);
  assert.equal((await app.post({transaction: voidTx})).status, 409);
  assert.equal(app.calls.put.length, 1);
});

test('路径段完整编码，metadata归属不匹配拒绝', async () => {
  const app = setup();
  const options = {owner: 'ali/ce', transaction: 'tx:ali/ce:request/one'};
  const upload = await (await app.post(options)).json();
  assert.match(upload.file.key, /^ali%2Fce\/project-a\/payment-vouchers\/tx%3Aali%2Fce%3Arequest%2Fone\//);
  assert.equal((await app.get({...options, key: upload.file.key})).status, 200);
  app.stored.get(upload.file.key).customMetadata.transaction_id = 'wrong-transaction';
  assert.equal((await app.get({...options, key: upload.file.key})).status, 403);
  assert.equal((await app.post({...options, attachment: upload.file.attachment_id})).status, 409);
});

test('R2故障不假报成功，无财务修改；写入后失去响应可安全重试', async () => {
  const app = setup(), financialBefore = JSON.stringify(app.projects), attachment = id();
  app.faults.put = true; const failed = await app.post({attachment});
  assert.equal(failed.status, 500); assert.equal((await failed.json()).ok, undefined); assert.equal(app.stored.size, 0);
  delete app.faults.put; app.faults.nullPut = true; assert.equal((await app.post({attachment})).status, 503);
  delete app.faults.nullPut; app.faults.putAfterCommit = true; assert.equal((await app.post({attachment})).status, 500);
  assert.equal(app.stored.size, 1); delete app.faults.putAfterCommit;
  const retry = await (await app.post({attachment})).json(); assert.equal(retry.reused, true); assert.equal(app.stored.size, 1);
  app.faults.list = true; assert.equal((await app.get()).status, 500); delete app.faults.list;
  app.faults.get = true; assert.equal((await app.get({key: retry.file.key})).status, 500);
  assert.equal(JSON.stringify(app.projects), financialBefore);
  const unavailable = setup({ready: false}); assert.equal((await unavailable.post()).status, 503); assert.equal((await unavailable.get()).status, 503);
});
