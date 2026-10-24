import {PDFDocument,rgb,type PDFPage} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {CONTRACT_CJK_FONT_BASE64} from '../assets/fonts/contract-cjk-font';
import {drawingMeasure,type DrawingRow} from './drawing-import';

export type ReviewEntry={row:DrawingRow;image?:string};
const reviewTitle='柜体图纸尺寸核对单';
export function drawingReviewPdfName(entries:ReviewEntry[]){
 const addresses=[...new Set(entries.map(e=>e.row.address?.trim()||'').filter(Boolean))];
 const address=addresses.length===1?addresses[0]:addresses.length>1?'多地址':'';
 const prefix=address.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'-').replace(/\s+/g,' ').replace(/[. ]+$/,'').slice(0,140);
 return prefix+reviewTitle+'.pdf';
}
/** Each drawing is followed by its complete editable-row information; totals occur once at the end. */
export async function generateDrawingReviewPdf(entries:ReviewEntry[],loadImage:(src:string)=>Promise<Uint8Array>){
 if(!entries.length)throw new Error('请先勾选需要导出的柜体');
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const compressed=Uint8Array.from(atob(CONTRACT_CJK_FONT_BASE64),c=>c.charCodeAt(0));
 const bytes=new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
 const font=await pdf.embedFont(bytes,{subset:false}),supported=new Set(font.getCharacterSet());
 const ink=rgb(.12,.2,.29),blue=rgb(.16,.36,.57),muted=rgb(.4,.45,.51),red=rgb(.7,.15,.12),shade=rgb(.95,.97,.99),border=rgb(.8,.85,.9);
 const clean=(s:string)=>s.replace(/\r\n?/g,'\n').replace(/\t/g,' ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').trim();
 const wrap=(value:string,size:number,width=487)=>{
  const text=clean(value),unknown=[...text].filter(c=>c!=='\n'&&!supported.has(c.codePointAt(0)!));
  if(unknown.length)throw new Error('PDF字体暂不支持字符：'+[...new Set(unknown)].slice(0,8).join(''));
  const lines:string[]=[];for(const paragraph of text.split('\n')){let line='';for(const c of paragraph){if(line&&font.widthOfTextAtSize(line+c,size)>width){lines.push(line);line=c;}else line+=c;}lines.push(line);}return lines;
 };
 let area=0,meters=0,pending=0;for(const {row} of entries){const m=drawingMeasure(row);if(m.area!==null)area+=m.area;else if(m.meters!==null)meters+=m.meters;else pending++;}
 pdf.setTitle(drawingReviewPdfName(entries).replace(/\.pdf$/,''));pdf.setCreator('固美格图纸识别');
 let page!:PDFPage,y=0,current=0;
 const addPage=(continued=false)=>{
  page=pdf.addPage([595.28,841.89]);
  const title=(entries[current].row.address?.trim()||'')+reviewTitle;let size=20;while(size>14&&font.widthOfTextAtSize(title,size)>1014)size--;
  let top=796;for(const line of wrap(title,size,507)){page.drawText(line,{x:44,y:top,size,font,color:blue});top-=size*1.3;}
  page.drawText(`柜体 ${current+1} / ${entries.length}${continued?'（信息续页）':''}`,{x:44,y:top-6,size:10,font,color:muted});y=top-30;
 };
 const ensure=(height:number)=>{if(y-height<140)addPage(true);};
 const info=(value:string,size=10,color=ink)=>{
  for(const line of wrap(value,size)){const h=size*1.5+7;ensure(h);page.drawRectangle({x:44,y:y-h,width:507,height:h,color:shade,borderColor:border,borderWidth:.3});page.drawText(line,{x:54,y:y-size-3,size,font,color});y-=h;}
 };
 for(let i=0;i<entries.length;i++){
  current=i;const {row,image}=entries[i];addPage();
  const height=360,bottom=y-height;
  page.drawRectangle({x:44,y:bottom,width:507,height,color:rgb(1,1,1),borderColor:border,borderWidth:.7});
  if(image){
   let png:Uint8Array;try{png=await loadImage(image);}catch{throw new Error(`第${i+1}个柜体图形读取失败，请重新导入后导出`);}
   const picture=await pdf.embedPng(png),scale=Math.min(487/picture.width,(height-20)/picture.height);
   page.drawImage(picture,{x:44+(507-picture.width*scale)/2,y:bottom+(height-picture.height*scale)/2,width:picture.width*scale,height:picture.height*scale});
  }else page.drawText('此项暂无可用图形，请补充原图后核对',{x:100,y:bottom+height/2,size:12,font,color:red});
  y=bottom-10;
  if(row.previewWarning)info(row.previewWarning,8,muted);
  info('来源文件：'+row.source,9,muted);
  info(`房间：${row.room||'待填写'}    柜名：${row.name||'待填写'}`,12,blue);
  info(`宽：${row.width||'待补充'} mm    高：${row.height||'未标注'}${row.height?' mm':''}`,11);
  info('计算公式（原图识别参考）：'+(row.note||'未提供'),10);
  const m=drawingMeasure(row),unit=m.area!==null?'㎡':m.meters!==null?'延米':'待核对';
  const measure=m.area!==null?m.area.toFixed(2):m.meters!==null?m.meters.toFixed(2):'待补充尺寸';
  info(`当前数量：${measure}${unit==='待核对'?'':` ${unit}`}`,18,m.area===null&&m.meters===null?red:blue);
  if(row.price.trim())info(`单价：${row.price.trim()} 元/${unit}`,11);
  info('识别方式：'+(/\.(dxf|dwg)(?:[（(]|$)/i.test(row.source)?'CAD解析':'截图识别'),9,muted);
  if(row.config?.trim())info('配置说明：'+row.config,10);
  info('图形及公式保留原图标注；手动修改以本图下方的当前尺寸、名称和数量为准。',8,muted);
 }
 // The overall square meters and linear meters appear only after all cabinet details.
 page.drawLine({start:{x:44,y:122},end:{x:551,y:122},color:border,thickness:.8});
 page.drawText(`全部 ${entries.length} 个柜体合计：${area.toFixed(2)} ㎡ + ${meters.toFixed(2)} 延米`,{x:44,y:99,size:14,font,color:blue});
 if(pending)page.drawText(`其中 ${pending} 项尺寸待补充，未计入数量合计`,{x:44,y:78,size:10,font,color:red});
 pdf.getPages().forEach((p,i)=>p.drawText(`尺寸单位：毫米（mm）    数量单位：㎡ / 延米        第 ${i+1} / ${pdf.getPageCount()} 页`,{x:44,y:24,size:9,font,color:muted}));
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
