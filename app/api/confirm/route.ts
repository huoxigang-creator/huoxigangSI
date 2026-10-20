import { NextRequest, NextResponse } from 'next/server';
import { sessionAccount, SESSION_COOKIE } from '../../../lib/local-auth';
import { confirmSheetService, ConfirmSheetError } from '../../../lib/confirm-sheets';

const responseHeaders = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: '不允许跨站请求' }, { status: 403, headers: responseHeaders });
  const account = sessionAccount(request.cookies.get(SESSION_COOKIE)?.value);
  if (!account) return NextResponse.json({ error: '请先登录' }, { status: 401, headers: responseHeaders });
  const owner = request.headers.get('oai-authenticated-user-id');
  if (!owner) return NextResponse.json({ error: '登录信息不完整' }, { status: 401, headers: responseHeaders });

  let input: { action?: unknown; args?: unknown };
  try { input = await request.json(); } catch { return NextResponse.json({ error: '请求格式不正确' }, { status: 400, headers: responseHeaders }); }
  const action = typeof input.action === 'string' ? input.action : '';
  const args = input.args ?? {};
  try {
    if (action === 'create') {
      const sheet = await confirmSheetService.create(owner, args, request.nextUrl.origin);
      return NextResponse.json({ ok: true, result: sheet }, { headers: responseHeaders });
    }
    if (action === 'list') {
      const sheets = await confirmSheetService.list(owner, (args as Record<string, unknown>).project_id, request.nextUrl.origin);
      return NextResponse.json({ ok: true, result: sheets }, { headers: responseHeaders });
    }
    if (action === 'detail') {
      const detail = await confirmSheetService.detail(owner, (args as Record<string, unknown>).id);
      return NextResponse.json({ ok: true, result: detail }, { headers: responseHeaders });
    }
    if (action === 'revoke') {
      const result = await confirmSheetService.revoke(owner, (args as Record<string, unknown>).id);
      return NextResponse.json({ ok: true, result }, { headers: responseHeaders });
    }
    return NextResponse.json({ error: '操作无效' }, { status: 400, headers: responseHeaders });
  } catch (reason) {
    if (reason instanceof ConfirmSheetError) return NextResponse.json({ error: reason.message }, { status: reason.status, headers: responseHeaders });
    if (reason instanceof Error && reason.name === 'ZodError') {
      return NextResponse.json({ error: '输入不合法，请检查填写内容' }, { status: 400, headers: responseHeaders });
    }
    throw reason;
  }
}
