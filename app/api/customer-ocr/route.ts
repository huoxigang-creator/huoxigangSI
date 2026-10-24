import { aliyunOcrConfigured, recognizeTextLines, ALIYUN_OCR_SETUP_HINT } from '../../../lib/aliyun-ocr';
import { qwenVisionConfigured, recognizeCustomerFieldsQwen, QWEN_VISION_SETUP_HINT } from '../../../lib/customer-vision';
import { parseCustomerOcrFields } from '../../../lib/customer-ocr-fields';

const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

// 登录态：管理端「图片识别建档」——接收一张订单照片/截图。
// engine=qwen（默认）：千问视觉大模型看图直接输出结构化字段（订单名称/姓名/电话/地址/日期/预算），识别更准；
// engine=ocr（备用）：阿里云文字识别 OCR 返回原文行再由规则提取。前端只展示核对清单，写入仍由人确认后建档，绝不自动写库。
export async function POST(request: Request) {
  try {
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner) return Response.json({ error: '请登录后使用' }, { status: 401, headers });
    const url = new URL(request.url);
    if ((request.headers.get('origin') && request.headers.get('origin') !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      return Response.json({ error: '不允许跨站请求' }, { status: 403, headers });
    }
    const form = await request.formData().catch(() => null);
    const engine = typeof form?.get('engine') === 'string' && ['qwen', 'ocr'].includes(String(form.get('engine'))) ? String(form.get('engine')) : 'qwen';
    if (engine === 'qwen') {
      if (!qwenVisionConfigured()) return Response.json({ error: QWEN_VISION_SETUP_HINT, configured: false }, { status: 503, headers });
    } else {
      if (!aliyunOcrConfigured()) return Response.json({ error: ALIYUN_OCR_SETUP_HINT, configured: false }, { status: 503, headers });
    }
    const file = form?.get('file');
    if (!(file instanceof File)) return Response.json({ error: '请选择一张图片' }, { status: 400, headers });
    const maxBytes = engine === 'qwen' ? 2 * 1024 * 1024 : 10 * 1024 * 1024;
    if (!file.size || file.size > maxBytes || !/^image\/(png|jpeg|webp)$/.test(file.type)) {
      return Response.json({ error: engine === 'qwen' ? '请选择 2MB 以内的 PNG 或 JPEG 图片' : '请选择 10MB 以内的 PNG、JPEG 或 WebP 图片' }, { status: 400, headers });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (engine === 'qwen') {
      const dataUrl = 'data:' + file.type + ';base64,' + Buffer.from(bytes).toString('base64');
      const candidates = await recognizeCustomerFieldsQwen(dataUrl);
      return Response.json({ ok: true, engine: 'qwen', result: { fields: candidates[0], candidates, lines: [] } }, { headers });
    }
    const lines = await recognizeTextLines(bytes);
    return Response.json({ ok: true, engine: 'ocr', result: { fields: parseCustomerOcrFields(lines), lines: lines.slice(0, 60) } }, { headers });
  } catch (error: any) {
    return Response.json({ error: error instanceof Error ? error.message : '识别失败，请重试' }, { status: 502, headers });
  }
}
