import {env} from '../../../lib/local-env';
import {execute} from '../../../lib/service';

type Dependencies = {
  bucket: () => R2Bucket | undefined;
  database: () => D1Database | undefined;
  authorize: (owner: string, project: string) => Promise<unknown>;
};
type Counts = {activeFiles: number; trashedFiles: number; activeCosts: number; trashedCosts: number};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = new Set(['五金汇总', '五金成本']);

class LegacyError extends Error {
  constructor(message: string, public status = 400) {super(message);}
}
function ownerFrom(request: Request) {
  const owner = request.headers.get('oai-authenticated-user-id');
  if (!owner) throw new LegacyError('请先登录', 401);
  // Historic uploads used the raw authenticated owner as a single path segment.
  if (owner.length > 512 || /[\x00-\x1f\x7f/\\]/.test(owner)) throw new LegacyError('账号标识无效', 403);
  return owner;
}
function projectFrom(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new LegacyError('请选择有效项目');
  return value;
}
function failure(error: unknown, fallback: string) {
  const status = Number((error as {status?: number})?.status);
  if (error instanceof LegacyError) return Response.json({error: error.message}, {status: error.status});
  if ([401, 403, 404].includes(status)) return Response.json({error: '项目不存在或无权访问'}, {status});
  return Response.json({error: fallback}, {status: 500});
}
function activeFile(object: R2Object, prefix: string) {
  return object.key.startsWith(prefix) && UUID.test(object.key.slice(prefix.length)) && TYPES.has(object.customMetadata?.type || '');
}
function trashedFile(object: R2Object, prefix: string) {
  const trashPrefix = prefix + 'legacy-trash/';
  const id = object.key.slice(trashPrefix.length);
  return object.key.startsWith(trashPrefix) && UUID.test(id) && TYPES.has(object.customMetadata?.type || '') && object.customMetadata?.originalKey === prefix + id;
}
async function listFiles(bucket: R2Bucket, prefix: string) {
  const active: R2Object[] = [], trash: R2Object[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({prefix, include: ['customMetadata'], ...(cursor ? {cursor} : {})} as R2ListOptions);
    for (const object of page.objects) {
      if (activeFile(object, prefix)) active.push(object);
      else if (trashedFile(object, prefix)) trash.push(object);
    }
    if (!page.truncated) break;
    cursor = page.cursor;
    if (!cursor || cursors.has(cursor)) throw new LegacyError('历史文件列表未完整读取，请重试', 503);
    cursors.add(cursor);
  } while (true);
  return {active, trash};
}
async function costCounts(database: D1Database, owner: string, project: string) {
  const result = await database.prepare('SELECT kind, COUNT(*) AS total FROM records WHERE owner = ? AND project = ? AND kind IN (?, ?) GROUP BY kind')
    .bind(owner, project, 'hardware', 'hardware_deleted').all<{kind: string; total: number}>();
  return {
    activeCosts: Number(result.results.find(row => row.kind === 'hardware')?.total || 0),
    trashedCosts: Number(result.results.find(row => row.kind === 'hardware_deleted')?.total || 0),
  };
}
async function snapshot(bucket: R2Bucket, database: D1Database, owner: string, project: string) {
  const prefix = owner + '/' + project + '/';
  const [files, costs] = await Promise.all([listFiles(bucket, prefix), costCounts(database, owner, project)]);
  return {
    counts: {activeFiles: files.active.length, trashedFiles: files.trash.length, ...costs} satisfies Counts,
    trashFiles: files.trash.map(object => ({
      key: object.key, name: object.customMetadata?.name || '五金表格.xlsx', type: object.customMetadata?.type,
      created: object.customMetadata?.created || object.uploaded.toISOString(), removedAt: object.customMetadata?.removedAt || '', size: object.size,
    })),
    files,
  };
}

