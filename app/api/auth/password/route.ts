import { randomBytes, scryptSync } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { rawDatabase } from '../../../../lib/local-env';
import { issueSession, SESSION_COOKIE, sessionAccount, verifyPassword } from '../../../../lib/local-auth';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: '不允许跨站请求' }, { status: 403 });
  const account = sessionAccount(request.cookies.get(SESSION_COOKIE)?.value);
  if (!account) return NextResponse.json({ error: '请先登录' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  let input: { old_password?: unknown; password?: unknown };
  try { input = await request.json(); } catch { return NextResponse.json({ error: '请求格式不正确' }, { status: 400 }); }
  const oldPassword = typeof input.old_password === 'string' ? input.old_password : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!oldPassword) return NextResponse.json({ error: '请填写当前密码' }, { status: 400 });
  if (password.length < 12 || password.length > 1024) return NextResponse.json({ error: '新密码至少 12 位' }, { status: 400 });
  const verified = verifyPassword(account.username, oldPassword);
  if (!verified || verified.id !== account.id) return NextResponse.json({ error: '当前密码不正确' }, { status: 401 });

  const salt = randomBytes(32);
  const hash = scryptSync(password, salt, 64);
  rawDatabase.prepare('UPDATE accounts SET password_hash = ?, salt = ?, updated = ? WHERE id = ?')
    .run(hash.toString('hex'), salt.toString('hex'), new Date().toISOString(), account.id);

  // updated 变更使旧会话失效，重新签发会话保持登录
  const refreshed = rawDatabase.prepare('SELECT id,username,display_name,role,active,updated FROM accounts WHERE id=? AND active=1').get(account.id) as typeof account;
  if (!refreshed) return NextResponse.json({ error: '密码已修改，请重新登录' }, { status: 401 });
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(SESSION_COOKIE, issueSession(refreshed), {
    httpOnly: true,
    secure: process.env.GUGEMEI_SECURE_COOKIE === 'true',
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60,
  });
  return response;
}
