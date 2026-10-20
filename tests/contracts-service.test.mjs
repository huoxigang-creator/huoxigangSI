import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const identityUrl = url(compile(readFileSync('lib/contract-identity.ts', 'utf8')));
const templateUrl = url(compile(readFileSync('lib/contract-template.ts', 'utf8')));
const esignUrl = url(compile(readFileSync('lib/esign.ts', 'utf8')).replace("from './contract-identity'", `from '${identityUrl}'`));
const {DEFAULT_CONTRACT_TEMPLATE, renderContractTemplate} = await import(templateUrl);
const {EsignError} = await import(esignUrl);
const pdfUrl = url('export async function generateContractPdf(){throw Error("unmocked PDF generation")}');
const serviceCode = compile(readFileSync('lib/contracts.ts', 'utf8')).replace("import { env } from 'cloudflare:workers';", 'const env = {};').replace("import { env } from './local-env';", 'const env = {};').replace("from 'zod'", `from '${import.meta.resolve('zod')}'`).replace("from './contract-template'", `from '${templateUrl}'`).replace("from './contract-pdf'", `from '${pdfUrl}'`).replace("from './esign'", `from '${esignUrl}'`).replace("from './contract-identity'", `from '${identityUrl}'`);
const {createContractService} = await import(url(serviceCode));
const trashCode = compile(readFileSync('lib/trash.ts', 'utf8')).replace("import { env } from 'cloudflare:workers';", 'const env = {};').replace("import { env } from './local-env';", 'const env = {};');
const {createTrashService} = await import(url(trashCode));
const date = '2026-10-13T08:00:00.000Z';
const appEnv = {ESIGN_APP_ID: 'mock-app-id-only', ESIGN_APP_SECRET: 'mock-secret-only-not-a-real-key', ESIGN_ENVIRONMENT: 'sandbox'};
const profile = {company_name: '示例卖方企业', org_id: 'org_mock', seal_id: 'seal_mock', transactor_name: '示例经办人', transactor_phone: '13900000002', transactor_id: ''};
const identityNumber = '00000000000000000X'; // Fictional format-only fixture, isolated from real services.

