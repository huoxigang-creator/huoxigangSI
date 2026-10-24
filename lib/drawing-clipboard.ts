/** Screenshot intake reads image payloads only. Text/HTML clipboard contents are ignored. */
export const MAX_SCREENSHOT_BYTES=10*1024*1024;
const supported=(type:string)=>/^image\/(png|jpeg|webp)$/.test(type);
let sequence=0;
export function screenshotFile(blob:Blob){
 if(!supported(blob.type))throw new Error('截图请使用PNG、JPG或WebP格式');
 if(!blob.size||blob.size>MAX_SCREENSHOT_BYTES)throw new Error('截图不能为空，每张不能超过10MB');
 const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date()).replace(/[: ]/g,'-');
 return new File([blob],`截图-${stamp}-${++sequence}.${blob.type==='image/jpeg'?'jpg':blob.type.slice(6)}`,{type:blob.type});
}
export function pastedScreenshotFiles(data:Pick<DataTransfer,'items'|'files'>|null){
 if(!data)return [];
 const items=Array.from(data.items||[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter((file):file is File=>!!file);
 return items.length?items:Array.from(data.files||[]).filter(file=>file.type.startsWith('image/'));
}
export async function screenshotFingerprint(blob:Blob){
 const bytes=await blob.arrayBuffer();
 if(globalThis.crypto?.subtle){const hash=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');}
 // Paste still works on legacy HTTP browsers without WebCrypto. Hash is for deduplication only.
 let a=2166136261,b=5381;for(const byte of new Uint8Array(bytes)){a=Math.imul(a^byte,16777619);b=Math.imul(b,33)^byte;}
 return `${blob.size}:${a>>>0}:${b>>>0}`;
}
export function createScreenshotWatcher({read,isFocused,onFiles,onError}:{read:()=>Promise<readonly Pick<ClipboardItem,'types'|'getType'>[]>;isFocused:()=>boolean;onFiles:(files:File[])=>void|Promise<void>;onError:(error:unknown)=>void}){
 let stopped=false,reading=false,primed=false,last='';
 async function scan(baseline:boolean){
  if(stopped||reading||!isFocused())return false;reading=true;
  try{
   const items=await read(),files:File[]=[];
   for(const item of items.slice(0,20)){const type=item.types.find(supported);if(type)files.push(screenshotFile(await item.getType(type)));}
   if(stopped||!isFocused())return false;
   const key=(await Promise.all(files.map(screenshotFingerprint))).join('|');
   if(stopped||!isFocused())return false;
   if(baseline||!primed){last=key;primed=true;return true;}
   if(key===last)return true;last=key;
   if(files.length)await onFiles(files);return true;
  }finally{reading=false;}
 }
 return {
  async prime(){if(!await scan(true))throw new Error('请回到本页后再开启截图自动接收');},
  async poll(){try{await scan(false);}catch(error){if(!stopped)onError(error);}},
  stop(){stopped=true;},
 };
}
