import { speechConfigured, recognizeSpeechSmart, SPEECH_SETUP_HINT } from '../../../lib/asr';
import { extractFromSpeech } from '../../../lib/register-speech';

const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

// 登录态：管理端「语音识别建档」——接收 WAV 录音，优先走百炼语音大模型（Qwen3-ASR-Flash，自动回退 ISI），
// 转文字并提取姓名/电话/地址等字段候选，由管理端核对后随建档表单提交，绝不自动写库。
export async function POST(request: Request) {
  try {
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner) return Response.json({ error: '请登录后使用' }, { status: 401, headers });
    const url = new URL(request.url);
    if ((request.headers.get('origin') && request.headers.get('origin') !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      return Response.json({ error: '不允许跨站请求' }, { status: 403, headers });
    }
    if (!speechConfigured()) return Response.json({ error: SPEECH_SETUP_HINT, configured: false }, { status: 503, headers });
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) return Response.json({ error: '请选择一段录音' }, { status: 400, headers });
    if (!file.size || file.size > 2 * 1024 * 1024 || !/^audio\/(wav|x-wav|wave|webm)$/.test(file.type)) {
      return Response.json({ error: '请上传 2MB 以内的 WAV 录音' }, { status: 400, headers });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = await recognizeSpeechSmart(bytes);
    const fields = extractFromSpeech(text);
    return Response.json({ ok: true, result: { fields, text } }, { headers });
  } catch (error: any) {
    return Response.json({ error: error instanceof Error ? error.message : '识别失败，请重试' }, { status: 502, headers });
  }
}
