import assert from 'node:assert/strict';
import {createHash, createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync('lib/esign.ts', 'utf8');
const compile = text => ts.transpileModule(text, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const identityUrl = 'data:text/javascript;base64,' + Buffer.from(compile(readFileSync('lib/contract-identity.ts', 'utf8'))).toString('base64');
const compiled = compile(source).replace("from './contract-identity'", `from '${identityUrl}'`);
const {configFromEnv, createEsignAdapter, EsignError} = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const env = {ESIGN_APP_ID: 'test-app', ESIGN_APP_SECRET: 'test-secret-do-not-use', ESIGN_ENVIRONMENT: 'sandbox'};
const NOW = 1791849600000;
const pdf = new TextEncoder().encode('%PDF-1.7\n模拟合同字节\n%%EOF');
// Deliberately fictional format-only fixture, never sent to the provider.
const identityNumber = '00000000000000000X';
const input = () => ({pdfBytes: pdf, pdfName: '全屋定制合同.pdf', title: '双方定制合同', customer: {name: '示例客户', phone: '13800000001', identityNumber}, organization: {name: '示例企业', orgId: 'org_ignored_with_name', sealId: 'seal_123', transactorName: '示例经办人', transactorPhone: '13900000002'}, positions: {customer: {page: 2, x: 90, y: 180, width: 160, height: 160, page_width: 595, page_height: 842}, organization: {page: 2, x: 400, y: 180, width: 160, height: 160, page_width: 595, page_height: 842}}});
const reply = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});
function fixture(queue, options = {}) {
  const calls = [], waits = [];
  const adapter = createEsignAdapter({env, now: () => NOW, sleep: async ms => waits.push(ms), fetch: async (url, init) => {calls.push({url, ...init}); const next = queue.shift(); assert.ok(next, `unexpected mock request ${url}`); return typeof next === 'function' ? next(url, init) : reply(next);}, ...options});
  return {adapter, calls, waits};
}
const uploadQueue = (fileStatus = 2) => [{code: 0, data: {fileId: 'file_123', fileUploadUrl: 'https://esignoss.esign.cn/test.pdf?Signature=opaque'}}, {errCode: 0}, {code: 0, data: {fileStatus}}];

test('配置摘要没有应用ID或密钥，缺失或未知环境不会默认调用正式服务', async () => {
  assert.deepEqual(configFromEnv({}), {configured: false, missing: ['ESIGN_APP_ID', 'ESIGN_APP_SECRET', 'ESIGN_ENVIRONMENT'], environment: 'sandbox'});
  assert.deepEqual(configFromEnv({...env, ESIGN_ENVIRONMENT: ''}).missing, ['ESIGN_ENVIRONMENT']);
  assert.equal(configFromEnv({...env, ESIGN_ENVIRONMENT: 'https://evil.test'}).configured, false);
  assert.equal(configFromEnv({...env, ESIGN_ENVIRONMENT: 'production'}).environment, 'production');
  assert.equal(JSON.stringify(configFromEnv(env)).includes('test-'), false);
  const app = fixture([], {env: {...env, ESIGN_ENVIRONMENT: undefined}});
  await assert.rejects(app.adapter.flowDetail('flow_123'), error => error instanceof EsignError && error.code === 'NOT_CONFIGURED');
  assert.equal(app.calls.length, 0);
});

test('GET网关签名保留空MD5与Date换行，使用HMAC-SHA256 Base64及固定沙箱域名', async () => {
  const app = fixture([{code: 0, data: {signFlowStatus: 1, signers: [{signerType: 0, signStatus: 1}]}}]);
  const result = await app.adapter.flowDetail('flow_123');
  assert.deepEqual(result, {flowId: 'flow_123', status: 1, finishedAt: null, signers: [{type: 0, status: 1}]});
  const call = app.calls[0];
  assert.equal(call.url, 'https://smlopenapi.esign.cn/v3/sign-flow/flow_123/detail');
  assert.equal(call.method, 'GET'); assert.equal(call.body, undefined);
  assert.equal(call.headers['Content-MD5'], '');
  assert.equal(call.headers['X-Tsign-Open-Ca-Timestamp'], String(NOW));
  assert.equal(call.headers['X-Tsign-Open-Auth-Mode'], 'Signature');
  const expected = createHmac('sha256', env.ESIGN_APP_SECRET).update('GET\n*/*\n\napplication/json; charset=UTF-8\n\n/v3/sign-flow/flow_123/detail').digest('base64');
  assert.equal(expected, 'fPWRsg1Q7AguPmuTYQI1wJF3rt+px3qrEJlaAucgQSI=');
  assert.equal(call.headers['X-Tsign-Open-Ca-Signature'], expected);
  assert.equal(call.redirect, 'error');
});

