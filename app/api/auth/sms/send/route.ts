import { NextRequest, NextResponse } from 'next/server';
import { accountByPhone, canRequestCode, issueCode, normalizePhone, sendSmsCode, smsConfigured } from '../../../../../lib/sms';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: '不允许跨站请求' }, { status: 403 });
  let input: { phone?: unknown; purpose?: unknown };
  try { input = await request.json(); } catch { return NextResponse.json({ error: '请求格式不正确' }, { status: 400 }); }
  const phone = normalizePhone(input.phone);
  const purpose = input.purpose === 'login' || input.purpose === 'reset' ? input.purpose : null;
  if (!phone) return NextResponse.json({ error: '请输入正确的手机号' }, { status: 400 });
  if (!purpose) return NextResponse.json({ error: '用途无效' }, { status: 400 });
  const account = accountByPhone(phone);
  if (!account || account.active !== 1) return NextResponse.json({ error: '该手机号未绑定账号' }, { status: 404 });
  const throttle = canRequestCode(phone, purpose);
  if (!throttle.ok) return NextResponse.json({ error: throttle.message }, { status: 429 });
  if (!smsConfigured()) return NextResponse.json({ error: '短信服务未配置，请联系管理员在服务器上配置 sms.env' }, { status: 503 });
  const code = issueCode(phone, purpose);
  try {
    await sendSmsCode(phone, code);
  } catch (reason) {
    return NextResponse.json({ error: reason instanceof Error ? reason.message : '短信发送失败' }, { status: 502 });
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