async function fixture(t, options = {}) {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(readFileSync('drizzle/0000_slippery_lenny_balinger.sql', 'utf8')); t.after(() => sqlite.close());
  const controls = {beforeBatch: null, failAudit: false, create: null, detail: {flowId: 'flow_mock', status: 1, finishedAt: null, signers: [{type: 0, status: 1}, {type: 1, status: 0}]}}, calls = {create: [], signUrl: [], detail: [], download: [], pdf: []}, files = new Map();
  const database = {prepare(sql) {let args = []; return {sql, get args() {return args;}, bind(...values) {args = values; return this;}, async all() {return {results: sqlite.prepare(sql).all(...args)};}};}, async batch(statements) {if (controls.beforeBatch) {const cb = controls.beforeBatch; controls.beforeBatch = null; await cb();} sqlite.exec('BEGIN'); try {const results = statements.map(statement => {if (controls.failAudit && statement.args[2] === 'audit') throw Error('mock audit failed'); return {meta: {changes: Number(sqlite.prepare(statement.sql).run(...statement.args).changes)}};}); sqlite.exec('COMMIT'); return results;} catch (error) {sqlite.exec('ROLLBACK'); throw error;}}};
  const bucket = {async put(key, bytes) {files.set(key, new Uint8Array(bytes));}, async get(key) {const bytes = files.get(key); return bytes ? {arrayBuffer: async () => new Uint8Array(bytes).buffer} : null;}};
  const adapter = {async createFlow(input) {calls.create.push(structuredClone(input)); if (controls.create) return controls.create(input); return {flowId: 'flow_mock', fileId: 'file_mock'};}, async signUrl(flowId, operator) {calls.signUrl.push({flowId, operator}); return {url: 'https://t.esign.cn/mock', expiresAt: 1791849600000};}, async flowDetail(flowId) {calls.detail.push(flowId); return structuredClone(controls.detail);}, async downloadSignedFile(flowId) {calls.download.push(flowId); return new Uint8Array([37, 80, 68, 70, 45]);}};
  const position = {page: 1, x: 50, y: 300, width: 160, height: 160, page_width: 595, page_height: 842};
  const service = createContractService({database: () => database, bucket: () => bucket, environment: () => options.env ?? appEnv, adapter: () => adapter, pdf: async record => {calls.pdf.push(structuredClone(record)); return {bytes: new TextEncoder().encode('%PDF-1.7\n' + renderContractTemplate(record)), positions: {customer: position, company: {...position, x: 350}}};}});
  const trash = createTrashService({database: () => database, bucket: () => bucket});
  const seed = (owner, kind, project, data, recordId = crypto.randomUUID()) => {sqlite.prepare('INSERT INTO records(id,owner,kind,project,data,created) VALUES(?,?,?,?,?,?)').run(recordId, owner, kind, project, JSON.stringify(data), date); return recordId;};
  const record = recordId => {const row = sqlite.prepare('SELECT * FROM records WHERE id=?').get(recordId); return row && {...row, data: JSON.parse(row.data)};};
  const change = (recordId, update) => {const before = record(recordId); sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...before.data, ...update}), recordId);};
  const audits = action => sqlite.prepare("SELECT * FROM records WHERE kind='audit'").all().map(row => JSON.parse(row.data)).filter(row => !action || row.action === action);
  const parent = seed('alice', 'project', '', {project_type: 'customer', name: '测试家庭', discount_amount: 500, rounding_amount: 1});
  const roomId = crypto.randomUUID();
  const quote = seed('alice', 'quote', parent, {title: '原报价', total: 10001, adopted: true, rooms: [{id: roomId, name: '主卧室'}], items: [{room_id: roomId, category: '柜体', name: '衣柜', quantity: 1, price: 100.01, model: '历史规格', note: '历史备注'}]});
  function input(update = {}) {return {id: crypto.randomUUID(), project_id: parent, title: '全屋合同', sign_date: '2026-10-13', company_name: '示例卖方企业', customer_name: '示例客户', customer_phone: '13800000001', customer_identity_type: 'CRED_PSN_CH_IDCARD', customer_identity_number: identityNumber, template_id: DEFAULT_CONTRACT_TEMPLATE.id, quote_id: quote, discount_amount: 0.02, rounding_amount: 0.01, installments: [{id: crypto.randomUUID(), name: '定金', ratio: 33.33, due_date: ''}, {id: crypto.randomUUID(), name: '材料款', ratio: 33.33, due_date: ''}, {id: crypto.randomUUID(), name: '尾款', ratio: 33.34, due_date: ''}], ...update};}
  const save = value => service.execute('alice', 'save_contract', value);
  const signingProfile = () => service.execute('alice', 'save_signing_profile', profile);
  const start = (value, requestId = crypto.randomUUID()) => service.execute('alice', 'start_signing', {id: value.id, revision: value.revision, request_id: requestId});
  return {...service, trash, sqlite, database, bucket, controls, calls, files, seed, record, change, audits, parent, quote, input, save, signingProfile, start};
}

test('保存合同取报价金额快照，优惠和抹零按分计算，分期余分归末期，不改变真实项目收付款', async t => {
  const app = await fixture(t), beforeParent = app.record(app.parent);
  const transaction = app.seed('alice', 'transaction', app.parent, {type: '收款', amount: 2300, date: '2026-10-13'}), beforeTransaction = app.record(transaction);
  const saved = await app.save(app.input({gross_amount: 99999}));
  assert.equal(saved.gross_amount, 10001); assert.equal(saved.discount_amount, 2); assert.equal(saved.rounding_amount, 1); assert.equal(saved.net_amount, 9998);
  assert.deepEqual(saved.installments.map(i => i.amount), [3332, 3332, 3334]); assert.equal(saved.installments.reduce((sum, i) => sum + i.amount, 0), 9998);
  assert.equal(saved.quote_snapshot.items[0].model, '历史规格'); assert.equal(saved.status, 'draft'); assert.ok(saved.revision);
  assert.deepEqual(app.record(transaction), beforeTransaction); assert.deepEqual(app.record(app.parent), beforeParent); assert.equal(app.audits('save_contract').length, 1);
});

test('个人合同证件资料可保存并填入身份证空位，编辑省略保留，显式空串清除且审计不记录证件', async t => {
  const app = await fixture(t), identity = identityNumber, value = app.input({customer_identity_type: 'CRED_PSN_CH_IDCARD', customer_identity_number: identity});
  const saved = await app.save(value);
  assert.equal(saved.customer_identity_type, 'CRED_PSN_CH_IDCARD'); assert.equal(saved.customer_identity_number, identity);
  assert.equal(saved.status, 'draft'); assert.equal(saved.signature, undefined); assert.equal(app.calls.create.length, 0);
  assert.ok(renderContractTemplate(saved).includes('身份证号码：' + identity));
  assert.deepEqual(await app.save(value), saved); assert.equal(app.audits('save_contract').length, 1);
  const {customer_identity_type, customer_identity_number, ...oldClientValue} = value;
  const edited = await app.save({...oldClientValue, revision: saved.revision, note: '只改备注'});
  assert.equal(edited.customer_identity_type, customer_identity_type); assert.equal(edited.customer_identity_number, customer_identity_number);
  assert.deepEqual(await app.save({...oldClientValue, note: '只改备注'}), edited);
  const cleared = await app.save({...oldClientValue, revision: edited.revision, note: '只改备注', customer_identity_number: ''});
  assert.equal(cleared.customer_identity_number, ''); assert.equal(cleared.customer_identity_type, 'CRED_PSN_CH_IDCARD');
  assert.equal(renderContractTemplate(cleared).includes(identity), false);
  assert.equal(JSON.stringify(app.audits()).includes(identity), false);
});

