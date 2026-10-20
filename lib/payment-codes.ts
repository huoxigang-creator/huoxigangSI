import {env} from './local-env';
import {PDFDocument} from 'pdf-lib';

export class PaymentCodeError extends Error {constructor(message:string,public status=400){super(message);}}
export type PaymentCodeContentType='image/png'|'image/jpeg';
export type PaymentCodeSnapshot={id:string;label:string;content_type:PaymentCodeContentType;width:number;height:number};
export type PaymentCodeMetadata=PaymentCodeSnapshot&{created:string;image_url:string};
type Row={id:string;owner:string;data:string;created:string};
type Stored={label:string;content_type:PaymentCodeContentType;width:number;height:number;object_key:string;sha256:string;deleted?:boolean};
type Deps={database:()=>D1Database|undefined;bucket:()=>R2Bucket|undefined;now?:()=>Date};
export const MAX_PAYMENT_CODE_BYTES=5*1024*1024;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pngMagic=[137,80,78,71,13,10,26,10];
const dimensionCheck=(width:number,height:number)=>{if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096||width*height>10000000)throw new PaymentCodeError('收款码图片须在 4096 像素以内，且不超过 1000 万像素');};
function invalid():never {throw new PaymentCodeError('图片已损坏或格式无效，请上传完整的 PNG 或 JPEG 图片');}
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes:Uint8Array,start:number,end:number){let c=0xffffffff;for(let p=start;p<end;p++)c=crcTable[(c^bytes[p])&255]^(c>>>8);return (c^0xffffffff)>>>0;}

