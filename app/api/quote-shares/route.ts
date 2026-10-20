import {confirmationFile} from '../../../lib/quote-confirmation-files';
import {quoteShareService,QuoteShareError} from '../../../lib/quote-shares';
import {ZodError} from 'zod';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
function owner(request:Request){const id=request.headers.get('oai-authenticated-user-id');if(!id)throw new QuoteShareError('请先登录',401);return id;}
function fail(error:unknown){return Response.json({error:error instanceof QuoteShareError?error.message:error instanceof ZodError?error.issues[0]?.message||'输入字段无效':'分享操作未完成，请重试'},{status:error instanceof QuoteShareError?error.status:error instanceof ZodError||error instanceof SyntaxError?400:500,headers});}
export async function GET(request:Request){try{
 const who=owner(request),url=new URL(request.url),id=url.searchParams.get('receipt_id'),format=url.searchParams.get('format')||'document';
 if(id){const record=await quoteShareService.receipt(who,id),file=await confirmationFile(record,format);return new Response(typeof file.bytes==='string'?file.bytes:new Uint8Array(file.bytes).buffer,{headers:{...headers,'Content-Type':file.mime,'Content-Disposition':format==='document'?'inline':"attachment; filename*=UTF-8''"+encodeURIComponent(record.snapshot.title+'-存根.'+file.extension),'Content-Security-Policy':"default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"}});}
 return Response.json({ok:true,result:await quoteShareService.list(who,url.searchParams.get('quote_id')||'',url.origin),availability:quoteShareService.availability()},{headers});
}catch(error){return fail(error);}}
export async function POST(request:Request){try{const who=owner(request),url=new URL(request.url);if((request.headers.get('origin') && request.headers.get('origin')!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site')throw new QuoteShareError('不允许跨站操作',403);const {action,args}=await request.json() as any;const result=action==='create'?await quoteShareService.create(who,args||{},url.origin):action==='revoke'?await quoteShareService.revoke(who,args?.id):null;if(!result)throw new QuoteShareError('操作无效');return Response.json({ok:true,result,availability:quoteShareService.availability()},{headers});}catch(error){return fail(error);}}