test('旧合同缺少证件字段仍可幂等保存，企业合同填入签署经办人证件，非法证件输入拒绝', async t => {
  const app = await fixture(t), legacyValue = app.input({customer_identity_type: undefined, customer_identity_number: undefined}), legacy = await app.save(legacyValue);
  assert.equal(Object.hasOwn(legacy, 'customer_identity_type'), false); assert.equal(Object.hasOwn(legacy, 'customer_identity_number'), false);
  assert.deepEqual(await app.save(legacyValue), legacy);
  const enterprise = await app.save(app.input({party_type: 'organization', customer_company: '本机测试企业', customer_identity_type: 'CRED_PSN_CH_IDCARD', customer_identity_number: ' 00000000000000000x '}));
  assert.equal(enterprise.customer_identity_number, identityNumber);
  assert.ok(renderContractTemplate(enterprise).includes('身份证号码：' + identityNumber));
  for (const invalid of ['x'.repeat(41), 'x\n', '\rx', 'x\u0000y', 'x\u007fy', 'x\u0085y']) {
    const value = app.input({customer_identity_number: invalid});
    await assert.rejects(app.save(value)); assert.equal(app.record(value.id), undefined);
  }
  await assert.rejects(app.save(app.input({customer_identity_type: 'UNKNOWN'})));
});

test('合同生成扩展证件字段不改默认模板名称、备注或任何条款文字', () => {
  assert.equal(DEFAULT_CONTRACT_TEMPLATE.name, '全屋定制购货合同书');
  assert.equal(DEFAULT_CONTRACT_TEMPLATE.note, '根据提供的合同模板保留条款原文。未采集的身份证、营业执照与法定代表人资料留空；签章与报价附件由合同生成器排版。');
  assert.equal(createHash('sha256').update(DEFAULT_CONTRACT_TEMPLATE.body).digest('hex'), '3428258569f352c1dd634368f2c43660713a77f70d2d281a051a45d55eb1ed0f');
});

test('重复相同草稿请求幂等，不同内容无revision拒绝；引用报价和模板后源变更或删除仍保留历史快照', async t => {
  // Advancing time exposes accidental dependence on two different creation clocks.
  const DateClass = globalThis.Date; let clock = DateClass.parse(date);
  globalThis.Date = class extends DateClass {constructor(...args) {super(...(args.length ? args : [clock++]));}};
  t.after(() => {globalThis.Date = DateClass;});
  const app = await fixture(t), templateId = crypto.randomUUID();
  const template = await app.execute('alice', 'save_template', {id: templateId, name: '历史模板', body: '原条款 {{net_amount}}', company_keyword: '乙方签章', customer_keyword: '甲方签字'});
  const value = app.input({template_id: templateId}), saved = await app.save(value);
  assert.deepEqual(await app.save(value), saved); assert.equal(app.audits('save_contract').length, 1);
  await assert.rejects(app.save({...value, note: '意外覆盖'}), error => error.status === 409);
  app.change(app.quote, {total: 888888, deleted: true, items: []});
  await app.execute('alice', 'delete_template', {id: template.id, revision: template.revision});
  const edited = await app.save({...value, revision: saved.revision, note: '只改备注'});
  assert.deepEqual(edited.quote_snapshot, saved.quote_snapshot); assert.deepEqual(edited.template_snapshot, saved.template_snapshot); assert.equal(edited.gross_amount, 10001);
  const bytes = await app.document('alice', edited.id); assert.match(new TextDecoder().decode(bytes), /原条款 99.98/);
});

