type Payment = {id: string; project: string; type: string; void?: boolean; voucher_project_id?: string};
type Dependencies = {
  bucket: () => R2Bucket | undefined;
  authorize: (owner: string, project: string) => Promise<unknown>;
  deletedKeys?: (owner:string,project:string,transaction:string)=>Promise<Set<string>>;
};
const MAX_SIZE = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const PRIVATE = {'Cache-Control': 'private, no-store'};
class VoucherError extends Error {
  constructor(message: string, public status = 400) {super(message);}
}
function json(body: unknown, status = 200) {return Response.json(body, {status, headers: PRIVATE});}
function failure(error: unknown, fallback: string) {
  if (error instanceof VoucherError) return json({error: error.message}, error.status);
  const status = Number((error as {status?: number} | null)?.status);
  if ([401, 403, 404].includes(status)) return json({error: status === 401 ? '请先登录' : '项目或付款记录不存在或无权访问'}, status);
  return json({error: fallback}, 500);
}
function ownerFrom(req: Request) {
  const owner = req.headers.get('oai-authenticated-user-id');
  if (!owner) throw new VoucherError('请先登录', 401);
  return owner;
}
function projectFrom(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new VoucherError('请选择有效项目');
  return value;
}
function transactionFrom(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) throw new VoucherError('请选择有效付款记录');
  return value;
}
function attachmentFrom(value: unknown) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new VoucherError('附件编号不正确，请重新选择文件');
  return value.toLowerCase();
}
function prefixFor(owner: string, project: string, transaction: string) {
  return encodeURIComponent(owner) + '/' + encodeURIComponent(project) + '/payment-vouchers/' + encodeURIComponent(transaction) + '/';
}
/** Only the authorized server record can choose the immutable original invoice namespace. */
function voucherProject(payment: Payment) {return payment.voucher_project_id ? projectFrom(payment.voucher_project_id) : payment.project;}
function scopeMatches(object: R2Object, project: string, transaction: string) {
  return object.customMetadata?.project_id === project && object.customMetadata?.transaction_id === transaction;
}
function describe(object: R2Object) {
  const meta = object.customMetadata || {};
  return {key: object.key, name: meta.name || '付款单据', size: object.size, created: meta.created || object.uploaded.toISOString(), attachment_id: meta.attachment_id || object.key.split('/').pop(), project_id: meta.project_id, transaction_id: meta.transaction_id};
}
function existingResult(object: R2Object, project: string, transaction: string, hash: string, size: number) {
  if (!scopeMatches(object, project, transaction) || object.customMetadata?.sha256 !== hash || object.size !== size) {
    throw new VoucherError('附件编号已用于其他内容，请重新选择文件后上传', 409);
  }
  return json({ok: true, reused: true, file: describe(object)});
}

