import {normalizeQuoteItem, QUOTE_CATEGORIES,quotePriceCents,quoteLineAmountCents} from './quotes';
import type {WorkBook} from 'xlsx';

export type QuoteSettlementInput={adopted?:boolean;discount_amount?:number;rounding_amount?:number;receivable?:number};
export type QuoteExportInput={project:{id:string;name:string;project_type?:'project'|'customer';customer?:string;phone?:string;address?:string;discount_amount?:number;rounding_amount?:number;receivable?:number};companyName:string;quote:any};
export type QuoteExcelPhoto={src:string;name:string;row?:number;column?:number;width?:number;height?:number};
export type QuoteExportSheet={name:string;rows:Array<Array<string|number|null>>;widths:number[];merges:Array<{s:{r:number;c:number};e:{r:number;c:number}}>;headerRow:number;totalRow:number;quantityColumn:number;priceColumn:number;amountColumn:number;sectionRows:number[];subtotalRows:number[];yellowRows?:number[];photoRows?:Array<{src:string;name:string;row:number}>;rowHeightOverrides?:Record<number,number>;signatureRow?:number};
const quoteName=(input:QuoteExportInput)=>String(input.quote.subproject_name||input.quote.title||input.project.address||input.project.name);
/** Project concessions apply only to the currently adopted household quotation. */
export function getQuoteSettlement(total:number,settlement?:QuoteSettlementInput){
 if(!settlement?.adopted||(settlement.discount_amount===undefined&&settlement.rounding_amount===undefined))return null;
 const discount=settlement.discount_amount??0,rounding=settlement.rounding_amount??0,receivable=total-discount-rounding;
 if(![total,discount,rounding,receivable].every(value=>Number.isSafeInteger(value)&&value>=0)||(settlement.receivable!==undefined&&settlement.receivable!==receivable))throw new Error('客户结算金额无效，请核对优惠、抹零和应收金额。');
 return {gross:total,discount,rounding,receivable};
}

