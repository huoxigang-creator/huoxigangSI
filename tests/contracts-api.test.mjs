import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const stubUrl = url(`export class ContractError extends Error {constructor(message,status=400){super(message);this.status=status;}}
export function contractExecute(...args){return globalThis.contractApiTest.execute(...args);}
export function contractDocument(...args){return globalThis.contractApiTest.document(...args);}`);
const identityUrl = url(compile(readFileSync('lib/contract-identity.ts', 'utf8')));
const esignUrl = url(compile(readFileSync('lib/esign.ts', 'utf8')).replace("from './contract-identity'", `from '${identityUrl}'`));
const {ContractError} = await import(stubUrl);
const api = await import(url(compile(readFileSync('app/api/contracts/route.ts', 'utf8')).replace("from '../../../lib/contracts'", `from '${stubUrl}'`).replace("from '../../../lib/esign'", `from '${esignUrl}'`).replace("from 'zod'", `from '${import.meta.resolve('zod')}'`)));
const trashUrl = url('export function getDeletedFileKeys(...args){return globalThis.contractApiTest.deletedKeys(...args)}');
const files = await import(url(compile(readFileSync('app/api/contracts/files/route.ts', 'utf8')).replace("import { env } from 'cloudflare:workers';", 'const env={get BUCKET(){return globalThis.contractApiTest.bucket}};').replace("import { env } from './local-env';", 'const env={get BUCKET(){return globalThis.contractApiTest.bucket}};').replace("from '../../../../lib/contracts'", `from '${stubUrl}'`).replace("from '../../../../lib/trash'", `from '${trashUrl}'`)));
const base = 'https://contracts.test', project = 'customer-test', contract = '10000000-0000-4000-a000-000000000001';
const otherContract = '10000000-0000-4000-a000-000000000002';
const pdf = new TextEncoder().encode('%PDF-1.7\nfixture');
const identity = {'oai-authenticated-user-id': 'alice', origin: base, 'sec-fetch-site': 'same-origin'};

function setup(t, {pageSize = 1000} = {}) {
  const stored = new Map(), deleted = new Set(), calls = {execute: [], document: [], put: [], get: [], list: []}, controls = {execute: null, put: null, list: null};
  const bucket = {
    async head(key) {return stored.get(key) ?? null;},
    async get(key) {calls.get.push(key); return stored.get(key) ?? null;},
    async put(key, bytes, options) {calls.put.push({key, options}); if (controls.put) return controls.put(key, bytes, options); if (stored.has(key)) return null; const object = {key, size: bytes.byteLength, uploaded: new Date('2026-10-13'), body: new Uint8Array(bytes), customMetadata: options.customMetadata, httpMetadata: options.httpMetadata}; stored.set(key, object); return object;},
    async list(options) {calls.list.push(options); if (controls.list) return controls.list(options); const objects = [...stored.values()].filter(value => value.key.startsWith(options.prefix)); const start = Number(options.cursor || 0), next = start + pageSize; return {objects: objects.slice(start, next), truncated: next < objects.length, ...(next < objects.length ? {cursor: String(next)} : {})};},
  };
  globalThis.contractApiTest = {
    bucket,
    async execute(owner, action, args) {calls.execute.push({owner, action, args}); if (controls.execute) return controls.execute(owner, action, args); if (owner !== 'alice') throw new ContractError('记录不存在', 404); if (action === 'get_contract') {if (![contract, otherContract].includes(args.id)) throw new ContractError('记录不存在', 404); return {id: args.id, project};} return {id: contract};},
    async document(owner, id, signed) {calls.document.push({owner, id, signed}); if (owner !== 'alice') throw new ContractError('记录不存在', 404); return new Uint8Array(pdf);},
    async deletedKeys(owner, id, type) {assert.equal(owner, 'alice'); assert.equal(id, project); assert.equal(type, 'project'); return new Set(deleted);},
  };
  t.after(() => {delete globalThis.contractApiTest;});
  const contractPost = (body = {action: 'save_contract', args: {}}, headers = identity) => api.POST(new Request(base + '/api/contracts', {method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: typeof body === 'string' ? body : JSON.stringify(body)}));
  const contractGet = (query = {id: contract}, headers = identity) => api.GET(new Request(base + '/api/contracts?' + new URLSearchParams(query), {headers}));
  const get = (query = {}, headers = identity) => files.GET(new Request(base + '/api/contracts/files?' + new URLSearchParams({project_id: project, contract_id: contract, ...query}), {headers}));
  const post = ({owner = 'alice', origin = base, site = 'same-origin', projectId = project, contractId = contract, attachmentId = crypto.randomUUID(), name = '签署留档.pdf', bytes = pdf, mime = 'application/pdf'} = {}) => {
    const form = new FormData(); form.set('project_id', projectId); form.set('contract_id', contractId); form.set('attachment_id', attachmentId); form.set('file', new File([bytes], name, {type: mime}));
    const headers = {'sec-fetch-site': site}; if (owner) headers['oai-authenticated-user-id'] = owner; if (origin) headers.origin = origin;
    return files.POST(new Request(base + '/api/contracts/files', {method: 'POST', headers, body: form}));
  };
  return {stored, deleted, calls, controls, bucket, contractPost, contractGet, get, post};
}