export function createPaymentVoucherHandlers(deps: Dependencies) {
  async function paymentFor(owner: string, project: string, transaction: string) {
    const data = await deps.authorize(owner, project) as {project?: {id?: string}; transactions?: Payment[]} | null;
    if (data?.project?.id !== project || !Array.isArray(data.transactions)) throw new VoucherError('项目不存在或无权访问', 404);
    const payment = data.transactions.find(value => value.id === transaction && value.project === project && value.type === '付款');
    if (!payment) throw new VoucherError('付款记录不存在或无权访问', 404);
    return payment;
  }
  function storage() {
    const bucket = deps.bucket();
    if (!bucket) throw new VoucherError('单据存储未就绪，请稍后重试', 503);
    return bucket;
  }
  async function POST(req: Request) {
    try {
      const owner = ownerFrom(req);
      if ((req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin) || req.headers.get('sec-fetch-site') === 'cross-site') throw new VoucherError('不允许跨站上传', 403);
      const form = await req.formData();
      const project = projectFrom(form.get('project_id'));
      const transaction = transactionFrom(form.get('transaction_id'));
      const payment = await paymentFor(owner, project, transaction);
      const originProject = voucherProject(payment);
      const attachment = attachmentFrom(form.get('attachment_id'));
      const file = form.get('file');
      if (!(file instanceof File) || !file.size || file.size > MAX_SIZE) throw new VoucherError('请选择非空单据，每个文件不得超过10MB');
      if (file.name.length > 240 || /[\x00-\x1f\x7f/\\]/.test(file.name)) throw new VoucherError('文件名不符合要求');
      const mime = MIME[file.name.split('.').pop()?.toLowerCase() || ''];
      if (!mime) throw new VoucherError('单据支持 PDF、PNG/JPG/WebP、Excel 和 Word，不支持网页、压缩包或程序文件');
      const bucket = storage();
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
      const key = prefixFor(owner, originProject, transaction) + attachment;
      if((await deps.deletedKeys?.(owner,project,transaction))?.has(key))throw new VoucherError('单据已移入回收站，请先恢复',409);
      const existing = await bucket.head(key);
      if (existing) return existingResult(existing, originProject, transaction, hash, file.size);
      if (payment.void) throw new VoucherError('此付款已作废，不能再上传新单据', 409);
      const created = new Date().toISOString();
      const saved = await bucket.put(key, bytes, {
        // Atomic create only: a concurrent retry cannot replace the first file.
        onlyIf: new Headers({'If-None-Match': '*'}), sha256: digest,
        httpMetadata: {contentType: mime},
        customMetadata: {name: file.name, mime, created, project_id: originProject, transaction_id: transaction, attachment_id: attachment, sha256: hash},
      });
      if (saved) return json({ok: true, reused: false, file: describe(saved)});
      const concurrent = await bucket.head(key);
      if (concurrent) return existingResult(concurrent, originProject, transaction, hash, file.size);
      throw new VoucherError('单据尚未保存成功，请使用同一附件编号重试', 503);
    } catch (error) {return failure(error, '单据上传失败，请保留所选文件并重试');}
  }
  async function GET(req: Request) {
    try {
      const owner = ownerFrom(req);
      const url = new URL(req.url);
      const project = projectFrom(url.searchParams.get('project_id'));
      const transaction = transactionFrom(url.searchParams.get('transaction_id'));
      const payment = await paymentFor(owner, project, transaction);
      const originProject = voucherProject(payment);
      const bucket = storage();
      const prefix = prefixFor(owner, originProject, transaction);
      const deletedKeys=await deps.deletedKeys?.(owner,project,transaction)||new Set<string>();
      const key = url.searchParams.get('key');
      if (key !== null) {
        if (!key.startsWith(prefix) || !UUID.test(key.slice(prefix.length))) throw new VoucherError('无权下载此付款单据', 403);
        if(deletedKeys.has(key))throw new VoucherError('单据已移入回收站，请先恢复',404);
        const object = await bucket.get(key);
        if (!object) throw new VoucherError('付款单据不存在', 404);
        if (!scopeMatches(object, originProject, transaction)) throw new VoucherError('无权下载此付款单据', 403);
        const name = (object.customMetadata?.name || '付款单据').replace(/[\x00-\x1f\x7f]/g, '');
        const encoded = encodeURIComponent(name).replace(/['()*]/g, value => '%' + value.charCodeAt(0).toString(16).toUpperCase());
        return new Response(object.body, {headers: {
          ...PRIVATE, 'Content-Type': object.customMetadata?.mime || 'application/octet-stream',
          'Content-Disposition': "attachment; filename*=UTF-8''" + encoded,
          'X-Content-Type-Options': 'nosniff',
        }});
      }
      const files: ReturnType<typeof describe>[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const options: R2ListOptions & {include: Array<'customMetadata'>} = {prefix, include: ['customMetadata'], ...(cursor ? {cursor} : {})};
        const page = await bucket.list(options);
        for (const object of page.objects) {
          if(deletedKeys.has(object.key))continue;
          if (object.key.startsWith(prefix) && UUID.test(object.key.slice(prefix.length)) && scopeMatches(object, originProject, transaction)) files.push(describe(object));
        }
        if (!page.truncated) break;
        cursor = page.cursor;
        if (!cursor || cursors.has(cursor)) throw new VoucherError('单据列表读取不完整，请稍后重试', 503);
        cursors.add(cursor);
      } while (true);
      files.sort((a, b) => b.created.localeCompare(a.created) || a.key.localeCompare(b.key));
      return json({files});
    } catch (error) {return failure(error, '付款单据读取失败，请稍后重试');}
  }
  return {GET, POST};
}
