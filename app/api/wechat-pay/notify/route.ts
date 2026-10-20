import {env} from '../../../../lib/local-env';
import {createQuotePaymentService} from '../../../../lib/quote-payments';
import {readQuoteShareForPayment} from '../../../../lib/quote-shares';
import {WechatPayError, wechatPayConfiguration, type WechatPayEnvironment} from '../../../../lib/wechat-pay';

const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
export async function POST(request: Request) {
  try {
    const environment = env as Cloudflare.Env & WechatPayEnvironment;
    const configuration = wechatPayConfiguration(environment);
    if (!configuration.configured) throw new WechatPayError('微信支付尚未配置', 503);
    if (new URL(request.url).origin !== configuration.origin) throw new WechatPayError('通知地址无效', 403);
    if (Number(request.headers.get('content-length') || 0) > 1048576) throw new WechatPayError('通知内容过大', 413);
    const raw = await request.text();
    // No browser identity or Origin requirement: only the verified WeChat
    // signature can authorize this public callback. Never parse/re-serialize raw.
    await createQuotePaymentService({database: () => env.DB, environment: () => environment,
      readShare: readQuoteShareForPayment}).notify(request.headers, raw);
    return new Response(null, {status: 204, headers});
  } catch (error) {
    return Response.json({code: 'FAIL', message: '通知尚未确认，请重试'},
      {status: error instanceof WechatPayError ? error.status : 500, headers});
  }
}
