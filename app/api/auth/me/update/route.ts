import { NextRequest, NextResponse } from 'next/server';
import { rawDatabase } from '../../../../../lib/local-env';
import { issueSession, SESSION_COOKIE, sessionAccount } from '../../../../../lib/local-auth';
import { normalizePhone, phoneTaken } from '../../../../../lib/sms';

const usernamePattern = /^[a-z0-9._-]{3,64}$/;

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: '不允许跨站请求' }, { status: 403 });
  const account = sessionAccount(request.cookies.get(SESSION_COOKIE)?.value);
  if (!account) return NextResponse.json({ error: '请先登录' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  let input: { username?: unknown; display_name?: unknown; phone?: unknown };
  try { input = await request.json(); } catch { return NextResponse.json({ error: '请求格式不正确' }, { status: 400 }); }

  const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
  const displayName = typeof input.display_name === 'string' ? input.display_name.trim() : '';
  const phoneRaw = input.phone == null || input.phone === '' ? null : String(input.phone).trim();
  const phone = phoneRaw == null ? null : normalizePhone(phoneRaw);
  if (!usernamePattern.test(username)) return NextResponse.json({ error: '用户名需为3至64位小写字母、数字、点、横线或下划线' }, { status: 400 });
  if (!displayName || displayName.length > 80) return NextResponse.json({ error: '请填写80字以内的姓名' }, { status: 400 });
  if (phoneRaw != null && !phone) return NextResponse.json({ error: '手机号格式不正确' }, { status: 400 });
  if (phone && phoneTaken(phone, account.id)) return NextResponse.json({ error: '该手机号已绑定其他账号' }, { status: 409 });

  try {
    rawDatabase.prepare('UPDATE accounts SET username = ?, display_name = ?, phone = ?, updated = ? WHERE id = ?')
      .run(username, displayName, phone, new Date().toISOString(), account.id);
  } catch (reason) {
    if (String(reason).includes('UNIQUE')) return NextResponse.json({ error: '该用户名已被占用' }, { status: 409 });
    throw reason;
  }

  // updated 变更使旧会话失效，重新签发会话保持登录
  const refreshed = sessionAccount(request.cookies.get(SESSION_COOKIE)?.value);
  if (!refreshed) return NextResponse.json({ error: '资料已更新，请重新登录' }, { status: 401 });
  const response = NextResponse.json({ ok: true, account: { id: refreshed.id, username: refreshed.username, display_name: refreshed.display_name, role: refreshed.role, phone } }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(SESSION_COOKIE, issueSession(refreshed), {
    httpOnly: true,
    secure: process.env.GUGEMEI_SECURE_COOKIE === 'true',
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60,
  });
  return response;
}
