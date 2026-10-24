import { inspectRegisterLink, RegisterLinkError } from '../../../lib/register-links';
import { recognizeTextLines, aliyunOcrConfigured, ALIYUN_OCR_SETUP_HINT } from '../../../lib/aliyun-ocr';
import { parseCustomerOcrFields } from '../../../lib/customer-ocr-fields';

const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

// 免登录：客户扫码建档页上传截图/照片，OCR 识别后返回姓名/电话/地址等字段候选，由客户核对后随表单提交。
export async function POST(request: Request) {
  try {
    const url = new URL(request.url), token = url.searchParams.get('token') || '';
    await inspectRegisterLink(token);
    if ((request.headers.get('origin') && request.headers.get('origin') !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      throw new RegisterLinkError('不允许跨站操作', 403);
    }
    if (!aliyunOcrConfigured()) return Response.json({ error: ALIYUN_OCR_SETUP_HINT, configured: false }, { status: 503, headers });
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) return Response.json({ error: '请选择一张图片' }, { status: 400, headers });
    if (!file.size || file.size > 10 * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type)) {
      return Response.json({ error: '请选择 10MB 以内的 PNG、JPEG 或 WebP 图片' }, { status: 400, headers });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const lines = await recognizeTextLines(bytes);
    const fields = parseCustomerOcrFields(lines);
    return Response.json({ ok: true, result: { fields, lines: lines.slice(0, 60) } }, { headers });
  } catch (error: any) {
    const known = error instanceof RegisterLinkError;
    return Response.json({ error: known ? error.message : (error instanceof Error ? error.message : '识别失败，请重试') }, { status: known ? error.status : 502, headers });
  }
}
