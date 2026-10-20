import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const adapterUrl = url(compile(readFileSync('lib/wechat-pay.ts', 'utf8')));
const {createWechatPayAdapter, WechatPayError} = await import(adapterUrl);
const {createQuotePaymentService} = await import(url(compile(readFileSync('lib/quote-payments.ts', 'utf8')).replace("from './wechat-pay'", `from '${adapterUrl}'`)));
const date = Date.parse('2026-10-13T08:00:00.000Z');
const environment = {WECHAT_PAY_MCHID: '1900000001', WECHAT_PAY_APPID: 'wx1234567890abcdef', WECHAT_PAY_MERCHANT_SERIAL: 'A'.repeat(40),
  WECHAT_PAY_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----',
  WECHAT_PAY_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nAA==\n-----END PUBLIC KEY-----',
  WECHAT_PAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_mock', WECHAT_PAY_API_V3_KEY: '0123456789abcdef0123456789abcdef',
  WECHAT_APP_SECRET: 'mock_oauth_secret_only', SITE_ORIGIN: 'https://quote.test'};

async function fixture(t, {configured = true, total = 10000} = {}) {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(readFileSync('drizzle/0000_slippery_lenny_balinger.sql', 'utf8'));
  t.after(() => sqlite.close());
  const controls = {beforeBatch: null, failAudit: false, query: null, native: null, now: date, oauth: null};
  const calls = {native: [], jsapi: [], query: [], oauth: []};
  const database = {prepare(sql) {let args = []; return {sql, get args() {return args;}, bind(...values) {args = values; return this;},
    async all() {return {results: sqlite.prepare(sql).all(...args)};}};}, async batch(statements) {
    if (controls.beforeBatch) {const callback = controls.beforeBatch; controls.beforeBatch = null; await callback(statements);}
    sqlite.exec('BEGIN');
    try {
      const results = statements.map(statement => {
        if (controls.failAudit && statement.args[2] === 'audit') throw new Error('isolated audit failure');
        return {meta: {changes: Number(sqlite.prepare(statement.sql).run(...statement.args).changes)}};
      }); sqlite.exec('COMMIT'); return results;
    } catch (error) {sqlite.exec('ROLLBACK'); throw error;}
  }};
  const seed = (id, owner, kind, project, data) => sqlite.prepare('INSERT INTO records(id,owner,kind,project,data,created) VALUES(?,?,?,?,?,?)').run(id, owner, kind, project, JSON.stringify(data), new Date(date).toISOString());
  seed('project-main', 'alice', 'project', 'project-main', {name: '隔离测试项目', project_type: 'project', status: '洽谈中'});
  seed('quote-main', 'alice', 'quote', 'project-main', {title: '隔离测试报价', total, adopted: false});
  const shares = new Map();
  function share(name = '定金', amount = 3000, token = 'a'.repeat(64)) {
    const value = {id: crypto.randomUUID(), owner: 'alice', project_id: 'project-main', quote_id: 'quote-main', quote_title: '隔离测试报价',
      snapshot: {title: '隔离测试报价', total}, collection: {name, amount}, expires_at: new Date(date + 30 * 86400000).toISOString()};
    shares.set(token, value);
    seed(value.id, value.owner, 'quote_share', value.project_id, {quote_id: value.quote_id, revoked: false, expires_at: value.expires_at,
      snapshot: {title: value.snapshot.title, total, collection: value.collection}});
    return {token, value};
  }
  async function readShare(token) {const value = shares.get(token); if (!value || value.revoked || Date.parse(value.expires_at) <= controls.now) throw new WechatPayError('报价链接已失效', 410, 'SHARE_UNAVAILABLE'); return value;}
  const currentEnv = () => configured ? environment : {SITE_ORIGIN: environment.SITE_ORIGIN};
  const base = createWechatPayAdapter(currentEnv(), {now: () => controls.now});
  const adapter = {...base,
    async createNative(order) {calls.native.push(structuredClone(order)); if (controls.native) return controls.native(order); return {code_url: 'weixin://wxpay/bizpayurl/up?pr=mock-' + order.out_trade_no};},
    async createJsapi(order, openid) {calls.jsapi.push({order, openid}); return {jsapi_params: {appId: environment.WECHAT_PAY_APPID, timeStamp: '1', nonceStr: 'mock', package: 'prepay_id=wxmock', signType: 'RSA', paySign: 'mock'}};},
    async query(outTradeNo) {
      calls.query.push(outTradeNo); if (controls.query) return controls.query(outTradeNo);
      const row = sqlite.prepare("SELECT data FROM records WHERE kind='payment_order' AND json_extract(data,'$.out_trade_no')=?").get(outTradeNo);
      return {appid: environment.WECHAT_PAY_APPID, mchid: environment.WECHAT_PAY_MCHID, out_trade_no: outTradeNo,
        trade_state: 'NOTPAY', amount: {total: JSON.parse(row.data).amount, currency: 'CNY'}};
    },
    async decodeNotification(_headers, raw) {return JSON.parse(raw);},
    async seal(token) {return {nonce: 'mock-server-only', ciphertext: Buffer.from(token).toString('base64')};},
    async open(value) {return Buffer.from(value.ciphertext, 'base64').toString();},
  };
  const service = createQuotePaymentService({database: () => database, environment: currentEnv, readShare, adapter: () => adapter,
    now: () => controls.now, fetch: async input => {
      calls.oauth.push(new URL(input).pathname); if (controls.oauth) return controls.oauth(input);
      return Response.json({openid: 'openid_mock_authorized_customer', access_token: 'mock_discarded'});
    }});
  const records = kind => sqlite.prepare('SELECT * FROM records WHERE kind=?').all(kind).map(row => ({...row, data: JSON.parse(row.data)}));
  const transaction = (publicOrder, update = {}) => ({appid: environment.WECHAT_PAY_APPID, mchid: environment.WECHAT_PAY_MCHID,
    out_trade_no: publicOrder.order_id, transaction_id: 'wxmock-' + publicOrder.order_id, trade_state: 'SUCCESS',
    success_time: '2026-10-13T23:59:00+08:00', amount: {total: publicOrder.amount, currency: 'CNY', payer_total: publicOrder.amount, payer_currency: 'CNY'}, ...update});
  const notify = value => service.notify(new Headers(), JSON.stringify(value));
  return {...service, sqlite, controls, calls, seed, share, shares, records, transaction, notify};
}

