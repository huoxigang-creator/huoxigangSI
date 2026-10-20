import {PDFDocument,rgb,type PDFPage} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {CONTRACT_CJK_FONT_BASE64} from '../assets/fonts/contract-cjk-font';
import type {ContractRecord} from './contract-types';
import {contractMoney,DEFAULT_CONTRACT_TEMPLATE,renderContractTemplate} from './contract-template';
import {normalizeQuoteItem,QUOTE_CATEGORIES,type QuoteItem,type QuoteRoom} from './quotes';

/** PDF point coordinates, lower-left corner and origin; page numbers are one-based. */
export type ContractSignPosition={page:number;x:number;y:number;width:number;height:number;page_width:number;page_height:number};
export type GeneratedContractPdf={bytes:Uint8Array;positions:{company:ContractSignPosition;customer:ContractSignPosition}};
const PAGE_WIDTH=595.28,PAGE_HEIGHT=841.89,MARGIN=44,CONTENT_WIDTH=PAGE_WIDTH-MARGIN*2;
const ink=rgb(0.12,0.19,0.27),blue=rgb(0.13,0.31,0.48),muted=rgb(0.4,0.46,0.52),border=rgb(0.76,0.8,0.84),shade=rgb(0.94,0.96,0.98);
let cachedFont:Promise<Uint8Array>|undefined;
function fontBytes(){
 if(!cachedFont)cachedFont=(async()=>{const binary=atob(CONTRACT_CJK_FONT_BASE64),compressed=Uint8Array.from(binary,char=>char.charCodeAt(0));const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));return new Uint8Array(await new Response(stream).arrayBuffer());})();
 return cachedFont;
}

function cleanText(value:unknown){return String(value??'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');}
function validateAmounts(record:ContractRecord){
 for(const value of [record.gross_amount,record.discount_amount,record.rounding_amount,record.net_amount])if(!Number.isSafeInteger(value)||value<0)throw new Error('合同金额须为非负整数分');
 if(record.gross_amount-record.discount_amount-record.rounding_amount!==record.net_amount)throw new Error('合同原价、优惠、抹零与签订金额不一致');
 if(record.installments.length){const total=record.installments.reduce((sum,part)=>{if(!Number.isSafeInteger(part.amount)||part.amount<0||!Number.isFinite(part.ratio)||part.ratio<0||part.ratio>100)throw new Error('合同付款分期金额或比例无效');return sum+part.amount;},0);if(!Number.isSafeInteger(total)||total!==record.net_amount)throw new Error('合同付款分期合计与签订金额不一致');}
}

function quoteAttachment(record:ContractRecord){
 const quote=record.quote_snapshot;
 if(!quote)return null;
 if(!Array.isArray(quote.items))throw new Error('合同报价快照缺少明细');
 const lines:QuoteItem[]=quote.items.map((raw:Partial<QuoteItem>)=>normalizeQuoteItem(raw));
 const total=lines.reduce((sum,line)=>{const price=Math.round(line.price*100),amount=Math.round(line.quantity*price);if(!Number.isFinite(line.quantity)||line.quantity<=0||!Number.isFinite(line.price)||line.price<0||!Number.isSafeInteger(price)||!Number.isSafeInteger(amount))throw new Error('合同报价快照明细金额无效');return sum+amount;},0);
 if(!Number.isSafeInteger(total)||total!==record.gross_amount||(quote.total!==undefined&&quote.total!==total))throw new Error('合同报价快照合计与合同原价不一致');
 const rooms:QuoteRoom[]=Array.isArray(quote.rooms)?quote.rooms.map((room:QuoteRoom)=>({id:room.id,name:room.name})):[];
 if(rooms.some(room=>typeof room.id!=='string'||typeof room.name!=='string')||new Set(rooms.map(room=>room.id)).size!==rooms.length)throw new Error('合同报价快照房间信息无效');
 const unassigned=lines.filter(line=>!line.room_id||!rooms.some(room=>room.id===line.room_id));
 const groups=[...rooms.map(room=>({...room,lines:lines.filter(line=>line.room_id===room.id)})),...(unassigned.length||!rooms.length?[{id:'unassigned',name:rooms.length?'未分配空间':'整体空间',lines:unassigned}]:[])];
 const cabinets=new Map<string,{name:string;room_id:string}>();
 for(const cabinet of quote.cabinets||[]){if(cabinets.has(cabinet.id)||!rooms.some(room=>room.id===cabinet.room_id))throw new Error('合同报价快照柜体信息无效');cabinets.set(cabinet.id,cabinet);}
 for(const line of lines){if(line.cabinet_id!==undefined){const cabinet=cabinets.get(line.cabinet_id);if(!cabinet||cabinet.room_id!==line.room_id)throw new Error('合同报价快照明细与柜体关联不一致');}}
 return {quote,groups,cabinets};
}

