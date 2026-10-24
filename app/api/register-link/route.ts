import { createRegisterLink, RegisterLinkError } from '../../../lib/register-links';
import { DEFAULT_COMPANY_NAME } from '../../../lib/release';

// 登录态：生成"客户扫码建档"登记链接（供管理端二维码使用）
export async function POST(request: Request) {
  try {
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner) return Response.json({ error: '请登录后使用' }, { status: 401 });
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: '不允许跨站请求' }, { status: 403 });
    const body = await request.json().catch(() => null) as any;
    const source = typeof body?.source === 'string' && body.source ? String(body.source).trim().slice(0, 20) : '';
    const result = await createRegisterLink(owner, source, DEFAULT_COMPANY_NAME);
    return Response.json({ ok: true, result });
  } catch (error: any) {
    const known = error instanceof RegisterLinkError;
    console.error('[register-link-err]', error);
    return Response.json({ error: known ? error.message : '生成失败，请稍后重试' }, { status: known ? error.status : 500 });
  }
}
