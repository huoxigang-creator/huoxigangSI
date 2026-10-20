import {env} from './local-env';
import {buildQuoteExportSheets,applyQuoteExcelStyling,type QuoteExportSheet,type QuoteExcelPhoto} from './quote-export';
import {confirmationSvg,confirmationLayout,confirmationDate} from './quote-confirmation-document';
import {QuoteShareError,type QuoteShareSnapshot} from './quote-shares';

export type ConfirmationRecord={owner:string;snapshot:QuoteShareSnapshot;signature?:string;signed_at?:string};
export async function confirmationSheet(record:ConfirmationRecord):Promise<QuoteExportSheet>{
 let sheet=record.snapshot.confirmation_sheet;
 if(!sheet){const s=record.snapshot;sheet=buildQuoteExportSheets({project:{id:'legacy',name:s.project_name,customer:s.customer,project_type:s.rooms.length?'customer':'project',discount_amount:s.settlement?.discount,rounding_amount:s.settlement?.rounding},companyName:s.company_name,quote:{title:s.title,rooms:s.rooms.length?s.rooms:undefined,items:s.items,total:s.total,adopted:!!s.settlement}})[0];}
 const photos:NonNullable<QuoteExportSheet['photoRows']>=[];
 for(const photo of sheet.photoRows||[]){
  if(!photo.src.startsWith(encodeURIComponent(record.owner)+'/quote-confirmations/'))throw new QuoteShareError('确认单附件无权访问',403);
  const object=await env.BUCKET?.get(photo.src);if(!object)throw new QuoteShareError('确认单附件暂时无法读取',503);
  const mime=object.customMetadata?.mime||object.httpMetadata?.contentType;
  if(!mime||!['image/png','image/jpeg','image/webp'].includes(mime))throw new QuoteShareError('确认单附件格式无效',400);
  const bytes=new Uint8Array(await object.arrayBuffer());
  photos.push({...photo,src:'data:'+mime+';base64,'+Buffer.from(bytes).toString('base64')});
 }
 return {...sheet,photoRows:photos};
}

export async function confirmationFile(record:ConfirmationRecord,format:string){
 const sheet=await confirmationSheet(record);
 if(format==='document')return {bytes:confirmationSvg(sheet,record.signature,record.signed_at),mime:'image/svg+xml',extension:'svg'};
 if(format==='excel'){
  const rows=sheet.rows.map(row=>[...row]);const photos:QuoteExcelPhoto[]=[...(sheet.photoRows||[])];
  if(record.signature){
   const r=rows.findIndex(row=>String(row[0]||'').startsWith('乙方：'));
   const time=rows.findIndex(row=>row[0]==='时间：');if(time>=0)rows[time][3]='时间：'+confirmationDate(record.signed_at);
   if(r>=0){sheet.rowHeightOverrides={...sheet.rowHeightOverrides,[r]:72};sheet.signatureRow=r;photos.push({src:record.signature,name:'客户确认签名',row:r,column:4,width:180,height:75});}
  }
  const bytes=await applyQuoteExcelStyling({...sheet,rows},{title:record.snapshot.title,company:record.snapshot.company_name},photos);
  return {bytes,mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',extension:'xlsx'};
 }
 if(format==='pdf')return {bytes:await confirmationPdf(sheet,record),mime:'application/pdf',extension:'pdf'};
 throw new QuoteShareError('下载格式无效',400);
}

/** The PDF draws the same export cells, row heights, merges and images, splitting only between rows. */
async function confirmationPdf(sheet:QuoteExportSheet,record:ConfirmationRecord){
 const [{PDFDocument,rgb},fontkit,{CONTRACT_CJK_FONT_BASE64}]=await Promise.all([import('pdf-lib'),import('@pdf-lib/fontkit'),import('../assets/fonts/contract-cjk-font')]);
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit.default);
 const {inflateSync}=await import('node:zlib');const font=await pdf.embedFont(inflateSync(Buffer.from(CONTRACT_CJK_FONT_BASE64,'base64')),{subset:false});
 const supported=new Set(font.getCharacterSet()),layout=confirmationLayout(sheet,record.signature,record.signed_at),scale=555/layout.width;
 const color=(hex:string)=>rgb(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);
 const image=async(src:string)=>{const bytes=Buffer.from(src.slice(src.indexOf(',')+1),'base64');if(src.startsWith('data:image/jpeg'))return pdf.embedJpg(bytes);if(src.startsWith('data:image/png'))return pdf.embedPng(bytes);throw new QuoteShareError('PDF 附件为 WebP，请使用下载表格图片或 Excel 保留该附件',400);};
 const placements:{page:ReturnType<typeof pdf.addPage>;top:number}[]=[];
 let page=pdf.addPage([595.28,841.89]),top=821.89;
 for(const [r,row] of layout.rows.entries()){
  const h=row.height*scale;if(h>780)throw new QuoteShareError('表格行过高，请下载表格图片或Excel',400);
  const imageHeight=(sheet.photoRows||[]).filter(photo=>photo.row===r).length*100*scale;
  if(top-Math.max(h,imageHeight)<20){page=pdf.addPage([595.28,841.89]);top=821.89;}
  placements[r]={page,top};
  for(const cell of row.cells){
   const x=20+cell.x*scale,w=cell.width*scale;
   page.drawRectangle({x,y:top-h,width:w,height:h,color:color(cell.fill),borderColor:color(cell.border),borderWidth:.5});
   const size=cell.fontSize*scale,lines=cell.lines.map(line=>[...line].filter(c=>supported.has(c.codePointAt(0)!)).join(''));
   const base=cell.image?top-20*scale:top-(h-lines.length*size*1.3)/2-size;
   lines.forEach((line,i)=>{const tw=font.widthOfTextAtSize(line,size),tx=cell.align==='right'?x+w-tw-3:cell.align==='center'?x+(w-tw)/2:x+3;page.drawText(line,{x:tx,y:base-i*size*1.3,size,font,color:color(cell.color)});});
   if(cell.image){const img=await image(cell.image),fit=Math.min((w-36)/img.width,(h-12)/img.height);page.drawImage(img,{x:x+34,y:top-h+(h-img.height*fit)/2,width:img.width*fit,height:img.height*fit});}
  }
  top-=h;
 }
 for(const photo of sheet.photoRows||[]){
  const position=placements[photo.row],cell=layout.rows[2].cells[7];if(!position)continue;
  const nth=(sheet.photoRows||[]).filter(p=>p.row===photo.row).indexOf(photo),img=await image(photo.src);
  position.page.drawImage(img,{x:20+cell.x*scale,y:position.top-(nth+1)*100*scale,width:100*scale,height:100*scale});
 }
 pdf.setTitle(record.snapshot.title+(record.signature?'（已签字确认）':'（待确认）'));pdf.setAuthor(record.snapshot.company_name);
 return pdf.save();
}
