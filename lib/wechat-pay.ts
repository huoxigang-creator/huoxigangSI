/** WeChat Pay APIv3. Credentials are runtime bindings, never client data. */
export type WechatPayEnvironment = Partial<Record<
  'WECHAT_PAY_MCHID' | 'WECHAT_PAY_APPID' | 'WECHAT_PAY_MERCHANT_SERIAL' |
  'WECHAT_PAY_PRIVATE_KEY' | 'WECHAT_PAY_API_V3_KEY' | 'WECHAT_PAY_PUBLIC_KEY_ID' |
  'WECHAT_PAY_PUBLIC_KEY' | 'WECHAT_APP_SECRET' | 'SITE_ORIGIN', string>>;

const REQUIRED = ['WECHAT_PAY_MCHID', 'WECHAT_PAY_APPID', 'WECHAT_PAY_MERCHANT_SERIAL',
  'WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_API_V3_KEY', 'WECHAT_PAY_PUBLIC_KEY_ID',
  'WECHAT_PAY_PUBLIC_KEY', 'SITE_ORIGIN'] as const;
const encoder = new TextEncoder();
const MAX_BODY = 1048576;
// Matches the official PHP SDK's 300-second absolute timestamp tolerance.
export const WECHAT_SIGNATURE_TOLERANCE_SECONDS = 300;

export class WechatPayError extends Error {
  constructor(message: string, public status = 400, public code = 'PAYMENT_INVALID',
    public missing: string[] = []) { super(message); }
}

function pem(value: string) { return value.replace(/\\n/g, '\n').trim(); }
export function wechatPayConfiguration(environment: WechatPayEnvironment) {
  const missing: string[] = REQUIRED.filter(key => !environment[key]?.trim());
  const invalid = (key: typeof REQUIRED[number], valid: boolean) => {
    if (environment[key]?.trim() && !valid && !missing.includes(key)) missing.push(key);
  };
  invalid('WECHAT_PAY_MCHID', /^\d{8,20}$/.test(environment.WECHAT_PAY_MCHID || ''));
  invalid('WECHAT_PAY_APPID', /^wx[A-Za-z0-9]{16}$/.test(environment.WECHAT_PAY_APPID || ''));
  invalid('WECHAT_PAY_MERCHANT_SERIAL', /^[A-Fa-f0-9]{32,64}$/.test(environment.WECHAT_PAY_MERCHANT_SERIAL || ''));
  invalid('WECHAT_PAY_PUBLIC_KEY_ID', /^PUB_KEY_ID_[A-Za-z0-9]+$/.test(environment.WECHAT_PAY_PUBLIC_KEY_ID || ''));
  invalid('WECHAT_PAY_API_V3_KEY', /^[\x21-\x7e]{32}$/.test(environment.WECHAT_PAY_API_V3_KEY || ''));
  invalid('WECHAT_PAY_PRIVATE_KEY', pem(environment.WECHAT_PAY_PRIVATE_KEY || '').includes('-----BEGIN PRIVATE KEY-----'));
  invalid('WECHAT_PAY_PUBLIC_KEY', pem(environment.WECHAT_PAY_PUBLIC_KEY || '').includes('-----BEGIN PUBLIC KEY-----'));
  let origin = '';
  try {
    const url = new URL(environment.SITE_ORIGIN || '');
    if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) origin = url.origin;
  } catch { /* Report the binding name only. */ }
  invalid('SITE_ORIGIN', Boolean(origin));
  return { configured: missing.length === 0, missing, origin,
    jsapi_configured: missing.length === 0 && Boolean(environment.WECHAT_APP_SECRET?.trim()),
    jsapi_missing: [...missing, ...(!environment.WECHAT_APP_SECRET?.trim() ? ['WECHAT_APP_SECRET'] : [])] };
}

export function randomWechatToken(bytes = 32) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), value => value.toString(16).padStart(2, '0')).join('');
}
export async function wechatTokenHash(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
function base64(bytes: ArrayBuffer | Uint8Array) {
  return btoa(Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), byte => String.fromCharCode(byte)).join(''));
}
function unbase64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error('Invalid base64');
  return Uint8Array.from(atob(value), byte => byte.charCodeAt(0));
}
function pemBytes(value: string, kind: 'PRIVATE' | 'PUBLIC') {
  const normalized = pem(value);
  const match = new RegExp('^-----BEGIN ' + kind + ' KEY-----\\s+([A-Za-z0-9+/=\\s]+)-----END ' + kind + ' KEY-----$').exec(normalized);
  if (!match) throw new Error('Invalid key format');
  return unbase64(match[1].replace(/\s/g, ''));
}

export type WechatPaymentOrder = {
  out_trade_no: string; amount: number; description: string; expires_at: string;
};
export type WechatTransaction = {
  appid: string; mchid: string; out_trade_no: string; transaction_id: string;
  trade_state: string; success_time: string; trade_type?: string;
  amount: { total: number; currency: string; payer_total?: number; payer_currency?: string };
};

