import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync, sign, verify, createCipheriv} from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const {createWechatPayAdapter, wechatPayConfiguration, WechatPayError} = await import(moduleUrl(compile(readFileSync('lib/wechat-pay.ts', 'utf8'))));
const merchant = generateKeyPairSync('rsa', {modulusLength: 2048}), platform = generateKeyPairSync('rsa', {modulusLength: 2048});
const now = Date.parse('2026-10-13T08:00:00.000Z');
const environment = {WECHAT_PAY_MCHID: '1900000001', WECHAT_PAY_APPID: 'wx1234567890abcdef',
  WECHAT_PAY_MERCHANT_SERIAL: 'A'.repeat(40), WECHAT_PAY_PRIVATE_KEY: merchant.privateKey.export({type: 'pkcs8', format: 'pem'}),
  WECHAT_PAY_API_V3_KEY: '0123456789abcdef0123456789abcdef',
  WECHAT_PAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_1234567890', WECHAT_PAY_PUBLIC_KEY: platform.publicKey.export({type: 'spki', format: 'pem'}),
  WECHAT_APP_SECRET: 'mock_oauth_secret_not_real', SITE_ORIGIN: 'https://quote.test'};
assert.equal(environment.WECHAT_PAY_API_V3_KEY.length, 32);
const order = {out_trade_no: 'GMGtestorder0001', amount: 12345, description: '测试报价 · 定金', expires_at: '2026-10-14T08:00:00.000Z'};

