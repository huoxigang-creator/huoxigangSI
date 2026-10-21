import {drawingFromWords,type DrawingRow} from './drawing-import';
import {parseDocumentTable,parseDocumentText,parseDocumentWords,type DocumentImportPreview} from './document-import';
import {documentOcrWords} from './document-ocr';
import type {QuoteCategory} from './quotes';

export const DOCUMENT_IMPORT_ACCEPT='.png,.jpg,.jpeg,.webp,.pdf,.xlsx,.xls,.csv,.docx,.txt,.tsv';
export const DOCUMENT_IMPORT_LIMITS={files:5,fileBytes:10*1024*1024,totalBytes:25*1024*1024,pages:10,rows:500};
type Word={text:string;bbox:{x0:number;y0:number;x1:number;y1:number};confidence?:number};
export type DocumentScanOptions={mode:'quote'|'purchase';defaultCategory:QuoteCategory;drawingRows?:DrawingRow[];textOutput?:string[];signal?:AbortSignal;onProgress?:(message:string,progress:number)=>void};
type OcrWorker=import('tesseract.js').Worker;
const ROOT='/assets/document-ocr';
const aborted=()=>new DOMException('已取消识别','AbortError');
function check(signal?:AbortSignal){if(signal?.aborted)throw aborted();}
function within<T>(promise:Promise<T>,signal?:AbortSignal,timeout=180000):Promise<T>{
 return new Promise((resolve,reject)=>{let done=false;const finish=(action:()=>void)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);action();};const cancel=()=>finish(()=>reject(aborted()));const timer=setTimeout(()=>finish(()=>reject(Error('文件识别超时，请减少页数或选择更清晰的图片后重试。'))),timeout);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();promise.then(value=>finish(()=>resolve(value)),error=>finish(()=>reject(error)));});
}
export function validateDocumentFiles(files:File[]){
 if(!files.length||files.length>DOCUMENT_IMPORT_LIMITS.files)throw Error('每次请选择 1 至 5 个文件。');
 if(files.reduce((sum,file)=>sum+file.size,0)>DOCUMENT_IMPORT_LIMITS.totalBytes)throw Error('所选文件合计不能超过 25 MB。');
 for(const file of files){if(!file.size||file.size>DOCUMENT_IMPORT_LIMITS.fileBytes)throw Error(file.name+'须大于 0 且不超过 10 MB。');if(!/\.(png|jpe?g|webp|pdf|xlsx?|csv|docx|txt|tsv)$/i.test(file.name))throw Error('支持 PNG/JPG/WebP 图片、PDF、Excel/CSV、Word DOCX、TXT/TSV 文件。');}
}
export function validateDocumentArchive(bytes:Uint8Array){
 if(bytes[0]!==80||bytes[1]!==75)return;
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let expanded=0,entries=0;
 for(let p=0;p+46<=bytes.length;p++){if(view.getUint32(p,true)!==0x02014b50)continue;entries++;const size=view.getUint32(p+24,true),name=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true);if(p+46+name+extra+comment>bytes.length)throw Error('压缩文件目录损坏，请重新保存文件。');expanded+=size;if(size>32*1024*1024||expanded>64*1024*1024||entries>2000)throw Error('文档解压后过大，请拆分文件后导入。');p+=45+name+extra+comment;}
 if(!entries)throw Error('文档压缩目录无效，请重新保存文件。');
}
function decode(bytes:Uint8Array){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return new TextDecoder('gb18030',{fatal:true}).decode(bytes);}}
export function mergeDocumentPreviews(previews:DocumentImportPreview[]):DocumentImportPreview{
 const rows=previews.flatMap(value=>value.rows);if(rows.length>DOCUMENT_IMPORT_LIMITS.rows)throw Error('每次最多识别 500 条明细，请分批上传。');
 const kinds=new Set(previews.filter(value=>value.rows.length).map(value=>value.priceKind)),kind=kinds.has('cost')?'cost':kinds.size===1?[...kinds][0]:'unknown';
 const warnings=[...new Set(previews.flatMap(value=>value.warnings))];if(kinds.size>1)warnings.push('不同文件的单价用途不同，请逐项核对，尤其不要把采购价直接作为销售价。');
 const seen=new Set<string>();let duplicates=0;for(const row of rows){const key=[row.category,row.name,row.model,row.unit,row.quantity,row.price].join('\u0000');if(seen.has(key))duplicates++;seen.add(key);}if(duplicates)warnings.push('存在 '+duplicates+' 条内容相同的明细，请核对是否重复；未自动删除。');
 return {rows,warnings,priceKind:kind,sources:[...new Set(previews.flatMap(value=>value.sources))],tables:previews.flatMap(value=>value.tables||[])};
}
export async function readDocumentFiles(files:File[],options:DocumentScanOptions):Promise<DocumentImportPreview>{
 validateDocumentFiles(files);check(options.signal);const previews:DocumentImportPreview[]=[],base={mode:options.mode,defaultCategory:options.defaultCategory};let worker:OcrWorker|undefined,pages=0,position=0,stopped=false;
 const progress=(message:string,value:number)=>{if(!stopped)options.onProgress?.(message,Math.max(0,Math.min(100,value)));};
 const stop=()=>{stopped=true;void worker?.terminate().catch(()=>{});};options.signal?.addEventListener('abort',stop,{once:true});
 const pageSlot=()=>{if(++pages>DOCUMENT_IMPORT_LIMITS.pages)throw Error('图片和 PDF 合计最多识别 10 页，请分批上传。');};
 async function ocr(image:HTMLCanvasElement,source:string){
  check(options.signal);if(!worker){const {createWorker,OEM}=await import('tesseract.js');const fast=Boolean(options.drawingRows||options.textOutput);const pending=createWorker('chi_sim',OEM.LSTM_ONLY,{workerPath:ROOT+'/7.0.0/worker.min.js',corePath:ROOT+'/7.0.0',langPath:ROOT+(fast?'/languages/fast':'/languages/full'),gzip:true,legacyCore:false,legacyLang:false,workerBlobURL:false,cachePath:fast?'gugemei-document-ocr-7-fast-20261021':'gugemei-document-ocr-7-full-20261014',logger:message=>{if(message.status==='recognizing text')progress('正在识别 '+source,position+Math.min(15,message.progress*15));else progress('正在准备中文字库…',position);}});pending.then(value=>{if(stopped)void value.terminate().catch(()=>{});}).catch(()=>{});worker=await within(pending,options.signal);await worker.setParameters({preserve_interword_spaces:'1',user_defined_dpi:'300',...(fast?{tessedit_pageseg_mode:'11' as import('tesseract.js').PSM}:{})});}
  const result=await within(worker.recognize(image,{}, {text:true,blocks:true}),options.signal),words=documentOcrWords(result.data.blocks);
  if(options.textOutput){options.textOutput.push(result.data.text);return;}
  if(options.drawingRows){
   const rotated=document.createElement('canvas');rotated.width=image.height;rotated.height=image.width;const ctx=rotated.getContext('2d');
   if(ctx){ctx.translate(image.height,0);ctx.rotate(Math.PI/2);ctx.drawImage(image,0,0);const sideways=await within(worker.recognize(rotated,{}, {text:true,blocks:true}),options.signal);for(const word of documentOcrWords(sideways.data.blocks)){if(!/^\d{3,5}(?:\.\d+)?$/.test(word.text.trim()))continue;words.push({...word,bbox:{x0:word.bbox.y0,y0:image.height-word.bbox.x1,x1:word.bbox.y1,y1:image.height-word.bbox.x0}});}}
   rotated.width=0;rotated.height=0;options.drawingRows.push(drawingFromWords(words,source));return;
  }
  const preview=words.length?parseDocumentWords(words,{...base,source}):parseDocumentText(result.data.text,{...base,source});preview.warnings.unshift('图片识别结果可能有错字，请核对名称、数量、单位和单价。');previews.push(preview);
 }
 async function imageFile(file:File,source:string,countPage=true){
  if(countPage)pageSlot();check(options.signal);let image:ImageBitmap|HTMLImageElement|undefined,url:string|undefined,canvas:HTMLCanvasElement|undefined;
  try{if(typeof createImageBitmap==='function')image=await within(createImageBitmap(file),options.signal,30000);else{url=URL.createObjectURL(file);const element=new Image();image=element;await within(new Promise<void>((resolve,reject)=>{element.onload=()=>resolve();element.onerror=()=>reject(Error('图片无法读取，请上传完整的 PNG/JPG/WebP。'));element.src=url!;}),options.signal,30000);}
   const width=image instanceof HTMLImageElement?image.naturalWidth:image.width,height=image instanceof HTMLImageElement?image.naturalHeight:image.height;if(!width||!height||width*height>30000000||width>12000||height>12000)throw Error('图片尺寸过大，请截取明细区域后上传。');const scale=Math.min(options.drawingRows||options.textOutput?2:1,2800/Math.max(width,height));canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));const context=canvas.getContext('2d');if(!context)throw Error('当前浏览器无法处理图片，请使用桌面浏览器。');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);if(options.drawingRows||options.textOutput){const pixels=context.getImageData(0,0,canvas.width,canvas.height);let sum=0;for(let i=0;i<pixels.data.length;i+=4)sum+=pixels.data[i]+pixels.data[i+1]+pixels.data[i+2];if(sum/(pixels.data.length/4*3)<100){for(let i=0;i<pixels.data.length;i+=4){const v=255-Math.max(pixels.data[i],pixels.data[i+1],pixels.data[i+2]);pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;}context.putImageData(pixels,0,0);}}await ocr(canvas,source);
  }finally{if(image&&'close' in image)image.close();if(url)URL.revokeObjectURL(url);if(canvas){canvas.width=0;canvas.height=0;}}
 }
 async function pdfFile(bytes:Uint8Array,file:File){
  const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=ROOT+'/pdf/pdf.worker.min.mjs';const task=pdfjs.getDocument({data:new Uint8Array(bytes),cMapUrl:ROOT+'/pdf/cmaps/',cMapPacked:true,standardFontDataUrl:ROOT+'/pdf/standard_fonts/',wasmUrl:ROOT+'/pdf/wasm/',iccUrl:ROOT+'/pdf/iccs/',enableXfa:false});const cancel=()=>{void task.destroy().catch(()=>{});};options.signal?.addEventListener('abort',cancel,{once:true});
  try{const pdf=await within(task.promise,options.signal,60000);if(pdf.numPages+pages>DOCUMENT_IMPORT_LIMITS.pages)throw Error('图片和 PDF 合计最多识别 10 页，请分批上传。');
   for(let number=1;number<=pdf.numPages;number++){check(options.signal);pageSlot();const page=await pdf.getPage(number),viewport=page.getViewport({scale:1}),source=file.name+' · 第'+number+'页';progress('正在读取 '+source,position);const content=await within(page.getTextContent(),options.signal,30000),words:Word[]=[];
    for(const item of content.items){if(!('str' in item)||!item.str.trim())continue;const transform=pdfjs.Util.transform(viewport.transform,item.transform),height=Math.max(Math.hypot(transform[2],transform[3]),item.height,1),tokens=item.str.match(/\S+/gu)||[];let offset=0;for(const text of tokens){const start=item.str.indexOf(text,offset);offset=start+text.length;const x=transform[4]+item.width*start/Math.max(1,item.str.length);words.push({text,bbox:{x0:x,y0:transform[5]-height,x1:x+item.width*text.length/Math.max(1,item.str.length),y1:transform[5]}});}}
    let preview:DocumentImportPreview|undefined;if(words.length){preview=parseDocumentWords(words,{...base,source});}
    if(preview?.rows.some(row=>row.name.trim()&&row.quantity.trim()&&row.unit.trim())){previews.push(preview);}else{const scale=Math.min(2.2,2800/Math.max(viewport.width,viewport.height)),rendered=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.ceil(rendered.width);canvas.height=Math.ceil(rendered.height);const context=canvas.getContext('2d');if(!context)throw Error('当前浏览器无法读取扫描 PDF。');const render=page.render({canvas,canvasContext:context,viewport:rendered});const abortRender=()=>render.cancel();options.signal?.addEventListener('abort',abortRender,{once:true});try{await within(render.promise,options.signal,60000);await ocr(canvas,source);}finally{options.signal?.removeEventListener('abort',abortRender);canvas.width=0;canvas.height=0;}}
    page.cleanup();
   }
  }finally{options.signal?.removeEventListener('abort',cancel);await within(task.destroy(),undefined,3000).catch(()=>{});}
 }
 try{for(let index=0;index<files.length;index++){const file=files[index];position=index/files.length*85;check(options.signal);progress('正在读取 '+file.name,position);const extension=file.name.split('.').pop()!.toLowerCase();
   if(['png','jpg','jpeg','webp'].includes(extension)){await imageFile(file,file.name);continue;}const bytes=new Uint8Array(await within(file.arrayBuffer(),options.signal,30000));check(options.signal);
   if(extension==='pdf'){await pdfFile(bytes,file);continue;}
   if(['txt','tsv'].includes(extension)){previews.push(parseDocumentText(decode(bytes),{...base,source:file.name}));continue;}
   const XLSX=await import('xlsx');validateDocumentArchive(bytes);
   if(extension==='xlsx'){
    // SheetJS synthesizes zero for some formula cells with no cached result. Inspect
    // the original XML first, so an uncalculated price is never imported as free.
    const CFB=(await import('cfb')).default,zip=CFB.read(bytes,{type:'array'});
    for(let entry=0;entry<zip.FullPaths.length;entry++)if(/\/xl\/worksheets\/[^/]+\.xml$/i.test(zip.FullPaths[entry])){
     const content=decode(new Uint8Array(zip.FileIndex[entry].content as Uint8Array));
     for(const cell of content.matchAll(/<(?:\w+:)?c\b[^>]*>[\s\S]*?<\/(?:\w+:)?c>/g))if(/<(?:\w+:)?f(?:\s|>)/.test(cell[0])&&!/<(?:\w+:)?v(?:\s[^>]*)?>\s*[^\s<][\s\S]*?<\/(?:\w+:)?v>/.test(cell[0]))throw Error('表格公式缺少计算结果，请在 Excel 中重算保存。');
    }
   }
   if(extension==='docx'){
    const CFB=(await import('cfb')).default,zip=CFB.read(bytes,{type:'array'}),entry=CFB.find(zip,'/word/document.xml');if(!entry?.content)throw Error('Word 文档缺少正文，请另存为 DOCX 后重试。');const xml=new DOMParser().parseFromString(decode(new Uint8Array(entry.content)),'application/xml');if(xml.querySelector('parsererror'))throw Error('Word 文档内容损坏。');const tables=[...xml.getElementsByTagName('w:tbl')];let imported=0;for(let table=0;table<tables.length;table++){const values=[...tables[table].getElementsByTagName('w:tr')].map(row=>[...row.children].filter(cell=>cell.localName==='tc').map(cell=>[...cell.getElementsByTagName('w:t')].map(text=>text.textContent||'').join(''))),preview=parseDocumentTable(values,{...base,source:file.name+' · 表格'+(table+1)});imported+=preview.rows.length;previews.push(preview);}if(!imported){const text=[...xml.getElementsByTagName('w:p')].map(paragraph=>[...paragraph.getElementsByTagName('w:t')].map(part=>part.textContent||'').join('')).join('\n'),preview=parseDocumentText(text,{...base,source:file.name});if(preview.rows.length)previews.push(preview);else{const media=zip.FileIndex.filter(part=>/\.(png|jpe?g|webp)$/i.test(part.name));if(!media.length)previews.push(preview);for(const [number,part] of media.entries())await imageFile(new File([new Uint8Array(part.content as Uint8Array)],part.name,{type:/\.png$/i.test(part.name)?'image/png':'image/jpeg'}),file.name+' · 图片'+(number+1));}}continue;
   }
   const content=extension==='csv'?decode(bytes):bytes,book=XLSX.read(content,{type:typeof content==='string'?'string':'array',raw:true,cellFormula:true,sheetStubs:true});for(const name of book.SheetNames){const sheet=book.Sheets[name];if(!sheet['!ref'])continue;const range=XLSX.utils.decode_range(sheet['!ref']);if(range.e.r>=5000||range.e.c>=60)throw Error('工作表最多支持 5000 行、60 列。');for(const key of Object.keys(sheet).filter(key=>!key.startsWith('!'))){const cell=sheet[key];if(cell.t==='e'||(cell.f&&cell.v==null))throw Error('表格公式错误或缺少计算结果，请在 Excel 中重算保存。');}previews.push(parseDocumentTable(XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true,range:0}) as unknown[][],{...base,source:file.name+' / '+name}));}
  }check(options.signal);const result=mergeDocumentPreviews(previews);if(!result.rows.length&&!options.drawingRows?.length&&!options.textOutput?.length)throw Error('未识别到明细。请上传带有名称、单位、数量、单价表头的清晰表格，或先截取明细区域。');progress('识别完成，请核对明细。',100);return result;
 }catch(error){if(options.signal?.aborted||error instanceof DOMException&&error.name==='AbortError')throw aborted();if(error instanceof Error&&/密码|password/i.test(error.message))throw Error('文档需要密码，请先解锁后重新上传。');throw error instanceof Error?error:Error('文件识别失败，请重新选择文件。');}
 finally{stop();options.signal?.removeEventListener('abort',stop);}
}