test('不同收款项对应各自报价来源，汇总项目总账；不改变报价采纳或项目状态', async t => {
  const app = await fixture(t), first = app.share('定金', 3000), second = app.share('尾款', 7000, 'b'.repeat(64));
  const parentBefore = app.records('project')[0], quoteBefore = app.records('quote')[0];
  const one = await app.start(first.token, 'native'); await app.notify(app.transaction(one));
  const two = await app.start(second.token, 'native'); await app.notify(app.transaction(two));
  const receipts = app.records('transaction'); assert.equal(receipts.length, 2);
  assert.equal(receipts.reduce((sum, receipt) => sum + receipt.data.amount, 0), 10000);
  assert.deepEqual(receipts.map(receipt => receipt.data.payment_item).sort(), ['定金', '尾款'].sort());
  for (const receipt of receipts) {
    assert.equal(receipt.project, 'project-main'); assert.equal(receipt.owner, 'alice'); assert.equal(receipt.data.source_quote_id, 'quote-main');
    assert.equal(receipt.data.quote_title, '隔离测试报价'); assert.equal(receipt.data.payment_provider, 'wechat');
    assert.equal(receipt.data.type, '收款'); assert.equal(receipt.data.date, '2026-10-13');
  }
  assert.deepEqual(app.records('project')[0], parentBefore); assert.deepEqual(app.records('quote')[0], quoteBefore);
  assert.equal(app.records('audit').length, 2);
  const state = await app.status(first.token); assert.equal(state.paid, true); assert.equal(state.amount, 3000);
  assert.equal(Object.hasOwn(state, 'owner'), false); assert.equal(Object.hasOwn(state, 'quote_id'), false);
});