test('拒绝跨owner访问、跨项目报价、超额折让、非法分期、重复编号及陈旧更新', async t => {
  const app = await fixture(t), saved = await app.save(app.input()), value = app.input();
  await assert.rejects(app.execute('bob', 'get_contract', {id: saved.id}), error => error.status === 404);
  await assert.rejects(app.document('bob', saved.id), error => error.status === 404);
  const otherProject = app.seed('alice', 'project', '', {name: '其他家庭'}), otherQuote = app.seed('alice', 'quote', otherProject, {total: 10000});
  await assert.rejects(app.save({...value, quote_id: otherQuote}), /报价不属于/);
  const bobQuote = app.seed('bob', 'quote', app.parent, {total: 10000}); await assert.rejects(app.save({...value, quote_id: bobQuote}), error => error.status === 404);
  await assert.rejects(app.save({...value, discount_amount: 101}), /优惠和抹零/);
  await assert.rejects(app.save({...value, installments: value.installments.map(i => ({...i, ratio: 30}))}), /合计必须/);
  await assert.rejects(app.save({...value, installments: value.installments.map(i => ({...i, id: value.installments[0].id}))}), /编号不能重复/);
  await assert.rejects(app.save({...value, installments: value.installments.map((i, index) => ({...i, ratio: index ? i.ratio : 33.333}))}), /最多两位小数/);
  await assert.rejects(app.save({...value, number: saved.number}), /编号已被使用/);
  await assert.rejects(app.save({...value, id: saved.id, revision: crypto.randomUUID()}), error => error.status === 409);
});

test('无e签宝账号与环境时发起禁用，不上传PDF、不创建流程，公开配置和合同模板均不泄露密钥', async t => {
  const app = await fixture(t, {env: {}}); await app.signingProfile(); const saved = await app.save(app.input());
  const configuration = await app.execute('alice', 'get_signing_config'); assert.equal(configuration.configured, false); assert.deepEqual(configuration.missing, ['ESIGN_APP_ID', 'ESIGN_APP_SECRET', 'ESIGN_ENVIRONMENT']);
  await assert.rejects(app.start(saved), error => error.status === 503); assert.equal(app.calls.create.length, 0); assert.equal(app.calls.pdf.length, 0); assert.equal(app.files.size, 0); assert.equal(app.record(saved.id).data.status, 'draft');
  const configured = await fixture(t); await configured.signingProfile(); const draft = await configured.save(configured.input());
  const publicData = JSON.stringify([await configured.execute('alice', 'list_contracts', {project_id: configured.parent}), await configured.execute('alice', 'list_templates')]);
  assert.equal(publicData.includes(appEnv.ESIGN_APP_SECRET), false); assert.equal(publicData.includes(appEnv.ESIGN_APP_ID), false);
  assert.equal(new TextDecoder().decode(await configured.document('alice', draft.id)).includes(appEnv.ESIGN_APP_SECRET), false);
});

test('缺少或非法身份证在PDF生成、文件上传与preparing之前拒绝，错误不泄露号码或改变合同及收款', async t => {
  const app = await fixture(t); await app.signingProfile();
  const tx = app.seed('alice', 'transaction', app.parent, {type: '收款', amount: 1000}), beforeTransaction = app.record(tx);
  for (const number of [undefined, '', '   ', 'bad-private-number', '00000000000000000Z', '00000000000000000X\n']) {
    const draft = await app.save(app.input());
    app.change(draft.id, {customer_identity_number: number}); // Simulates incomplete or malformed legacy records.
    const before = app.record(draft.id);
    await assert.rejects(app.start(draft), error => error.status === 400 && /身份证号码/.test(error.message) && (!number?.trim() || !error.message.includes(number.trim())));
    assert.deepEqual(app.record(draft.id), before);
  }
  assert.equal(app.calls.pdf.length, 0); assert.equal(app.calls.create.length, 0); assert.equal(app.files.size, 0); assert.equal(app.audits('start_signing').length, 0);
  assert.deepEqual(app.record(tx), beforeTransaction);
});

test('个人与企业经办人号码保存正规化、进入PDF与签署参数，签署开始后冻结且审计不含证件', async t => {
  const app = await fixture(t); await app.signingProfile();
  for (const type of ['person', 'organization']) {
    const value = app.input({party_type: type, customer_company: type === 'organization' ? '测试客户企业' : '', customer_identity_number: ' 00000000000000000x '}), saved = await app.save(value), started = await app.start(saved);
    const customer = app.calls.create.at(-1).customer;
    assert.equal(customer.identityNumber, identityNumber); assert.equal(customer.identityType, 'CRED_PSN_CH_IDCARD'); assert.equal(customer.type, type);
    assert.ok(new TextDecoder().decode(Array.from(app.files.values()).at(-1)).includes('身份证号码：' + identityNumber));
    await assert.rejects(app.save({...value, revision: started.revision, customer_identity_number: '000000000000000000'}), error => error.status === 409);
    assert.equal(app.record(saved.id).data.customer_identity_number, identityNumber);
  }
  assert.equal(JSON.stringify(app.audits()).includes(identityNumber), false);
});

