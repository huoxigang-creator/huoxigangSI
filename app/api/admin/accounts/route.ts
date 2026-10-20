import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { rawDatabase } from '../../../../lib/local-env';
import { sessionAccount, SESSION_COOKIE } from '../../../../lib/local-auth';
import { normalizePhone, phoneTaken } from '../../../../lib/sms';

const responseHeaders = { 'Cache-Control': 'no-store' };
const usernamePattern = /^[a-z0-9._-]{3,64}$/;

function owner(request: NextRequest) {
  return sessionAccount(request.cookies.get(SESSION_COOKIE)?.value)?.role === 'owner';
}

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: responseHeaders });
}

export async function GET(request: NextRequest) {
  if (!owner(request)) return error('仅老板可管理员工账号', 403);
  const accounts = rawDatabase.prepare("SELECT id, username, display_name, active, phone, created, updated FROM accounts WHERE role = 'employee' ORDER BY created, username").all();
  const ownerAccount = rawDatabase.prepare("SELECT id, username, display_name, phone FROM accounts WHERE role = 'owner' LIMIT 1").get();
  return NextResponse.json({ accounts, owner: ownerAccount }, { headers: responseHeaders });
}

export async function POST(request: NextRequest) {
  if (!owner(request)) return error('仅老板可管理员工账号', 403);
  if (request.headers.get('origin') !== request.nextUrl.origin) return error('不允许跨站请求', 403);
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return error('请求格式不正确', 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return error('请求格式不正确', 400);

  if (input.action === 'create') {
    const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
    const displayName = typeof input.display_name === 'string' ? input.display_name.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const phone = input.phone == null || input.phone === '' ? null : normalizePhone(input.phone);
    if (!usernamePattern.test(username)) return error('账号需为3至64位小写字母、数字、点、横线或下划线', 400);
    if (!displayName || displayName.length > 80) return error('请填写80字以内的员工姓名', 400);
    if (password.length < 12 || password.length > 1024) return error('密码至少12位', 400);
    if (input.phone != null && input.phone !== '' && !phone) return error('手机号格式不正确', 400);
    if (phone && phoneTaken(phone)) return error('该手机号已绑定其他账号', 409);
    const salt = randomBytes(32);
    const hash = scryptSync(password, salt, 64);
    const now = new Date().toISOString();
    try {
      rawDatabase.prepare("INSERT INTO accounts(id, username, display_name, role, password_hash, salt, active, created, updated, phone) VALUES(?,?,?,'employee',?,?,1,?,?,?)")
        .run(randomUUID(), username, displayName, hash.toString('hex'), salt.toString('hex'), now, now, phone);
    } catch (reason) {
      if (String(reason).includes('UNIQUE')) return error('该账号已存在', 409);
      throw reason;
    }
    return NextResponse.json({ ok: true }, { headers: responseHeaders });
  }

  if (input.action === 'set_active') {
    const id = typeof input.id === 'string' ? input.id : '';
    if (!/^[0-9a-f-]{36}$/i.test(id) || typeof input.active !== 'boolean') return error('账号或状态无效', 400);
    const result = rawDatabase.prepare("UPDATE accounts SET active = ?, updated = ? WHERE id = ? AND role = 'employee'")
      .run(input.active ? 1 : 0, new Date().toISOString(), id);
    if (!result.changes) return error('员工账号不存在', 404);
    return NextResponse.json({ ok: true }, { headers: responseHeaders });
  }

  if (input.action === 'reset_password') {
    const id = typeof input.id === 'string' ? input.id : '';
    const password = typeof input.password === 'string' ? input.password : '';
    if (!/^[0-9a-f-]{36}$/i.test(id) || password.length < 12 || password.length > 1024) return error('账号无效或密码不足12位', 400);
    const salt = randomBytes(32);
    const hash = scryptSync(password, salt, 64);
    const result = rawDatabase.prepare("UPDATE accounts SET password_hash = ?, salt = ?, updated = ? WHERE id = ? AND role = 'employee'")
      .run(hash.toString('hex'), salt.toString('hex'), new Date().toISOString(), id);
    if (!result.changes) return error('员工账号不存在', 404);
    return NextResponse.json({ ok: true }, { headers: responseHeaders });
  }

  if (input.action === 'set_phone') {
    const id = typeof input.id === 'string' ? input.id : '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) return error('账号无效', 400);
    const phone = input.phone == null || input.phone === '' ? null : normalizePhone(input.phone);
    if (input.phone != null && input.phone !== '' && !phone) return error('手机号格式不正确', 400);
    if (phone && phoneTaken(phone, id)) return error('该手机号已绑定其他账号', 409);
    const result = rawDatabase.prepare('UPDATE accounts SET phone = ?, updated = ? WHERE id = ?')
      .run(phone, new Date().toISOString(), id);
    if (!result.changes) return error('账号不存在', 404);
    return NextResponse.json({ ok: true }, { headers: responseHeaders });
  }
  return error('操作无效', 400);
}
