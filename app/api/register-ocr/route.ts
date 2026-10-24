import { inspectRegisterLink, RegisterLinkError } from '../../../lib/register-links';
import { recognizeTextLines, aliyunOcrConfigured, ALIYUN_OCR_SETUP_HINT } from '../../../lib/aliyun-ocr';
import { parseCustomerOcrFields } from '../../../lib/customer-ocr-fields';
import { qwenVisionConfigured, recognizeCustomerFieldsQwen, QWEN_VISION_SETUP_HINT } from '../../../lib/customer-vision';

const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

// 免登录：客户扫码建档页上传截图/照片。
// engine=qwen（默认）：千问视觉大模型看图直接输出结构化字段（姓名/电话/地址等），识别更准；
// engine=ocr（备用）：阿里云文字识别 OCR 返回原文行再由规则提取。识别结果由客户核对后随表单提交，绝不自动写库。
export async function POST(request: Request) {
  try {
    const url = new URL(request.url), token = url.searchParams.get('token') || '';
    await inspectRegisterLink(token);
    if ((request.headers.get('origin') && request.headers.get('origin') !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      throw new RegisterLinkError('不允许跨站操作', 403);
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
      return Response.json({ error: engine === 'qwen' ? '请选择 2MB 以内的 PNG、JPEG 或 WebP 图片' : '请选择 10MB 以内的 PNG、JPEG 或 WebP 图片' }, { status: 400, headers });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (engine === 'qwen') {
      const dataUrl = 'data:' + file.type + ';base64,' + Buffer.from(bytes).toString('base64');
      const fields = await recognizeCustomerFieldsQwen(dataUrl);
      return Response.json({ ok: true, engine: 'qwen', result: { fields, lines: [] } }, { headers });
    }
    const lines = await recognizeTextLines(bytes);
    const fields = parseCustomerOcrFields(lines);
    return Response.json({ ok: true, engine: 'ocr', result: { fields, lines: lines.slice(0, 60) } }, { headers });
  } catch (error: any) {
    const known = error instanceof RegisterLinkError;
    return Response.json({ error: known ? error.message : (error instanceof Error ? error.message : '识别失败，请重试') }, { status: known ? error.status : 502, headers });
  }
}
