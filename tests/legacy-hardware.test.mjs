import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Route-only dependencies are replaced to exercise exactly the deployed handlers.
const source = readFileSync('app/api/legacy-hardware/route.ts', 'utf8')
  .replace(/^import .*?;\r?\n/gm, '')
  .replace(/\nconst handlers = createLegacyHardwareHandlers\([\s\S]*$/, '\nexport {createLegacyHardwareHandlers};');
const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const {createLegacyHardwareHandlers} = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const BASE = 'https://legacy.test';
const IDS = ['00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000003'];
const activeKey = id => 'alice/project-a/' + id;
const trashKey = id => 'alice/project-a/legacy-trash/' + id;

function setup({pageSize = 1000, ready = true, databaseReady = true} = {}) {
  const stored = new Map(), rows = [];
  const calls = {authorize: [], list: [], put: [], get: [], head: [], delete: [], batch: [], all: []};
  const failures = {put: new Set(), delete: new Set(), batch: false, listAt: 0};
  function object(key, content, metadata, httpMetadata = {contentType: 'application/xlsx'}) {
    const bytes = new Uint8Array(content);
    const etag = createHash('md5').update(bytes).digest('hex');
    return {key, body: bytes, etag, size: bytes.byteLength, uploaded: new Date('2026-10-12T00:00:00Z'), customMetadata: {...metadata}, httpMetadata};
  }
  function add(key, metadata = {name: '五金.xlsx', type: '五金汇总', created: '2026-10-12T00:00:00Z'}, content = [1, 2, 3]) {
    const value = object(key, content, metadata); stored.set(key, value); return value;
  }
  function archive(id, content = [1, 2, 3]) {
    const source = object(activeKey(id), content, {});
    return add(trashKey(id), {name: '历史五金.xlsx', type: '五金成本', created: '2026-10-12T00:00:00Z', originalKey: activeKey(id), originalEtag: source.etag, removedAt: '2026-10-12T01:00:00Z'}, content);
  }
  const bucket = {
    async get(key) {calls.get.push(key); return stored.get(key) || null;},
    async head(key) {calls.head.push(key); return stored.get(key) || null;},
    async put(key, content, options) {
      calls.put.push({key, options});
      if (failures.put.has(key)) throw new Error('copy failure');
      if (options.onlyIf?.get('If-None-Match') === '*' && stored.has(key)) return null;
      const bytes = content instanceof ReadableStream ? new Uint8Array(await new Response(content).arrayBuffer()) : new Uint8Array(content);
      const value = object(key, bytes, options.customMetadata, options.httpMetadata);
      stored.set(key, value); return value;
    },
    async delete(key) {
      calls.delete.push(key);
      if (failures.delete.has(key)) throw new Error('delete failure');
      stored.delete(key);
    },
    async list(options) {
      calls.list.push(options);
      if (failures.listAt === calls.list.length) throw new Error('listing failure');
      const objects = [...stored.values()].filter(value => value.key.startsWith(options.prefix)).sort((a, b) => a.key.localeCompare(b.key));
      const from = Number(options.cursor || 0), next = from + pageSize;
      return {objects: objects.slice(from, next), truncated: next < objects.length, ...(next < objects.length ? {cursor: String(next)} : {})};
    },
  };
  const database = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            sql, args,
            async all() {
              calls.all.push({sql, args});
              assert.match(sql, /^SELECT kind, COUNT/);
              const [owner, project, first, second] = args;
              const found = rows.filter(row => row.owner === owner && row.project === project && [first, second].includes(row.kind));
              return {results: [first, second].map(kind => ({kind, total: found.filter(row => row.kind === kind).length}))};
            },
          };
        },
      };
    },
    async batch(statements) {
      calls.batch.push(statements);
      if (failures.batch) throw new Error('batch failure');
      const mutation = statements[0], audit = statements[1];
      assert.match(mutation.sql, /^UPDATE records SET kind = \? WHERE owner = \? AND project = \? AND kind = \?/);
      const [kind, owner, project, fromKind] = mutation.args;
      const blocked = mutation.sql.includes('NOT EXISTS') && rows.some(row => row.owner === owner && row.project === project && row.kind === 'hardware');
      let changes = 0;
      for (const row of rows) if (!blocked && row.owner === owner && row.project === project && row.kind === fromKind) {row.kind = kind; changes++;}
      const [id, auditOwner, auditKind, auditProject, data, created] = audit.args;
      rows.push({id, owner: auditOwner, kind: auditKind, project: auditProject, data, created});
      return [{meta: {changes}}, {meta: {changes: 1}}];
    },
  };
  const handlers = createLegacyHardwareHandlers({
    bucket: () => ready ? bucket : undefined,
    database: () => databaseReady ? database : undefined,
    async authorize(owner, project) {
      calls.authorize.push({owner, project});
      if (!({alice: ['project-a', 'project-b'], bob: ['project-c']}[owner] || []).includes(project)) throw Object.assign(new Error('denied'), {status: 404});
    },
  });
  function get({owner = 'alice', project = 'project-a'} = {}) {
    return handlers.GET(new Request(BASE + '/api/legacy-hardware?' + new URLSearchParams({project_id: project}), {headers: owner ? {'oai-authenticated-user-id': owner} : {}}));
  }
  function post({action = 'clear', owner = 'alice', project = 'project-a', origin = BASE, site = 'same-origin'} = {}) {
    const headers = {'Content-Type': 'application/json', 'sec-fetch-site': site};
    if (owner) headers['oai-authenticated-user-id'] = owner;
    if (origin) headers.origin = origin;
    return handlers.POST(new Request(BASE + '/api/legacy-hardware', {method: 'POST', headers, body: JSON.stringify({project_id: project, action})}));
  }
  function cost({owner = 'alice', project = 'project-a', kind = 'hardware', id = crypto.randomUUID(), data = '{"items":[{"name":"五金"}]}' } = {}) {const row = {owner, project, kind, id, data, created: '2026-10-01T00:00:00Z'}; rows.push(row); return row;}
  return {stored, rows, calls, failures, add, archive, cost, get, post};
}