test('线下已签与平台已签分开：纸签有确认时间且冻结，但不能伪造电签或下载电子已签原件', async t => {
  const app = await fixture(t), saved = await app.save(app.input());
  const paper = await app.execute('alice', 'confirm_offline_signed', {id: saved.id, revision: saved.revision});
  assert.equal(paper.status, 'offline_signed'); assert.ok(paper.confirmed_at); assert.equal(paper.signature, undefined);
  await assert.rejects(app.start(paper), error => error.status === 409);
  await assert.rejects(app.execute('alice', 'refresh_signing', {id: paper.id}), /尚未取得/);
  await assert.rejects(app.document('alice', paper.id, true), /尚未由e签宝/);
  assert.equal(app.calls.create.length, 0); assert.equal(app.calls.download.length, 0);
});

test('发起请求先锁preparing，重复发起和并发分期关联均拒绝；已知flow持久化并保持真实收款', async t => {
  const app = await fixture(t); await app.signingProfile(); const saved = await app.save(app.input()), requestId = crypto.randomUUID();
  const tx = app.seed('alice', 'transaction', app.parent, {type: '收款', amount: 1000}), before = app.record(tx);
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); app.controls.create = async () => {entered.resolve(); return release.promise;};
  const running = app.start(saved, requestId); await entered.promise;
  const preparing = await app.execute('alice', 'get_contract', {id: saved.id}); assert.equal(preparing.status, 'preparing');
  await assert.rejects(app.execute('alice', 'allocate_receipts', {id: saved.id, revision: preparing.revision, allocations: [{transaction_id: tx, installment_id: preparing.installments[0].id, amount: 10}]}), error => error.status === 409 && /正在创建/.test(error.message));
  await assert.rejects(app.start(preparing, requestId), error => error.status === 409);
  release.resolve({flowId: 'flow_mock', fileId: 'file_mock'}); const result = await running;
  assert.equal(result.status, 'signing'); assert.equal(result.signature.flow_id, 'flow_mock'); assert.equal(result.signature.file_id, 'file_mock'); assert.equal(app.calls.create.length, 1);
  assert.deepEqual(app.record(tx), before); assert.deepEqual(result.receipt_allocations, []);
  const repeated = await app.start(saved, requestId); assert.equal(repeated.signature.flow_id, 'flow_mock'); assert.equal(app.calls.create.length, 1);
  await assert.rejects(app.start(result), error => error.status === 409);
});

test('双方签署链接只选冻结资料，公司配置后来变更不改已发合同，客户端任意手机号不生效', async t => {
  const app = await fixture(t); await app.signingProfile(); const saved = await app.save(app.input({party_type: 'organization', customer_company: '客户公司'})), started = await app.start(saved);
  await app.execute('alice', 'save_signing_profile', {...profile, company_name: '新公司', transactor_phone: '13700000003'});
  await app.execute('alice', 'get_sign_url', {id: saved.id, role: 'customer', account: '13600000004'});
  await app.execute('alice', 'get_sign_url', {id: saved.id, role: 'company', account: '13600000004'});
  assert.deepEqual(app.calls.signUrl, [{flowId: 'flow_mock', operator: {account: '13800000001', organization: {orgName: '客户公司'}}}, {flowId: 'flow_mock', operator: {account: '13900000002', organization: {orgName: '示例卖方企业'}}}]);
  assert.equal(started.signature.environment, 'sandbox'); assert.equal(app.calls.create[0].requireFace, true); assert.equal(app.calls.create[0].customer.type, 'organization');
  await assert.rejects(app.execute('alice', 'get_sign_url', {id: saved.id, role: 'evil'}));
});

