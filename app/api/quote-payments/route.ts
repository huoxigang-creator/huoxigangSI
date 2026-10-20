import {env} from '../../../lib/local-env';
import {createQuotePaymentService, WECHAT_SESSION_COOKIE} from '../../../lib/quote-payments';
import {QuoteShareError, readQuoteShareForPayment} from '../../../lib/quote-shares';
import {WechatPayError, wechatPayConfiguration, type WechatPayEnvironment} from '../../../lib/wechat-pay';

const headers = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Cookie'};
const environment = () => env as Cloudflare.Env & WechatPayEnvironment;
const service = () => createQuotePaymentService({database: () => env.DB, environment, readShare: readQuoteShareForPayment});
function origin(request: Request, mutation = false) {
  const config = wechatPayConfiguration(environment());
  if (!config.origin) throw new WechatPayError('微信支付站点地址尚未配置', 503, 'PAYMENT_NOT_CONFIGURED', config.missing);
  if (new URL(request.url).origin !== config.origin || (mutation &&
    (request.headers.get('origin') !== config.origin || request.headers.get('sec-fetch-site') === 'cross-site'))) {
    throw new WechatPayError('不允许跨站付款请求', 403, 'PAYMENT_ORIGIN_INVALID');
  }
}
function cookie(request: Request, name: string) {
  const values = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));
  return values.length === 1 ? values[0].slice(name.length + 1) : undefined;
}
function fail(error: unknown) {
  const known = error instanceof WechatPayError || error instanceof QuoteShareError;
  return Response.json({ok: false, error: known ? error.message : error instanceof SyntaxError ? '请求格式不正确' : '付款操作未完成，请稍后查询',
    code: error instanceof WechatPayError ? error.code : known ? 'SHARE_UNAVAILABLE' : 'PAYMENT_RETRY',
    ...(error instanceof WechatPayError && error.missing.length ? {missing: error.missing} : {})},
  {status: known ? error.status : error instanceof SyntaxError ? 400 : 500, headers});
}
export async function GET(request: Request) {
  try {
    origin(request); const url = new URL(request.url);
    if (url.searchParams.getAll('token').length !== 1) throw new WechatPayError('报价链接无效');
    return Response.json({ok: true, result: await service().status(url.searchParams.get('token') || '')}, {headers});
  } catch (error) {return fail(error);}
}
export async function POST(request: Request) {
  try {
    origin(request, true);
    const raw = await request.text(); if (raw.length > 4096) throw new WechatPayError('付款请求过大', 413);
    const input = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.token !== 'string' ||
      !['native', 'jsapi'].includes(input.method) || Object.keys(input).some(key => !['token', 'method'].includes(key))) {
      throw new WechatPayError('付款请求无效；微信付款身份必须通过授权获取');
    }
    return Response.json({ok: true, result: await service().start(input.token, input.method,
      cookie(request, WECHAT_SESSION_COOKIE))}, {headers});
  } catch (error) {return fail(error);}
}