/** A single printable statement. Saved data and category totals remain authoritative. */
export function buildQuoteExportSheets(input:QuoteExportInput,options?:{hideCabinetSection?:boolean}):QuoteExportSheet[]{
 const quote=input?.quote;
 if(!quote||!Array.isArray(quote.items))throw new Error('没有可下载的报价明细，请先保存报价。');
 if(!Number.isSafeInteger(quote.total)||quote.total<0)throw new Error('报价没有有效的已保存总额，请先保存报价。');
 const items=quote.items.map((raw:any,index:number)=>{const item=normalizeQuoteItem(raw),priceCents=quotePriceCents(item.price),amountCents=quoteLineAmountCents(item.quantity,item.price);if(!Number.isFinite(item.quantity)||item.quantity<=0||!Number.isSafeInteger(priceCents)||priceCents<0||!Number.isSafeInteger(amountCents)||amountCents<0)throw new Error(`第 ${index+1} 条明细数量或价格无效，请核对报价。`);return {...item,priceCents,amountCents};});
 const total=items.reduce((sum:number,item:any)=>sum+item.amountCents,0);
 if(!Number.isSafeInteger(total)||total!==quote.total)throw new Error('报价明细合计与已保存总额不一致，请核对并保存后再下载。');
 const rooms=quote.rooms;
 if(rooms!==undefined&&(!Array.isArray(rooms)||rooms.length>100||rooms.some((room:any)=>!room||typeof room.id!=='string'||!room.id||typeof room.name!=='string'||!room.name.trim())||new Set(rooms.map((room:any)=>room.id)).size!==rooms.length))throw new Error('报价房间信息无效，请核对并保存后再下载。');
 if(input.project.project_type==='customer'&&!rooms?.length)throw new Error('终端客户报价缺少房间，请核对并保存后再下载。');
 if((rooms!==undefined||items.some((item:any)=>item.room_id!==undefined))&&items.some((item:any)=>!rooms?.some((room:any)=>room.id===item.room_id)))throw new Error('报价明细未关联有效房间，请核对并保存后再下载。');
 const cabinets=quote.cabinets??[],uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!Array.isArray(cabinets)||cabinets.some((cabinet:any)=>!cabinet||typeof cabinet.id!=='string'||!uuid.test(cabinet.id)||typeof cabinet.room_id!=='string'||!uuid.test(cabinet.room_id)||typeof cabinet.name!=='string'||!cabinet.name.trim())||new Set(cabinets.map((cabinet:any)=>cabinet.id.toLowerCase())).size!==cabinets.length)throw new Error('报价柜体信息无效，请核对并保存后再下载。');
 if(cabinets.some((cabinet:any)=>!rooms?.some((room:any)=>room.id===cabinet.room_id)))throw new Error('报价柜体未关联有效房间，请核对并保存后再下载。');
 items.forEach((item:any,index:number)=>{const id=quote.items[index]?.cabinet_id;if(id===undefined)return;const cabinet=cabinets.find((value:any)=>value.id===id);if(!cabinet)throw new Error('报价明细未关联有效柜体，请核对并保存后再下载。');if(item.room_id!==cabinet.room_id)throw new Error('报价明细与柜体所属房间不一致，请核对并保存后再下载。');});
 const settlement=input.project.project_type==='customer'?getQuoteSettlement(total,{...input.project,adopted:quote.adopted===true}):null;
 const rows:QuoteExportSheet['rows']=[[input.companyName||''],[quoteName(input)+'的清单报价'],['客户姓名：'+(input.project.customer||'')+'  客户地址：'+(input.project.address||'')+'  客户电话：'+(input.project.phone||'')],['编号','项目','单位','数量','单价','金额','上传附件']];
  const merges:QuoteExportSheet['merges']=[0,1,2].map(r=>({s:{r,c:0},e:{r,c:6}})),sectionRows:number[]=[],subtotalRows:number[]=[],yellowRows:number[]=[];
  const photoRows:{src:string;name:string;row:number}[]=[];
  const appendCategories=(groupItems:typeof items)=>{for(const category of QUOTE_CATEGORIES){const entries=groupItems.filter((item:any)=>item.category===category);if(!entries.length)continue;if(category!=='柜体'||!options?.hideCabinetSection){const r=rows.length;sectionRows.push(r);merges.push({s:{r,c:0},e:{r,c:4}});rows.push([category,null,null,null,null,entries.reduce((sum:number,item:any)=>sum+item.amountCents,0)/100,null]);}entries.forEach((item:any,index:number)=>{rows.push([index+1,item.name,item.unit,item.quantity,item.priceCents/100,item.amountCents/100,null]);const itemRow=rows.length-1;(item.photos||[]).slice(0,3).forEach((photo:any)=>photoRows.push({src:'/api/quote-item-photos?key='+encodeURIComponent(photo.key),name:photo.name,row:itemRow}));if(item.config_note){const r=rows.length;rows.push(['配置：'+item.config_note]);merges.push({s:{r,c:0},e:{r,c:6}});}if(item.note&&!item.note.startsWith('AI智能识别')){const r=rows.length;rows.push(['备注：'+item.note]);merges.push({s:{r,c:0},e:{r,c:6}});}});}};
 const appendSection=(label:string)=>{const r=rows.length;rows.push([label]);sectionRows.push(r);merges.push({s:{r,c:0},e:{r,c:6}});};
 const appendSubtotal=(label:string,amount:number)=>{const r=rows.length;rows.push([label,null,null,null,null,amount/100,null]);subtotalRows.push(r);merges.push({s:{r,c:0},e:{r,c:4}});return r;};
 if(rooms?.length){for(const room of rooms){
  const roomItems=items.filter((item:any)=>item.room_id===room.id),roomCabinets=cabinets.filter((cabinet:any)=>cabinet.room_id===room.id);appendSection('空间：'+room.name);
  if(roomCabinets.length){
   const common=roomItems.filter((item:any)=>item.cabinet_id===undefined);if(common.length){appendSection('公共明细');appendCategories(common);}
   for(const cabinet of roomCabinets){const cabinetItems=roomItems.filter((item:any)=>item.cabinet_id===cabinet.id);appendSection('柜体：'+cabinet.name);appendCategories(cabinetItems);if(!cabinetItems.length){const r=rows.length;rows.push(['暂无报价明细']);merges.push({s:{r,c:0},e:{r,c:6}});}appendSubtotal(cabinet.name+'柜体小计',cabinetItems.reduce((sum:number,item:any)=>sum+item.amountCents,0));}
  }else appendCategories(roomItems);
  appendSubtotal(room.name+'小计',roomItems.reduce((sum:number,item:any)=>sum+item.amountCents,0));
 }}else appendCategories(items);
 let r=rows.length;rows.push(['费用项']);sectionRows.push(r);yellowRows.push(r);merges.push({s:{r,c:0},e:{r,c:6}});
 r=rows.length;rows.push(['项目',null,null,null,null,'金额','备注']);merges.push({s:{r,c:0},e:{r,c:4}});
 const totalRow=appendSubtotal('报价合计',total);
 if(settlement){appendSubtotal('原报价',settlement.gross);appendSubtotal('优惠',settlement.discount);appendSubtotal('抹零',settlement.rounding);appendSubtotal('应收金额',settlement.receivable);}
 if(quote.note){r=rows.length;rows.push(['报价备注：'+String(quote.note)]);merges.push({s:{r,c:0},e:{r,c:6}});}
 r=rows.length;rows.push(['乙方：'+input.companyName,null,null,'甲方：']);merges.push({s:{r,c:0},e:{r,c:2}},{s:{r,c:3},e:{r,c:6}});
 r=rows.length;rows.push(['时间：',null,null,'时间：']);merges.push({s:{r,c:0},e:{r,c:2}},{s:{r,c:3},e:{r,c:6}});r=rows.length;rows.push(['固美格定制·SI超级智能平台 · https://www.si助手.com · '+new Date().getFullYear()+'/'+String(new Date().getMonth()+1).padStart(2,'0')+'/'+String(new Date().getDate()).padStart(2,'0')]);merges.push({s:{r,c:0},e:{r,c:6}});
  return [{name:'报价清单',rows,widths:[7,24,6,9,10,14,12],merges,headerRow:3,totalRow,quantityColumn:3,priceColumn:4,amountColumn:5,sectionRows,subtotalRows,yellowRows,photoRows}];
}