test('完成仅来自平台详情；签署终态不回退，过期、拒签、撤销分别保存并禁止重新发起', async t => {
  const app = await fixture(t); await app.signingProfile(); const saved = await app.save(app.input()), started = await app.start(saved);
  app.controls.detail = {flowId: 'flow_mock', status: 2, finishedAt: Date.parse(date), signers: [{type: 0, status: 2}, {type: 1, status: 2}]};
  const signed = await app.execute('alice', 'refresh_signing', {id: saved.id}); assert.equal(signed.status, 'signed'); assert.equal(signed.signature.finished_at, date);
  const before = app.record(saved.id); app.controls.detail.status = 1;
  await assert.rejects(app.execute('alice', 'refresh_signing', {id: saved.id}), error => error.status === 409); assert.deepEqual(app.record(saved.id), before);
  await assert.rejects(app.start(started), error => error.status === 409);
  for (const [status, expected] of [[3, 'cancelled'], [5, 'expired'], [7, 'rejected']]) {
    const draft = await app.save(app.input()); await app.start(draft); app.controls.detail.status = status;
    const terminal = await app.execute('alice', 'refresh_signing', {id: draft.id}); assert.equal(terminal.status, expected);
    await assert.rejects(app.start(terminal), error => error.status === 409); assert.equal(app.record(draft.id).data.signature.flow_id, 'flow_mock');
  }
});

test('网络歧义保留uncertain且不能重复签；确定准备失败可修草稿而不伪造签署状态', async t => {
  const app = await fixture(t); await app.signingProfile(); const saved = await app.save(app.input());
  app.controls.create = async () => {throw new EsignError('TIMEOUT', 'stub timeout');};
  await assert.rejects(app.start(saved), /不能重复发起/); const uncertain = await app.execute('alice', 'get_contract', {id: saved.id}); assert.equal(uncertain.status, 'uncertain');
  await assert.rejects(app.start(uncertain), error => error.status === 409); await assert.rejects(app.save({...app.input(), id: saved.id, revision: uncertain.revision}), error => error.status === 409); assert.equal(app.calls.create.length, 1);
  const draftInput = app.input(), draft = await app.save(draftInput); app.controls.create = async () => {throw new EsignError('INVALID_INPUT', 'stub invalid');};
  await assert.rejects(app.start(draft), /准备未完成/); const failed = await app.execute('alice', 'get_contract', {id: draft.id}); assert.equal(failed.status, 'failed'); assert.equal(failed.signature.flow_id, undefined);
  const fixed = await app.save({...draftInput, revision: failed.revision, note: '修订资料'}); assert.equal(fixed.status, 'draft'); assert.equal(fixed.signature, undefined);
});

test('分期只关联既有实收，跨合同金额不能重复消费，收款并发失效与审计失败回滚', async t => {
  const app = await fixture(t), a = await app.save(app.input()), b = await app.save(app.input());
  const tx = app.seed('alice', 'transaction', app.parent, {type: '收款', amount: 3000, note: '真实金额'}), before = app.record(tx);
  const allocate = (contract, amount) => app.execute('alice', 'allocate_receipts', {id: contract.id, revision: contract.revision, allocations: [{transaction_id: tx, installment_id: contract.installments[0].id, amount}]});
  const linked = await allocate(a, 20); assert.equal(linked.receipt_allocations[0].amount, 2000); assert.deepEqual(app.record(tx), before);
  await assert.rejects(allocate(b, 20), /超过该笔实际收款/);
  app.controls.beforeBatch = () => app.change(tx, {void: true}); await assert.rejects(allocate(b, 10), error => error.status === 409); assert.deepEqual(app.record(b.id).data.receipt_allocations, []);
  app.change(tx, {void: false}); const old = app.record(b.id); app.controls.failAudit = true; await assert.rejects(allocate(b, 10), /mock audit failed/); assert.deepEqual(app.record(b.id), old);
});

test('父客户删除与报价/模板变更并发均使保存CAS拒绝，审计失败不留下半份合同', async t => {
  const app = await fixture(t), input = app.input(); app.controls.beforeBatch = () => app.change(app.parent, {deleted: true});
  await assert.rejects(app.save(input), error => error.status === 409); assert.equal(app.record(input.id), undefined); assert.equal(app.audits('save_contract').length, 0);
  app.change(app.parent, {deleted: false}); app.controls.beforeBatch = () => app.change(app.quote, {total: 88888}); await assert.rejects(app.save(input), error => error.status === 409); assert.equal(app.record(input.id), undefined);
  app.controls.failAudit = true; await assert.rejects(app.save(input), /mock audit failed/); assert.equal(app.record(input.id), undefined);
});