test('授权账号与项目隔离，跨站和非法路径操作均不可触达存储', async () => {
  const app = setup();
  assert.equal((await app.get({owner: null})).status, 401);
  assert.equal((await app.post({owner: null})).status, 401);
  assert.equal((await app.get({owner: 'bob'})).status, 404);
  assert.equal((await app.post({owner: 'bob'})).status, 404);
  assert.equal((await app.post({origin: null})).status, 403);
  assert.equal((await app.post({origin: 'https://other.test'})).status, 403);
  assert.equal((await app.post({site: 'cross-site'})).status, 403);
  assert.equal((await app.get({project: '../project-a'})).status, 400);
  assert.equal((await app.post({project: '../project-a'})).status, 400);
  assert.equal((await app.post({owner: 'alice/project-a'})).status, 403);
  assert.equal((await app.post({action: 'delete'})).status, 400);
  for (const name of ['list', 'get', 'put', 'delete', 'batch', 'all']) assert.equal(app.calls[name].length, 0);
});

test('完整分页仅清理当前项目直接UUID且五金类型，普通附件与其他业务均保留', async () => {
  const app = setup({pageSize: 1});
  const first = app.add(activeKey(IDS[0]));
  app.add(activeKey(IDS[1]), {name: '成本.xlsx', type: '五金成本', created: '2026-10-01T00:00:00Z'});
  const preserved = [
    ['alice/project-a/files/' + IDS[2], {name: '普通.xlsx', category: '项目资料', type: '五金成本'}],
    [activeKey(IDS[2]), {name: '普通.pdf', type: '合同'}],
    ['alice/project-a/nested/' + IDS[0], {type: '五金汇总'}],
    ['alice/project-a/not-a-uuid', {type: '五金汇总'}],
    ['alice/project-b/' + IDS[0], {type: '五金汇总'}],
    ['bob/project-c/' + IDS[0], {type: '五金汇总'}],
  ];
  for (const [key, metadata] of preserved) app.add(key, metadata);
  const activeCost = app.cost();
  const otherCost = app.cost({project: 'project-b'}), otherOwner = app.cost({owner: 'bob'}), quote = app.cost({kind: 'quote'}), payment = app.cost({kind: 'transaction'});
  const before = await (await app.get()).json();
  assert.deepEqual(before.counts, {activeFiles: 2, trashedFiles: 0, activeCosts: 1, trashedCosts: 0});
  const response = await app.post();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, {activeFiles: 0, trashedFiles: 2, activeCosts: 0, trashedCosts: 1});
  assert.deepEqual(result.changes, {filesMoved: 2, costsMoved: 1});
  assert.equal(activeCost.kind, 'hardware_deleted');
  assert.equal(otherCost.kind, 'hardware'); assert.equal(otherOwner.kind, 'hardware'); assert.equal(quote.kind, 'quote'); assert.equal(payment.kind, 'transaction');
  for (const [key] of preserved) assert(app.stored.has(key), key);
  assert.equal(app.stored.get(trashKey(IDS[0])).customMetadata.name, first.customMetadata.name);
  assert.deepEqual([...app.stored.get(trashKey(IDS[0])).body], [1, 2, 3]);
  assert(app.calls.list.length > 10);
  assert(app.calls.list.every(call => call.prefix === 'alice/project-a/'));
  assert(app.calls.put.every(call => call.options.onlyIf.get('If-None-Match') === '*'));
  assert.equal(app.rows.filter(row => row.kind === 'audit').length, 1);
  assert.equal(result.trashFiles.length, 2);
});