test('同share重复下单只生成一次，同交易重复及并发通知只写一份流水和审计', async t => {
  const app = await fixture(t), {token} = app.share(), order = await app.start(token, 'native');
  assert.deepEqual(await app.start(token, 'native'), order); assert.equal(app.calls.native.length, 1);
  const notice = app.transaction(order); await Promise.all([app.notify(notice), app.notify(notice)]); await app.notify(notice);
  assert.equal(app.records('transaction').length, 1); assert.equal(app.records('audit').length, 1);
  const receipt = app.records('transaction')[0];
  app.sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...receipt.data, deleted: true, void: true}), receipt.id);
  await app.notify(notice); assert.equal(app.records('transaction')[0].data.deleted, true); assert.equal(app.records('transaction')[0].data.void, true);
  assert.equal(app.records('audit').length, 1); assert.equal((await app.start(token, 'native')).paid, true);
});

test('撤销/过期/原项目软删后已付款通知仍根据保存的绑定入账', async t => {
  const app = await fixture(t), {token, value} = app.share(), order = await app.start(token, 'native');
  value.revoked = true; value.expires_at = new Date(date - 1000).toISOString();
  const parent = app.records('project')[0]; app.sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...parent.data, deleted: true}), parent.id);
  await assert.rejects(app.start(token, 'native'), error => error.status === 410);
  await app.notify(app.transaction(order)); assert.equal(app.records('transaction').length, 1);
  assert.equal(app.records('payment_order')[0].data.status, 'paid');
});

test('金额/币种/appid/mchid/状态不一致拒绝，不建立流水，优惠券保留原实付', async t => {
  const app = await fixture(t), {token} = app.share(), order = await app.start(token, 'native'), correct = app.transaction(order);
  for (const update of [{appid: 'wxotherappid123456'}, {mchid: '1900000002'}, {trade_state: 'REFUND'},
    {amount: {...correct.amount, total: 3001}}, {amount: {...correct.amount, currency: 'USD'}}, {amount: {...correct.amount, payer_total: -1}}]) {
    await assert.rejects(app.notify({...correct, ...update}), error => error.code === 'PAYMENT_MISMATCH');
  }
  assert.equal(app.records('transaction').length, 0);
  await app.notify({...correct, amount: {...correct.amount, payer_total: 2800}});
  assert.equal(app.records('transaction')[0].data.amount, 3000); assert.equal(app.records('transaction')[0].data.wechat_payer_amount, 2800);
});

test('审计失败时D1原子batch回滚流水和paid状态，重试只登记一次', async t => {
  const app = await fixture(t), {token} = app.share(), order = await app.start(token, 'native'); app.controls.failAudit = true;
  await assert.rejects(app.notify(app.transaction(order))); assert.equal(app.records('transaction').length, 0);
  assert.equal(app.records('payment_order')[0].data.status, 'ready'); app.controls.failAudit = false;
  await app.notify(app.transaction(order)); assert.equal(app.records('transaction').length, 1); assert.equal(app.records('audit').length, 1);
});

test('所有share的进行中与成功金额和旧手工来源收款共同限制报价应收，其他owner不干扰', async t => {
  const app = await fixture(t), first = app.share('定金', 3000), second = app.share('尾款', 6000, 'b'.repeat(64));
  app.seed('manual', 'alice', 'transaction', 'project-main', {type: '收款', source_quote_id: 'quote-main', amount: 2000});
  app.seed('other-owner', 'bob', 'transaction', 'other-project', {type: '收款', source_quote_id: 'quote-main', amount: 999999});
  await app.start(first.token, 'native');
  await assert.rejects(app.start(second.token, 'native'), error => error.code === 'PAYMENT_LIMIT_EXCEEDED');
  assert.equal(app.calls.native.length, 1); assert.equal(app.records('payment_order').length, 1);
});

test('并发预检之后新手工收款仍由原子INSERT累计guard拦截', async t => {
  const app = await fixture(t), {token} = app.share('尾款', 7000);
  app.controls.beforeBatch = async () => app.seed('late-manual', 'alice', 'transaction', 'project-main', {type: '收款', source_quote_id: 'quote-main', amount: 4000});
  await assert.rejects(app.start(token, 'native'), error => error.code === 'PAYMENT_LIMIT_EXCEEDED');
  assert.equal(app.calls.native.length, 0); assert.equal(app.records('payment_order').length, 0);
});