test('合同与模板从回收站恢复轮换revision；签署中和已签合同不能删除，草稿并发开始签署也不能误删', async t => {
  const app = await fixture(t), value = app.input(), saved = await app.save(value);
  await app.trash.execute('alice', 'delete_record', {id: saved.id});
  const restored = await app.trash.execute('alice', 'restore_record', {id: saved.id});
  assert.notEqual(restored.record.revision, saved.revision); assert.equal(restored.record.status, 'draft');
  await assert.rejects(app.save({...value, revision: saved.revision, note: '旧页面修改'}), error => error.status === 409);
  const template = await app.execute('alice', 'save_template', {id: crypto.randomUUID(), name: '模板', body: '正文', company_keyword: '乙方', customer_keyword: '甲方'});
  await app.trash.execute('alice', 'delete_record', {id: template.id});
  const restoredTemplate = await app.trash.execute('alice', 'restore_record', {id: template.id});
  assert.notEqual(restoredTemplate.record.revision, template.revision);
  const draft = await app.save(app.input());
  app.controls.beforeBatch = () => app.change(draft.id, {status: 'signing', signature: {flow_id: 'flow_concurrent'}});
  await assert.rejects(app.trash.execute('alice', 'delete_record', {id: draft.id}), error => error.status === 409);
  assert.equal(app.record(draft.id).data.deleted, undefined);
  for (const status of ['preparing', 'signing', 'signed', 'offline_signed', 'uncertain', 'cancelled', 'expired', 'rejected']) {
    app.change(draft.id, {status});
    await assert.rejects(app.trash.execute('alice', 'delete_record', {id: draft.id}), error => error.status === 409);
  }
});

test('项目删除在数据库事务内再次检查签署合同，读取后进入preparing的并发请求不能删除客户', async t => {
  const app = await fixture(t), saved = await app.save(app.input()), beforeParent = app.record(app.parent);
  app.controls.beforeBatch = () => app.change(saved.id, {status: 'preparing'});
  await assert.rejects(app.trash.execute('alice', 'delete_record', {id: app.parent}), error => error.status === 409);
  assert.deepEqual(app.record(app.parent), beforeParent); assert.equal(app.audits('delete_record').length, 0);
  for (const status of ['preparing', 'signing', 'uncertain']) {
    app.change(saved.id, {status});
    await assert.rejects(app.trash.execute('alice', 'delete_record', {id: app.parent}), error => error.status === 409);
  }
});

test('回收站恢复合同不能重新引入已复用的合同编号', async t => {
  const app = await fixture(t), saved = await app.save(app.input({number: 'TEST-UNIQUE'}));
  await app.trash.execute('alice', 'delete_record', {id: saved.id});
  await app.save(app.input({number: saved.number}));
  await assert.rejects(app.trash.execute('alice', 'restore_record', {id: saved.id}), error => error.status === 409);
  assert.equal(app.record(saved.id).data.deleted, true);
});

test('恢复读取后并发复用编号仍被原子guard拒绝，无恢复审计', async t => {
  const app = await fixture(t), saved = await app.save(app.input({number: 'TEST-RACE-NUMBER'}));
  await app.trash.execute('alice', 'delete_record', {id: saved.id});
  const replacement = await app.save(app.input({number: 'TEST-OTHER-NUMBER'}));
  app.controls.beforeBatch = () => app.change(replacement.id, {number: saved.number});
  await assert.rejects(app.trash.execute('alice', 'restore_record', {id: saved.id}), error => error.status === 409);
  assert.equal(app.record(saved.id).data.deleted, true); assert.equal(app.audits('restore_record').length, 0);
});

test('回收站恢复不能让同一实际收款被两个合同重复关联', async t => {
  const app = await fixture(t), original = await app.save(app.input()), tx = app.seed('alice', 'transaction', app.parent, {type: '收款', amount: 1000});
  await app.execute('alice', 'allocate_receipts', {id: original.id, revision: original.revision, allocations: [{transaction_id: tx, installment_id: original.installments[0].id, amount: 10}]});
  await app.trash.execute('alice', 'delete_record', {id: original.id});
  const replacement = await app.save(app.input());
  await app.execute('alice', 'allocate_receipts', {id: replacement.id, revision: replacement.revision, allocations: [{transaction_id: tx, installment_id: replacement.installments[0].id, amount: 10}]});
  await assert.rejects(app.trash.execute('alice', 'restore_record', {id: original.id}), error => error.status === 409);
  assert.equal(app.record(original.id).data.deleted, true); assert.equal(app.record(tx).data.amount, 1000);
});

test('恢复读取后并发消耗实收容量也被原子guard拒绝，金融交易不变', async t => {
  const app = await fixture(t), original = await app.save(app.input()), tx = app.seed('alice', 'transaction', app.parent, {type: '收款', amount: 1000}), before = app.record(tx);
  await app.execute('alice', 'allocate_receipts', {id: original.id, revision: original.revision, allocations: [{transaction_id: tx, installment_id: original.installments[0].id, amount: 10}]});
  await app.trash.execute('alice', 'delete_record', {id: original.id});
  const replacement = await app.save(app.input());
  app.controls.beforeBatch = () => app.change(replacement.id, {receipt_allocations: [{transaction_id: tx, installment_id: replacement.installments[0].id, amount: 1000}]});
  await assert.rejects(app.trash.execute('alice', 'restore_record', {id: original.id}), error => error.status === 409);
  assert.equal(app.record(original.id).data.deleted, true); assert.equal(app.audits('restore_record').length, 0); assert.deepEqual(app.record(tx), before);
});

