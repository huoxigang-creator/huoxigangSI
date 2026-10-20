import {env} from '../../../../lib/local-env';
import {createQuotePaymentService, WECHAT_OAUTH_COOKIE, WECHAT_SESSION_COOKIE} from '../../../../lib/quote-payments';
import {QuoteShareError, readQuoteShareForPayment} from '../../../../lib/quote-shares';
import {randomWechatToken, WechatPayError, wechatPayConfiguration, type WechatPayEnvironment} from '../../../../lib/wechat-pay';

function cookie(request: Request, name: string) {
  const values = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));
  return values.length === 1 ? values[0].slice(name.length + 1) : '';
}
const cookieValue = (name: string, value: string, seconds: number) => `${name}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;
export async function GET(request: Request) {
  const headers = new Headers({'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', Vary: 'Cookie'});
  try {
    const environment = env as Cloudflare.Env & WechatPayEnvironment, config = wechatPayConfiguration(environment);
    if (!config.jsapi_configured) throw new WechatPayError('微信内付款授权尚未配置', 503, 'PAYMENT_NOT_CONFIGURED', config.jsapi_missing);
    const url = new URL(request.url);
    if (url.origin !== config.origin) throw new WechatPayError('不允许跨站微信授权', 403, 'PAYMENT_ORIGIN_INVALID');
    const service = createQuotePaymentService({database: () => env.DB, environment: () => environment, readShare: readQuoteShareForPayment});
    if (url.searchParams.has('state') || url.searchParams.has('code')) {
      if (url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length !== 1) throw new WechatPayError('微信授权回调无效', 400, 'WECHAT_AUTH_INVALID');
      const result = await service.finishOAuth(url.searchParams.get('state') || '', url.searchParams.get('code') || '', cookie(request, WECHAT_OAUTH_COOKIE));
      headers.append('Set-Cookie', cookieValue(WECHAT_OAUTH_COOKIE, '', 0));
      headers.append('Set-Cookie', cookieValue(WECHAT_SESSION_COOKIE, result.sessionToken, 3600));
      headers.set('Location', config.origin + '/s/q/' + result.token);
    } else {
      if (url.searchParams.getAll('token').length !== 1 || request.headers.get('sec-fetch-site') === 'cross-site' ||
        (request.headers.has('origin') && request.headers.get('origin') !== config.origin)) throw new WechatPayError('微信授权请求无效', 403, 'PAYMENT_ORIGIN_INVALID');
      const secret = randomWechatToken(), result = await service.beginOAuth(url.searchParams.get('token') || '', secret);
      headers.append('Set-Cookie', cookieValue(WECHAT_OAUTH_COOKIE, secret, 600));
      headers.set('Location', result.url);
    }
    return new Response(null, {status: 302, headers});
  } catch (error) {
    const known = error instanceof WechatPayError || error instanceof QuoteShareError;
    return Response.json({ok: false, error: known ? error.message : '微信授权未完成，请重新打开报价页面',
      code: error instanceof WechatPayError ? error.code : known ? 'SHARE_UNAVAILABLE' : 'WECHAT_AUTH_INVALID',
      ...(error instanceof WechatPayError && error.missing.length ? {missing: error.missing} : {})},
      {status: known ? error.status : 500, headers});
  }
}
