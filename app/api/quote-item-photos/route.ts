import { NextRequest, NextResponse } from 'next/server';
import { sessionAccount, SESSION_COOKIE } from '../../../lib/local-auth';
import { env } from '../../../lib/local-env';

const responseHeaders = { 'Cache-Control': 'no-store' };
const MAX_SIZE = 10 * 1024 * 1024;
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  zip: 'application/zip',
  txt: 'text/plain',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class QuotePhotoError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function fail(error: unknown, fallback: string) {
  if (error instanceof QuotePhotoError) return NextResponse.json({ error: error.message }, { status: error.status, headers: responseHeaders });
  const status = Number((error as { status?: number } | null)?.status);
  if ([401, 403, 404].includes(status)) return NextResponse.json({ error: status === 401 ? '请先登录' : '无权访问此文件' }, { status, headers: responseHeaders });
  return NextResponse.json({ error: fallback }, { status: 500, headers: responseHeaders });
}

function authorize(request: NextRequest) {
  const account = sessionAccount(request.cookies.get(SESSION_COOKIE)?.value);
  if (!account) throw new QuotePhotoError('请先登录', 401);
  const owner = request.headers.get('oai-authenticated-user-id');
  if (!owner) throw new QuotePhotoError('登录信息不完整', 401);
  if ((request.headers.get('origin') && request.headers.get('origin') !== request.nextUrl.origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new QuotePhotoError('不允许跨站上传', 403);
  return owner;
}

function prefixFor(owner: string) { return encodeURIComponent(owner) + '/quote-items/'; }

export async function POST(request: NextRequest) {
  try {
    const owner = authorize(request);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_SIZE) throw new QuotePhotoError('请选择非空文件，每个文件不得超过10MB');
    if (file.name.length > 240 || /[\x00-\x1f\x7f/\\]/.test(file.name)) throw new QuotePhotoError('文件名不符合要求');
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const mime = MIME[extension];
    if (!mime) throw new QuotePhotoError('支持图片（PNG/JPG/WebP）和 PDF、Excel、Word、TXT、ZIP 文件，不支持网页或程序文件');
    const bucket = env.BUCKET;
    if (!bucket) throw new QuotePhotoError('文件存储未就绪，请稍后重试', 503);
    const key = prefixFor(owner) + crypto.randomUUID();
    await bucket.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: mime },
      customMetadata: { name: file.name, mime, uploaded: new Date().toISOString() },
    });
    return NextResponse.json({ ok: true, file: { key, name: file.name, mime, size: file.size } }, { headers: responseHeaders });
  } catch (error) { return fail(error, '文件保存失败，请稍后重试'); }
}

export async function GET(request: NextRequest) {
  try {
    const account = sessionAccount(request.cookies.get(SESSION_COOKIE)?.value);
    if (!account) throw new QuotePhotoError('请先登录', 401);
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner) throw new QuotePhotoError('登录信息不完整', 401);
    const url = new URL(request.url);
    const key = url.searchParams.get('key') || '';
    const prefix = prefixFor(owner);
    if (!key.startsWith(prefix) || !UUID.test(key.slice(prefix.length))) throw new QuotePhotoError('无权下载此文件', 403);
    const bucket = env.BUCKET;
    if (!bucket) throw new QuotePhotoError('文件存储未就绪，请稍后重试', 503);
    const object = await bucket.get(key);
    if (!object) throw new QuotePhotoError('文件不存在', 404);
    const name = (object.customMetadata?.name || '报价明细附件').replace(/[\x00-\x1f\x7f]/g, '');
    const mime = object.customMetadata?.mime || 'application/octet-stream';
    const inline = mime.startsWith('image/');
    return new NextResponse(object.body, { headers: {
      'Content-Type': mime,
      'Content-Disposition': (inline ? 'inline' : "attachment; filename*=UTF-8''" + encodeURIComponent(name)),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    }});
  } catch (error) { return fail(error, '无法读取附件，请稍后重试'); }
}
