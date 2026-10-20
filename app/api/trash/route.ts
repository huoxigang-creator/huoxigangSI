import {trashExecute, TrashError} from '../../../lib/trash';

export async function POST(request: Request) {
  try {
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner) throw new TrashError('请先登录', 401);
    if ((request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new TrashError('不允许跨站操作', 403);
    const input = await request.json() as {action?: unknown; args?: unknown} | null;
    if (!input || typeof input !== 'object' || typeof input.action !== 'string' || (input.args !== undefined && (!input.args || typeof input.args !== 'object' || Array.isArray(input.args)))) throw new TrashError('请求格式不正确');
    const result = await trashExecute(owner, input.action, input.args || {});
    return Response.json(result, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    const status = error instanceof TrashError ? error.status : 500;
    return Response.json({error: error instanceof TrashError ? error.message : '回收站操作失败，请稍后重试'}, {status, headers: {'Cache-Control': 'private, no-store'}});
  }
}