/** Worker-safe generation: bundled font bytes, no fs, child process or remote font requests. */
export async function generateContractPdf(record:ContractRecord):Promise<GeneratedContractPdf>{
 validateAmounts(record);
 const attachment=quoteAttachment(record),template=record.template_snapshot||DEFAULT_CONTRACT_TEMPLATE;
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 // Full embedding avoids fontkit CJK subset outline loss for small custom templates.
 const font=await pdf.embedFont(await fontBytes(),{subset:false});
 const supported=new Set(font.getCharacterSet());
 const date=new Date(record.created);if(Number.isFinite(date.getTime())){pdf.setCreationDate(date);pdf.setModificationDate(date);}
 pdf.setTitle(record.title||template.name);pdf.setAuthor(record.company_name);pdf.setCreator('固美格项目经营管理');pdf.setProducer('固美格合同 PDF');
 let page!:PDFPage,y=PAGE_HEIGHT-MARGIN;
 const addPage=()=>{page=pdf.addPage([PAGE_WIDTH,PAGE_HEIGHT]);y=PAGE_HEIGHT-MARGIN-20;};
 addPage();
 const checkText=(value:string)=>{const unknown=[...new Set([...value].filter(char=>char!=='\n'&&!supported.has(char.codePointAt(0)!)))];if(unknown.length)throw new Error('合同中含字体不支持的字符：'+unknown.slice(0,8).join(' '));};
 const wrap=(value:string,width:number,size:number)=>{
  const text=cleanText(value);checkText(text);const result:string[]=[];
  for(const paragraph of text.split('\n')){let line='';for(const char of paragraph){if(line&&font.widthOfTextAtSize(line+char,size)>width){result.push(line);line=char;}else line+=char;}result.push(line);}
  return result;
 };
 const ensure=(height:number)=>{if(y-height<MARGIN+24){addPage();return true;}return false;};
 const draw=(text:string,x:number,baseline:number,size=10,color=ink)=>{checkText(text);page.drawText(text,{x,y:baseline,size,font,color});};
 const paragraph=(value:string,size=10.2,heading=false)=>{
  if(!value.trim()){ensure(7);y-=7;return;}
  const lines=wrap(value,CONTENT_WIDTH,size),lineHeight=size*1.65;
  ensure(heading?lineHeight+25:lineHeight);
  for(const line of lines){ensure(lineHeight);draw(line,MARGIN,y,size,heading?blue:ink);y-=lineHeight;}
  y-=heading?4:3;
 };
 const title=cleanText(record.title||template.name);
 paragraph(title,19,true);
 paragraph('合同编号：'+record.number+'　约定签订日期：'+(record.sign_date||'—'),9);
 if(record.paper_number)paragraph('纸质合同编号：'+record.paper_number,9);
 y-=7;

 const table=(headers:string[],rows:string[][],widths:number[])=>{
  const size=8.6,padding=6,lineHeight=12.4;
  const header=()=>{ensure(27);let x=MARGIN;for(let i=0;i<headers.length;i++){page.drawRectangle({x,y:y-25,width:widths[i],height:25,color:shade,borderColor:border,borderWidth:0.5});draw(headers[i],x+padding,y-16,size,blue);x+=widths[i];}y-=25;};
  header();
  for(const row of rows){const cells=row.map((cell,index)=>wrap(cell,widths[index]-padding*2,size));const height=Math.max(1,...cells.map(cell=>cell.length))*lineHeight+padding*2;
   if(height>PAGE_HEIGHT-MARGIN*2-75)throw new Error('合同明细文字过长，请缩短备注后生成');
   if(ensure(height)){header();}
   let x=MARGIN;for(let column=0;column<widths.length;column++){page.drawRectangle({x,y:y-height,width:widths[column],height,borderColor:border,borderWidth:0.5});for(const [index,line] of cells[column].entries()){const alignRight=column>=2;const left=alignRight?x+widths[column]-padding-font.widthOfTextAtSize(line,size):x+padding;draw(line,left,y-padding-size-index*lineHeight,size);}x+=widths[column];}y-=height;
  }
  if(!rows.length){page.drawRectangle({x:MARGIN,y:y-16,width:widths.reduce((sum,width)=>sum+width,0),height:16,borderColor:border,borderWidth:0.5});y-=16;}
  y-=10;
 };
 const installments=()=>table(['分期名称','分期比例','分期金额'],record.installments.map(part=>[part.name+(part.due_date?'\n到期：'+part.due_date:''),String(part.ratio)+'%',contractMoney(part.amount)+'元']),[CONTENT_WIDTH-205,85,120]);
 const body=template.body.split('{{payment_schedule}}');
 for(const [partIndex,part] of body.entries()){
  const rendered=renderContractTemplate({...record,template_snapshot:{...template,body:part}});
  for(const [lineIndex,line] of rendered.split('\n').entries()){
   if(partIndex===0&&lineIndex===0&&[title,DEFAULT_CONTRACT_TEMPLATE.name,template.name].includes(line.trim()))continue;
   paragraph(line,/^第[一二三四五六七八九十]+条\s*[、，]/.test(line)?12:10.2,/^第[一二三四五六七八九十]+条\s*[、，]/.test(line));
  }
  if(partIndex<body.length-1)installments();
 }
 if(body.length===1&&record.installments.length){paragraph('付款分期',12,true);installments();}
 if(record.special_terms&&!template.body.includes('{{special_terms}}')){paragraph('补充约定',12,true);paragraph(record.special_terms);}

 const customerX=MARGIN+12,companyX=PAGE_WIDTH/2+17,signWidth=PAGE_WIDTH/2-MARGIN-37,signHeight=170;
 const signLabel=(value:string,fallback:string)=>cleanText(value.trim()||fallback).replace(/[：:]$/,'')+'：';
 const signers=[{x:customerX,label:signLabel(template.customer_keyword,'甲方代表（签章）'),name:record.party_type==='organization'?record.customer_company||record.customer_name:record.customer_name},{x:companyX,label:signLabel(template.company_keyword,'乙方代表（签章）'),name:record.company_name}];
 const signerLines=signers.map(signer=>({...signer,labels:wrap(signer.label,signWidth,10.2),names:wrap(signer.name,signWidth,9.2)}));
 if(signerLines.some(signer=>signer.labels.length>2||signer.names.length>2))throw new Error('合同签章方名称或标签过长，请缩短显示名称');
 const labelHeight=Math.max(...signerLines.map(signer=>signer.labels.length))*16,nameHeight=Math.max(...signerLines.map(signer=>signer.names.length))*13;
 ensure(12+labelHeight+nameHeight+signHeight+48);y-=12;
 const signTop=y,signBottom=signTop-labelHeight-nameHeight-12-signHeight;
 for(const signer of signerLines){signer.labels.forEach((line,index)=>draw(line,signer.x,signTop-index*16,10.2));signer.names.forEach((line,index)=>draw(line,signer.x,signTop-labelHeight-index*13,9.2,muted));}
 for(const x of [customerX,companyX]){page.drawRectangle({x,y:signBottom,width:signWidth,height:signHeight,borderColor:border,borderWidth:0.5});draw('日期：______年____月____日',x,signBottom-17,9.2,muted);}
 const position=(x:number):ContractSignPosition=>({page:pdf.getPageCount(),x,y:signBottom,width:signWidth,height:signHeight,page_width:PAGE_WIDTH,page_height:PAGE_HEIGHT});
 const positions={customer:position(customerX),company:position(companyX)};
 y=signBottom-40;

 if(attachment){
  addPage();paragraph('附件一：'+record.company_name+'报价清单',17,true);
  paragraph('报价版本：'+(attachment.quote.title||record.quote_id),9);
  paragraph('客户：'+record.customer_name+'　交货地点：'+record.customer_address,9);
  for(const room of attachment.groups){
   const roomTotal=room.lines.reduce((sum,line)=>sum+Math.round(line.quantity*Math.round(line.price*100)),0);
   ensure(70);paragraph(room.name+'　小计：'+contractMoney(roomTotal)+'元',12,true);
   for(const category of QUOTE_CATEGORIES){const lines=room.lines.filter(line=>line.category===category);if(!lines.length)continue;
    ensure(70);paragraph(category,10.5,true);
    table(['序号','名称 / 规格','数量','单位','销售单价','报价金额'],lines.map((line,index)=>{const cabinet=line.cabinet_id?attachment.cabinets.get(line.cabinet_id):undefined;return [String(index+1),line.name+(line.model?'\n规格：'+line.model:'')+(cabinet?'\n原柜体：'+cabinet.name:'')+(line.note?'\n备注：'+line.note:''),String(line.quantity),line.unit,contractMoney(Math.round(line.price*100)),contractMoney(Math.round(line.quantity*Math.round(line.price*100)))];}),[27,CONTENT_WIDTH-242,45,35,65,70]);
    paragraph(category+'小计：'+contractMoney(lines.reduce((sum,line)=>sum+Math.round(line.quantity*Math.round(line.price*100)),0))+'元',9);
   }
   if(!room.lines.length)paragraph('暂无报价明细',9);
  }
  paragraph('合同原价：'+contractMoney(record.gross_amount)+'元　优惠：'+contractMoney(record.discount_amount)+'元　抹零：'+contractMoney(record.rounding_amount)+'元',10.2);
  paragraph('合同签订金额：'+contractMoney(record.net_amount)+'元',12,true);
  if(attachment.quote.note)paragraph('报价备注：'+attachment.quote.note,9);
 }
 const pages=pdf.getPages();pages.forEach((entry,index)=>{page=entry;draw(cleanText(record.company_name),MARGIN,PAGE_HEIGHT-27,8,muted);const pageText=`${index+1} / ${pages.length}`;draw(pageText,PAGE_WIDTH-MARGIN-font.widthOfTextAtSize(pageText,8),26,8,muted);});
 return {bytes:await pdf.save(),positions};
}