export async function createQuoteWorkbook(input:QuoteExportInput):Promise<WorkBook>{
 const module=await import('xlsx'),XLSX=module.default||module,workbook=XLSX.utils.book_new();workbook.Props={Title:quoteName(input)+'的清单报价',Company:input.companyName};workbook.Workbook={Names:[]};
 for(const data of buildQuoteExportSheets(input)){const sheet=XLSX.utils.aoa_to_sheet(data.rows);sheet['!merges']=data.merges;sheet['!cols']=data.widths.map(wch=>({wch}));sheet['!rows']=data.rows.map((row,index)=>({hpt:index===0?46:row[0]?.toString().includes('备注')?Math.max(25.6,Math.ceil(String(row[0]).length/55)*18):25.6}));sheet['!margins']={left:0.25,right:0.25,top:0.4,bottom:0.4,header:0.15,footer:0.15};
 // Fill the grid so borders and category bars include empty cells.
 for(let r=0;r<data.rows.length;r++)for(let c=0;c<7;c++){const address=XLSX.utils.encode_cell({r,c});if(!sheet[address])sheet[address]={t:'s',v:''};}
 XLSX.utils.book_append_sheet(workbook,sheet,data.name);workbook.Workbook!.Names!.push({Name:'_xlnm.Print_Area',Sheet:0,Ref:"'报价清单'!$A$1:$G$"+data.rows.length},{Name:'_xlnm.Print_Titles',Sheet:0,Ref:"'报价清单'!$1:$4"});}return workbook;
}

