import {PDFDocument,rgb,type PDFPage} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {CONTRACT_CJK_FONT_BASE64} from '../assets/fonts/contract-cjk-font';
import {QUOTE_CATEGORIES} from './quotes';
// The core entry only creates a matrix; qrcode's Node image/file renderers are never loaded.
// @ts-expect-error qrcode exposes public types but does not declare its pure core entry.
import QRCode from 'qrcode/lib/core/qrcode';

/** Every field in this snapshot is safe for the customer to see. Prices are yuan; totals are cents. */
export type QuoteSharePdfSnapshot={
 company_name:string;
 project_name:string;
 customer:string;
 title:string;
 created:string;
 expires_at:string|null;
 rooms:ReadonlyArray<{id:string;name:string}>;
 items:ReadonlyArray<{name:string;model:string;unit:string;quantity:number;price:number;category:string;room_id?:string}>;
 total:number;
 settlement:{gross:number;discount:number;rounding:number;receivable:number}|null;
 customer_note:string;
 collection?:{name:string;amount?:number|null}|null;
 payment_mode?:'manual_code'|'wechat';
 payment_code?:{label:string;content_type?:'image/png'|'image/jpeg';width?:number;height?:number}|null;
 share_url?:string;
};
export type QuoteSharePdfOptions={paymentCodeImage?:{bytes:Uint8Array;contentType:'image/png'|'image/jpeg';label:string}};

const PAGE_WIDTH=595.28,PAGE_HEIGHT=841.89,MARGIN=44,CONTENT_WIDTH=PAGE_WIDTH-MARGIN*2;
const ink=rgb(0.12,0.19,0.27),blue=rgb(0.13,0.31,0.48),muted=rgb(0.4,0.46,0.52),border=rgb(0.76,0.8,0.84),shade=rgb(0.94,0.96,0.98);
let cachedFont:Promise<Uint8Array>|undefined;
function fontBytes(){
 if(!cachedFont)cachedFont=(async()=>{const binary=atob(CONTRACT_CJK_FONT_BASE64),compressed=Uint8Array.from(binary,char=>char.charCodeAt(0));const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));return new Uint8Array(await new Response(stream).arrayBuffer());})();
 return cachedFont;
}
function cleanText(value:unknown){return String(value??'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');}
function cents(value:number){if(!Number.isSafeInteger(value)||value<0)throw new Error('客户报价金额须为非负整数分');return value;}
function money(value:number){return (cents(value)/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});}
function dateLabel(value:string,empty:string){
 if(!value)return empty;
 const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new Error('客户报价日期无效');
 return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date).replaceAll('/','-')+'（北京时间）';
}