function createLegacyHardwareHandlers(deps: Dependencies) {
  async function context(request: Request, projectValue: unknown) {
    const owner = ownerFrom(request), project = projectFrom(projectValue);
    await deps.authorize(owner, project);
    const bucket = deps.bucket(), database = deps.database();
    if (!bucket || !database) throw new LegacyError('项目存储尚未就绪，请稍后重试', 503);
    return {owner, project, bucket, database, prefix: owner + '/' + project + '/'};
  }
  async function GET(request: Request) {
    try {
      const {owner, project, bucket, database} = await context(request, new URL(request.url).searchParams.get('project_id'));
      const {counts, trashFiles} = await snapshot(bucket, database, owner, project);
      return Response.json({counts, trashFiles}, {headers: {'Cache-Control': 'private, no-store'}});
    } catch (error) {return failure(error, '无法读取历史五金资料，请稍后重试');}
  }
  async function POST(request: Request) {
    try {
      ownerFrom(request);
      if ((request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new LegacyError('不允许跨站操作', 403);
      const input = await request.json() as {action?: unknown; project_id?: unknown};
      if (!['clear', 'restore'].includes(String(input.action))) throw new LegacyError('请选择清除或恢复操作');
      const action = input.action as 'clear' | 'restore';
      const {owner, project, bucket, database, prefix} = await context(request, input.project_id);
      const before = await snapshot(bucket, database, owner, project);
      const errors: string[] = [], conflicts: string[] = [];
      let filesMoved = 0, costsMoved = 0;
      const now = new Date().toISOString();
      for (const listed of action === 'clear' ? before.files.active : before.files.trash) {
        const label = listed.customMetadata?.name || '五金表格.xlsx';
        try {
          const source = await bucket.get(listed.key);
          if (!source) continue; // A repeated/concurrent operation already moved it.
          if (action === 'clear') {
            if (!activeFile(source, prefix)) {errors.push(label + '：文件类型发生变化，未清除'); continue;}
            const target = prefix + 'legacy-trash/' + source.key.slice(prefix.length);
            let archived = await bucket.head(target);
            if (!archived) {
              archived = await bucket.put(target, source.body, {
                onlyIf: new Headers({'If-None-Match': '*'}), httpMetadata: source.httpMetadata,
                customMetadata: {...source.customMetadata, originalKey: source.key, originalEtag: source.etag, removedAt: now},
              });
              if (!archived) archived = await bucket.head(target);
            }
            // Never remove the original unless the recoverable copy is complete and matches.
            if (!archived || !trashedFile(archived, prefix) || archived.customMetadata?.originalEtag !== source.etag || archived.size !== source.size || archived.etag !== source.etag) {
              conflicts.push(label + '：回收站中存在不同版本，原文件已保留'); continue;
            }
            const current = await bucket.head(source.key);
            if (current && current.etag !== source.etag) {conflicts.push(label + '：原文件已变化，已保留'); continue;}
            if (current) {await bucket.delete(source.key); filesMoved++;}
          } else {
            if (!trashedFile(source, prefix)) {errors.push(label + '：回收站记录无效，未恢复'); continue;}
            const target = source.customMetadata!.originalKey;
            if (await bucket.head(target)) {conflicts.push(label + '：原位置已有文件，未覆盖，回收站副本已保留'); continue;}
            const {originalKey: _key, originalEtag: _etag, removedAt: _removed, ...metadata} = source.customMetadata!;
            const restored = await bucket.put(target, source.body, {onlyIf: new Headers({'If-None-Match': '*'}), httpMetadata: source.httpMetadata, customMetadata: metadata});
            if (!restored) {conflicts.push(label + '：原位置已有文件，未覆盖，回收站副本已保留'); continue;}
            if (restored.size !== source.size || restored.etag !== source.etag) {errors.push(label + '：恢复副本校验失败，回收站副本已保留'); continue;}
            await bucket.delete(source.key); filesMoved++;
          }
        } catch {errors.push(label + '：移动未完成，原文件或回收站副本已保留，可重试');}
      }
      const restoreCostConflict = action === 'restore' && before.counts.activeCosts > 0 && before.counts.trashedCosts > 0;
      if (restoreCostConflict) conflicts.push('已有当前成本数据，历史成本未覆盖，仍保留在回收站');
      try {
        const fromKind = action === 'clear' ? 'hardware' : 'hardware_deleted';
        const toKind = action === 'clear' ? 'hardware_deleted' : 'hardware';
        const mutation = database.prepare('UPDATE records SET kind = ? WHERE owner = ? AND project = ? AND kind = ?' + (action === 'restore' ? ' AND NOT EXISTS (SELECT 1 FROM records AS active WHERE active.owner = ? AND active.project = ? AND active.kind = ?)' : ''));
        const bound = action === 'restore'
          ? mutation.bind(toKind, owner, project, fromKind, owner, project, 'hardware')
          : mutation.bind(toKind, owner, project, fromKind);
        const audit = database.prepare('INSERT INTO records(id,owner,kind,project,data,created) VALUES(?,?,?,?,?,?)').bind(
          crypto.randomUUID(), owner, 'audit', project,
          JSON.stringify({action: 'legacy_hardware_' + action, detail: action === 'clear' ? '清除历史五金资料（移至回收站）' : '恢复历史五金资料', actor: owner, files_moved: filesMoved, issues: errors.length + conflicts.length}), now,
        );
        const result = await database.batch([bound, audit]);
        costsMoved = Number(result[0].meta.changes || 0);
        if (action === 'restore' && !restoreCostConflict && before.counts.trashedCosts > 0 && !costsMoved) conflicts.push('成本数据在操作期间发生变化，历史成本仍保留在回收站');
      } catch {errors.push('成本数据或操作记录保存未完成，成本记录已保留，可重试');}
      let after: Awaited<ReturnType<typeof snapshot>> | undefined;
      try {after = await snapshot(bucket, database, owner, project);} catch {errors.push('最终数量暂时无法读取，请刷新核实');}
      const partial = errors.length + conflicts.length > 0;
      return Response.json({
        ok: !partial, status: partial ? 'partial' : action === 'clear' ? 'cleared' : 'restored',
        counts: after?.counts || null, trashFiles: after?.trashFiles || [], changes: {filesMoved, costsMoved}, errors, conflicts,
      }, {status: partial ? 207 : 200, headers: {'Cache-Control': 'private, no-store'}});
    } catch (error) {return failure(error, '历史五金资料操作失败，请稍后重试');}
  }
  return {GET, POST};
}

const handlers = createLegacyHardwareHandlers({bucket: () => env.BUCKET, database: () => env.DB, authorize: (owner, project) => execute(owner, 'get_project', {id: project})});
export const GET = handlers.GET;
export const POST = handlers.POST;
