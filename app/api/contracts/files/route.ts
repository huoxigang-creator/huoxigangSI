import {env} from '../../../../lib/local-env';
import {contractExecute,ContractError} from '../../../../lib/contracts';
import {getDeletedFileKeys} from '../../../../lib/trash';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME:Record<string,string>={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
function fail(error:unknown){return Response.json({error:error instanceof ContractError?error.message:'合同附件操作未完成，请刷新后重试'},{status:error instanceof ContractError?error.status:500,headers});}
async function context(req:Request,project:unknown,id:unknown){const owner=req.headers.get('oai-authenticated-user-id');if(!owner)throw new ContractError('请先登录',401);if(typeof project!=='string'||typeof id!=='string'||!UUID.test(id))throw new ContractError('合同编号无效');const record=await contractExecute(owner,'get_contract',{id});if(record.project!==project)throw new ContractError('无权访问此合同附件',403);const bucket=env.BUCKET;if(!bucket)throw new ContractError('文件存储未就绪',503);return {owner,bucket,prefix:encodeURIComponent(owner)+'/'+encodeURIComponent(project)+'/files/'};}
function metadata(key:string,object:R2Object){return {key,name:object.customMetadata?.name||'合同附件',size:object.size,created:object.customMetadata?.created||object.uploaded.toISOString()};}
export async function POST(req:Request){try{
 if((req.headers.get('origin') && req.headers.get('origin')!==new URL(req.url).origin)||req.headers.get('sec-fetch-site')==='cross-site')throw new ContractError('不允许跨站上传',403);
 const form=await req.formData(),project=form.get('project_id'),id=form.get('contract_id'),attachment=form.get('attachment_id');
 const {owner,bucket,prefix}=await context(req,project,id);if(typeof attachment!=='string'||!UUID.test(attachment))throw new ContractError('附件请求编号无效');
 const file=form.get('file');if(!(file instanceof File)||file.size<1||file.size>10*1024*1024)throw new ContractError('请选择不超过10MB的非空附件');if(file.name.length>240||/[\x00-\x1f\x7f/\\]/.test(file.name))throw new ContractError('文件名不合法');
 const extension=file.name.split('.').pop()?.toLowerCase()||'',mime=MIME[extension];if(!mime)throw new ContractError('合同附件仅支持PDF、PNG、JPG和WebP照片');
 const bytes=new Uint8Array(await file.arrayBuffer()),head=new TextDecoder().decode(bytes.subarray(0,12));const valid=extension==='pdf'?head.startsWith('%PDF-'):extension==='png'?bytes[0]===137&&head.slice(1,4)==='PNG':extension==='jpg'||extension==='jpeg'?bytes[0]===255&&bytes[1]===216:head.startsWith('RIFF')&&head.slice(8,12)==='WEBP';if(!valid)throw new ContractError('附件内容与文件类型不一致');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join(''),key=prefix+attachment;
 const deleted=await getDeletedFileKeys(owner,String(project),'project');if(deleted.has(key))throw new ContractError('此附件请求已删除，请重新选择文件',409);
 const matching=(object:R2Object)=>object.customMetadata?.contract_id===id&&object.customMetadata?.sha256===hash&&object.customMetadata?.name===file.name&&object.size===file.size;
 const existing=await bucket.head(key);if(existing){if(!matching(existing))throw new ContractError('重复附件编号对应不同内容',409);return Response.json({ok:true,file:metadata(key,existing)},{headers});}
 const created=new Date().toISOString();const saved=await bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:mime},customMetadata:{name:file.name,category:'合同',contract_id:String(id),created,mime,sha256:hash}});
 if(!saved){const current=await bucket.head(key);if(!current||!matching(current))throw new ContractError('附件在上传期间已变化，请重新选择',409);return Response.json({ok:true,file:metadata(key,current)},{headers});}
 return Response.json({ok:true,file:metadata(key,saved)},{headers});
 }catch(error){return fail(error);}}
export async function GET(req:Request){try{
 const url=new URL(req.url),project=url.searchParams.get('project_id'),id=url.searchParams.get('contract_id'),{owner,bucket,prefix}=await context(req,project,id),deleted=await getDeletedFileKeys(owner,String(project),'project'),key=url.searchParams.get('key');
 if(key!==null){if(!key.startsWith(prefix)||!UUID.test(key.slice(prefix.length))||deleted.has(key))throw new ContractError('附件不存在或无权下载',404);const object=await bucket.get(key);if(!object||object.customMetadata?.contract_id!==id)throw new ContractError('附件不存在或无权下载',404);return new Response(object.body,{headers:{...headers,'Content-Type':object.customMetadata?.mime||'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(object.customMetadata?.name||'合同附件')}});}
 const files:any[]=[],seen=new Set<string>();let cursor:string|undefined;do{const page=await bucket.list({prefix,include:['customMetadata'],...(cursor?{cursor}:{})} as R2ListOptions);for(const object of page.objects){if(object.customMetadata?.contract_id===id&&!deleted.has(object.key))files.push(metadata(object.key,object));}if(!page.truncated)break;cursor=page.cursor;if(!cursor||seen.has(cursor))throw new ContractError('附件读取不完整，请刷新',503);seen.add(cursor);}while(true);
 files.sort((a,b)=>b.created.localeCompare(a.created));return Response.json({ok:true,files},{headers});
 }catch(error){return fail(error);}}
