import {autoColumnWidths,rowHeightPt,rowMergeWidthMap,type QuoteExportSheet} from './quote-export';

export type ConfirmationImage={src:string;name:string;row:number};
export type ConfirmationCell={x:number;y:number;width:number;height:number;text:string;lines:string[];fontSize:number;bold:boolean;fill:string;color:string;border:string;align:'left'|'center'|'right';image?:string};
export type ConfirmationLayout={width:number;height:number;rows:{y:number;height:number;cells:ConfirmationCell[]}[]};
export function confirmationDate(value?:string){return value?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value)):'';}
const escape=(value:string)=>value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
function wrap(text:string,width:number,size:number){const result:string[]=[];for(const paragraph of text.split('\n')){let line='',used=0;for(const char of paragraph){const n=/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(char)?size:size*.55;if(line&&used+n>width){result.push(line);line='';used=0;}line+=char;used+=n;}result.push(line);}return result;}

/** The same rows, merges, column sizing and row sizing used by the actual XLSX export. */
export function confirmationLayout(sheet:QuoteExportSheet,signature?:string,signedAt?:string):ConfirmationLayout{
 const widths=autoColumnWidths(sheet,[6,14,18,5,7,8,10,10],[7,30,55,7,9,10,14,16]);
 const columns=widths.map(value=>value*7+5),merged=rowMergeWidthMap({...sheet,widths});
 const lastMoney=Math.max(...sheet.subtotalRows),rows:ConfirmationLayout['rows']=[];let y=0;
 for(let r=0;r<sheet.rows.length;r++){
  const row=sheet.rows[r],section=sheet.sectionRows.includes(r),yellow=sheet.yellowRows?.includes(r),tail=r>lastMoney;
  const signRow=String(row[0]||'').startsWith('乙方：'),dateRow=row[0]==='时间：';
  const height=Math.max((r===0?38.4:rowHeightPt(row,widths,merged.get('r'+r)))*4/3,signRow&&signature?96:0);
  const cells:ConfirmationCell[]=[];let x=0;
  for(let c=0;c<8;c++){
   const merge=sheet.merges.find(m=>m.s.r===r&&m.s.c===c),covered=sheet.merges.some(m=>m.s.r===r&&m.s.c<c&&m.e.c>=c);
   if(covered){x+=columns[c];continue;}
   const span=merge?merge.e.c-c+1:1,width=columns.slice(c,c+span).reduce((a,b)=>a+b,0),value=row[c];
   let text=typeof value==='number'&&[sheet.priceColumn,sheet.amountColumn,sheet.quantityColumn].includes(c)?value.toFixed(2):String(value??'');
   if(dateRow&&signedAt&&c===3)text='时间：'+confirmationDate(signedAt);
   const numeric=typeof value==='number'&&(c===sheet.priceColumn||c===sheet.amountColumn);
   const fontSize=r===0?24:44/3,align=numeric?'right':r===1||section||c===1||c===2||(signRow&&!!signature)?'left':'center';
   cells.push({x,y,width,height,text,lines:wrap(text,width-12,fontSize),fontSize,bold:r===0||numeric,fill:r===0?'#99ccff':yellow?'#ffff00':section?'#c0c0c0':'#ffffff',color:numeric?'#ff5722':'#000000',border:tail?'#d9d9d9':'#000000',align,...(signRow&&c===3&&signature?{image:signature}:{})});
   x+=columns[c];
  }
  rows.push({y,height,cells});y+=height;
 }
 return {width:columns.reduce((a,b)=>a+b,0),height:y,rows};
}

export function confirmationSvg(sheet:QuoteExportSheet,signature?:string,signedAt?:string){
 const layout=confirmationLayout(sheet,signature,signedAt);let body='';
 for(const row of layout.rows)for(const cell of row.cells){
  body+=`<rect x="${cell.x}" y="${cell.y}" width="${cell.width}" height="${cell.height}" fill="${cell.fill}" stroke="${cell.border}" stroke-width="1"/>`;
  const textX=cell.align==='right'?cell.x+cell.width-6:cell.align==='center'?cell.x+cell.width/2:cell.x+6;
  const textY=cell.image?cell.y+20:cell.y+(cell.height-cell.lines.length*cell.fontSize*1.3)/2+cell.fontSize;
  body+=`<text fill="${cell.color}" font-size="${cell.fontSize}" font-weight="${cell.bold?'bold':'normal'}" text-anchor="${cell.align==='right'?'end':cell.align==='center'?'middle':'start'}">${cell.lines.map((line,i)=>`<tspan x="${textX}" y="${textY+i*cell.fontSize*1.3}">${escape(line)}</tspan>`).join('')}</text>`;
  if(cell.image)body+=`<image href="${escape(cell.image)}" x="${cell.x+60}" y="${cell.y+8}" width="${cell.width-70}" height="${cell.height-16}" preserveAspectRatio="xMidYMid meet"/>`;
 }
 for(const photo of sheet.photoRows||[]){
  const row=layout.rows[photo.row],cell=row?.cells.find(c=>c.x===layout.rows[2]?.cells[7]?.x);if(!row||!cell)continue;
  const index=(sheet.photoRows||[]).filter(p=>p.row===photo.row).indexOf(photo);
  body+=`<image href="${escape(photo.src)}" x="${cell.x}" y="${row.y+index*100}" width="${100}" height="100" preserveAspectRatio="none"><title>${escape(photo.name)}</title></image>`;
 }
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(layout.width)}" height="${Math.ceil(layout.height)}" viewBox="-1 -1 ${layout.width+2} ${layout.height+2}"><rect x="-1" y="-1" width="100%" height="100%" fill="white"/><g font-family="SimSun,宋体,Noto Sans CJK SC,serif">${body}</g></svg>`;
}
