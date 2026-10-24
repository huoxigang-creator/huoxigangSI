import { inspectRegisterLink, RegisterLinkError } from '../../../lib/register-links';
import { recognizeSpeech, aliyunAsrConfigured, ALIYUN_ASR_SETUP_HINT } from '../../../lib/asr';
import { extractFromSpeech } from '../../../lib/register-speech';

const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

// 免登录：客户扫码建档页录音转 WAV 上传，语音识别后返回姓名/电话/地址字段候选，由客户核对后随表单提交。
export async function POST(request: Request) {
  try {
    const url = new URL(request.url), token = url.searchParams.get('token') || '';
    await inspectRegisterLink(token);
    if ((request.headers.get('origin') && request.headers.get('origin') !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      throw new RegisterLinkError('不允许跨站操作', 403);
    }
    if (!aliyunAsrConfigured()) return Response.json({ error: ALIYUN_ASR_SETUP_HINT, configured: false }, { status: 503, headers });
    if (Number(request.headers.get('content-length')) > 2 * 1024 * 1024 + 1024) throw new RegisterLinkError('语音文件过大（不超过 2MB / 60 秒）', 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    const text = await recognizeSpeech(bytes);
    const fields = extractFromSpeech(text);
    return Response.json({ ok: true, result: { text, fields } }, { headers });
  } catch (error: any) {
    const known = error instanceof RegisterLinkError;
    return Response.json({ error: known ? error.message : (error instanceof Error ? error.message : '识别失败，请重试') }, { status: known ? error.status : 502, headers });
  }
}