test('重复清除幂等，恢复原文件metadata和成本内容，重复恢复不新增业务记录', async () => {
  const app = setup();
  const original = app.add(activeKey(IDS[0]));
  const cost = app.cost(), originalData = cost.data, originalId = cost.id, originalCreated = cost.created;
  await app.post();
  const again = await (await app.post()).json();
  assert.deepEqual(again.changes, {filesMoved: 0, costsMoved: 0});
  assert.equal(app.calls.put.length, 1);
  const restored = await (await app.post({action: 'restore'})).json();
  assert.deepEqual(restored.counts, {activeFiles: 1, trashedFiles: 0, activeCosts: 1, trashedCosts: 0});
  assert.deepEqual(restored.changes, {filesMoved: 1, costsMoved: 1});
  assert.deepEqual(app.stored.get(original.key).customMetadata, original.customMetadata);
  assert.equal(cost.kind, 'hardware'); assert.equal(cost.data, originalData);
  assert.equal(cost.id, originalId); assert.equal(cost.created, originalCreated);
  const repeat = await (await app.post({action: 'restore'})).json();
  assert.deepEqual(repeat.changes, {filesMoved: 0, costsMoved: 0});
  assert.equal(app.rows.filter(row => row.kind === 'hardware').length, 1);
});

test('复制失败不删除原件，返回部分失败和真实数量', async () => {
  const app = setup(); app.add(activeKey(IDS[0]));
  app.failures.put.add(trashKey(IDS[0]));
  const response = await app.post(), result = await response.json();
  assert.equal(response.status, 207); assert.equal(result.ok, false); assert.equal(result.status, 'partial');
  assert.equal(result.counts.activeFiles, 1); assert.equal(result.counts.trashedFiles, 0);
  assert.equal(app.calls.delete.length, 0); assert(app.stored.has(activeKey(IDS[0])));
  assert.equal(result.errors.length, 1);
});