/** SheetJS CE omits styles/page setup; apply standard OOXML to the browser ZIP. */
export async function applyQuoteExcelStyling(data:QuoteExportSheet,props?:{title:string;company?:string},photos?:QuoteExcelPhoto[]):Promise<Uint8Array>{
  const module=await import('xlsx'),XLSX=module.default||module;
  const zip=XLSX.CFB.read(new Uint8Array(XLSX.write(await workbookFromSheet(data,props),{bookType:'xlsx',type:'array'})),{type:'buffer'}),encode=new TextEncoder(),decode=new TextDecoder();
  const fonts='<fonts count="6"><font><sz val="11"/><name val="宋体"/></font><font><b/><sz val="18"/><name val="宋体"/></font><font><b/><sz val="11"/><color rgb="FFFF5722"/><name val="宋体"/></font><font><b/><sz val="24"/><color rgb="FF2F75B5"/><name val="宋体"/></font><font><b/><sz val="14"/><name val="宋体"/></font><font><sz val="10"/><name val="宋体"/></font></fonts>';
  const fills='<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F75B5"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC0C0C0"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>';
  // WPS/Excel 惯例：borders[0] 必须是空边框，自定义边框从索引 1 开始，否则 WPS 会把 borderId=0 视为无边框。
  // borderId=1 黑色细线（表体）；borderId=2 浅灰细线（报价合计之后的落款区——参照桌面xls：黑框只到合计行）。
  const border='<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border>'+['left','right','top','bottom'].map(side=>`<${side} style="thin"><color rgb="FF000000"/></${side}>`).join('')+'<diagonal/></border><border>'+['left','right','top','bottom'].map(side=>`<${side} style="thin"><color rgb="FFD9D9D9"/></${side}>`).join('')+'<diagonal/></border></borders>';
  const xf=(font:number,fill:number,num:number,align='center',borderId=1)=>`<xf numFmtId="${num}" fontId="${font}" fillId="${fill}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="${align}" vertical="center" wrapText="1"/></xf>`;
  const baseXfs=xf(0,0,0)+xf(3,1,0)+xf(0,0,0,'left')+xf(0,3,0,'left')+xf(2,0,2,'right')+xf(2,3,2,'right')+xf(0,0,2)+xf(0,4,0,'left')+xf(4,0,0)+xf(0,5,0,'left',2)+xf(5,0,0,'left',2);
  const styles='<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+fonts+fills+border+'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="22">'+baseXfs+baseXfs.replaceAll('borderId="1"','borderId="2"')+'</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const styleEntry=XLSX.CFB.find(zip,'/xl/styles.xml')!;styleEntry.content=encode.encode(styles) as any;styleEntry.size=styleEntry.content.length;
  const entry=XLSX.CFB.find(zip,'/xl/worksheets/sheet1.xml');if(!entry)throw new Error('报价工作表生成失败');
  let xml=decode.decode(entry.content as Uint8Array);
  // 报价合计（或应收金额）之后的落款区（报价备注/乙方甲方/时间）用浅灰边框（样式+8），表体保持黑框。
  // 表格区域之外（第 9 列起 / 末行之后）统一铺浅灰细线样式 8：WPS 若仍显示网格线，表外线条即呈浅灰；打印区域仅限表格本身。
  const lastMoneyRow=data.subtotalRows.length?Math.max(...data.subtotalRows):-1;
  xml=xml.replace(/<c\b([^>]*\br="([A-Z]+)(\d+)"[^>]*)>/g,(_all,attributes,col,row)=>{const r=Number(row)-1,c=XLSX.utils.decode_col(col),value=data.rows[r]?.[c],section=data.sectionRows.includes(r),yellow=data.yellowRows?.includes(r)===true;let style=r===0?1:r===1?8:r===2?2:yellow?7:section?3:c===1?2:0;if(typeof value==='number'&&(c===5||c===6))style=section?5:4;else if(typeof value==='number'&&c===4)style=6;if(r===data.signatureRow&&c===3)style=2;if(r>=data.rows.length||c>6)style=9;else if(r===data.rows.length-1)style=10;else if(r>lastMoneyRow)style+=11;return '<c'+attributes.replace(/\s+s="\d+"/g,'')+` s="${style}">`;});
  xml=xml.replace('<sheetView workbookViewId="0"/>','<sheetView workbookViewId="0" showGridLines="0"/>');
  xml=xml.replace('</sheetPr>','<pageSetUpPr fitToPage="1"/></sheetPr>');if(!xml.includes('<sheetPr>'))xml=xml.replace(/(<worksheet\b[^>]*>)/,'$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
  xml=xml.replace(/(<pageMargins\b[^>]*\/>) /,'$1');
  xml=xml.replace(/(<pageMargins\b[^>]*\/>)/,'<printOptions horizontalCentered="1"/>$1<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;C第 &amp;P 页 / 共 &amp;N 页</oddFooter></headerFooter>');
  entry.content=encode.encode(xml) as any;entry.size=entry.content.length;
  await embedPhotos(zip,XLSX,encode,decode,data,photos);
  return new Uint8Array(XLSX.CFB.write(zip,{type:'buffer',fileType:'zip',compression:true}));
}

/** 把附件图片嵌入 xlsx：每张图片锚定在「上传附件」列（H 列）对应明细行下方；同一行多张则向下排开；未关联行的图排在表尾之后。 */
async function embedPhotos(zip:any,XLSX:any,encode:TextEncoder,decode:TextDecoder,data:QuoteExportSheet,photos?:QuoteExcelPhoto[]):Promise<void>{
  if(!photos?.length)return;
  const loaded:Uint8Array[]=[];
  const rowsOf:number[]=[];
  for(const photo of photos){try{const response=await fetch(photo.src);if(!response.ok)continue;loaded.push(new Uint8Array(await response.arrayBuffer()));rowsOf.push(photo.row??-1);}catch{/* 单张失败跳过 */}}
  if(!loaded.length)return;
  loaded.forEach((bytes,index)=>{
    XLSX.CFB.utils.cfb_add(zip,'/xl/media/image'+(index+1)+'.png',bytes);
  });
  const relsEntry=XLSX.CFB.find(zip,'/xl/worksheets/_rels/sheet1.xml.rels');
  const drawingRelId='rIdPhoto1';
  if(relsEntry){
    let rels=decode.decode(relsEntry.content as Uint8Array);
    rels=rels.replace('</Relationships>',`<Relationship Id="${drawingRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
    relsEntry.content=encode.encode(rels) as any;relsEntry.size=relsEntry.content.length;
  }else{
    const rels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="'+drawingRelId+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>';
    XLSX.CFB.utils.cfb_add(zip,'/xl/worksheets/_rels/sheet1.xml.rels',encode.encode(rels));
  }
  // 每行照片都锚定在「上传附件」列（col 7）；同一行多张则依次向下排开（rowOff 递增）。
  const perRow=new Map<number,number>();
  const anchors:string[]=[];
  const EMU=952500;
  const tailStart=data.rows.length+1;
  let tailCount=0;
  loaded.forEach((_,index)=>{
    const row=rowsOf[index];
    let anchorRow:number,anchorCol:number,rowOff:number;
    if(row>=0){const nth=perRow.get(row)||0;perRow.set(row,nth+1);anchorRow=row;anchorCol=photos[index].column??6;rowOff=nth*EMU;}
    else{anchorRow=tailStart+Math.floor(tailCount/4)*9;anchorCol=tailCount%4*2;rowOff=0;tailCount++;}
    const imageWidth=Math.round((photos[index].width??100)*9525),imageHeight=Math.round((photos[index].height??100)*9525);
    anchors.push('<xdr:oneCellAnchor><xdr:from><xdr:col>'+anchorCol+'</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>'+anchorRow+'</xdr:row><xdr:rowOff>'+rowOff+'</xdr:rowOff></xdr:from><xdr:ext cx="'+imageWidth+'" cy="'+imageHeight+'"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="'+(index+2)+'" name="'+(photos[index].name||('附件'+(index+1))).replace(/[<>&"]/g,'')+'"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdImg'+(index+1)+'"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+imageWidth+'" cy="'+imageHeight+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>');
  });
  const drawing='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'+anchors.join('')+'</xdr:wsDr>';
  XLSX.CFB.utils.cfb_add(zip,'/xl/drawings/drawing1.xml',encode.encode(drawing));
  const drawingRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+loaded.map((_,index)=>'<Relationship Id="rIdImg'+(index+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image'+(index+1)+'.png"/>').join('')+'</Relationships>';
  XLSX.CFB.utils.cfb_add(zip,'/xl/drawings/_rels/drawing1.xml.rels',encode.encode(drawingRels));
  const sheetEntry=XLSX.CFB.find(zip,'/xl/worksheets/sheet1.xml')!;
  let sheet=decode.decode(sheetEntry.content as Uint8Array);
  if(!sheet.includes('xmlns:r='))sheet=sheet.replace(/<worksheet\b([^>]*?)>/,'<worksheet$1 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
  sheet=sheet.replace('</worksheet>','<drawing r:id="'+drawingRelId+'"/></worksheet>');
  sheetEntry.content=encode.encode(sheet) as any;sheetEntry.size=sheetEntry.content.length;
  const typesEntry=XLSX.CFB.find(zip,'[Content_Types].xml')!;
  let types=decode.decode(typesEntry.content as Uint8Array);
  if(!types.includes('Extension="png"'))types=types.replace('</Types>','<Default Extension="png" ContentType="image/png"/>');
  types=types.replace('</Types>','<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
  typesEntry.content=encode.encode(types) as any;typesEntry.size=typesEntry.content.length;
}

/** 按每列文字实际宽度自动调列宽：中文计双宽，限制在 [min,max] 区间，总宽不超上限。 */
export function autoColumnWidths(data:QuoteExportSheet,min:number[],max:number[]):number[]{
  const widths=data.widths.slice();
  for(let c=0;c<7;c++){
    let cost=0;
    data.rows.forEach((row,r)=>{
      if(data.sectionRows.includes(r)||data.yellowRows?.includes(r))return;
      const merge=data.merges.find(m=>m.s.r===r&&m.s.c<=c&&m.e.c>=c);
      if(merge)return;
      const text=row[c]==null?'':String(row[c]);
      const cell=[...text].reduce((sum,ch)=>sum+(/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch)?2:1),0);
      cost=Math.max(cost,cell);
    });
    widths[c]=Math.max(min[c]??widths[c],Math.min(max[c]??widths[c],cost+2));
  }
  return widths;
}

/** 估算一行文字按列宽换行后需要的显示高度：中日韩字符按 2 个半角宽度计；合并单元格按合并总宽度算。 */
export function rowHeightPt(row:QuoteExportSheet['rows'][number],widths:number[],mergeAt?:Map<number,number>):number{
  let lines=1;
  for(let c=0;c<row.length&&c<widths.length;c++){
    const text=row[c]==null?'':String(row[c]);
    if(!text)continue;
    const capacity=Math.max(6,(mergeAt?.get(c)??widths[c]));
    const cost=[...text].reduce((sum,ch)=>sum+(/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch)?2:1),0);
    lines=Math.max(lines,Math.ceil(cost/capacity));
  }
  return Math.max(25.6,Math.min(409,lines*15.5+10));
}

export function rowMergeWidthMap(data:QuoteExportSheet):Map<string,Map<number,number>>{
  const byRow=new Map<string,Map<number,number>>();
  data.merges.forEach(merge=>{
    const width=data.widths.slice(merge.s.c,merge.e.c+1).reduce((a,b)=>a+b,0);
    let cols=byRow.get('r'+merge.s.r);
    if(!cols){cols=new Map();byRow.set('r'+merge.s.r,cols);}
    cols.set(merge.s.c,width);
  });
  return byRow;
}

async function workbookFromSheet(data:QuoteExportSheet,props?:{title:string;company?:string}):Promise<WorkBook>{
  const module=await import('xlsx'),XLSX=module.default||module,workbook=XLSX.utils.book_new();workbook.Props={Title:props?.title||String(data.rows[0]?.[0]||'报价清单'),Company:props?.company};workbook.Workbook={Names:[]};
  const widths=autoColumnWidths(data,[6,14,5,7,8,10,10],[7,30,7,9,10,14,16]);
  const mergeWidths=rowMergeWidthMap({...data,widths});
  const sheet=XLSX.utils.aoa_to_sheet(data.rows);sheet['!merges']=data.merges;sheet['!cols']=widths.map(wch=>({wch}));sheet['!rows']=data.rows.map((row,index)=>({hpt:data.rowHeightOverrides?.[index]??(index===0?46:rowHeightPt(row,widths,mergeWidths.get('r'+index)))}));sheet['!margins']={left:0.25,right:0.25,top:0.4,bottom:0.4,header:0.15,footer:0.15};
  // Fill the grid so borders and category bars include empty cells; extend to columns A..Z and
  // 15 rows past the table so the area outside the table carries the light-gray line style.
  for(let r=0;r<data.rows.length+15;r++)for(let c=0;c<26;c++){const address=XLSX.utils.encode_cell({r,c});if(!sheet[address])sheet[address]={t:'s',v:''};}
  sheet['!ref']='A1:'+XLSX.utils.encode_cell({r:data.rows.length+14,c:25});
  XLSX.utils.book_append_sheet(workbook,sheet,data.name);workbook.Workbook!.Names!.push({Name:'_xlnm.Print_Area',Sheet:0,Ref:"'"+data.name+"'!$A$1:$G$"+data.rows.length},{Name:'_xlnm.Print_Titles',Sheet:0,Ref:"'"+data.name+"'!$1:$4"});
  return workbook;
}

export async function createQuoteExcelBytes(input:QuoteExportInput):Promise<Uint8Array>{
  const sheets=buildQuoteExportSheets(input);
  return applyQuoteExcelStyling(sheets[0],{title:quoteName(input)+'的清单报价',company:input.companyName},(sheets[0].photoRows||[]).slice(0,60));
}
export function quoteExcelFileName(input:QuoteExportInput):string{return ([input.project.address||input.project.name,quoteName(input),'报价清单'].join('_').replace(/[<>:"/\\|?*\u0000-\u001F]/g,'_').trim().replace(/[. ]+$/g,'').slice(0,150)||'项目报价')+'.xlsx';}
export async function downloadQuoteExcel(input:QuoteExportInput):Promise<void>{const bytes=await createQuoteExcelBytes(input),url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');try{link.href=url;link.download=quoteExcelFileName(input);document.body.appendChild(link);link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}}

export type DraftQuoteExcelInput={title:string;companyName?:string;customer?:string;items:Array<{name:string;model:string;quantity:number;price:number;unit:string;note:string;config_note?:string;category:string;photos?:Array<{key:string;name:string}>}>;note?:string};
/** 草稿导出：与正式「下载 Excel」同一套排版（蓝底标题/客户行、灰底分类段带小计、黄底费用项、报价合计、乙方甲方），保留销售单价与金额。 */
export async function downloadDraftQuoteExcel(input:DraftQuoteExcelInput):Promise<void>{
  if(!input.items.length)throw new Error('当前草稿没有明细，无法导出 Excel。');
  const cents=(item:DraftQuoteExcelInput['items'][number])=>quoteLineAmountCents(item.quantity,item.price);
  const rows:QuoteExportSheet['rows']=[[input.companyName||''],[input.title],['客户姓名：'+(input.customer||'')+'  客户地址：  客户电话：'],['编号','项目','单位','数量','单价','金额','上传附件']];
  const merges:QuoteExportSheet['merges']=[0,1,2].map(r=>({s:{r,c:0},e:{r,c:6}})),sectionRows:number[]=[],subtotalRows:number[]=[],yellowRows:number[]=[];
  const photos:{src:string;name:string;row:number}[]=[];
  for(const category of QUOTE_CATEGORIES){
    const entries=input.items.filter(item=>item.category===category);
    if(!entries.length)continue;
    const r=rows.length;sectionRows.push(r);merges.push({s:{r,c:0},e:{r,c:4}});
    rows.push([category+'销售清单',null,null,null,null,entries.reduce((sum,item)=>sum+cents(item),0)/100,null]);
    entries.forEach((item,index)=>{rows.push([index+1,item.name,item.unit,item.quantity,item.price,cents(item)/100,null]);const itemRow=rows.length-1;(item.photos||[]).slice(0,3).forEach(photo=>photos.push({src:'/api/quote-item-photos?key='+encodeURIComponent(photo.key),name:photo.name,row:itemRow}));if(item.config_note){const cr=rows.length;rows.push(['配置：'+item.config_note]);merges.push({s:{r:cr,c:0},e:{r:cr,c:6}});}if(item.note&&!item.note.startsWith('AI智能识别')){const nr=rows.length;rows.push(['备注：'+item.note]);merges.push({s:{r:nr,c:0},e:{r:nr,c:6}});}});
  }
  let r=rows.length;rows.push(['费用项']);sectionRows.push(r);yellowRows.push(r);merges.push({s:{r,c:0},e:{r,c:6}});
  r=rows.length;rows.push(['项目',null,null,null,null,'金额','备注']);merges.push({s:{r,c:0},e:{r,c:4}});
  const total=input.items.reduce((sum,item)=>sum+cents(item),0);
  r=rows.length;rows.push(['报价合计',null,null,null,null,total/100,null]);subtotalRows.push(r);merges.push({s:{r,c:0},e:{r,c:4}});
  if(input.note){r=rows.length;rows.push(['报价备注：'+String(input.note)]);merges.push({s:{r,c:0},e:{r,c:6}});}
  r=rows.length;rows.push(['乙方：'+(input.companyName||''),null,null,'甲方：']);merges.push({s:{r,c:0},e:{r,c:2}},{s:{r,c:3},e:{r,c:6}});
  r=rows.length;rows.push(['时间：',null,null,'时间：']);merges.push({s:{r,c:0},e:{r,c:2}},{s:{r,c:3},e:{r,c:6}});r=rows.length;rows.push(['固美格定制·SI超级智能平台 · https://www.si助手.com · '+new Date().getFullYear()+'/'+String(new Date().getMonth()+1).padStart(2,'0')+'/'+String(new Date().getDate()).padStart(2,'0')]);merges.push({s:{r,c:0},e:{r,c:6}});
  const data:QuoteExportSheet={name:'报价清单',rows,widths:[7,24,6,9,10,14,12],merges,headerRow:3,totalRow:rows.length-4,quantityColumn:3,priceColumn:4,amountColumn:5,sectionRows,subtotalRows,yellowRows,photoRows:photos};
  const bytes=await applyQuoteExcelStyling(data,{title:input.title,company:input.companyName},photos.slice(0,60));
  const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');
  try{link.href=url;link.download=(input.title.replace(/[<>:"/\\|?*\u0000-\u001F]/g,'_').trim()||'报价草稿')+'.xlsx';document.body.appendChild(link);link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