test('未关联报价的手工收款（现金/转账）也计入项目应收，防止微信超收', async t => {
  const app = await fixture(t), {token} = app.share('尾款', 7000);
  app.seed('cash', 'alice', 'transaction', 'project-main', {type: '收款', amount: 4000});
  app.seed('voided-cash', 'alice', 'transaction', 'project-main', {type: '收款', amount: 9000, void: true});
  app.seed('payment-out', 'alice', 'transaction', 'project-main', {type: '付款', amount: 9000});
  await assert.rejects(app.start(token, 'native'), error => error.code === 'PAYMENT_LIMIT_EXCEEDED');
  assert.equal(app.calls.native.length, 0); assert.equal(app.records('payment_order').length, 0);
  const ok = await fixture(t), allowed = ok.share('尾款', 6000);
  ok.seed('cash', 'alice', 'transaction', 'project-main', {type: '收款', amount: 4000});
  assert.equal((await ok.start(allowed.token, 'native')).amount, 6000);
});

test('项目级限额：其他小项目已采纳报价计入应收，同组未采纳版本只按差额计入', async t => {
  const app = await fixture(t), {token} = app.share('定金', 3000);
  app.seed('quote-other', 'alice', 'quote', 'project-main', {title: '另一小项目', total: 20000, adopted: true, subproject_id: 'b0000000-0000-4000-8000-000000000000'});
  app.seed('cash-other', 'alice', 'transaction', 'project-main', {type: '收款', amount: 20000});
  assert.equal((await app.start(token, 'native')).amount, 3000);
  const same = await fixture(t), version = same.share('定金', 3000);
  same.seed('quote-adopted', 'alice', 'quote', 'project-main', {title: '已采纳版本', total: 9000, adopted: true});
  same.seed('cash', 'alice', 'transaction', 'project-main', {type: '收款', amount: 8000});
  await assert.rejects(same.start(version.token, 'native'), error => error.code === 'PAYMENT_LIMIT_EXCEEDED');
});

test('分享预检后被撤销，原子订单预留拒绝且不调用微信或建立流水', async t => {
  const app = await fixture(t), {token, value} = app.share();
  app.controls.beforeBatch = async () => {
    value.revoked = true;
    const stored = app.records('quote_share')[0];
    app.sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...stored.data, revoked: true}), stored.id);
  };
  await assert.rejects(app.start(token, 'native'), error => error.status === 410);
  assert.equal(app.calls.native.length, 0); assert.equal(app.records('payment_order').length, 0); assert.equal(app.records('transaction').length, 0);
});

test('未配置或0金额不建支付订单/收款，状态只给缺少名称；未知session不调用JSAPI', async t => {
  const app = await fixture(t, {configured: false}), {token} = app.share();
  const state = await app.status(token); assert.equal(state.configured, false); assert.ok(state.missing.includes('WECHAT_PAY_MCHID'));
  await assert.rejects(app.start(token, 'native'), error => error.status === 503);
  assert.equal(app.records('payment_order').length, 0); assert.equal(app.records('transaction').length, 0); assert.equal(app.calls.native.length, 0);
  const configured = await fixture(t), zero = configured.share('定金', 0);
  await assert.rejects(configured.start(zero.token, 'native'), error => error.code === 'PAYMENT_UNAVAILABLE');
  const valid = configured.share('定金', 3000, 'c'.repeat(64));
  const response = await configured.start(valid.token, 'jsapi', '0'.repeat(64));
  assert.equal(response.status, 'authorization_required'); assert.match(response.authorization_url, /^\/api\/wechat-pay\/oauth\?token=/);
  assert.equal(configured.calls.jsapi.length, 0); assert.equal(configured.records('payment_order').length, 0);
});