function signedResponse(raw, {status = 200, timestamp = String(now / 1000), nonce = 'mock-response-nonce', serial = environment.WECHAT_PAY_PUBLIC_KEY_ID, corrupt = false} = {}) {
  const signature = sign('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`), platform.privateKey).toString('base64');
  return new Response(corrupt ? raw + ' ' : raw, {status, headers: {'Wechatpay-Timestamp': timestamp, 'Wechatpay-Nonce': nonce,
    'Wechatpay-Serial': serial, 'Wechatpay-Signature': signature}});
}
function encryptedNotification(transaction, {timestamp = String(now / 1000), serial = environment.WECHAT_PAY_PUBLIC_KEY_ID} = {}) {
  const nonce = 'mockNonce123', associated = 'transaction';
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(environment.WECHAT_PAY_API_V3_KEY), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associated));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(transaction)), cipher.final(), cipher.getAuthTag()]).toString('base64');
  const raw = JSON.stringify({id: 'mock-notification', create_time: '2026-10-01T08:00:00Z', event_type: 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource', resource: {algorithm: 'AEAD_AES_256_GCM', original_type: 'transaction', nonce, associated_data: associated, ciphertext}});
  const response = signedResponse(raw, {timestamp, serial}); return {raw, headers: response.headers};
}
const transaction = {appid: environment.WECHAT_PAY_APPID, mchid: environment.WECHAT_PAY_MCHID, out_trade_no: order.out_trade_no,
  transaction_id: '420000000000000001', trade_state: 'SUCCESS', success_time: '2026-10-01T08:00:00Z', amount: {total: 12345, currency: 'CNY', payer_total: 12345, payer_currency: 'CNY'}};

test('配置只报告缺少的运行时名称，不返回凭据；无配置阻止真实请求', async () => {
  let calls = 0;
  const adapter = createWechatPayAdapter({}, {fetch: async () => {calls++; throw new Error('must not fetch');}});
  assert.equal(adapter.configuration.configured, false);
  await assert.rejects(adapter.createNative(order), error => error instanceof WechatPayError && error.status === 503 && error.missing.includes('WECHAT_PAY_MCHID'));
  assert.equal(calls, 0);
  assert.equal(wechatPayConfiguration({...environment, WECHAT_APP_SECRET: ''}).configured, true);
  assert.equal(wechatPayConfiguration({...environment, WECHAT_APP_SECRET: ''}).jsapi_configured, false);
  for (const update of [{SITE_ORIGIN: 'http://quote.test'}, {SITE_ORIGIN: 'https://quote.test/path'}, {WECHAT_PAY_API_V3_KEY: 'short'}, {WECHAT_PAY_MCHID: 'quote"inject'}]) assert.equal(wechatPayConfiguration({...environment, ...update}).configured, false);
});

test('Native对精确请求路径及body进行RSA签名，并只接受验签成功的官方code_url', async () => {
  let captured;
  const adapter = createWechatPayAdapter(environment, {now: () => now, fetch: async (input, options) => {
    const url = new URL(input); captured = JSON.parse(options.body);
    const auth = Object.fromEntries([...options.headers.Authorization.matchAll(/(\w+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
    assert.equal(auth.mchid, environment.WECHAT_PAY_MCHID); assert.equal(auth.serial_no, environment.WECHAT_PAY_MERCHANT_SERIAL);
    assert.equal(verify('RSA-SHA256', Buffer.from(`POST\n${url.pathname}${url.search}\n${auth.timestamp}\n${auth.nonce_str}\n${options.body}\n`), merchant.publicKey, Buffer.from(auth.signature, 'base64')), true);
    assert.equal(options.redirect, 'error');
    return signedResponse(JSON.stringify({code_url: 'weixin://wxpay/bizpayurl/up?pr=mockonly'}));
  }});
  assert.deepEqual(await adapter.createNative(order), {code_url: 'weixin://wxpay/bizpayurl/up?pr=mockonly'});
  assert.equal(captured.notify_url, 'https://quote.test/api/wechat-pay/notify');
  assert.deepEqual(captured.amount, {total: 12345, currency: 'CNY'});
  assert.equal(captured.out_trade_no, order.out_trade_no);
});

test('响应缺失/错误签名、未知公钥、过期时间及外部付款链接均失败关闭', async () => {
  const raw = JSON.stringify({code_url: 'weixin://wxpay/bizpayurl/up?pr=mockonly'});
  for (const response of [new Response(raw), signedResponse(raw, {corrupt: true}), signedResponse(raw, {serial: 'PUB_KEY_ID_unknown'}),
    signedResponse(raw, {timestamp: String(now / 1000 - 301)}), signedResponse(JSON.stringify({code_url: 'https://attacker.test/pay'}))]) {
    const adapter = createWechatPayAdapter(environment, {now: () => now, fetch: async () => response});
    await assert.rejects(adapter.createNative(order), error => error.status === 502);
  }
});

test('通知原始报文验签后AES256GCM解密，容忍±300秒且不误拒旧业务支付时间', async () => {
  const adapter = createWechatPayAdapter(environment, {now: () => now});
  for (const offset of [-300, 0, 300]) {
    const notice = encryptedNotification(transaction, {timestamp: String(now / 1000 + offset)});
    assert.deepEqual(await adapter.decodeNotification(notice.headers, notice.raw), transaction);
  }
  for (const offset of [-301, 301]) {
    const notice = encryptedNotification(transaction, {timestamp: String(now / 1000 + offset)});
    await assert.rejects(adapter.decodeNotification(notice.headers, notice.raw), error => error.status === 401);
  }
  const notice = encryptedNotification(transaction);
  await assert.rejects(adapter.decodeNotification(notice.headers, notice.raw + '\n'), error => error.status === 401);
  const probe = new Headers(notice.headers); probe.set('Wechatpay-Signature', 'WECHATPAY/SIGNTEST/mock');
  await assert.rejects(adapter.decodeNotification(probe, notice.raw), error => error.status === 401);
});

test('签名正确但AES认证标签被篡改、通知类型不符均拒绝', async () => {
  const adapter = createWechatPayAdapter(environment, {now: () => now}), notice = encryptedNotification(transaction);
  const value = JSON.parse(notice.raw), bytes = Buffer.from(value.resource.ciphertext, 'base64'); bytes[0] ^= 1;
  value.resource.ciphertext = bytes.toString('base64'); let raw = JSON.stringify(value);
  await assert.rejects(adapter.decodeNotification(signedResponse(raw).headers, raw), error => error.code === 'WECHAT_DECRYPT_INVALID');
  value.event_type = 'REFUND.SUCCESS'; raw = JSON.stringify(value);
  await assert.rejects(adapter.decodeNotification(signedResponse(raw).headers, raw), error => error.status === 400);
});

test('JSAPI参数签名使用appId/timeStamp/nonceStr/package且openID仅作为受信后端参数', async () => {
  let captured;
  const adapter = createWechatPayAdapter(environment, {now: () => now, fetch: async (_input, options) => {
    captured = JSON.parse(options.body); return signedResponse(JSON.stringify({prepay_id: 'wxmockprepay0001'}));
  }});
  const {jsapi_params: params} = await adapter.createJsapi(order, 'openid_mock_authorized_customer');
  assert.equal(captured.payer.openid, 'openid_mock_authorized_customer');
  assert.equal(verify('RSA-SHA256', Buffer.from(`${params.appId}\n${params.timeStamp}\n${params.nonceStr}\n${params.package}\n`), merchant.publicKey, Buffer.from(params.paySign, 'base64')), true);
  const sealed = await adapter.seal('mock-server-state'); assert.equal(await adapter.open(sealed), 'mock-server-state');
});
