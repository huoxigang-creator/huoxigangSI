import {z, ZodError} from 'zod';
import {catalogExecute, CatalogError, materialSchema} from '../../../lib/catalog';

/** Browser parses the workbook, then submits confirmed rows with stable IDs. */
export async function POST(request: Request) {
  const headers = {'Cache-Control':'private, no-store'};
  try {
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner) throw new CatalogError('请先登录',401);
    if ((request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new CatalogError('不允许跨站操作',403);
    const body = await request.text();
    if (body.length > 2*1024*1024) throw new CatalogError('导入请求过大',413);
    const {items} = z.object({items:z.array(materialSchema.extend({id:z.string().uuid(),expense_category:z.literal('五金费用'),attribute:z.literal('辅材')})).min(1).max(500)}).parse(JSON.parse(body));
    const results = [];
    for (const item of items) {
      try {const record = await catalogExecute(owner,'create_material',item);results.push({id:item.id,ok:true,record});}
      catch (error) {results.push({id:item.id,ok:false,error:error instanceof CatalogError ? error.message : '此项导入失败，请重试'});}
    }
    return Response.json({ok:true,results},{headers});
  } catch(error) {
    return Response.json({error:error instanceof CatalogError ? error.message : error instanceof ZodError ? error.issues[0]?.message : '导入请求格式不正确'}, {status:error instanceof CatalogError ? error.status : 400,headers});
  }
}
