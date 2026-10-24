import { inspectRegisterLink, submitRegister, RegisterLinkError } from '../../../lib/register-links';

const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

// 免登录：扫码页打开时校验登记链接
export async function GET(request: Request) {
  try {
    const url = new URL(request.url), token = url.searchParams.get('token') || '';
    const result = await inspectRegisterLink(token);
    return Response.json({ ok: true, result }, { headers });
  } catch (error: any) {
    const known = error instanceof RegisterLinkError;
    return Response.json({ error: known ? error.message : '链接暂时无法使用' }, { status: known ? error.status : 500, headers });
  }
}

// 免登录：客户提交资料，自动建档（同手机号合并）
export async function POST(request: Request) {
  try {
    const url = new URL(request.url), token = url.searchParams.get('token') || '';
    if ((request.headers.get('origin') && request.headers.get('origin') !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      throw new RegisterLinkError('不允许跨站操作', 403);
    }
    if (Number(request.headers.get('content-length')) > 20000) throw new RegisterLinkError('提交内容过大', 413);
    const raw = await request.text();
    if (raw.length > 20000) throw new RegisterLinkError('提交内容过大', 413);
    let body: any;
    try { body = JSON.parse(raw); } catch { throw new RegisterLinkError('提交数据无效', 400); }
    const result = await submitRegister(token, {
      name: String(body?.name ?? ''),
      customer: String(body?.customer ?? ''),
      phone: String(body?.phone ?? ''),
      address: String(body?.address ?? ''),
      note: String(body?.note ?? ''),
    });
    return Response.json({ ok: true, result }, { headers });
  } catch (error: any) {
    const known = error instanceof RegisterLinkError;
    return Response.json({ error: known ? error.message : '提交失败，请稍后重试' }, { status: known ? error.status : 500, headers });
  }
}
