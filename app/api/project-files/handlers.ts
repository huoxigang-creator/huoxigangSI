type Dependencies = {
  bucket: () => R2Bucket | undefined;
  authorize: (owner: string, project: string) => Promise<unknown>;
  deletedKeys?: (owner:string,project:string)=>Promise<Set<string>>;
};

const MAX_SIZE = 10 * 1024 * 1024;
const CATEGORIES = new Set(['合同', '设计图', '项目资料']);
const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  dwg: 'application/octet-stream',
  dxf: 'application/octet-stream',
  zip: 'application/zip',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class FileError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function fail(error: unknown, fallback: string) {
  if (error instanceof FileError) return Response.json({error: error.message}, {status: error.status});
  const status = Number((error as {status?: number} | null)?.status);
  if ([401, 403, 404].includes(status)) {
    return Response.json({error: status === 401 ? '请先登录' : '项目不存在或无权访问'}, {status});
  }
  return Response.json({error: fallback}, {status: 500});
}

function ownerFrom(req: Request) {
  const owner = req.headers.get('oai-authenticated-user-id');
  if (!owner) throw new FileError('请先登录', 401);
  return owner;
}

function projectFrom(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new FileError('请选择有效项目');
  }
  return value;
}

function prefixFor(owner: string, project: string) {
  return encodeURIComponent(owner) + '/' + encodeURIComponent(project) + '/files/';
}

function categoryFrom(value: unknown) {
  if (typeof value !== 'string' || !CATEGORIES.has(value)) throw new FileError('请选择合同、设计图或项目资料分类');
  return value;
}

export function createProjectFileHandlers(deps: Dependencies) {
  async function POST(req: Request) {
    try {
      const owner = ownerFrom(req);
      if ((req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin) || req.headers.get('sec-fetch-site') === 'cross-site') {
        throw new FileError('不允许跨站上传', 403);
      }
      const form = await req.formData();
      const project = projectFrom(form.get('project_id'));
      await deps.authorize(owner, project);
      const category = categoryFrom(form.get('category'));
      const file = form.get('file');
      if (!(file instanceof File) || file.size === 0 || file.size > MAX_SIZE) {
        throw new FileError('请选择非空文件，每个文件不得超过10MB');
      }
      if (file.name.length > 240 || /[\x00-\x1f\x7f/\\]/.test(file.name)) throw new FileError('文件名不符合要求');
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      const mime = MIME[extension];
      if (!mime) throw new FileError('支持 PDF、Excel、Word、图片、DWG、DXF 和 ZIP 文件，不支持网页或程序文件');
      const bucket = deps.bucket();
      if (!bucket) throw new FileError('文件存储未就绪，请稍后重试', 503);
      const key = prefixFor(owner, project) + crypto.randomUUID();
      const created = new Date().toISOString();
      await bucket.put(key, await file.arrayBuffer(), {
        httpMetadata: {contentType: mime},
        customMetadata: {name: file.name, category, created, mime},
      });
      return Response.json({ok: true, file: {key, name: file.name, category, created, size: file.size}});
    } catch (error) { return fail(error, '文件保存失败，请稍后重试'); }
  }

  async function GET(req: Request) {
    try {
      const owner = ownerFrom(req);
      const url = new URL(req.url);
      const project = projectFrom(url.searchParams.get('project_id'));
      await deps.authorize(owner, project);
      const bucket = deps.bucket();
      if (!bucket) throw new FileError('文件存储未就绪，请稍后重试', 503);
      const prefix = prefixFor(owner, project);
      const deletedKeys=await deps.deletedKeys?.(owner,project)||new Set<string>();
      const key = url.searchParams.get('key');
      if (key !== null) {
        if (!key.startsWith(prefix) || !UUID.test(key.slice(prefix.length))) throw new FileError('无权下载此文件', 403);
        if(deletedKeys.has(key))throw new FileError('文件已移入回收站，请先恢复',404);
        const object = await bucket.get(key);
        if (!object) throw new FileError('文件不存在', 404);
        const name = (object.customMetadata?.name || '项目附件').replace(/[\x00-\x1f\x7f]/g, '');
        return new Response(object.body, {headers: {
          'Content-Type': object.customMetadata?.mime || 'application/octet-stream',
          'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name),
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store',
        }});
      }
      const category = url.searchParams.has('category') ? categoryFrom(url.searchParams.get('category')) : undefined;
      const files: Array<{key: string; name: string; category: string; created: string; size: number}> = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        // R2 supports include even when the installed worker typings omit it.
        const options: R2ListOptions & {include: Array<'customMetadata'>} = {prefix, include: ['customMetadata'], ...(cursor ? {cursor} : {})};
        const page = await bucket.list(options);
        for (const object of page.objects) {
          const metadata = object.customMetadata || {};
          if (deletedKeys.has(object.key))continue;
          if (!UUID.test(object.key.slice(prefix.length)) || !object.key.startsWith(prefix)) continue;
          if (!CATEGORIES.has(metadata.category) || (category && metadata.category !== category)) continue;
          files.push({key: object.key, name: metadata.name || '项目附件', category: metadata.category, created: metadata.created || object.uploaded.toISOString(), size: object.size});
        }
        if (!page.truncated) break;
        cursor = page.cursor;
        if (!cursor || seenCursors.has(cursor)) throw new FileError('文件列表读取不完整，请稍后重试', 503);
        seenCursors.add(cursor);
      } while (true);
      files.sort((a, b) => b.created.localeCompare(a.created) || a.key.localeCompare(b.key));
      return Response.json({files}, {headers: {'Cache-Control': 'private, no-store'}});
    } catch (error) { return fail(error, '无法读取项目文件，请稍后重试'); }
  }

  return {GET, POST};
}