/** Validate the original image; no raster conversion, resizing, or recompression occurs. */
export function validatePaymentCodeImage(bytes:Uint8Array,declaredType?:string):{content_type:PaymentCodeContentType;width:number;height:number}{
 if(!bytes.length||bytes.length>MAX_PAYMENT_CODE_BYTES)throw new PaymentCodeError('收款码图片须小于或等于 5 MB',413);
 let width=0,height=0,content_type:PaymentCodeContentType;
 if(pngMagic.every((b,i)=>bytes[i]===b)){
  content_type='image/png';const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let p=8,ihdr=false,idat=false,ended=false;
  while(p<bytes.length){if(p+12>bytes.length)invalid();const len=view.getUint32(p),end=p+12+len;if(end>bytes.length)invalid();const type=String.fromCharCode(...bytes.subarray(p+4,p+8));if(!/^[A-Za-z]{4}$/.test(type)||crc32(bytes,p+4,p+8+len)!==view.getUint32(p+8+len))invalid();
   if(!ihdr){if(type!=='IHDR'||len!==13)invalid();width=view.getUint32(p+8);height=view.getUint32(p+12);dimensionCheck(width,height);const depth=bytes[p+16],color=bytes[p+17],allowed:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};if(!allowed[color]?.includes(depth)||bytes[p+18]!==0||bytes[p+19]!==0||bytes[p+20]>1)invalid();ihdr=true;
   }else if(type==='IHDR')invalid();
   if(type==='IDAT'){if(!len)invalid();idat=true;}
   if(type==='IEND'){if(len!==0||!idat||end!==bytes.length)invalid();ended=true;break;}p=end;
  }if(!ended)invalid();
 }else if(bytes[0]===255&&bytes[1]===216){
  content_type='image/jpeg';let p=2,frame=false,scan=false,ended=false;
  while(p<bytes.length){if(bytes[p++]!==255)invalid();while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===undefined||marker===0||marker===216)invalid();if(marker===217){if(!frame||!scan||p!==bytes.length)invalid();ended=true;break;}
   if(marker===1||(marker>=208&&marker<=215))invalid();if(p+2>bytes.length)invalid();const len=bytes[p]*256+bytes[p+1],end=p+len;if(len<2||end>bytes.length)invalid();
   if([192,193,194].includes(marker)){if(frame||len<8||bytes[p+2]!==8)invalid();height=bytes[p+3]*256+bytes[p+4];width=bytes[p+5]*256+bytes[p+6];dimensionCheck(width,height);const components=bytes[p+7];if(![1,3,4].includes(components)||len!==8+3*components)invalid();frame=true;}
   else if(marker>=192&&marker<=207&&![196,200,204].includes(marker))invalid();
   if(marker===218){if(!frame||len<6||len!==6+2*bytes[p+2])invalid();scan=true;p=end;let data=false;while(p<bytes.length){if(bytes[p]!==255){data=true;p++;continue;}if(bytes[p+1]===0||(bytes[p+1]>=208&&bytes[p+1]<=215)){data=true;p+=2;continue;}break;}if(!data)invalid();}else p=end;
  }if(!ended)invalid();
 }else invalid();
 if(declaredType&&declaredType!==content_type)throw new PaymentCodeError('图片类型与文件内容不一致，请上传 PNG 或 JPEG');
 return {content_type,width,height};
}
const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))).map(v=>v.toString(16).padStart(2,'0')).join('');
async function validatePngCompression(bytes:Uint8Array,width:number,height:number){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),parts:Uint8Array[]=[];let size=0;for(let p=8;p<bytes.length;){const len=view.getUint32(p),name=String.fromCharCode(...bytes.subarray(p+4,p+8));if(name==='IDAT'){parts.push(bytes.subarray(p+8,p+8+len));size+=len;}p+=len+12;}
 const compressed=new Uint8Array(size);let offset=0;for(const part of parts){compressed.set(part,offset);offset+=part.length;}
 const components:Record<number,number>={0:1,2:3,3:1,4:2,6:4},bits=components[bytes[25]]*bytes[24],filters:number[]=[];let expected=0;
 const passes=bytes[28]===0?[[0,0,1,1]]:[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];
 for(const [x,y,dx,dy] of passes){const w=Math.max(0,Math.ceil((width-x)/dx)),h=Math.max(0,Math.ceil((height-y)/dy));if(!w||!h)continue;const rowBytes=1+Math.ceil(w*bits/8);for(let row=0;row<h;row++){filters.push(expected);expected+=rowBytes;}}
 const reader=new Blob([compressed.buffer]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();let count=0,filter=0;
 try{while(true){const part=await reader.read();if(part.done)break;if(count+part.value.length>expected)invalid();while(filter<filters.length&&filters[filter]<count+part.value.length){if(part.value[filters[filter]-count]>4)invalid();filter++;}count+=part.value.length;}if(count!==expected||filter!==filters.length)invalid();}catch{await reader.cancel().catch(()=>{});invalid();}finally{reader.releaseLock();}
}
async function validateEmbedding(bytes:Uint8Array,type:PaymentCodeContentType,width:number,height:number){try{if(type==='image/png')await validatePngCompression(bytes,width,height);const doc=await PDFDocument.create(),image=type==='image/png'?await doc.embedPng(bytes):await doc.embedJpg(bytes);if(image.width!==width||image.height!==height)invalid();}catch{invalid();}}
/** Bounded image validation shared by quote confirmation signatures. */
export async function validateSignaturePng(bytes:Uint8Array){
 const valid=validatePaymentCodeImage(bytes,'image/png');
 if(valid.width>2048||valid.height>1024)throw new PaymentCodeError('签字图片尺寸无效');
 await validateEmbedding(bytes,'image/png',valid.width,valid.height);
}
async function objectKey(owner:string,id:string,type:PaymentCodeContentType){return 'payment-codes/'+await digest(new TextEncoder().encode(owner))+'/'+id+(type==='image/png'?'.png':'.jpg');}
export function paymentCodeSnapshot(row:{id:string;owner:string;data:string;created:string},owner:string):PaymentCodeSnapshot{
 if(row.owner!==owner||!uuid.test(row.id))throw new PaymentCodeError('收款码不存在或无权访问',404);
 let value:Stored;try{value=JSON.parse(row.data);}catch{throw new PaymentCodeError('收款码图片资料已损坏',503);}
 if(value.deleted)throw new PaymentCodeError('收款码不存在或无权访问',404);
 if(typeof value.label!=='string'||!value.label.trim()||value.label.length>100||!['image/png','image/jpeg'].includes(value.content_type))throw new PaymentCodeError('收款码图片资料已损坏',503);
 dimensionCheck(value.width,value.height);
 return {id:row.id,label:value.label,content_type:value.content_type,width:value.width,height:value.height};
}
export function createPaymentCodeService(deps:Deps){
 const now=()=>deps.now?.()??new Date();
 const ownerCheck=(owner:string)=>{if(!owner)throw new PaymentCodeError('请先登录',401);};
 function database(){const db=deps.database();if(!db)throw new PaymentCodeError('数据库尚未就绪',503);return db;}
 function bucket(){const b=deps.bucket();if(!b)throw new PaymentCodeError('图片存储尚未就绪',503);return b;}
 const metadataOf=(row:Row,owner:string):PaymentCodeMetadata=>({...paymentCodeSnapshot(row,owner),created:row.created,image_url:'/api/payment-codes?id='+encodeURIComponent(row.id)});
 async function rowFor(owner:string,id:string){ownerCheck(owner);if(!uuid.test(id))throw new PaymentCodeError('收款码不存在或无权访问',404);const r=await database().prepare("SELECT id,owner,data,created FROM records WHERE owner=? AND id=? AND kind='payment_code' LIMIT 1").bind(owner,id).all<Row>();if(!r.results[0])throw new PaymentCodeError('收款码不存在或无权访问',404);return r.results[0];}
 async function list(owner:string){ownerCheck(owner);const r=await database().prepare("SELECT id,owner,data,created FROM records WHERE owner=? AND kind='payment_code' AND COALESCE(json_extract(data,'$.deleted'),0)=0 ORDER BY created DESC,id DESC").bind(owner).all<Row>();return r.results.map(row=>metadataOf(row,owner));}
 async function metadata(owner:string,id:string){return metadataOf(await rowFor(owner,id),owner);}
 async function image(owner:string,id:string){const row=await rowFor(owner,id),metadata=metadataOf(row,owner),value=JSON.parse(row.data) as Stored,key=await objectKey(owner,id,metadata.content_type);if(value.object_key!==key||!/^[a-f0-9]{64}$/.test(value.sha256))throw new PaymentCodeError('收款码图片资料已损坏',503);const object=await bucket().get(key);if(!object||object.size>MAX_PAYMENT_CODE_BYTES)throw new PaymentCodeError('收款码图片暂时不可用，请联系商家',503);const bytes=new Uint8Array(await object.arrayBuffer());const valid=validatePaymentCodeImage(bytes,metadata.content_type);if(valid.width!==metadata.width||valid.height!==metadata.height||await digest(bytes)!==value.sha256)throw new PaymentCodeError('收款码图片校验失败，请联系商家',503);return {metadata,bytes};}
 async function upload(owner:string,input:{bytes:Uint8Array;contentType:string;label:string}){
  ownerCheck(owner);const db=database(),b=bucket(),label=typeof input.label==='string'?input.label.trim():'';if(!label||label.length>100)throw new PaymentCodeError('请填写 100 字以内的收款码名称');if(!['image/png','image/jpeg'].includes(input.contentType))throw new PaymentCodeError('仅支持 PNG 或 JPEG 收款码图片');const valid=validatePaymentCodeImage(input.bytes,input.contentType);await validateEmbedding(input.bytes,valid.content_type,valid.width,valid.height);const id=crypto.randomUUID(),created=now().toISOString(),key=await objectKey(owner,id,valid.content_type),value:Stored={label,...valid,object_key:key,sha256:await digest(input.bytes)};
  const stored=await b.put(key,new Uint8Array(input.bytes).buffer,{httpMetadata:{contentType:valid.content_type},onlyIf:{etagDoesNotMatch:'*'}});if(!stored)throw new PaymentCodeError('收款码图片未保存，请重试',503);
  try{const result=await db.batch([db.prepare('INSERT INTO records(id,owner,kind,project,data,created) VALUES(?,?,?,?,?,?)').bind(id,owner,'payment_code','',JSON.stringify(value),created),db.prepare('INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,? WHERE changes()>0').bind(crypto.randomUUID(),owner,'audit','',JSON.stringify({action:'upload_payment_code',record_id:id,detail:'上传静态收款码图片'}),created)]);if(result[0]?.meta?.changes!==1)throw new PaymentCodeError('收款码资料未保存，请重试',503);}catch(error){await b.delete(key).catch(()=>{});throw error;}
  return metadataOf({id,owner,data:JSON.stringify(value),created},owner);
 }
 return {list,metadata,image,upload};
}
export const paymentCodeService=createPaymentCodeService({database:()=>env.DB,bucket:()=>env.BUCKET});
