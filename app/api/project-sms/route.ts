import { NextRequest, NextResponse } from 'next/server';
import { rawDatabase } from '../../../lib/local-env';
import { sessionAccount, SESSION_COOKIE } from '../../../lib/local-auth';
import { normalizePhone, progressNoticeConfigured, sendProgressNotice } from '../../../lib/sms';
import { publicProgress } from '../../../lib/project-progress';

// 同一手机号 60 秒内不能重复发送，避免误触与费用浪费。
const sentAt = new Map<string, number>();

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: '不允许跨站请求' }, { status: 403 });
  const account = sessionAccount(request.cookies.get(SESSION_COOKIE)?.value);
  if (!account) return NextResponse.json({ error: '请先登录' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const owner = request.headers.get('oai-authenticated-user-id');
  if (!owner) return NextResponse.json({ error: '登录信息不完整' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

  let input: { project_id?: unknown };
  try { input = await request.json(); } catch { return NextResponse.json({ error: '请求格式不正确' }, { status: 400 }); }
  const projectId = typeof input.project_id === 'string' ? input.project_id.trim() : '';
  if (!projectId || projectId.length > 128) return NextResponse.json({ error: '项目无效' }, { status: 400 });

  const row = rawDatabase.prepare("SELECT data FROM records WHERE owner = ? AND id = ? AND kind = 'project' AND COALESCE(json_extract(data, '$.deleted'), 0) = 0").get(owner, projectId) as { data: string } | undefined;
  if (!row) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

  const data = JSON.parse(row.data) as { phone?: unknown; name?: unknown; status?: unknown };
  const phone = normalizePhone(data.phone);
  if (!phone) return NextResponse.json({ error: '客户未填写手机号，请先在编辑项目中填写 11 位手机号' }, { status: 400 });
  if (!progressNoticeConfigured()) return NextResponse.json({ error: '通知短信模板未配置，请先在阿里云申请并通过通知类短信模板' }, { status: 503 });

  const last = sentAt.get(phone);
  if (last && Date.now() - last < 60_000) return NextResponse.json({ error: '短信已发送，请 60 秒后再试' }, { status: 429 });

  const progress = publicProgress({ name: data.name, status: data.status });
  try {
    await sendProgressNotice(phone, progress.name, progress.stage, progress.summary);
    sentAt.set(phone, Date.now());
  } catch (reason) {
    return NextResponse.json({ error: reason instanceof Error ? reason.message : '短信发送失败' }, { status: 502 });
  }
  const masked = phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
  return NextResponse.json({ ok: true, phone: masked }, { headers: { 'Cache-Control': 'no-store' } });
}
