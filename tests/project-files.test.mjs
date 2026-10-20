import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync('app/api/project-files/handlers.ts', 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
}).outputText;
const {createProjectFileHandlers} = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const base = 'https://files.test';

function setup({pageSize = 1000, ready = true} = {}) {
  const stored = new Map();
  const calls = {authorize: [], put: [], get: [], list: []};
  const bucket = {
    async put(key, value, options) {
      calls.put.push(key);
      stored.set(key, {key, body: new Uint8Array(value), size: value.byteLength, uploaded: new Date(), customMetadata: options.customMetadata, httpMetadata: options.httpMetadata});
    },
    async get(key) {calls.get.push(key); return stored.get(key) || null;},
    async list(options) {
      calls.list.push(options);
      const objects = [...stored.values()].filter(value => value.key.startsWith(options.prefix));
      const from = Number(options.cursor || 0);
      const next = from + pageSize;
      return {objects: objects.slice(from, next), truncated: next < objects.length, ...(next < objects.length ? {cursor: String(next)} : {})};
    },
  };
  const handlers = createProjectFileHandlers({
    bucket: () => ready ? bucket : undefined,
    async authorize(owner, project) {
      calls.authorize.push({owner, project});
      if (!({alice: ['project-a', 'project-b'], bob: ['project-c'], 'alice/bob': ['project-d']}[owner] || []).includes(project)) {
        throw Object.assign(new Error('denied'), {status: 404});
      }
    },
  });
  function get({owner = 'alice', project = 'project-a', key, category} = {}) {
    const query = new URLSearchParams({project_id: project});
    if (key !== undefined) query.set('key', key);
    if (category !== undefined) query.set('category', category);
    return handlers.GET(new Request(base + '/api/project-files?' + query, {headers: owner ? {'oai-authenticated-user-id': owner} : {}}));
  }
  function post({owner = 'alice', project = 'project-a', name = '测试合同.pdf', content = new Uint8Array([1, 2, 3]), category = '合同', origin = base, site = 'same-origin'} = {}) {
    const form = new FormData();
    form.set('project_id', project); form.set('category', category); form.set('file', new File([content], name));
    const headers = {'sec-fetch-site': site};
    if (owner) headers['oai-authenticated-user-id'] = owner;
    if (origin) headers.origin = origin;
    return handlers.POST(new Request(base + '/api/project-files', {method: 'POST', body: form, headers}));
  }
  return {get, post, stored, calls, handlers};
}

test('无登录与其他账号项目不可列表、上传或下载', async () => {
  const app = setup();
  assert.equal((await app.get({owner: null})).status, 401);
  assert.equal((await app.post({owner: null})).status, 401);
  assert.equal((await app.get({owner: 'bob'})).status, 404);
  assert.equal((await app.post({owner: 'bob'})).status, 404);
  assert.equal((await app.get({owner: 'bob', key: 'alice/project-a/files/anything'})).status, 404);
  assert.equal(app.calls.put.length, 0);
  assert.equal(app.calls.get.length, 0);
});

test('上传要求同源，拒绝跨站与缺少Origin', async () => {
  const app = setup();
  assert.equal((await app.post({origin: 'https://other.test'})).status, 403);
  assert.equal((await app.post({site: 'cross-site'})).status, 403);
  assert.equal((await app.post({origin: null})).status, 403);
  assert.equal(app.calls.put.length, 0);
});

test('校验空文件、10MB大小、类型、分类和项目路径', async () => {
  const app = setup();
  for (const name of ['index.html', 'script.js', 'run.exe', 'readme.txt', 'file.svg', 'file.pdf.exe']) {
    assert.equal((await app.post({name})).status, 400);
  }
  assert.equal((await app.post({content: new Uint8Array(0)})).status, 400);
  assert.equal((await app.post({content: new Uint8Array(10 * 1024 * 1024 + 1)})).status, 400);
  assert.equal((await app.post({category: '五金汇总'})).status, 400);
  assert.equal((await app.get({project: '../project-a'})).status, 400);
  assert.equal((await app.get({category: '五金成本'})).status, 400);
  assert.equal(app.calls.put.length, 0);
});

test('10MB边界、支持常见项目附件，重复上传产生新文件', async () => {
  const app = setup();
  assert.equal((await app.post({name: '大型图纸.DWG', content: new Uint8Array(10 * 1024 * 1024), category: '设计图'})).status, 200);
  for (const extension of ['pdf', 'xlsx', 'xls', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'webp', 'dwg', 'dxf', 'zip']) {
    const response = await app.post({name: '附件.' + extension});
    assert.equal(response.status, 200, extension);
    const body = await response.json();
    assert.match(body.file.key, /^alice\/project-a\/files\/[0-9a-f-]{36}$/);
  }
  const first = await (await app.post()).json();
  const second = await (await app.post()).json();
  assert.notEqual(first.file.key, second.file.key);
  assert.equal(app.calls.put.length, 15);
  assert.equal(app.calls.authorize.length, 15);
  assert.deepEqual([...app.stored.get(first.file.key).body], [1, 2, 3]);
});

test('完整分页且合同过滤不漏页，旧五金附件不进入通用列表', async () => {
  const app = setup({pageSize: 1});
  const contract = await (await app.post()).json();
  await app.post({category: '设计图', name: '设计.dxf'});
  await app.post({category: '项目资料', name: '资料.xlsx'});
  app.stored.set('alice/project-a/old-hardware', {key: 'alice/project-a/old-hardware', size: 3, uploaded: new Date(), customMetadata: {name: '旧五金.xlsx', type: '五金汇总'}});
  const all = await (await app.get()).json();
  assert.equal(all.files.length, 3);
  assert.equal(app.calls.list.length, 3);
  assert(app.calls.list.every(value => value.prefix === 'alice/project-a/files/'));
  const contracts = await (await app.get({category: '合同'})).json();
  assert.deepEqual(contracts.files.map(file => file.key), [contract.file.key]);
  assert.equal(app.calls.list.length, 6);
});

test('下载隔离账号与项目，禁止旧前缀，固定为附件和私有禁缓存', async () => {
  const app = setup();
  const uploaded = await (await app.post()).json();
  const key = uploaded.file.key;
  for (const options of [{project: 'project-b', key}, {owner: 'bob', project: 'project-c', key}, {key: 'alice/project-a/old-hardware'}, {key: 'alice/project-a/files/../../project-b/file'}]) {
    assert.equal((await app.get(options)).status, 403);
  }
  assert.equal(app.calls.get.length, 0);
  const download = await app.get({key});
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/pdf');
  assert.match(download.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(download.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual([...new Uint8Array(await download.arrayBuffer())], [1, 2, 3]);
  assert.equal((await app.get({key: 'alice/project-a/files/' + crypto.randomUUID()})).status, 404);
  assert.equal((await app.get()).headers.get('cache-control'), 'private, no-store');
});

test('owner路径编码隔离且存储未就绪可重试', async () => {
  const app = setup();
  const uploaded = await (await app.post({owner: 'alice/bob', project: 'project-d'})).json();
  assert.match(uploaded.file.key, /^alice%2Fbob\/project-d\/files\//);
  assert.equal((await app.get({owner: 'alice/bob', project: 'project-d', key: uploaded.file.key})).status, 200);
  const unavailable = setup({ready: false});
  assert.equal((await unavailable.post()).status, 503);
  assert.equal((await unavailable.get()).status, 503);
});