test('PDF二进制上传MD5取原字节，POST签名取实际UTF8请求体，OSS不带应用凭据并等待可用状态', async () => {
  const app = fixture([...uploadQueue(1), {code: 0, data: {fileStatus: 2}}]);
  const before = structuredClone(pdf);
  assert.deepEqual(await app.adapter.uploadPdf(pdf, '合同.pdf'), {fileId: 'file_123'});
  const [post, put] = app.calls;
  const content = JSON.parse(post.body), digest = createHash('md5').update(pdf).digest('base64');
  assert.deepEqual(content, {contentMd5: digest, contentType: 'application/pdf', convertToPDF: false, fileName: '合同.pdf', fileSize: pdf.byteLength});
  assert.equal(post.headers['Content-MD5'], createHash('md5').update(post.body).digest('base64'));
  const canonical = `POST\n*/*\n${post.headers['Content-MD5']}\napplication/json; charset=UTF-8\n\n/v3/files/file-upload-url`;
  assert.equal(post.headers['X-Tsign-Open-Ca-Signature'], createHmac('sha256', env.ESIGN_APP_SECRET).update(canonical).digest('base64'));
  assert.deepEqual(put.headers, {'Content-MD5': digest, 'Content-Type': 'application/pdf'});
  assert.deepEqual(new Uint8Array(put.body), pdf); assert.deepEqual(pdf, before);
  assert.deepEqual(app.waits, [500]); assert.equal(app.calls.length, 4);
});

test('双方合同先验证输入再上传；实名刷脸及意愿刷脸、双方手动签与指定位置正确，无外部回调依赖', async () => {
  const app = fixture([...uploadQueue(), {code: 0, data: {signFlowId: 'flow_123'}}]);
  const value = input(), original = structuredClone(value);
  assert.deepEqual(await app.adapter.createFlow(value), {flowId: 'flow_123', fileId: 'file_123'});
  assert.deepEqual(value, original);
  const body = JSON.parse(app.calls[3].body);
  assert.equal(app.calls[3].url, 'https://smlopenapi.esign.cn/v3/sign-flow/create-by-file');
  assert.deepEqual(body.signFlowConfig, {signFlowTitle: '双方定制合同', autoStart: true, autoFinish: true, identityVerify: true, noticeConfig: {noticeTypes: ''}});
  assert.deepEqual(body.signers[0].authConfig, {psnAvailableAuthModes: ['PSN_FACE'], willingnessAuthModes: ['PSN_FACE_ESIGN']});
  assert.deepEqual(body.signers[0].psnSignerInfo, {psnAccount: '13800000001', psnInfo: {psnName: '示例客户', psnIDCardType: 'CRED_PSN_CH_IDCARD', psnIDCardNum: identityNumber}});
  assert.deepEqual(body.signers[1].orgSignerInfo, {orgName: '示例企业', transactorInfo: {psnAccount: '13900000002', psnInfo: {psnName: '示例经办人'}}});
  assert.equal(body.signers[0].signerType, 0); assert.equal(body.signers[1].signerType, 1);
  assert.equal(body.signers[0].signConfig.signOrder, 1); assert.equal(body.signers[1].signConfig.signOrder, 2);
  for (const signer of body.signers) assert.equal(signer.signFields[0].normalSignFieldConfig.autoSign, false);
  assert.equal(body.signers[1].signFields[0].normalSignFieldConfig.assignedSealId, 'seal_123');
  assert.deepEqual(body.signers[0].signFields[0].normalSignFieldConfig.signFieldPosition, {positionPage: '2', positionX: 170, positionY: 260});
  assert.equal(body.signers[0].signFields[0].normalSignFieldConfig.signFieldSize, 160);
  assert.equal(body.signers[0].signFields[0].normalSignFieldConfig.freeMode, false);
  assert.equal(body.signers[0].signFields[0].normalSignFieldConfig.movableSignField, false);
});

test('公司客户也是机构手动签署，其印章不受卖方指定；企业ID模式要求配对经办人ID', async () => {
  const app = fixture([...uploadQueue(), {code: 0, data: {signFlowId: 'flow_123'}}]);
  const value = input(); value.customer.type = 'organization'; value.customer.companyName = '客户公司'; value.organization = {orgId: 'org_123', transactorId: 'psn_123'};
  await app.adapter.createFlow(value);
  const body = JSON.parse(app.calls[3].body);
  assert.equal(body.signers[0].signerType, 1);
  assert.deepEqual(body.signers[0].orgSignerInfo, {orgName: '客户公司', transactorInfo: {psnAccount: '13800000001', psnInfo: {psnName: '示例客户', psnIDCardType: 'CRED_PSN_CH_IDCARD', psnIDCardNum: identityNumber}}});
  assert.equal(body.signers[0].signFields[0].normalSignFieldConfig.assignedSealId, undefined);
  assert.deepEqual(body.signers[1].orgSignerInfo, {orgId: 'org_123', transactorInfo: {psnId: 'psn_123'}});
  const invalid = fixture([]), bad = input(); bad.organization = {orgId: 'org_123', transactorPhone: '13900000002'};
  await assert.rejects(invalid.adapter.createFlow(bad), error => error.code === 'INVALID_INPUT'); assert.equal(invalid.calls.length, 0);
});

