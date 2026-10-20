import { NextRequest, NextResponse } from 'next/server';
import { confirmSheetService, ConfirmSheetError } from '../../../lib/confirm-sheets';
import { generateConfirmSheetPdf } from '../../../lib/confirm-sheet-pdf';
import { env } from '../../../lib/local-env';
import { DEFAULT_COMPANY_NAME } from '../../../lib/release';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  const format = url.searchParams.get('format');
  const attachment = url.searchParams.get('attachment');
  try {
    const sheet = await confirmSheetService.read(token);
    if (format === 'pdf') {
      const bytes = await generateConfirmSheetPdf({
        company_name: DEFAULT_COMPANY_NAME,
        title: sheet.title,
        customer_name: sheet.customer_name,
        address: sheet.address,
        note: sheet.note,
        expires_at: sheet.expires_at,
        submitted_at: sheet.signature?.signed_at,
        signer_name: sheet.signature?.name,
        signer_phone: sheet.signature?.phone,
        signature_data_url: sheet.signature?.data_url,
        items: sheet.items,
        attachments: sheet.attachments,
      });
      return new NextResponse(new Uint8Array(bytes).buffer, { headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(sheet.title + '-客户确认单.pdf'),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      }});
    }
    if (attachment) {
      const found = (sheet.attachments || []).find(item => item.key === attachment);
      if (!found) return NextResponse.json({ error: '附件不存在或已失效' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
      const bucket = env.BUCKET;
      if (!bucket) return NextResponse.json({ error: '文件存储未就绪，请稍后重试' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      const object = await bucket.get(found.key);
      if (!object) return NextResponse.json({ error: '附件不存在' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
      const name = found.name.replace(/[\x00-\x1f\x7f]/g, '');
      return new NextResponse(object.body, { headers: {
        'Content-Type': found.mime || 'application/octet-stream',
        'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      }});
    }
    return NextResponse.json({ ok: true, result: sheet }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (reason) {
    if (reason instanceof ConfirmSheetError) {
      return NextResponse.json({ error: reason.message }, { status: reason.status === 404 || reason.status === 410 ? reason.status : 400, headers: { 'Cache-Control': 'no-store' } });
    }
    throw reason;
  }
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: '不允许跨站请求' }, { status: 403 });
  let input: { token?: unknown; name?: unknown; phone?: unknown; signature_data_url?: unknown; items?: unknown };
  try { input = await request.json(); } catch { return NextResponse.json({ error: '请求格式不正确' }, { status: 400 }); }
  try {
    const result = await confirmSheetService.submit(String(input.token || ''), input);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (reason) {
    if (reason instanceof ConfirmSheetError) {
      return NextResponse.json({ error: reason.message }, { status: reason.status === 409 || reason.status === 410 || reason.status === 404 ? reason.status : 400, headers: { 'Cache-Control': 'no-store' } });
    }
    if (reason instanceof Error && reason.name === 'ZodError') {
      return NextResponse.json({ error: '请完整填写每项确认意见并完成签名' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    throw reason;
  }
}
