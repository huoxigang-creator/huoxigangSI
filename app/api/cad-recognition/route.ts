import {parseDxfText,CadImportError} from '../../../lib/dxf-import';
import {selectionInput,selectionHeaders,selectionFailure,selectionOwner} from '../../../lib/material-selection-http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const run=promisify(execFile);
let active=0;
const MAX_CAD_BYTES=100*1024*1024;
async function binaryCadInput(r:Request){
 const origin=r.headers.get('origin');
 if(origin&&origin!==new URL(r.url).origin||r.headers.get('sec-fetch-site')==='cross-site')throw new CadImportError('不允许跨站操作',403);
 if(Number(r.headers.get('content-length'))>MAX_CAD_BYTES)throw new CadImportError('CAD文件超过100MB，请简化图纸或分文件上传',413);
 const reader=r.body?.getReader();if(!reader)throw new CadImportError('请上传CAD文件');
 const chunks:Uint8Array[]=[];let length=0;
 try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>MAX_CAD_BYTES){await reader.cancel();throw new CadImportError('CAD文件超过100MB，请简化图纸或分文件上传',413);}chunks.push(part.value);}}finally{reader.releaseLock();}
 let source;try{source=decodeURIComponent(r.headers.get('x-cad-source')||'CAD图纸').slice(0,240);}catch{throw new CadImportError('CAD文件名无效');}
 return {buffer:Buffer.concat(chunks,length),source,dwg:r.headers.get('x-cad-dwg')==='1'};
}
/** 按字节解码 DXF：优先 UTF-8，出现大量替换符或解析不出柜体时回退 GB18030（宏光/中望等 CAD 可能存 GBK）。 */
function decodeCad(buffer:Buffer):string{
  try{return new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{return new TextDecoder('gb18030').decode(buffer);}
}
async function dwgToDxfBytes(buffer:Buffer):Promise<Buffer>{
  const dir=await mkdtemp(join(tmpdir(),'cad-'));
  try{
    const dwg=join(dir,'input.dwg');
    const dxf=join(dir,'output.dxf');
    await writeFile(dwg,buffer);
    const tool=process.env.DWG_TO_DXF_CMD||'dwg2dxf';
    try{
      await run(tool,[dwg,dxf],{timeout:120000});
    }catch(e){
      throw new CadImportError('服务器未安装DWG转换工具，请把图纸另存为DXF后上传，或联系管理员安装 dwg2dxf',503);
    }
    return await readFile(dxf);
  }finally{await rm(dir,{recursive:true,force:true});}
}
export async function POST(r:Request){try{
  const owner=selectionOwner(r);
  if(active>=1)throw new CadImportError('正在处理其他图纸，请稍后重试',429);
  active++;
  try{
    const binary=r.headers.get('content-type')?.split(';')[0]==='application/octet-stream';
    const input=binary?await binaryCadInput(r):await selectionInput(r,135*1024*1024);
    const {content,source,dwg,encoding}=input;
    if(!binary&&(typeof content!=='string'||!content.trim()))throw new CadImportError('请上传DXF或CAD文件');
    let text:string;
    if(binary||encoding==='base64'||dwg===true||/^data:/.test(content)){
      const buffer=binary?input.buffer:Buffer.from(content.includes(',')?content.split(',')[1]:content,'base64');
      if(!buffer.length||buffer.length>MAX_CAD_BYTES)throw new CadImportError('CAD文件过大（超过100MB），请简化图纸或分文件上传',413);
      const head=buffer.slice(0,6).toString('ascii');
      if(dwg===true||/^AC1\d{3}$/.test(head)){
        text=decodeCad(await dwgToDxfBytes(buffer));
      }else{
        text=decodeCad(buffer);
      }
    }else{
      if(Buffer.byteLength(content,'utf8')>MAX_CAD_BYTES)throw new CadImportError('CAD文件过大（超过100MB），请简化图纸或分文件上传',413);
      text=content;
    }
    const rows=parseDxfText(text,typeof source==='string'&&source.trim()?source.slice(0,240):'CAD图纸');
    if(!rows.length)throw new CadImportError('未能从CAD中识别出柜体。请确认图纸包含"房间/柜名"文字和尺寸标注（如 厨房/地柜），柜名需含"柜/岛台"等字。');
    return Response.json({result:rows},{headers:selectionHeaders});
  }finally{active--;}
}catch(e){
  if(e instanceof CadImportError)return Response.json({error:e.message},{status:e.status,headers:selectionHeaders});
  return selectionFailure(e);
}}
