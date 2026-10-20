import { NextRequest, NextResponse } from 'next/server';
import { issueSession, SESSION_COOKIE, verifyPassword } from '../../../../lib/local-auth';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: '不允许跨站请求' }, { status: 403 });
  let input: { username?: string; password?: string };
  try { input = await request.json(); } catch { return NextResponse.json({ error: '请求格式不正确' }, { status: 400 }); }
  const account = verifyPassword(input.username?.trim() || '', input.password || '');
  if (!account) return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
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