test('复制成功后原件清除失败可重复执行，已有相同副本不再覆盖', async () => {
  const app = setup(); app.add(activeKey(IDS[0]));
  app.failures.delete.add(activeKey(IDS[0]));
  const first = await (await app.post()).json();
  assert.equal(first.status, 'partial');
  assert.equal(first.counts.activeFiles, 1); assert.equal(first.counts.trashedFiles, 1);
  assert(app.stored.has(activeKey(IDS[0]))); assert(app.stored.has(trashKey(IDS[0])));
  app.failures.delete.clear();
  const repeat = await (await app.post()).json();
  assert.equal(repeat.ok, true); assert.equal(repeat.counts.activeFiles, 0); assert.equal(repeat.counts.trashedFiles, 1);
  assert.equal(app.calls.put.length, 1);
});

test('恢复遇现有目标与现有成本不覆盖，回收站资料完整保留', async () => {
  const app = setup(); app.archive(IDS[0]);
  const replacement = app.add(activeKey(IDS[0]), {name: '现有五金.xlsx', type: '五金汇总'}, [9, 8]);
  const deleted = app.cost({kind: 'hardware_deleted', data: '{"old":1}'}), current = app.cost({data: '{"new":1}'});
  const response = await app.post({action: 'restore'}), result = await response.json();
  assert.equal(response.status, 207); assert.equal(result.ok, false); assert.equal(result.conflicts.length, 2);
  assert.deepEqual(result.changes, {filesMoved: 0, costsMoved: 0});
  assert.equal(app.calls.put.length, 0); assert.equal(app.calls.delete.length, 0);
  assert.equal(app.stored.get(replacement.key), replacement); assert(app.stored.has(trashKey(IDS[0])));
  assert.equal(deleted.kind, 'hardware_deleted'); assert.equal(current.kind, 'hardware');
  assert.equal(deleted.data, '{"old":1}'); assert.equal(current.data, '{"new":1}');
});

test('回收站版本不一致不删除当前原件，伪造跨项目trash不纳入操作', async () => {
  const app = setup(); app.archive(IDS[0], [1]); app.add(activeKey(IDS[0]), {type: '五金汇总'}, [2]);
  const fake = app.add(trashKey(IDS[1]), {name: '跨项目.xlsx', type: '五金汇总', originalKey: 'alice/project-b/' + IDS[1]});
  const result = await (await app.post()).json();
  assert.equal(result.ok, false); assert.equal(result.conflicts.length, 1);
  assert.equal(app.calls.delete.length, 0); assert.equal(app.calls.put.length, 0);
  assert(app.stored.has(activeKey(IDS[0]))); assert.equal(app.stored.get(fake.key), fake);
  assert.equal(result.counts.trashedFiles, 1);
});

test('恢复复制后回收站清除失败保留两份，再执行冲突不覆盖原件', async () => {
  const app = setup(); app.archive(IDS[0]); app.failures.delete.add(trashKey(IDS[0]));
  const first = await (await app.post({action: 'restore'})).json();
  assert.equal(first.status, 'partial'); assert.equal(first.counts.activeFiles, 1); assert.equal(first.counts.trashedFiles, 1);
  const second = await (await app.post({action: 'restore'})).json();
  assert.equal(second.conflicts.length, 1); assert.equal(app.calls.put.length, 1);
  assert(app.stored.has(activeKey(IDS[0]))); assert(app.stored.has(trashKey(IDS[0])));
});

test('数据库失败不删除成本，列表未完整读取不开始清除，缺失存储可重试', async () => {
  const app = setup(); const cost = app.cost(); app.failures.batch = true;
  const partial = await (await app.post()).json();
  assert.equal(partial.ok, false); assert.equal(cost.kind, 'hardware'); assert.equal(partial.counts.activeCosts, 1);
  const brokenList = setup({pageSize: 1}); brokenList.add(activeKey(IDS[0])); brokenList.add(activeKey(IDS[1])); brokenList.failures.listAt = 2;
  assert.equal((await brokenList.post()).status, 500);
  assert.equal(brokenList.calls.put.length, 0); assert.equal(brokenList.calls.delete.length, 0);
  assert.equal((await setup({ready: false}).get()).status, 503);
  assert.equal((await setup({databaseReady: false}).post()).status, 503);
});
