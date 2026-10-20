import { randomBytes, scryptSync } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { rawDatabase } from '../../../../lib/local-env';
import { accountByPhone, consumeCode, normalizePhone } from '../../../../lib/sms';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: '不允许跨站请求' }, { status: 403 });
  let input: { phone?: unknown; code?: unknown; password?: unknown };
  try { input = await request.json(); } catch { return NextResponse.json({ error: '请求格式不正确' }, { status: 400 }); }
  const phone = normalizePhone(input.phone);
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!phone || !/^\d{6}$/.test(code)) return NextResponse.json({ error: '手机号或验证码不正确' }, { status: 400 });
  if (password.length < 12 || password.length > 1024) return NextResponse.json({ error: '新密码至少 12 位' }, { status: 400 });
  if (!consumeCode(phone, 'reset', code)) return NextResponse.json({ error: '验证码错误或已过期' }, { status: 401 });
  const account = accountByPhone(phone);
  if (!account || account.active !== 1) return NextResponse.json({ error: '该手机号未绑定可用账号' }, { status: 404 });
  const salt = randomBytes(32);
  const hash = scryptSync(password, salt, 64);
  rawDatabase.prepare('UPDATE accounts SET password_hash = ?, salt = ?, updated = ? WHERE id = ?')
    .run(hash.toString('hex'), salt.toString('hex'), new Date().toISOString(), account.id);
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
