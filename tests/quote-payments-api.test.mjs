import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const asURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const adapterUrl = asURL(compile(readFileSync('lib/wechat-pay.ts', 'utf8')));
const {WechatPayError} = await import(adapterUrl);
const sharesUrl = asURL("export class QuoteShareError extends Error {constructor(message,status=400){super(message);this.status=status;}} export async function readQuoteShareForPayment(){throw Error('must be injected');}");
const serviceUrl = asURL("export const WECHAT_SESSION_COOKIE='__Host-gmg-wx-session';export const WECHAT_OAUTH_COOKIE='__Host-gmg-wx-oauth';export function createQuotePaymentService(){return globalThis.quotePaymentApiTest.service;}");
async function route(path, levels) {
  const prefix = '../'.repeat(levels) + 'lib/';
  const source = compile(readFileSync(path, 'utf8')).replace("import { env } from 'cloudflare:workers';", "const env=new Proxy({}, {get(_t,key){return globalThis.quotePaymentApiTest.env[key];}});").replace("import { env } from './local-env';", "const env=new Proxy({}, {get(_t,key){return globalThis.quotePaymentApiTest.env[key];}});")
    .replace(`from '${prefix}quote-payments'`, `from '${serviceUrl}'`).replace(`from '${prefix}quote-shares'`, `from '${sharesUrl}'`).replace(`from '${prefix}wechat-pay'`, `from '${adapterUrl}'`);
  return import(asURL(source));
}
const paymentApi = await route('app/api/quote-payments/route.ts', 3), notifyApi = await route('app/api/wechat-pay/notify/route.ts', 4), oauthApi = await route('app/api/wechat-pay/oauth/route.ts', 4);
const origin = 'https://quote.test', token = 'a'.repeat(64), session = 'b'.repeat(64), browser = 'c'.repeat(64);
const env = {SITE_ORIGIN: origin, WECHAT_PAY_MCHID: '1900000001', WECHAT_PAY_APPID: 'wx1234567890abcdef', WECHAT_PAY_MERCHANT_SERIAL: 'A'.repeat(40),
  WECHAT_PAY_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----', WECHAT_PAY_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nAA==\n-----END PUBLIC KEY-----',
  WECHAT_PAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_mock', WECHAT_PAY_API_V3_KEY: '0123456789abcdef0123456789abcdef', WECHAT_APP_SECRET: 'mock_only'};
function setup(t) {
  const calls = {start: [], notify: [], oauth: []};
  const service = {async status() {return {configured: false, missing: ['WECHAT_PAY_MCHID'], payment_name: '定金', amount: 3000, paid: false, status: 'not_requested'};},
    async start(...args) {calls.start.push(args); return {status: 'ready', amount: 3000, name: '定金', code_url: 'weixin://wxpay/bizpayurl/up?pr=mock'};},
    async notify(...args) {calls.notify.push(args); return {received: true};},
    async beginOAuth(...args) {calls.oauth.push(args); return {url: 'https://open.weixin.qq.com/mock-only'};},
    async finishOAuth(...args) {calls.oauth.push(args); return {token, sessionToken: session};}};
  globalThis.quotePaymentApiTest = {env: {...env}, service}; t.after(() => {delete globalThis.quotePaymentApiTest;});
  const post = (body = {token, method: 'native'}, headers = {origin, 'sec-fetch-site': 'same-origin'}) => paymentApi.POST(new Request(origin + '/api/quote-payments', {method: 'POST', headers, body: JSON.stringify(body)}));
  return {calls, service, post};
}

test('付款POST严格要求配置站点和Origin，拒绝客户端openid/owner/非法方式，不调用后端', async t => {
  const app = setup(t);
  for (const headers of [{}, {origin: 'https://other.test'}, {origin, 'sec-fetch-site': 'cross-site'}]) assert.equal((await app.post(undefined, headers)).status, 403);
  for (const body of [{token, method: 'jsapi', openid: '0'}, {token, method: 'native', owner: 'bob'}, {token, method: 'anything'}, []]) assert.equal((await app.post(body)).status, 400);
  assert.equal(app.calls.start.length, 0);
  const response = await app.post({token, method: 'jsapi'}, {origin, cookie: '__Host-gmg-wx-session=' + session});
  assert.equal(response.status, 200); assert.deepEqual(app.calls.start[0], [token, 'jsapi', session]);
  assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('配置缺失503报告名称；未知异常不泄露内部信息；安全GET不回传owner', async t => {
  const app = setup(t);
  app.service.start = async () => {throw new WechatPayError('微信商户支付尚未配置完成', 503, 'PAYMENT_NOT_CONFIGURED', ['WECHAT_PAY_MCHID']);};
  let response = await app.post(); assert.equal(response.status, 503); assert.deepEqual((await response.json()).missing, ['WECHAT_PAY_MCHID']);
  app.service.start = async () => {throw new Error('internal mock secret and customer data');};
  response = await app.post(); assert.equal(response.status, 500); assert.equal(JSON.stringify(await response.json()).includes('mock secret'), false);
  response = await paymentApi.GET(new Request(origin + '/api/quote-payments?token=' + token));
  assert.equal(response.status, 200); assert.equal(Object.hasOwn((await response.json()).result, 'owner'), false);
  assert.equal((await paymentApi.GET(new Request('https://other.test/api/quote-payments?token=' + token))).status, 403);
});

test('支付通知不依赖登录/Origin，原样传递签名头与报文，成功204；错误签名不返回成功', async t => {
  const app = setup(t), raw = '{ "encrypted": "mock" }\n';
  const response = await notifyApi.POST(new Request(origin + '/api/wechat-pay/notify', {method: 'POST', headers: {'Wechatpay-Signature': 'mock-platform-signature'}, body: raw}));
  assert.equal(response.status, 204); assert.equal(await response.text(), ''); assert.equal(app.calls.notify[0][1], raw);
  assert.equal(app.calls.notify[0][0].get('Wechatpay-Signature'), 'mock-platform-signature');
  app.service.notify = async () => {throw new WechatPayError('fake-signature', 401);};
  const failed = await notifyApi.POST(new Request(origin + '/api/wechat-pay/notify', {method: 'POST', body: raw}));
  assert.equal(failed.status, 401); assert.equal((await failed.json()).code, 'FAIL');
});

test('OAuth仅在配置站点发起，cookie为Host/HttpOnly/Secure/Lax，callback固定回报价页', async t => {
  const app = setup(t);
  let response = await oauthApi.GET(new Request(origin + '/api/wechat-pay/oauth?token=' + token, {headers: {'sec-fetch-site': 'same-origin'}}));
  assert.equal(response.status, 302); assert.equal(response.headers.get('location'), 'https://open.weixin.qq.com/mock-only');
  assert.match(response.headers.get('set-cookie'), /__Host-gmg-wx-oauth=[a-f0-9]{64}; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax/);
  response = await oauthApi.GET(new Request(origin + '/api/wechat-pay/oauth?state=' + 'd'.repeat(64) + '&code=mock-code', {headers: {cookie: '__Host-gmg-wx-oauth=' + browser, 'sec-fetch-site': 'cross-site'}}));
  assert.equal(response.status, 302); assert.equal(response.headers.get('location'), origin + '/s/q/' + token);
  assert.match(response.headers.get('set-cookie'), /__Host-gmg-wx-session=/); assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await oauthApi.GET(new Request('https://other.test/api/wechat-pay/oauth?token=' + token))).status, 403);
});