/** Worker-safe: bundled Chinese font, browser compression APIs, and no filesystem or remote font fetch. */
export async function generateQuoteSharePdf(snapshot:QuoteSharePdfSnapshot,options?:QuoteSharePdfOptions):Promise<Uint8Array>{
 if(!Array.isArray(snapshot.rooms)||!Array.isArray(snapshot.items))throw new Error('客户报价快照缺少房间或明细');
 const rooms=snapshot.rooms.map(room=>({id:cleanText(room.id),name:cleanText(room.name)}));
 if(rooms.some(room=>!room.id)||new Set(rooms.map(room=>room.id)).size!==rooms.length)throw new Error('客户报价房间信息无效');
 // Deliberately read this allowlist field by field. Internal notes, addresses, costs and profits never enter the PDF.
 const lines=snapshot.items.map(item=>{
  if(!Number.isFinite(item.quantity)||item.quantity<=0||!Number.isFinite(item.price)||item.price<0)throw new Error('客户报价明细金额或数量无效');
  const unitPrice=cents(Math.round(item.price*100)),amount=cents(Math.round(item.quantity*unitPrice));
  return {name:cleanText(item.name),model:cleanText(item.model),unit:cleanText(item.unit),quantity:item.quantity,category:cleanText(item.category)||'材料费用',room_id:typeof item.room_id==='string'?item.room_id:undefined,unitPrice,amount};
 });
 const total=cents(snapshot.total),actual=cents(lines.reduce((sum,line)=>sum+line.amount,0));
 if(actual!==total)throw new Error('客户报价明细合计与已保存总额不一致');
 const settlement=snapshot.settlement;
 if(settlement){
  for(const value of [settlement.gross,settlement.discount,settlement.rounding,settlement.receivable])cents(value);
  if(settlement.gross!==total||settlement.gross-settlement.discount-settlement.rounding!==settlement.receivable)throw new Error('客户报价原价、优惠、抹零与应收金额不一致');
 }
 const collection=snapshot.collection;
 if(collection?.amount!=null){cents(collection.amount);if(collection.amount>(settlement?.receivable??total))throw new Error('本次收款金额不能超过客户报价应收金额');}
 const paymentCodeInput=options?.paymentCodeImage,manualCode=snapshot.payment_mode==='manual_code'||!!paymentCodeInput;
 if(paymentCodeInput&&(!(paymentCodeInput.bytes instanceof Uint8Array)||!paymentCodeInput.bytes.length||!['image/png','image/jpeg'].includes(paymentCodeInput.contentType)))throw new Error('收款码图片须为有效的 PNG 或 JPEG 图片');
 const shareUrl=cleanText(snapshot.share_url);
 if(shareUrl){const url=new URL(shareUrl);if(url.protocol!=='https:')throw new Error('客户报价二维码须使用 HTTPS 分享链接');}
 const created=dateLabel(snapshot.created,'未填写'),expires=dateLabel(snapshot.expires_at||'','长期有效');
 const unassigned=lines.filter(line=>!line.room_id||!rooms.some(room=>room.id===line.room_id));
 const groups=[...rooms.map(room=>({...room,lines:lines.filter(line=>line.room_id===room.id)})),...(unassigned.length||!rooms.length?[{id:'unassigned',name:rooms.length?'未分配空间':'整体空间',lines:unassigned}]:[])];
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 // Full CJK embedding also preserves correct outlines in quotations with only a few characters.
 const font=await pdf.embedFont(await fontBytes(),{subset:false}),supported=new Set(font.getCharacterSet());
 // Only backend-validated image bytes are used. Payment metadata and URLs cannot load images here.
 const paymentCodeImage=paymentCodeInput?await (paymentCodeInput.contentType==='image/png'?pdf.embedPng(paymentCodeInput.bytes):pdf.embedJpg(paymentCodeInput.bytes)):null;
 if(paymentCodeImage&&(!Number.isFinite(paymentCodeImage.width)||!Number.isFinite(paymentCodeImage.height)||paymentCodeImage.width<=0||paymentCodeImage.height<=0))throw new Error('收款码图片尺寸无效');
 const title=cleanText(snapshot.title)||'客户报价单',company=cleanText(snapshot.company_name),note=cleanText(snapshot.customer_note);
 const createdDate=new Date(snapshot.created);if(Number.isFinite(createdDate.getTime())){pdf.setCreationDate(createdDate);pdf.setModificationDate(createdDate);}
 pdf.setTitle(title);pdf.setAuthor(company);pdf.setCreator('固美格项目经营管理');pdf.setProducer('固美格客户报价 PDF');
 let page!:PDFPage,y=0;
 const addPage=()=>{page=pdf.addPage([PAGE_WIDTH,PAGE_HEIGHT]);y=PAGE_HEIGHT-MARGIN-20;};
 const checkText=(value:string)=>{const unknown=[...new Set([...value].filter(char=>char!=='\n'&&!supported.has(char.codePointAt(0)!)))];if(unknown.length)throw new Error('客户报价中含字体不支持的字符：'+unknown.slice(0,8).join(' '));};
 const wrap=(value:string,width:number,size:number)=>{
  const text=cleanText(value);checkText(text);const result:string[]=[];
  for(const paragraph of text.split('\n')){let line='';for(const char of paragraph){if(line&&font.widthOfTextAtSize(line+char,size)>width){result.push(line);line=char;}else line+=char;}result.push(line);}
  return result;
 };
 const ensure=(height:number)=>{if(y-height<MARGIN+24){addPage();return true;}return false;};
 const draw=(text:string,x:number,baseline:number,size=10,color=ink)=>{checkText(text);page.drawText(text,{x,y:baseline,size,font,color});};
 const paragraph=(value:string,size=10.2,heading=false)=>{
  if(!value.trim()){ensure(7);y-=7;return;}
  const wrapped=wrap(value,CONTENT_WIDTH,size),lineHeight=size*1.65;ensure(heading?lineHeight+25:lineHeight);
  for(const line of wrapped){ensure(lineHeight);draw(line,MARGIN,y,size,heading?blue:ink);y-=lineHeight;}
  y-=heading?4:3;
 };
 const shareQr=shareUrl?(QRCode as {create:(value:string,options:{errorCorrectionLevel:string})=>{modules:{size:number;get:(row:number,column:number)=>boolean}}}).create(shareUrl,{errorCorrectionLevel:'M'}):null;
 const drawShareQr=(left:number,top:number,size=104)=>{
  if(!shareQr)return;
  const quiet=4,cell=size/(shareQr.modules.size+quiet*2);
  page.drawRectangle({x:left,y:top-size,width:size,height:size,color:rgb(1,1,1)});
  for(let row=0;row<shareQr.modules.size;row++)for(let column=0;column<shareQr.modules.size;column++)if(shareQr.modules.get(row,column))page.drawRectangle({x:left+(column+quiet)*cell,y:top-(row+quiet+1)*cell,width:cell,height:cell,color:rgb(0,0,0)});
 };
 let shareQrInline=false;
 addPage();paragraph(title,19,true);
 paragraph('项目：'+(cleanText(snapshot.project_name)||'未填写'),10.2);
 paragraph('客户：'+(cleanText(snapshot.customer)||'未填写'),10.2);
 paragraph('报价时间：'+created,9);
 paragraph('有效期至：'+expires,9);y-=9;

 const table=(rows:string[][])=>{
  const headers=['序号','名称 / 规格','数量','单位','销售单价\n（元）','报价金额\n（元）'],widths=[27,CONTENT_WIDTH-242,45,35,65,70];
  const size=8.6,padding=6,lineHeight=12.4,headerHeight=32;
  const header=()=>{ensure(headerHeight+lineHeight+padding*2);let x=MARGIN;for(let i=0;i<headers.length;i++){page.drawRectangle({x,y:y-headerHeight,width:widths[i],height:headerHeight,color:shade,borderColor:border,borderWidth:0.5});const headerLines=wrap(headers[i],widths[i]-(i===0?6:padding*2),size);headerLines.forEach((line,index)=>{const left=i===1?x+padding:x+(widths[i]-font.widthOfTextAtSize(line,size))/2;draw(line,left,y-(headerHeight+size)/2+(headerLines.length-1)*lineHeight/2-index*lineHeight,size,blue);});x+=widths[i];}y-=headerHeight;};
  header();
  for(const row of rows){
   const cells=row.map((cell,index)=>wrap(cell,widths[index]-padding*2,size));let offset=0;
   const lineCount=Math.max(1,...cells.map(cell=>cell.length));
   // Long cells continue on following pages instead of clipping or dropping content.
   while(offset<lineCount){
    if(y-(lineHeight+padding*2)<MARGIN+24){addPage();header();}
    let available=Math.max(1,Math.floor((y-MARGIN-24-padding*2)/lineHeight));
    const freshCapacity=Math.floor((PAGE_HEIGHT-MARGIN-20-headerHeight-MARGIN-24-padding*2)/lineHeight);
    if(lineCount-offset<=freshCapacity&&lineCount-offset>available){addPage();header();available=freshCapacity;}
    const count=Math.min(available,lineCount-offset),height=count*lineHeight+padding*2;
    let x=MARGIN;
    for(let column=0;column<widths.length;column++){
     page.drawRectangle({x,y:y-height,width:widths[column],height,borderColor:border,borderWidth:0.5});
     cells[column].slice(offset,offset+count).forEach((line,index)=>{const textWidth=font.widthOfTextAtSize(line,size),left=column>=4||column===2?x+widths[column]-padding-textWidth:column===0||column===3?x+(widths[column]-textWidth)/2:x+padding;draw(line,left,y-padding-size-index*lineHeight,size);});x+=widths[column];
    }
    y-=height;offset+=count;
    if(offset<lineCount){addPage();header();}
   }
  }
  y-=9;
 };
 for(const room of groups){
  const roomTotal=cents(room.lines.reduce((sum,line)=>sum+line.amount,0));ensure(100);
  paragraph((room.name||'未命名空间')+'　小计：'+money(roomTotal)+'元',12,true);
  if(!room.lines.length){paragraph('暂无报价明细',9, false);y-=7;continue;}
  const categories=[...QUOTE_CATEGORIES,...new Set(room.lines.map(line=>line.category).filter(category=>!QUOTE_CATEGORIES.some(known=>known===category)))];
  for(const category of categories){
   const items=room.lines.filter(line=>line.category===category);if(!items.length)continue;
   ensure(95);paragraph(category,10.5,true);
   table(items.map((line,index)=>[String(index+1),line.name+(line.model?'\n规格：'+line.model:''),String(line.quantity),line.unit,money(line.unitPrice),money(line.amount)]));
   paragraph(category+'小计：'+money(cents(items.reduce((sum,line)=>sum+line.amount,0)))+'元',9);
  }
  y-=5;
 }
 ensure(settlement?120:62);y-=6;
 paragraph('报价合计：'+money(total)+'元',12,true);
 if(settlement){paragraph('优惠：'+money(settlement.discount)+'元　抹零：'+money(settlement.rounding)+'元',10.2);paragraph('应收金额：'+money(settlement.receivable)+'元',15,true);}
 if(collection)paragraph((collection.amount==null?'收款项目：':'本次收款：')+(cleanText(collection.name)||'报价款')+(collection.amount==null?'':'　'+money(collection.amount)+'元'),11.5,true);
 if(note){y-=10;paragraph('客户说明',12,true);paragraph(note,10.2);}
 if(paymentCodeImage&&paymentCodeInput){
  // Fit the complete uploaded image without cropping. The surrounding white frame protects its quiet zone.
  const padding=16,inline=!!shareUrl&&manualCode,maxWidth=inline?CONTENT_WIDTH-padding*2-24-145:340;
  const scale=Math.min(maxWidth/paymentCodeImage.width,320/paymentCodeImage.height),width=paymentCodeImage.width*scale,height=paymentCodeImage.height*scale,blockHeight=Math.max(height+padding*2,inline?196:0);
  const label=cleanText(paymentCodeInput.label),labelHeight=label?wrap(label,CONTENT_WIDTH,10.2).length*16.83+3:0;
  ensure(blockHeight+labelHeight+110);y-=10;
  paragraph('收款码',14,true);if(label)paragraph(label,10.2);
  if(ensure(blockHeight+78))paragraph('收款码',14,true);y-=8;
  const left=inline?MARGIN:(PAGE_WIDTH-width-padding*2)/2,top=y;
  page.drawRectangle({x:left,y:top-height-padding*2,width:width+padding*2,height:height+padding*2,color:rgb(1,1,1),borderColor:border,borderWidth:0.6});
  page.drawImage(paymentCodeImage,{x:left+padding,y:top-height-padding,width,height});
  if(inline){
   const right=left+width+padding*2+24,rightWidth=CONTENT_WIDTH-width-padding*2-24;
   draw('查看报价二维码',right,top-12,12,blue);
   drawShareQr(right+(rightWidth-104)/2,top-33);
   wrap('扫码查看此版报价\n此二维码仅用于查看报价。',rightWidth,9.2).forEach((line,index)=>draw(line,right,top-157-index*15,9.2,index===0?blue:muted));
   shareQrInline=true;
  }
  y=top-blockHeight-18;
  paragraph('请核对收款方及金额后扫码付款。',10.2);
  paragraph('付款到账后，由商家核实并确认收款。',10.2);y-=8;
 }
 if(shareUrl&&!shareQrInline){
  ensure(164);y-=10;paragraph('查看报价二维码',12,true);
  const size=104,top=y;drawShareQr(MARGIN,top,size);
  const labelLines=wrap(manualCode?'扫码查看此版报价\n此二维码仅用于查看报价。':'扫码查看此版报价与付款安排\n请以客户页面显示的付款状态为准。',CONTENT_WIDTH-size-18,10.2);
  labelLines.forEach((line,index)=>draw(line,MARGIN+size+18,top-22-index*17,10.2,index===0?blue:muted));
  y=top-size-12;
 }
 const companyHeader=wrap(company,CONTENT_WIDTH-70,8)[0];
 const pages=pdf.getPages();pages.forEach((entry,index)=>{page=entry;draw(companyHeader,MARGIN,PAGE_HEIGHT-27,8,muted);draw('客户报价单',MARGIN,26,8,muted);const pageText=`${index+1} / ${pages.length}`;draw(pageText,PAGE_WIDTH-MARGIN-font.widthOfTextAtSize(pageText,8),26,8,muted);});
 return pdf.save();
}
