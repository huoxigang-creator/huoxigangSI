import {catalogExecute, CatalogError} from '../../../lib/catalog';
import {ZodError} from 'zod';
import {employeeCatalog} from '../../../lib/employee-access';

export async function POST(request: Request) {
  const headers = {'Cache-Control': 'private, no-store'};
  try {
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner) throw new CatalogError('请先登录', 401);
    if ((request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new CatalogError('不允许跨站操作', 403);
    const input = await request.json() as {action?: unknown; args?: unknown} | null;
    if (!input || typeof input !== 'object' || typeof input.action !== 'string' || (input.args !== undefined && (!input.args || typeof input.args !== 'object' || Array.isArray(input.args)))) throw new CatalogError('请求格式不正确');
    const employee = request.headers.get('x-gugemei-role') === 'employee';
    if (employee && input.action !== 'get_catalog') throw new CatalogError('仅老板可访问采购与配置操作', 403);
    const result = await catalogExecute(owner, input.action, input.args || {});
    const visible = employee ? employeeCatalog(result) : result;
    return Response.json({ok: true, result: visible}, {headers});
  } catch (error) {
    const status = error instanceof CatalogError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500;
    const message = error instanceof CatalogError ? error.message : error instanceof ZodError ? error.issues[0]?.message || '输入字段不合法' : error instanceof SyntaxError ? '请求格式不正确' : '配置或采购保存失败，请稍后重试';
    return Response.json({error: message}, {status, headers});
  }
}
