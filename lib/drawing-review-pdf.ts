import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {CONTRACT_CJK_FONT_BASE64} from '../assets/fonts/contract-cjk-font';
import {drawingMeasure,type DrawingRow} from './drawing-import';

export type ReviewEntry={row:DrawingRow;image?:string};
/** One cabinet per A4 page. Images are loaded sequentially to bound browser memory. */
export async function generateDrawingReviewPdf(entries:ReviewEntry[],loadImage:(src:string)=>Promise<Uint8Array>){
 if(!entries.length)throw new Error('请先勾选需要导出的柜体');
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const compressed=Uint8Array.from(atob(CONTRACT_CJK_FONT_BASE64),c=>c.charCodeAt(0));
 const bytes=new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
 const font=await pdf.embedFont(bytes,{subset:false}),supported=new Set(font.getCharacterSet());
 const ink=rgb(.12,.2,.29),blue=rgb(.16,.36,.57),muted=rgb(.4,.45,.51),red=rgb(.7,.15,.12);
 const clean=(s:string)=>s.slice(0,600).replace(/[\x00-\x1f\x7f]/g,' ').trim();
 const wrap=(value:string,size:number,width=507)=>{
  const text=clean(value);const unknown=[...text].filter(c=>!supported.has(c.codePointAt(0)!));
  if(unknown.length)throw new Error('PDF字体暂不支持字符：'+[...new Set(unknown)].slice(0,8).join(''));
  const lines:string[]=[];let line='';for(const c of text){if(line&&font.widthOfTextAtSize(line+c,size)>width){lines.push(line);line=c;}else line+=c;}if(line)lines.push(line);return lines;
 };
 let area=0,meters=0,pending=0;for(const {row} of entries){const m=drawingMeasure(row);if(m.area!==null)area+=m.area;else if(m.meters!==null)meters+=m.meters;else pending++;}
 const totals=`合计：${area.toFixed(2)} ㎡ + ${meters.toFixed(2)} 延米`+(pending?`；${pending} 项尺寸待补充`:'');
 const date=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 pdf.setTitle('柜体图纸尺寸核对单');pdf.setCreator('固美格图纸识别');
 for(let i=0;i<entries.length;i++){
  const {row,image}=entries[i],page=pdf.addPage([595.28,841.89]);let y=796;
  const text=(value:string,size=11,color=ink)=>{for(const line of wrap(value,size)){page.drawText(line,{x:44,y,size,font,color});y-=size*1.5;}};
  text('柜体图纸尺寸核对单',21,blue);text(`第 ${i+1} / ${entries.length} 个柜体 · ${date}`,10,muted);y-=10;
  text(`${i+1}. ${row.room||'房间待填写'} / ${row.name||'柜名待填写'}`,16);
  text('来源：'+row.source.slice(0,240),9,muted);
  const m=drawingMeasure(row),measure=m.area!==null?`${m.area.toFixed(2)} ㎡`:m.meters!==null?`${m.meters.toFixed(2)} 延米`:'待补充尺寸';
  text(`当前核对尺寸（毫米）：宽 ${row.width||'待补充'}`+(row.height?` × 高 ${row.height}`:'；高度未填写'),12);
  text('当前核对数量：'+measure,14,m.area===null&&m.meters===null?red:blue);
  if(row.note)text('原图识别参考：'+row.note.slice(0,400),10,muted);
  y-=12;const bottom=180,boxHeight=Math.max(120,y-bottom),boxWidth=507;
  page.drawRectangle({x:44,y:bottom,width:boxWidth,height:boxHeight,color:rgb(1,1,1),borderColor:rgb(.78,.83,.88),borderWidth:.7});
  if(image){
   let png:Uint8Array;try{png=await loadImage(image);}catch{throw new Error(`第${i+1}个柜体图形读取失败，请重新导入后导出`);}
   const picture=await pdf.embedPng(png),scale=Math.min((boxWidth-20)/picture.width,(boxHeight-20)/picture.height);
   page.drawImage(picture,{x:44+(boxWidth-picture.width*scale)/2,y:bottom+(boxHeight-picture.height*scale)/2,width:picture.width*scale,height:picture.height*scale});
  }else page.drawText('此项暂无可用图形，请补充原图后核对',{x:100,y:bottom+boxHeight/2,size:12,font,color:red});
  y=160;
  text('图形保留原图标注；手动修改的名称、尺寸及数量以本页上方核对值为准。',9,muted);
  if(row.previewWarning)text(row.previewWarning,8,muted);
  y=Math.min(y-8,111);text(totals,12,blue);
  text('客户核对：________________   日期：________________',10);
  page.drawText(`尺寸单位：毫米（mm）    数量单位：㎡ / 延米        第 ${i+1} / ${entries.length} 页`,{x:44,y:35,size:9,font,color:muted});
 }
 return pdf.save();
}

/** Rasterize existing image or safe parser-generated CAD SVG at print resolution. */
export async function drawingImagePng(src:string):Promise<Uint8Array>{
 const image=new Image();image.decoding='async';await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('图形加载失败'));image.src=src;});
 const scale=Math.min(2,2800/Math.max(image.naturalWidth,image.naturalHeight));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('浏览器无法导出图形');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('图形转换失败')),'image/png'));
 canvas.width=canvas.height=1;return new Uint8Array(await blob.arrayBuffer());
}
