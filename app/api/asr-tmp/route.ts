import { readFileSync, unlinkSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { dataDirectory } from '../../../lib/local-env';

const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

// 豆包录音文件识别2.0 要求音频走公网 URL：本路由把语音识别过程中产生的临时 WAV
// （dataDirectory/asr-tmp/{uuid}.wav）以 HTTPS 流式返回给豆包语音服务拉取。
// 调用格式：GET /api/asr-tmp?id={uuid}（uuid 不可枚举、30 分钟内过期自动删除、单文件不超过 2MB，识别完成后调用方立即清理）。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_AGE_MS = 30 * 60 * 1000;
const dir = join(dataDirectory, 'asr-tmp');

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!UUID_RE.test(id)) return Response.json({ error: '无效的录音文件' }, { status: 404, headers });
  const filePath = join(dir, id + '.wav');
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return Response.json({ error: '录音文件不存在或已过期' }, { status: 404, headers });
  }
  if (Date.now() - stat.mtimeMs > MAX_AGE_MS) {
    try { unlinkSync(filePath); } catch { /* 忽略 */ }
    return Response.json({ error: '录音文件已过期' }, { status: 404, headers });
  }
  if (stat.size > 2 * 1024 * 1024) {
    try { unlinkSync(filePath); } catch { /* 忽略 */ }
    return Response.json({ error: '录音文件异常' }, { status: 404, headers });
  }
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const body = readFileSync(filePath);
    return new Response(new Uint8Array(body), { headers: { ...headers, 'Content-Type': 'audio/wav', 'Content-Length': String(stat.size) } });
  } catch {
    return Response.json({ error: '录音文件读取失败' }, { status: 404, headers });
  }
}
