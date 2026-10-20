import { NextRequest, NextResponse } from 'next/server';
import { accountByPhone, consumeCode, normalizePhone } from '../../../../../lib/sms';
import { issueSession, SESSION_COOKIE } from '../../../../../lib/local-auth';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: '不允许跨站请求' }, { status: 403 });
  let input: { phone?: unknown; code?: unknown };
  try { input = await request.json(); } catch { return NextResponse.json({ error: '请求格式不正确' }, { status: 400 }); }
  const phone = normalizePhone(input.phone);
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  if (!phone || !/^\d{6}$/.test(code)) return NextResponse.json({ error: '手机号或验证码不正确' }, { status: 400 });
  if (!consumeCode(phone, 'login', code)) return NextResponse.json({ error: '验证码错误或已过期' }, { status: 401 });
  const account = accountByPhone(phone);
  if (!account || account.active !== 1) return NextResponse.json({ error: '该手机号未绑定可用账号' }, { status: 404 });
  const response = NextResponse.json({ ok: true, role: account.role });
  response.cookies.set(SESSION_COOKIE, issueSession(account), {
    httpOnly: true,
    secure: process.env.GUGEMEI_SECURE_COOKIE === 'true',
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