test('收款码图片模式禁止查单、Native、JSAPI和OAuth，不生成支付订单或收款', async t => {
  const app = await fixture(t), {token, value} = app.share();
  value.snapshot.payment_mode = 'manual_code';
  value.snapshot.payment_code = {id: crypto.randomUUID(), label: '隔离演示图片'};
  const manualOnly = error => error.code === 'MANUAL_PAYMENT_ONLY';
  await assert.rejects(app.status(token), manualOnly);
  await assert.rejects(app.start(token, 'native'), manualOnly);
  await assert.rejects(app.start(token, 'jsapi'), manualOnly);
  await assert.rejects(app.beginOAuth(token, 'd'.repeat(64)), manualOnly);
  assert.deepEqual(app.calls, {native: [], jsapi: [], query: [], oauth: []});
  for (const kind of ['payment_order', 'transaction', 'audit', 'wechat_oauth', 'wechat_session']) assert.equal(app.records(kind).length, 0);
});

test('旧授权回调遇到图片模式时停止，不兑换客户身份或保存会话', async t => {
  const app = await fixture(t), {token, value} = app.share(), browser = 'd'.repeat(64);
  const begin = await app.beginOAuth(token, browser), state = new URL(begin.url).searchParams.get('state');
  value.snapshot.payment_mode = 'manual_code';
  await assert.rejects(app.finishOAuth(state, 'mock-code', browser), error => error.code === 'MANUAL_PAYMENT_ONLY');
  assert.equal(app.calls.oauth.length, 0); assert.equal(app.records('wechat_session').length, 0);
});

test('数据库图片模式不能通过旧分享预检创建自动支付订单', async t => {
  const app = await fixture(t), {token} = app.share();
  app.controls.beforeBatch = async () => {
    const stored = app.records('quote_share')[0];
    stored.data.snapshot.payment_mode = 'manual_code';
    app.sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(stored.data), stored.id);
  };
  await assert.rejects(app.start(token, 'native'));
  assert.equal(app.calls.native.length, 0); assert.equal(app.records('payment_order').length, 0); assert.equal(app.records('transaction').length, 0);
});

test('查单确认付款补入账且不重复；超时下单保留同商户订单号避免重复扣款', async t => {
  const app = await fixture(t), {token} = app.share(), order = await app.start(token, 'native');
  app.controls.query = () => app.transaction(order); assert.equal((await app.status(token)).paid, true);
  assert.equal((await app.status(token)).paid, true); assert.equal(app.records('transaction').length, 1);
  const other = await fixture(t), pending = other.share(); other.controls.native = () => {throw new WechatPayError('isolated timeout', 503);};
  await assert.rejects(other.start(pending.token, 'native'), error => error.status === 503);
  const firstNumber = other.calls.native[0].out_trade_no; other.controls.native = null;
  const retry = await other.start(pending.token, 'native'); assert.equal(retry.order_id, firstNumber); assert.equal(other.records('payment_order').length, 1);
});

test('OAuth一次性state绑定浏览器和分享，服务端会话绑定quote分享且openid不暴露', async t => {
  const app = await fixture(t), first = app.share(), browser = 'd'.repeat(64);
  const begin = await app.beginOAuth(first.token, browser), redirect = new URL(begin.url), state = redirect.searchParams.get('state');
  assert.equal(redirect.origin, 'https://open.weixin.qq.com'); assert.equal(redirect.searchParams.get('scope'), 'snsapi_base');
  assert.equal(redirect.searchParams.get('redirect_uri'), 'https://quote.test/api/wechat-pay/oauth');
  assert.equal(app.records('wechat_oauth')[0].data.token.ciphertext.includes(first.token), false);
  await assert.rejects(app.finishOAuth(state, 'mock-code', 'e'.repeat(64)), error => error.status === 401); assert.equal(app.calls.oauth.length, 0);
  const completed = await app.finishOAuth(state, 'mock-code', browser); assert.equal(completed.token, first.token);
  await assert.rejects(app.finishOAuth(state, 'mock-code', browser), error => error.status === 401); assert.equal(app.calls.oauth.length, 1);
  const result = await app.start(first.token, 'jsapi', completed.sessionToken);
  assert.ok(result.jsapi_params); assert.equal(app.calls.jsapi[0].openid, 'openid_mock_authorized_customer');
  assert.equal(Object.hasOwn(result, 'openid'), false); assert.equal(JSON.stringify(result).includes('alice'), false);
  const other = app.share('尾款', 3000, 'b'.repeat(64));
  assert.equal((await app.start(other.token, 'jsapi', completed.sessionToken)).status, 'authorization_required');
});
