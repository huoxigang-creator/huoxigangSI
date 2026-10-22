import { NextRequest, NextResponse } from 'next/server';
import { rawDatabase } from '../../../lib/local-env';
import { sessionAccount, SESSION_COOKIE } from '../../../lib/local-auth';
import { normalizePhone, progressNoticeConfigured, sendProgressNotice } from '../../../lib/sms';

// 同一手机号 60 秒内不能重复发送，避免误触与费用浪费。
const sentAt = new Map<string, number>();

// 今日待办短信提醒：按任务取关联客户项目，用通知模板发送到访/测量等提醒。
// 模板变量：address（项目地址）/ stage（任务标题）/ summary（任务备注）。
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: '不允许跨站请求' }, { status: 403 });
  const account = sessionAccount(request.cookies.get(SESSION_COOKIE)?.value);
  if (!account) return NextResponse.json({ error: '请先登录' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const owner = request.headers.get('oai-authenticated-user-id');
  if (!owner) return NextResponse.json({ error: '登录信息不完整' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

  let input: { task_id?: unknown };
  try { input = await request.json(); } catch { return NextResponse.json({ error: '请求格式不正确' }, { status: 400 }); }
  const taskId = typeof input.task_id === 'string' ? input.task_id.trim() : '';
  if (!taskId || taskId.length > 128) return NextResponse.json({ error: '任务无效' }, { status: 400 });

  const task = rawDatabase.prepare("SELECT data FROM records WHERE owner = ? AND id = ? AND kind = 'task' AND COALESCE(json_extract(data, '$.deleted'), 0) = 0").get(owner, taskId) as { data: string } | undefined;
  if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  const taskData = JSON.parse(task.data) as { project?: unknown; title?: unknown; note?: unknown };
  const projectId = typeof taskData.project === 'string' && taskData.project ? taskData.project : '';
  const stageText = (typeof taskData.title === 'string' && taskData.title.trim() ? taskData.title.trim() : '跟进事项').slice(0, 30);
  const summaryText = (typeof taskData.note === 'string' && taskData.note.trim() ? taskData.note.trim() : '请保持电话畅通，如有疑问可联系门店。').slice(0, 200);
  if (!projectId) return NextResponse.json({ error: '该任务未关联客户项目，无法获取客户手机号' }, { status: 400 });

  const row = rawDatabase.prepare("SELECT data FROM records WHERE owner = ? AND id = ? AND kind = 'project' AND COALESCE(json_extract(data, '$.deleted'), 0) = 0").get(owner, projectId) as { data: string } | undefined;
  if (!row) return NextResponse.json({ error: '关联项目不存在' }, { status: 404 });
  const projectData = JSON.parse(row.data) as { phone?: unknown; name?: unknown; address?: unknown };
  const phone = normalizePhone(projectData.phone);
  if (!phone) return NextResponse.json({ error: '客户未填写手机号，请先在编辑项目中填写 11 位手机号' }, { status: 400 });
  if (!progressNoticeConfigured()) return NextResponse.json({ error: '通知短信模板未配置，请先在阿里云申请并通过通知类短信模板' }, { status: 503 });

  const last = sentAt.get(phone);
  if (last && Date.now() - last < 60_000) return NextResponse.json({ error: '短信已发送，请 60 秒后再试' }, { status: 429 });

  // 模板 address 为“地址”属性（≤30 字符）：优先项目地址，未填则回退项目名（楼盘房号）。
  const fallbackName = typeof projectData.name === 'string' ? projectData.name.trim() : '';
  const addressText = (typeof projectData.address === 'string' && projectData.address.trim() ? projectData.address.trim() : fallbackName).slice(0, 30);
  try {
    await sendProgressNotice(phone, addressText, stageText, summaryText);
    sentAt.set(phone, Date.now());
  } catch (reason) {
    return NextResponse.json({ error: reason instanceof Error ? reason.message : '短信发送失败' }, { status: 502 });
  }
  const masked = phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
  return NextResponse.json({ ok: true, phone: masked }, { headers: { 'Cache-Control': 'no-store' } });
}
