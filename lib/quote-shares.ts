import {env} from './local-env';
import {z} from 'zod';
import {DEFAULT_COMPANY_NAME} from './release';
import {normalizeQuoteItem,QUOTE_CATEGORIES} from './quotes';
import {getQuoteSettlement,buildQuoteExportSheets,type QuoteExportSheet} from './quote-export';
import {paymentCodeSnapshot,validateSignaturePng,type PaymentCodeSnapshot} from './payment-codes';
import {paymentAmountCents} from './payment-details';

export class QuoteShareError extends Error {constructor(message:string,public status=400){super(message);}}
export type QuoteShareSnapshot={company_name:string;project_name:string;customer:string;title:string;created:string;expires_at:string;rooms:{id:string;name:string}[];items:{name:string;model:string;unit:string;quantity:number;price:number;category:string;room_id?:string}[];total:number;settlement:{gross:number;discount:number;rounding:number;receivable:number}|null;customer_note:string;collection:{name:string;amount:number}|null;share_url:string;payment_mode?:'manual_code'|'wechat';payment_code?:PaymentCodeSnapshot|null;confirmation_sheet?:QuoteExportSheet;document_mode?:'excel_confirmation'};
type Row={id:string;owner:string;kind:string;project:string;data:string;created:string};
type Deps={database:()=>D1Database|undefined;now?:()=>Date;customerAccess?:()=>boolean;freezeSheet?:(owner:string,id:string,sheet:QuoteExportSheet)=>Promise<QuoteExportSheet>};
const identifier=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/,'报价编号无效');
const createInput=z.object({id:z.string().uuid().optional(),quote_id:identifier,document_mode:z.literal('excel_confirmation').optional(),expires_days:z.union([z.literal(7),z.literal(30),z.literal(90)]).default(30),customer_note:z.string().trim().max(2000).default(''),collection_name:z.string().trim().min(1).max(100).optional(),collection_amount:z.number().finite().positive().max(100000000).optional(),payment_mode:z.enum(['manual_code','wechat']).default('manual_code'),payment_code_id:z.string().uuid().optional()}).superRefine((v,c)=>{if((v.collection_name===undefined)!==(v.collection_amount===undefined))c.addIssue({code:'custom',message:'请同时填写收款项名称和金额'});if(v.payment_code_id&&v.payment_mode!=='manual_code')c.addIssue({code:'custom',message:'静态收款码图片仅用于手动确认收款模式'});});
const ACTIVE_PARENT="EXISTS (SELECT 1 FROM records AS parent WHERE parent.id=? AND parent.owner=? AND parent.kind='project' AND COALESCE(json_extract(parent.data,'$.deleted'),0)=0)";
const ACTIVE_QUOTE="EXISTS (SELECT 1 FROM records AS quote WHERE quote.id=? AND quote.owner=? AND quote.kind='quote' AND quote.project=? AND COALESCE(json_extract(quote.data,'$.deleted'),0)=0)";
const ACTIVE_PAYMENT_CODE="(? IS NULL OR EXISTS (SELECT 1 FROM records AS code WHERE code.id=? AND code.owner=? AND code.kind='payment_code' AND code.data=? AND COALESCE(json_extract(code.data,'$.deleted'),0)=0))";
const clean=(v:unknown,max:number)=>String(v??'').slice(0,max);
const hash=async(token:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(v=>v.toString(16).padStart(2,'0')).join('');
function changes(result:any){const n=result?.meta?.changes;if(!Number.isSafeInteger(n)||n<0)throw new QuoteShareError('无法确认分享保存结果，请刷新核对',503);return n;}

/** Explicit customer field projection. Private notes and catalog costs never enter a share. */
export function quoteCustomerSnapshot(project:any,quote:any,companyName:string,created:string,expiresAt:string,customerNote='',collection:QuoteShareSnapshot['collection']=null,shareUrl=''):QuoteShareSnapshot{
 if(!Array.isArray(quote.items)||quote.items.length>500)throw new QuoteShareError('报价明细无效，请先核对并保存');
 const rooms=Array.isArray(quote.rooms)?quote.rooms.map((room:any)=>({id:clean(room.id,128),name:clean(room.name,100)})):[];
 if(new Set(rooms.map((room:any)=>room.id)).size!==rooms.length||rooms.some((room:any)=>!room.id||!room.name.trim()))throw new QuoteShareError('报价房间信息无效');
 if(project.project_type==='customer'&&!rooms.length)throw new QuoteShareError('整户报价需要房间信息');
 const items=quote.items.map((raw:any)=>{const item=normalizeQuoteItem(raw);const line={name:clean(item.name,100),model:clean(item.model,100),unit:clean(item.unit,30),quantity:item.quantity,price:item.price,category:QUOTE_CATEGORIES.includes(item.category)?item.category:'材料费用',...(typeof item.room_id==='string'?{room_id:item.room_id}:{})};const price=Math.round(line.price*100),amount=Math.round(line.quantity*price);if(!line.name.trim()||!Number.isFinite(line.quantity)||line.quantity<=0||!Number.isFinite(line.price)||line.price<0||!Number.isSafeInteger(price)||!Number.isSafeInteger(amount)||amount<0)throw new QuoteShareError('报价数量或金额无效');if(rooms.length&&!rooms.some((room:any)=>room.id===line.room_id))throw new QuoteShareError('报价明细未关联有效房间');return line;});
 const total=items.reduce((sum:number,line:any)=>sum+Math.round(line.quantity*Math.round(line.price*100)),0);
 if(!Number.isSafeInteger(total)||total<0||total!==quote.total)throw new QuoteShareError('报价明细与总额不一致，请先保存报价');
 let settlement:QuoteShareSnapshot['settlement']=null;
 if(project.project_type==='customer'&&quote.adopted===true){try{settlement=getQuoteSettlement(total,{adopted:true,discount_amount:project.discount_amount||0,rounding_amount:project.rounding_amount||0});}catch{throw new QuoteShareError('客户优惠、抹零与报价金额不一致');}}
 if(collection&&(!collection.name.trim()||!Number.isSafeInteger(collection.amount)||collection.amount<1||collection.amount>(settlement?.receivable??total)))throw new QuoteShareError('本次收款金额须大于零且不能超过此份报价应收');
 return {company_name:clean(companyName||DEFAULT_COMPANY_NAME,200),project_name:clean(quote.subproject_name||project.name,100),customer:clean(project.customer,100),title:clean(quote.title,100),created,expires_at:expiresAt,rooms,items,total,settlement,customer_note:clean(customerNote,2000),collection:collection?{name:collection.name,amount:collection.amount}:null,share_url:shareUrl};
}

export function createQuoteShareService(deps:Deps){
 const now=()=>deps.now?.()??new Date();
 function database(){const db=deps.database();if(!db)throw new QuoteShareError('数据库尚未就绪',503);return db;}
 async function load(owner:string){if(!owner)throw new QuoteShareError('请先登录',401);const r=await database().prepare('SELECT * FROM records WHERE owner=?').bind(owner).all<Row>();return r.results.map(row=>({...row,value:JSON.parse(row.data)}));}
 function get(all:any[],id:unknown,kind:string){const row=all.find(r=>r.id===id&&r.kind===kind&&!r.value.deleted);if(!row)throw new QuoteShareError('记录不存在、已删除或无权访问',404);return row;}
 function availability(){const enabled=deps.customerAccess?.()===true;return {enabled,message:enabled?'客户可凭此链接查看报价。':'客户免登录访问尚未启用，当前链接仅供你预览；启用后再发给客户。'};}
 function display(row:any,origin:string){const d=row.value;return {id:row.id,url:origin+'/s/q/'+d.token,expires_at:d.expires_at,created:row.created,revoked:d.revoked===true,expired:Date.parse(d.expires_at)<=now().getTime(),title:d.snapshot.title,collection:d.snapshot.collection,payment_mode:d.snapshot.payment_mode??'wechat',payment_code:d.snapshot.payment_code??null,signed:!!d.signature,signed_at:d.signed_at||null,availability:availability()};}
 async function list(owner:string,quoteId:string,origin:string){identifier.parse(quoteId);const all=await load(owner),quote=get(all,quoteId,'quote');get(all,quote.project,'project');return all.filter(r=>r.kind==='quote_share'&&r.value.quote_id===quoteId&&!r.value.deleted).sort((a,b)=>b.created.localeCompare(a.created)).map(r=>display(r,origin));}
 async function create(owner:string,args:any,origin:string){
  const input=createInput.parse(args),all=await load(owner),quote=get(all,input.quote_id,'quote'),project=get(all,quote.project,'project');
  const existing=input.id?all.find(r=>r.id===input.id):undefined;if(existing){if(existing.kind!=='quote_share'||JSON.stringify(existing.value.request)!==JSON.stringify(input))throw new QuoteShareError('重复分享编号对应不同内容',409);return display(existing,origin);}
  const token=randomToken(),id=input.id||crypto.randomUUID(),lookup='qs_'+await hash(token),created=now().toISOString(),expires_at=new Date(now().getTime()+input.expires_days*86400000).toISOString();
  const collection=input.collection_name!==undefined?{name:input.collection_name,amount:paymentAmountCents(input.collection_amount!)}:null;
  const company=all.find(r=>r.kind==='company_profile'&&!r.value.deleted)?.value.name||DEFAULT_COMPANY_NAME;
  const snapshot=quoteCustomerSnapshot({...project.value,project_type:project.value.project_type||'project'},quote.value,company,created,expires_at,input.customer_note,collection,origin+'/s/q/'+token);
  if(input.document_mode==='excel_confirmation'){
   const sheet=buildQuoteExportSheets({project:{...project.value,id:project.id},companyName:company,quote:quote.value})[0];
   snapshot.confirmation_sheet=deps.freezeSheet?await deps.freezeSheet(owner,id,sheet):sheet;
   snapshot.document_mode='excel_confirmation';
  }
  const code=input.payment_code_id?get(all,input.payment_code_id,'payment_code'):null;
  snapshot.payment_mode=input.payment_mode;snapshot.payment_code=code?paymentCodeSnapshot(code,owner):null;
  const value={token,lookup,quote_id:quote.id,quote_title:quote.value.title,expires_at,revoked:false,snapshot,request:input};
  const results=await database().batch([database().prepare('INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,? WHERE '+ACTIVE_PARENT+' AND '+ACTIVE_QUOTE+' AND '+ACTIVE_PAYMENT_CODE+" AND EXISTS (SELECT 1 FROM records WHERE id=? AND owner=? AND kind='quote' AND data=?) AND EXISTS (SELECT 1 FROM records WHERE id=? AND owner=? AND kind='project' AND data=?)"+' AND NOT EXISTS (SELECT 1 FROM records WHERE id=?) ON CONFLICT(id) DO NOTHING').bind(id,owner,'quote_share',project.id,JSON.stringify(value),created,project.id,owner,quote.id,owner,project.id,code?.id??null,code?.id??null,owner,code?.data??null,quote.id,owner,quote.data,project.id,owner,project.data,id),database().prepare('INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,? WHERE changes()>0').bind(crypto.randomUUID(),owner,'audit',project.id,JSON.stringify({action:'create_quote_share',detail:'创建客户报价快照分享',record_id:id,source_quote_id:quote.id}),created)]);
  if(!changes(results[0]))throw new QuoteShareError('报价在操作期间已变化，请刷新后重试',409);
  return display({id,created,value},origin);
 }
 async function revoke(owner:string,id:string){z.string().uuid().parse(id);const all=await load(owner),row=get(all,id,'quote_share');if(row.value.revoked)return {id,revoked:true};const updated={...row.value,revoked:true,revoked_at:now().toISOString()};const r=await database().batch([database().prepare("UPDATE records SET data=? WHERE id=? AND owner=? AND kind='quote_share' AND data=?").bind(JSON.stringify(updated),id,owner,row.data),database().prepare('INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,? WHERE changes()>0').bind(crypto.randomUUID(),owner,'audit',row.project,JSON.stringify({action:'revoke_quote_share',detail:'停用客户报价链接',record_id:id}),now().toISOString())]);if(!changes(r[0]))throw new QuoteShareError('分享状态已变化，请刷新核对',409);return {id,revoked:true};}
 async function saveSignature(token:string,signatureDataUrl:string,_clientTime?:string){
  if(!/^[a-f0-9]{64}$/.test(token))throw new QuoteShareError('报价链接不存在或已失效',404);
  if(typeof signatureDataUrl!=='string'||signatureDataUrl.length>500000||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(signatureDataUrl))throw new QuoteShareError('签字图片无效',400);
  const bytes=Uint8Array.from(atob(signatureDataUrl.slice(22)),c=>c.charCodeAt(0));
  try{await validateSignaturePng(bytes);}catch{throw new QuoteShareError('签字图片已损坏，请重新签字',400);}
  const view=new DataView(bytes.buffer);
  if(bytes.length<67||Array.from(bytes.slice(0,8)).join(',')!=='137,80,78,71,13,10,26,10'||view.getUint32(12)!==0x49484452||view.getUint32(16)<1||view.getUint32(16)>2048||view.getUint32(20)<1||view.getUint32(20)>1024)throw new QuoteShareError('签字图片无效',400);
  const share=await read(token),r=await database().prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='quote_share'").bind(share.id,share.owner).all<Row>();
  const row=r.results[0];if(!row)throw new QuoteShareError('报价链接不存在',404);const value=JSON.parse(row.data);
  if(value.revoked||value.deleted||Date.parse(value.expires_at)<=now().getTime())throw new QuoteShareError('报价链接已停用或已到期',410);
  if(value.signature){if(value.signature===signatureDataUrl)return {ok:true,signed_at:value.signed_at};throw new QuoteShareError('该报价已经确认签字，不能覆盖存根，请联系商家生成新的确认单',409);}
  const signedAt=now().toISOString(),snapshot_hash=await hash(JSON.stringify(value.snapshot));
  const updated={...value,signature:signatureDataUrl,signed_at:signedAt,snapshot_hash,confirmation_status:'confirmed'};
  const results=await database().batch([
   database().prepare("UPDATE records SET data=? WHERE id=? AND owner=? AND kind='quote_share' AND data=? AND "+ACTIVE_PARENT+' AND '+ACTIVE_QUOTE).bind(JSON.stringify(updated),row.id,row.owner,row.data,row.project,row.owner,value.quote_id,row.owner,row.project),
   database().prepare('INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,? WHERE changes()>0').bind(crypto.randomUUID(),row.owner,'audit',row.project,JSON.stringify({action:'sign_quote_confirmation',record_id:row.id,source_quote_id:value.quote_id,detail:'客户签字确认报价，已保存表格快照和签名存根',snapshot_hash,signed_at:signedAt}),signedAt)
  ]);
  if(!changes(results[0]))throw new QuoteShareError('确认单状态已变化，请刷新后核对',409);
  return {ok:true,signed_at:signedAt};
 }
 async function receipt(owner:string,id:string){
  z.string().uuid().parse(id);const all=await load(owner),row=get(all,id,'quote_share');
  return {id:row.id,owner:row.owner,snapshot:row.value.snapshot as QuoteShareSnapshot,signature:row.value.signature as string|undefined,signed_at:row.value.signed_at as string|undefined};
 }
 async function read(token:string){
  if(!/^[a-f0-9]{64}$/.test(token))throw new QuoteShareError('报价链接不存在或已失效',404);
  const lookup='qs_'+await hash(token),r=await database().prepare("SELECT * FROM records WHERE kind='quote_share' AND json_extract(data,'$.lookup')=? LIMIT 1").bind(lookup).all<Row>();
  const row=r.results[0];if(!row)throw new QuoteShareError('报价链接不存在或已失效',404);const value=JSON.parse(row.data);
  if(value.revoked||value.deleted||!Number.isFinite(Date.parse(value.expires_at))||Date.parse(value.expires_at)<=now().getTime())throw new QuoteShareError('报价链接已停用或已到期，请联系商家',410);
  const parents=await database().prepare("SELECT id,kind FROM records WHERE owner=? AND ((id=? AND kind='project') OR (id=? AND kind='quote' AND project=?)) AND COALESCE(json_extract(data,'$.deleted'),0)=0").bind(row.owner,row.project,value.quote_id,row.project).all<{id:string;kind:string}>();
  if(parents.results.length!==2)throw new QuoteShareError('报价链接已失效，请联系商家',410);
  return {id:row.id,owner:row.owner,project_id:row.project,quote_id:value.quote_id,quote_title:value.quote_title,snapshot:value.snapshot as QuoteShareSnapshot,collection:value.snapshot.collection as QuoteShareSnapshot['collection'],expires_at:value.expires_at,signature:value.signature as string|undefined,signed_at:value.signed_at as string|undefined};
 }
 return {list,create,revoke,read,saveSignature,receipt,availability};
}
async function freezeSheet(owner:string,id:string,sheet:QuoteExportSheet):Promise<QuoteExportSheet>{
 const photos=sheet.photoRows||[];if(!photos.length)return sheet;
 if(photos.length>60)throw new QuoteShareError('报价附件超过60张，请分批生成确认单');
 const bucket=env.BUCKET;if(!bucket)throw new QuoteShareError('文件存储尚未就绪',503);
 const frozen:NonNullable<QuoteExportSheet['photoRows']>=[];
 for(const [index,photo] of photos.entries()){
  const key=new URL(photo.src,'https://local.invalid').searchParams.get('key')||'';
  if(!key.startsWith(encodeURIComponent(owner)+'/quote-items/'))throw new QuoteShareError('报价附件无权访问',403);
  const object=await bucket.get(key);if(!object)throw new QuoteShareError('报价中的附件不存在，请补传后生成确认单',409);
  const mime=object.customMetadata?.mime||object.httpMetadata?.contentType||'';
  if(!['image/png','image/jpeg','image/webp'].includes(mime))throw new QuoteShareError('报价附件包含非图片文件，请先核对下载Excel的附件列',400);
  const copyKey=encodeURIComponent(owner)+'/quote-confirmations/'+id+'/'+index;
  await bucket.put(copyKey,await object.arrayBuffer(),{httpMetadata:{contentType:mime},customMetadata:{mime,name:photo.name}});
  frozen.push({...photo,src:copyKey});
 }
 return {...sheet,photoRows:frozen};
}
export const quoteShareService=createQuoteShareService({database:()=>env.DB,customerAccess:()=>true,freezeSheet});
export const readQuoteShareForPayment=quoteShareService.read;
