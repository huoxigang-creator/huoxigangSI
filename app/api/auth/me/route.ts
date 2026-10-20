import { NextRequest, NextResponse } from 'next/server';
import { rawDatabase } from '../../../../lib/local-env';
import { SESSION_COOKIE, sessionAccount } from '../../../../lib/local-auth';

export async function GET(request: NextRequest) {
  const account = sessionAccount(request.cookies.get(SESSION_COOKIE)?.value);
  if (!account) return NextResponse.json({ error: '请先登录' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const row = rawDatabase.prepare('SELECT id, username, display_name, role, phone, created, updated FROM accounts WHERE id = ?').get(account.id) as { id: string; username: string; display_name: string; role: string; phone: string | null; created: string; updated: string } | undefined;
  if (!row) return NextResponse.json({ error: '账号不存在' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json(row, { headers: { 'Cache-Control': 'no-store' } });
}