test('签署短链接传精确个人/经办人及企业主体，设登录并只接受官方HTTPS域名', async () => {
  const app = fixture([{code: 0, data: {shortUrl: 'https://t.esign.cn/example'}}]);
  assert.deepEqual(await app.adapter.signUrl('flow_123', {account: '13800000001', organization: {orgName: '客户公司'}}), {url: 'https://t.esign.cn/example', expiresAt: NOW + 90 * 86400000});
  assert.deepEqual(JSON.parse(app.calls[0].body), {operator: {psnAccount: '13800000001'}, needLogin: true, clientType: 'ALL', urlType: 2, organization: {orgName: '客户公司'}});
  for (const url of ['https://evil.test/x', 'http://t.esign.cn/x', 'https://t.esign.cn.evil.test/x', 'https://user:pw@t.esign.cn/x', 'https://t.esign.cn:8080/x']) {
    const bad = fixture([{code: 0, data: {shortUrl: url}}]);
    await assert.rejects(bad.adapter.signUrl('flow_123', {account: '13800000001'}), error => error.code === 'UNSAFE_URL');
  }
});

test('身份证必填及格式校验在任何上传或外部请求之前，错误不回显号码，正常值只修空白与X大小写', async () => {
  for (const number of [undefined, '', '   ', 'bad-private-number', '123456789012345', '00000000000000000Z', '00000000000000000X\n']) {
    const app = fixture([]), value = input(); value.customer.identityNumber = number;
    await assert.rejects(app.adapter.createFlow(value), error => error.code === 'INVALID_INPUT' && /身份证号码/.test(error.message) && (!number?.trim() || !error.message.includes(number.trim())));
    assert.equal(app.calls.length, 0);
  }
  const bad = fixture([]), value = input(); value.customer.identityType = 'UNKNOWN';
  await assert.rejects(bad.adapter.createFlow(value), error => error.code === 'INVALID_INPUT'); assert.equal(bad.calls.length, 0);
  const app = fixture([...uploadQueue(), {code: 0, data: {signFlowId: 'flow_123'}}]), normalized = input();
  normalized.customer.identityNumber = ' 00000000000000000x ';
  await app.adapter.createFlow(normalized);
  assert.equal(JSON.parse(app.calls[3].body).signers[0].psnSignerInfo.psnInfo.psnIDCardNum, identityNumber);
  assert.equal(normalized.customer.identityNumber, ' 00000000000000000x ');
});

test('状态归一化不返回PII或链接；完成要求双方已签，拒签/过期/撤销保留真实状态', async () => {
  const app = fixture([{code: 0, data: {signFlowStatus: 2, signFlowFinishTime: NOW, secret: env.ESIGN_APP_SECRET, signers: [{signerType: 0, signStatus: 2, psnSigner: {psnName: '真实姓名', psnAccount: '13800000001'}}, {signerType: 1, signStatus: 2, raw: 'other'}]}}]);
  assert.deepEqual(await app.adapter.flowDetail('flow_123'), {flowId: 'flow_123', status: 2, finishedAt: NOW, signers: [{type: 0, status: 2}, {type: 1, status: 2}]});
  for (const status of [0, 1, 3, 5, 7]) {const flow = fixture([{code: 0, data: {signFlowStatus: status}}]); assert.equal((await flow.adapter.flowDetail('flow_123')).status, status);}
  for (const signers of [undefined, [], [{signerType: 0, signStatus: 2}], [{signerType: 0, signStatus: 2}, {signerType: 1, signStatus: 3}]]) {const bad = fixture([{code: 0, data: {signFlowStatus: 2, signers}}]); await assert.rejects(bad.adapter.flowDetail('flow_123'), error => error.code === 'INVALID_RESPONSE');}
});

test('不安全上传URL、非法PDF、非法名称/位置/手机号均在签署创建前拒绝', async () => {
  for (const change of [value => value.pdfName = '../合同.pdf', value => value.title = '合同😀', value => value.pdfBytes = new Uint8Array(), value => value.customer.phone = '123', value => value.positions.customer.page = 0, value => value.requireFace = 'false']) {
    const app = fixture([]), value = input(); change(value);
    await assert.rejects(app.adapter.createFlow(value), error => error.code === 'INVALID_INPUT'); assert.equal(app.calls.length, 0);
  }
  const app = fixture([{code: 0, data: {fileId: 'file_123', fileUploadUrl: 'http://127.0.0.1/secret'}}]);
  await assert.rejects(app.adapter.uploadPdf(pdf, '合同.pdf'), error => error.code === 'UNSAFE_URL'); assert.equal(app.calls.length, 1);
  await assert.rejects(app.adapter.flowDetail('../other'), error => error.code === 'INVALID_ID');
});

