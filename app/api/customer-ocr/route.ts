import { aliyunOcrConfigured, recognizeTextLines, ALIYUN_OCR_SETUP_HINT } from '../../../lib/aliyun-ocr';
import { parseCustomerOcrFields } from '../../../lib/customer-ocr-fields';

const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

// 登录态：管理端「图片识别建档」——接收一张订单照片/截图，调用阿里云文字识别 OCR，
// 返回六个核心字段候选与识别原文行；前端只展示核对清单，写入仍由人确认后建档，绝不自动写库。
export async function POST(request: Request) {
  try {
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner) return Response.json({ error: '请登录后使用' }, { status: 401, headers });
    const url = new URL(request.url);
    if ((request.headers.get('origin') && request.headers.get('origin') !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      return Response.json({ error: '不允许跨站请求' }, { status: 403, headers });
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
    return Response.json({ ok: true, result: { fields: parseCustomerOcrFields(lines), lines: lines.slice(0, 60) } }, { headers });
  } catch (error: any) {
    return Response.json({ error: error instanceof Error ? error.message : '识别失败，请重试' }, { status: 502, headers });
  }
}