export function createWechatPayAdapter(environment: WechatPayEnvironment,
  options: { fetch?: typeof fetch; now?: () => number } = {}) {
  const config = wechatPayConfiguration(environment);
  const requestFetch = options.fetch || fetch;
  const now = options.now || Date.now;
  let privateKey: Promise<CryptoKey> | undefined;
  let publicKey: Promise<CryptoKey> | undefined;
  let encryptionKey: Promise<CryptoKey> | undefined;
  function requireConfiguration(jsapi = false) {
    const missing = jsapi ? config.jsapi_missing : config.missing;
    if (missing.length) throw new WechatPayError('微信商户支付尚未配置完成', 503, 'PAYMENT_NOT_CONFIGURED', missing);
  }
  function key(kind: 'private' | 'public' | 'encryption') {
    requireConfiguration();
    if (kind === 'encryption') return encryptionKey ||= crypto.subtle.importKey('raw', encoder.encode(environment.WECHAT_PAY_API_V3_KEY!), 'AES-GCM', false, ['encrypt', 'decrypt']);
    if (kind === 'private') return privateKey ||= crypto.subtle.importKey('pkcs8', pemBytes(environment.WECHAT_PAY_PRIVATE_KEY!, 'PRIVATE'), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    return publicKey ||= crypto.subtle.importKey('spki', pemBytes(environment.WECHAT_PAY_PUBLIC_KEY!, 'PUBLIC'), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  }
  async function sign(message: string) {
    try { return base64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await key('private'), encoder.encode(message))); }
    catch (error) {
      if (error instanceof WechatPayError) throw error;
      throw new WechatPayError('微信商户签名配置无效', 503, 'PAYMENT_NOT_CONFIGURED', ['WECHAT_PAY_PRIVATE_KEY']);
    }
  }
  async function verify(headers: Headers, raw: string) {
    requireConfiguration();
    const timestamp = headers.get('Wechatpay-Timestamp') || '';
    const nonce = headers.get('Wechatpay-Nonce') || '';
    const signature = headers.get('Wechatpay-Signature') || '';
    if (headers.get('Wechatpay-Serial') !== environment.WECHAT_PAY_PUBLIC_KEY_ID ||
      !/^\d{1,12}$/.test(timestamp) || !nonce || nonce.length > 128 || signature.length > 2048 ||
      signature.startsWith('WECHATPAY/SIGNTEST/') ||
      Math.abs(Math.floor(now() / 1000) - Number(timestamp)) > WECHAT_SIGNATURE_TOLERANCE_SECONDS) {
      throw new WechatPayError('微信支付通知签名或时间无效', 401, 'WECHAT_SIGNATURE_INVALID');
    }
    try {
      const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await key('public'), unbase64(signature), encoder.encode(`${timestamp}\n${nonce}\n${raw}\n`));
      if (!valid) throw new Error('Invalid signature');
    } catch (error) {
      if (error instanceof WechatPayError) throw error;
      throw new WechatPayError('微信支付签名校验未通过', 401, 'WECHAT_SIGNATURE_INVALID');
    }
  }
  async function request(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<any> {
    requireConfiguration();
    const raw = body === undefined ? '' : JSON.stringify(body);
    const timestamp = String(Math.floor(now() / 1000)), nonce = randomWechatToken(16);
    const signature = await sign(`${method}\n${path}\n${timestamp}\n${nonce}\n${raw}\n`);
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${environment.WECHAT_PAY_MCHID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${environment.WECHAT_PAY_MERCHANT_SERIAL}",signature="${signature}"`;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await requestFetch('https://api.mch.weixin.qq.com' + path, {
        method, headers: { Authorization: authorization, Accept: 'application/json',
          'Content-Type': 'application/json', 'Wechatpay-Serial': environment.WECHAT_PAY_PUBLIC_KEY_ID! },
        ...(body === undefined ? {} : { body: raw }), signal: controller.signal, redirect: 'error',
      });
      const responseRaw = await response.text();
      if (responseRaw.length > MAX_BODY) throw new WechatPayError('微信支付响应无效', 502, 'WECHAT_RESPONSE_INVALID');
      try { await verify(response.headers, responseRaw); }
      catch { throw new WechatPayError('微信支付响应签名校验未通过', 502, 'WECHAT_RESPONSE_INVALID'); }
      if (!response.ok) throw new WechatPayError('微信支付暂未接受该请求，请稍后重试', response.status === 429 ? 503 : 502, 'WECHAT_API_ERROR');
      try { return JSON.parse(responseRaw); }
      catch { throw new WechatPayError('微信支付响应格式无效', 502, 'WECHAT_RESPONSE_INVALID'); }
    } catch (error) {
      if (error instanceof WechatPayError) throw error;
      throw new WechatPayError('暂时无法连接微信支付，请稍后重试', 503, 'WECHAT_UNAVAILABLE');
    } finally { clearTimeout(timeout); }
  }
  function paymentBody(order: WechatPaymentOrder) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(order.out_trade_no) || !Number.isSafeInteger(order.amount) || order.amount < 1 || order.amount > 10000000000 ||
      !order.description || encoder.encode(order.description).length > 127 || !Number.isFinite(Date.parse(order.expires_at))) {
      throw new WechatPayError('付款订单无效');
    }
    return { appid: environment.WECHAT_PAY_APPID!, mchid: environment.WECHAT_PAY_MCHID!,
      description: order.description, out_trade_no: order.out_trade_no, time_expire: order.expires_at,
      notify_url: config.origin + '/api/wechat-pay/notify', amount: { total: order.amount, currency: 'CNY' } };
  }
  async function createNative(order: WechatPaymentOrder) {
    const result = await request('POST', '/v3/pay/transactions/native', paymentBody(order));
    if (typeof result.code_url !== 'string' || result.code_url.length > 512 || !/^weixin:\/\/wxpay\/bizpayurl(?:\/|\?)/.test(result.code_url)) {
      throw new WechatPayError('微信支付未返回有效付款码', 502, 'WECHAT_RESPONSE_INVALID');
    }
    return { code_url: result.code_url };
  }
  async function createJsapi(order: WechatPaymentOrder, trustedOpenid: string) {
    requireConfiguration(true);
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(trustedOpenid)) throw new WechatPayError('微信支付身份无效', 401, 'WECHAT_AUTH_REQUIRED');
    const result = await request('POST', '/v3/pay/transactions/jsapi', { ...paymentBody(order), payer: { openid: trustedOpenid } });
    if (typeof result.prepay_id !== 'string' || !/^wx[A-Za-z0-9_-]{1,200}$/.test(result.prepay_id)) throw new WechatPayError('微信预支付订单无效', 502, 'WECHAT_RESPONSE_INVALID');
    const timeStamp = String(Math.floor(now() / 1000)), nonceStr = randomWechatToken(16), packageValue = 'prepay_id=' + result.prepay_id;
    return { jsapi_params: { appId: environment.WECHAT_PAY_APPID!, timeStamp, nonceStr, package: packageValue,
      signType: 'RSA', paySign: await sign(`${environment.WECHAT_PAY_APPID}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`) } };
  }
  async function query(outTradeNo: string): Promise<WechatTransaction> {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(outTradeNo)) throw new WechatPayError('付款订单无效');
    return request('GET', '/v3/pay/transactions/out-trade-no/' + outTradeNo + '?mchid=' + environment.WECHAT_PAY_MCHID);
  }
  async function decodeNotification(headers: Headers, raw: string): Promise<WechatTransaction> {
    if (raw.length > MAX_BODY) throw new WechatPayError('通知内容过大', 413);
    await verify(headers, raw);
    let notification: any;
    try { notification = JSON.parse(raw); }
    catch { throw new WechatPayError('微信通知格式无效'); }
    if (notification.event_type !== 'TRANSACTION.SUCCESS' || notification.resource_type !== 'encrypt-resource' ||
      notification.resource?.algorithm !== 'AEAD_AES_256_GCM' || notification.resource?.original_type !== 'transaction' ||
      typeof notification.resource?.nonce !== 'string' || typeof notification.resource?.ciphertext !== 'string') throw new WechatPayError('微信通知类型无效');
    try {
      const resource = notification.resource;
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: encoder.encode(resource.nonce),
        additionalData: encoder.encode(resource.associated_data || ''), tagLength: 128 }, await key('encryption'), unbase64(resource.ciphertext));
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decrypted));
    } catch { throw new WechatPayError('微信通知解密未通过', 400, 'WECHAT_DECRYPT_INVALID'); }
  }
  // Short-lived encrypted OAuth state contains a share bearer token only on the server.
  async function seal(value: string) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce,
      additionalData: encoder.encode('gmg-wechat-oauth-state-v1') }, await key('encryption'), encoder.encode(value));
    return { nonce: base64(nonce), ciphertext: base64(encrypted) };
  }
  async function open(value: { nonce: string; ciphertext: string }) {
    try {
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(value.nonce),
        additionalData: encoder.encode('gmg-wechat-oauth-state-v1') }, await key('encryption'), unbase64(value.ciphertext));
      return new TextDecoder('utf-8', { fatal: true }).decode(decrypted);
    } catch { throw new WechatPayError('微信授权状态无效', 401, 'WECHAT_AUTH_INVALID'); }
  }
  return { configuration: config, requireConfiguration, createNative, createJsapi, query, verify, decodeNotification, seal, open };
}