test('HTTP/业务/网络错误脱敏，创建流程不自动重试；上传失败或持续pending不会发起签署', async () => {
  const business = fixture([{code: 10001, message: env.ESIGN_APP_SECRET + '13800000001'}]);
  await assert.rejects(business.adapter.flowDetail('flow_123'), error => error.code === 'PROVIDER_ERROR' && /10001/.test(error.message) && !/test-secret|13800000001/.test(error.message));
  const network = fixture([() => {throw new Error('sensitive token=' + env.ESIGN_APP_SECRET);}]);
  await assert.rejects(network.adapter.flowDetail('flow_123'), error => error.code === 'REQUEST_FAILED' && !error.message.includes(env.ESIGN_APP_SECRET));
  const http = fixture([() => new Response(env.ESIGN_APP_SECRET, {status: 403})]);
  await assert.rejects(http.adapter.flowDetail('flow_123'), error => error.code === 'HTTP_ERROR' && !error.message.includes(env.ESIGN_APP_SECRET));
  const created = fixture([...uploadQueue(), {code: 500, message: 'private'}]);
  await assert.rejects(created.adapter.createFlow(input()), error => error.code === 'PROVIDER_ERROR'); assert.equal(created.calls.filter(call => call.url.endsWith('/create-by-file')).length, 1);
  const failed = fixture(uploadQueue(3)); await assert.rejects(failed.adapter.createFlow(input()), error => error.code === 'UPLOAD_FAILED'); assert.equal(failed.calls.length, 3);
  const pending = fixture([...uploadQueue(1), {code: 0, data: {fileStatus: 1}}], {uploadPolls: 2});
  await assert.rejects(pending.adapter.createFlow(input()), error => error.code === 'UPLOAD_PENDING'); assert.equal(pending.calls.length, 4);
});

test('V3文件查询只读fileStatus，拒绝旧V1 status与未知类型而不创建合同', async () => {
  const done = fixture([{code: 0, data: {fileStatus: 5}}]); assert.equal(await done.adapter.fileStatus('file_123'), 5);
  for (const data of [{status: 2}, {fileStatus: '2'}, {fileStatus: 999}, {}]) {const bad = fixture([{code: 0, data}]); await assert.rejects(bad.adapter.fileStatus('file_123'), error => error.code === 'INVALID_RESPONSE');}
});

test('多页PDF坐标从预留区左下转换到中心，校验区域大小及页面边界，无屏幕DPI比例和Y轴翻转', async () => {
  const app = fixture([...uploadQueue(), {code: 0, data: {signFlowId: 'flow_123'}}]);
  const value = input(); value.positions.customer = {page: 7, x: 50.25, y: 240.5, width: 180, height: 200, page_width: 595.28, page_height: 841.89};
  await app.adapter.createFlow(value);
  const field = JSON.parse(app.calls[3].body).signers[0].signFields[0].normalSignFieldConfig;
  assert.deepEqual(field.signFieldPosition, {positionPage: '7', positionX: 140.25, positionY: 340.5}); assert.equal(field.signFieldSize, 180);
  for (const badPosition of [{width: 159}, {height: 70}, {x: 500}, {y: 800}, {page_width: 0}, {page_height: NaN}]) {
    const bad = input(); Object.assign(bad.positions.customer, badPosition); const isolated = fixture([]);
    await assert.rejects(isolated.adapter.createFlow(bad), error => error.code === 'INVALID_INPUT'); assert.equal(isolated.calls.length, 0);
  }
});

test('网络及响应读取均限时中止，未核实的签后原件端点不会猜测或下载预览PDF', async () => {
  let signal;
  const app = fixture([(_url, init) => {signal = init.signal; return new Promise(() => {});}], {timeoutMs: 10});
  await assert.rejects(app.adapter.flowDetail('flow_123'), error => error.code === 'TIMEOUT'); assert.equal(signal.aborted, true);
  const read = fixture([() => ({ok: true, json: () => new Promise(() => {})})], {timeoutMs: 10});
  await assert.rejects(read.adapter.flowDetail('flow_123'), error => error.code === 'TIMEOUT');
  const download = fixture([]);
  await assert.rejects(download.adapter.downloadSignedFile('flow_123'), error => error.code === 'DOWNLOAD_UNAVAILABLE' && error.status === 501); assert.equal(download.calls.length, 0);
});