test('合同API只信网关owner并要求登录同源，格式错误不触发服务，响应私有禁缓存', async t => {
  const app = setup(t);
  for (const headers of [{}, {origin: base}]) assert.equal((await app.contractPost(undefined, headers)).status, 401);
  for (const headers of [{...identity, origin: 'https://other.test'}, {...identity, origin: ''}, {...identity, 'sec-fetch-site': 'cross-site'}]) assert.equal((await app.contractPost(undefined, headers)).status, 403);
  for (const body of ['{', {}, {action: 3}, {action: 'save_contract', args: []}, {action: 'save_contract', args: null}]) assert.equal((await app.contractPost(body)).status, 400);
  assert.equal(app.calls.execute.length, 0);
  const response = await app.contractPost({owner: 'bob', action: 'save_contract', args: {owner: 'bob', title: '测试'}});
  assert.equal(response.status, 200); assert.equal(app.calls.execute[0].owner, 'alice'); assert.equal(app.calls.execute[0].args.title, '测试');
  assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('API保留可处理业务状态码，未知异常不暴露服务商内容和配置', async t => {
  const app = setup(t);
  app.controls.execute = () => {throw new ContractError('并发变化请刷新', 409);};
  let response = await app.contractPost(); assert.equal(response.status, 409); assert.equal((await response.json()).error, '并发变化请刷新');
  app.controls.execute = () => {throw new Error('internal fake-app-secret and customer-name');};
  response = await app.contractPost(); assert.equal(response.status, 500); assert.equal((await response.json()).error, '合同操作未完成，请刷新后核对');
});

test('PDF预览和下载保留原二进制并验证编号与owner，只有明确signed=1请求签后文件', async t => {
  const app = setup(t);
  assert.equal((await app.contractGet(undefined, {})).status, 401);
  for (const id of ['', '../abc', 'a/b', 'x\nheader', 'x'.repeat(129)]) assert.equal((await app.contractGet({id})).status, 400);
  assert.equal(app.calls.document.length, 0);
  assert.equal((await app.contractGet(undefined, {...identity, 'oai-authenticated-user-id': 'bob'})).status, 404);
  const preview = await app.contractGet(); assert.equal(preview.status, 200); assert.match(preview.headers.get('content-disposition'), /^inline;/); assert.deepEqual(new Uint8Array(await preview.arrayBuffer()), pdf);
  const download = await app.contractGet({id: contract, signed: '1', download: '1'}); assert.equal(download.headers.get('content-type'), 'application/pdf'); assert.match(download.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''/); assert.equal(download.headers.get('cache-control'), 'private, no-store'); assert.equal(app.calls.document.at(-1).signed, true);
});

test('附件访问隔离owner、项目和合同，上传要求同源，不允许未授权存储读写', async t => {
  const app = setup(t);
  assert.equal((await app.post({owner: null})).status, 401); assert.equal((await app.get({}, {})).status, 401);
  assert.equal((await app.post({owner: 'bob'})).status, 404); assert.equal((await app.get({}, {...identity, 'oai-authenticated-user-id': 'bob'})).status, 404);
  assert.equal((await app.post({projectId: 'another-project'})).status, 403); assert.equal((await app.get({project_id: 'another-project'})).status, 403);
  for (const options of [{origin: null}, {origin: 'https://other.test'}, {site: 'cross-site'}]) assert.equal((await app.post(options)).status, 403);
  assert.equal((await app.post({contractId: '../invalid'})).status, 400); assert.equal((await app.post({attachmentId: '../invalid'})).status, 400);
  assert.equal(app.calls.put.length, 0); assert.equal(app.calls.get.length, 0); assert.equal(app.calls.list.length, 0);
});

test('合同附件检查真实文件头、大小和文件名，10MB边界与常用照片/PDF可存档', async t => {
  const app = setup(t);
  for (const name of ['script.html', 'file.svg', 'test.pdf.exe', '../bad.pdf', 'bad\n.pdf']) assert.equal((await app.post({name})).status, 400);
  for (const [name, bytes] of [['wrong.pdf', new Uint8Array([1, 2])], ['wrong.png', pdf], ['wrong.jpg', pdf], ['wrong.webp', pdf], ['empty.pdf', new Uint8Array()], ['too-big.pdf', new Uint8Array(10 * 1024 * 1024 + 1)]]) assert.equal((await app.post({name, bytes})).status, 400);
  assert.equal(app.calls.put.length, 0);
  const large = new Uint8Array(10 * 1024 * 1024); large.set(pdf); assert.equal((await app.post({bytes: large})).status, 200);
  for (const [name, bytes] of [['留档.PNG', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], ['留档.jpg', new Uint8Array([255, 216, 255])], ['留档.jpeg', new Uint8Array([255, 216, 255])], ['留档.webp', new TextEncoder().encode('RIFFxxxxWEBP')]]) assert.equal((await app.post({name, bytes, mime: 'text/html'})).status, 200);
  assert.equal(app.calls.put.length, 5); assert(app.calls.put.every(call => call.options.onlyIf.etagDoesNotMatch === '*'));
});

test('附件同请求重试幂等，内容/名称/合同冲突及回收站已删除不能覆盖', async t => {
  const app = setup(t), attachmentId = crypto.randomUUID();
  const first = await (await app.post({attachmentId})).json(); assert.equal((await app.post({attachmentId})).status, 200); assert.equal(app.calls.put.length, 1);
  assert.equal((await app.post({attachmentId, name: '不同.pdf'})).status, 409); assert.equal((await app.post({attachmentId, bytes: new TextEncoder().encode('%PDF-different')})).status, 409); assert.equal((await app.post({attachmentId, contractId: otherContract})).status, 409); assert.equal(app.calls.put.length, 1);
  app.deleted.add(first.file.key); assert.equal((await app.post({attachmentId})).status, 409); assert.equal((await app.get({key: first.file.key})).status, 404); assert.equal(app.calls.get.length, 0);
});

test('附件并发写用R2条件put，只有一致竞争结果可复用，不覆盖他人内容', async t => {
  const app = setup(t);
  app.controls.put = (key, bytes, options) => {app.stored.set(key, {key, size: bytes.byteLength, uploaded: new Date(), body: new Uint8Array(bytes), customMetadata: options.customMetadata}); return null;};
  assert.equal((await app.post()).status, 200);
  app.controls.put = (key, bytes, options) => {app.stored.set(key, {key, size: bytes.byteLength, uploaded: new Date(), customMetadata: {...options.customMetadata, sha256: 'different'}}); return null;};
  assert.equal((await app.post()).status, 409);
});

test('附件列表完整分页并隔离合同与已删除文件，下载验证owner路径及合同metadata', async t => {
  const app = setup(t, {pageSize: 1}), original = await (await app.post()).json(), hidden = await (await app.post({name: '已删除.pdf'})).json(); app.deleted.add(hidden.file.key);
  await app.post({contractId: otherContract, name: '另一个合同.pdf'});
  const listing = await app.get(); assert.equal(listing.status, 200); assert.deepEqual((await listing.json()).files.map(file => file.key), [original.file.key]); assert.equal(app.calls.list.length, 3);
  for (const key of ['bob/customer-test/files/' + crypto.randomUUID(), 'alice/another-project/files/' + crypto.randomUUID(), 'alice/customer-test/files/../bad', hidden.file.key]) assert.equal((await app.get({key})).status, 404);
  const alien = [...app.stored.values()].find(value => value.customMetadata.contract_id === otherContract); assert.equal((await app.get({key: alien.key})).status, 404);
  const download = await app.get({key: original.file.key}); assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'application/pdf'); assert.match(download.headers.get('content-disposition'), /^attachment;/); assert.equal(download.headers.get('cache-control'), 'private, no-store'); assert.equal(download.headers.get('x-content-type-options'), 'nosniff'); assert.deepEqual(new Uint8Array(await download.arrayBuffer()), pdf);
});

test('附件分页游标异常明确失败，缺少存储可重试，底层异常不泄露密钥', async t => {
  const app = setup(t); app.controls.list = () => ({objects: [], truncated: true});
  assert.equal((await app.get()).status, 503); app.controls.list = () => {throw new Error('fake-secret');};
  let response = await app.get(); assert.equal(response.status, 500); assert.equal((await response.json()).error, '合同附件操作未完成，请刷新后重试');
  globalThis.contractApiTest.bucket = undefined; response = await app.post(); assert.equal(response.status, 503); assert.equal(app.calls.put.length, 0);
});