test('服务商已返回flow后本地审计暂时失败仍保存流程编号，禁止再创建且可查询核对', async t => {
  const app = await fixture(t); await app.signingProfile(); const saved = await app.save(app.input());
  app.controls.create = async () => {
    const batch = app.database.batch;
    app.database.batch = async statements => {app.database.batch = batch; throw Error('mock transient local commit failure');};
    return {flowId: 'flow_known', fileId: 'file_known'};
  };
  await assert.rejects(app.start(saved), /flow_known/);
  const stored = app.record(saved.id).data;
  assert.equal(stored.status, 'uncertain'); assert.equal(stored.signature.flow_id, 'flow_known'); assert.equal(stored.signature.file_id, 'file_known');
  await assert.rejects(app.start({...saved, revision: stored.revision}), error => error.status === 409);
  assert.equal(app.calls.create.length, 1);
  app.controls.detail = {flowId: 'flow_known', status: 1, finishedAt: null, signers: [{type: 0, status: 0}, {type: 1, status: 0}]};
  const refreshed = await app.execute('alice', 'refresh_signing', {id: saved.id}); assert.equal(refreshed.status, 'signing'); assert.equal(app.calls.detail[0], 'flow_known');
});

test('既有tx:local_seedy:收款编号可以按分关联，放宽格式仍保持owner和项目归属及原交易不变', async t => {
  const app = await fixture(t), draft = await app.save(app.input()), transactionId = 'tx:local_seedy:' + crypto.randomUUID();
  app.seed('alice', 'transaction', app.parent, {type: '收款', amount: 2567}, transactionId); const before = app.record(transactionId);
  const allocate = (id, record = draft) => app.execute('alice', 'allocate_receipts', {id: record.id, revision: record.revision, allocations: [{transaction_id: id, installment_id: record.installments[0].id, amount: 25.67}]});
  const saved = await allocate(transactionId);
  assert.deepEqual(saved.receipt_allocations, [{transaction_id: transactionId, installment_id: draft.installments[0].id, amount: 2567}]);
  const shown = await app.execute('alice', 'get_contract', {id: draft.id}); assert.equal(shown.installments[0].received, 2567); assert.equal(shown.allocated_received, 2567); assert.deepEqual(app.record(transactionId), before);
  const foreign = app.seed('bob', 'transaction', app.parent, {type: '收款', amount: 2567}, 'tx:local_seedy:' + crypto.randomUUID());
  await assert.rejects(allocate(foreign, saved), error => error.status === 404);
  const otherProject = app.seed('alice', 'project', '', {name: '另一客户'}), alien = app.seed('alice', 'transaction', otherProject, {type: '收款', amount: 2567}, 'tx:local_seedy:' + crypto.randomUUID());
  await assert.rejects(allocate(alien, saved), /当前项目有效的实际收款/);
  for (const invalid of ['', 'tx:bad\nheader', 'tx:bad\u0000id', 'x'.repeat(1025)]) await assert.rejects(allocate(invalid, saved));
  assert.deepEqual(app.record(transactionId), before); assert.deepEqual(app.record(draft.id).data.receipt_allocations, saved.receipt_allocations);
});

test('PDF乙方主体与配置签章企业不一致时在文件生成及供应商调用前拒绝，修正草稿后才可发起', async t => {
  const app = await fixture(t); await app.signingProfile(); const value = app.input({company_name: '另一企业'}), draft = await app.save(value), before = app.record(draft.id);
  await assert.rejects(app.start(draft), /合同乙方公司与电子签章企业不一致/);
  assert.equal(app.calls.pdf.length, 0); assert.equal(app.calls.create.length, 0); assert.equal(app.files.size, 0); assert.equal(app.audits('start_signing').length, 0); assert.deepEqual(app.record(draft.id), before);
  const corrected = await app.save({...value, revision: draft.revision, company_name: profile.company_name});
  const started = await app.start(corrected); assert.equal(started.status, 'signing'); assert.equal(app.calls.create.length, 1); assert.equal(app.calls.create[0].organization.name, profile.company_name); assert.equal(app.calls.pdf[0].company_name, profile.company_name);
});
