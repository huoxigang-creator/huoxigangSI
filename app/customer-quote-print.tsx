'use client';

import {useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import type {QuoteRoom} from './quote-rooms';
import {type QuoteCabinet,type QuoteItem} from '../lib/quotes';
import {buildQuoteExportSheets,type QuoteExportSheet,type QuoteSettlementInput,type QuoteExportInput} from '../lib/quote-export';

type Line = QuoteItem & {room_id?:string};
const subscribeToMount=()=>()=>{};
const clientMounted=()=>true;
const serverMounted=()=>false;

export function buildCustomerQuotePrintGroups(rooms:QuoteRoom[],lines:Line[],cabinets:QuoteCabinet[]=[]){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!Array.isArray(cabinets)||cabinets.some(cabinet=>!cabinet||typeof cabinet.id!=='string'||!uuid.test(cabinet.id)||typeof cabinet.room_id!=='string'||!uuid.test(cabinet.room_id)||typeof cabinet.name!=='string'||!cabinet.name.trim())||new Set(cabinets.map(cabinet=>cabinet.id.toLowerCase())).size!==cabinets.length)throw new Error('报价柜体信息无效，请核对后打印。');
 if(cabinets.some(cabinet=>!rooms.some(room=>room.id===cabinet.room_id)))throw new Error('报价柜体未关联有效房间，请核对后打印。');
 lines.forEach(line=>{if(line.cabinet_id===undefined)return;const cabinet=cabinets.find(value=>value.id===line.cabinet_id);if(!cabinet)throw new Error('报价明细未关联有效柜体，请核对后打印。');if(line.room_id!==cabinet.room_id)throw new Error('报价明细与柜体所属房间不一致，请核对后打印。');});
 const unassigned=lines.filter(line=>!line.room_id||!rooms.some(room=>room.id===line.room_id));
 return [...rooms.map(room=>({...room,lines:lines.filter(line=>line.room_id===room.id),cabinets:cabinets.filter(cabinet=>cabinet.room_id===room.id)})),...(unassigned.length?[{id:'unassigned',name:'未分配空间',lines:unassigned,cabinets:[]}]:[])];
}

/** 整户报价打印：与「下载 Excel」完全同一套表格（buildQuoteExportSheets），Excel 文件即打印文件。 */
export default function CustomerQuotePrint({title,customer,phone,address,company,rooms,lines,total,note,cabinets=[],settlement,exportInput}: {
  title:string;customer?:string;phone?:string;address?:string;company:string;rooms:QuoteRoom[];lines:Line[];total:number;note?:string;cabinets?:QuoteCabinet[];settlement?:QuoteSettlementInput;exportInput?:QuoteExportInput;
}) {
  const mounted=useSyncExternalStore(subscribeToMount,clientMounted,serverMounted);
  if(!mounted)return null;
  // 打印兜底：历史报价可能存在未关联房间的明细，归入「未分配空间」，与旧打印口径一致（下载 Excel 仍走严格校验）。
  const orphan=lines.filter(line=>!line.room_id||!rooms.some(room=>room.id===line.room_id));
  const printRooms=orphan.length?[...rooms,{id:'unassigned',name:'未分配空间'}]:rooms;
  const printLines=orphan.length?lines.map(line=>({...line,room_id:line.room_id&&rooms.some(room=>room.id===line.room_id)?line.room_id:'unassigned'})):lines;
  let sheet:QuoteExportSheet|null=null,printError='';
  try{
    sheet=buildQuoteExportSheets(exportInput||{project:{id:'print',name:title,project_type:'customer',customer,phone,address,...(settlement||{})},companyName:company,quote:{subproject_name:title,title,rooms:printRooms,cabinets,items:printLines,total,adopted:settlement?.adopted===true,note}})[0];
  }catch(reason){printError=reason instanceof Error?reason.message:'报价信息无效，请核对后打印。';}
  if(printError||!sheet)return createPortal(<main className="qwCustomerPrint"><h1>{title}</h1><p>{company}</p><p>客户：{customer||'—'}　电话：{phone||'—'}　地址：{address||'—'}</p><p role="alert">{printError||'报价信息无效，请核对后打印。'}</p></main>,document.body);
  const {rows,sectionRows,subtotalRows,yellowRows,photoRows}=sheet;
  const lastMoneyRow=subtotalRows.length?Math.max(...subtotalRows):-1;
  const photosByRow=new Map<number,{src:string;name:string}[]>();
  (photoRows||[]).forEach(photo=>{const list=photosByRow.get(photo.row)||[];list.push(photo);photosByRow.set(photo.row,list);});
  const fmt=(value:string|number|null)=>typeof value==='number'?value.toFixed(2):(value==null?'':String(value));
  const body=rows.map((row,r)=>{
    const tail=r>lastMoneyRow?' qwXlsTail':'';
    if(r===0)return <tr key={r} className="qwXlsTitle"><td colSpan={8}>{row[0]}</td></tr>;
    if(r===1)return <tr key={r} className={'qwXlsCustomer'+tail}><td colSpan={8}>{row[0]}</td></tr>;
    if(r===2)return <tr key={r} className={'qwXlsHead'+tail}>{row.map((value,c)=><td key={c}>{value}</td>)}</tr>;
    if(yellowRows?.includes(r))return <tr key={r} className={'qwXlsYellow'+tail}><td colSpan={8}>{row[0]}</td></tr>;
    if(row[0]==='项目'&&row[6]==='金额')return <tr key={r} className={'qwXlsHead'+tail}><td colSpan={6}>项目</td><td>金额</td><td>备注</td></tr>;
    if(sectionRows.includes(r)&&row[6]!==undefined&&row[6]!==null)return <tr key={r} className={'qwXlsSection'+tail}><td colSpan={6}>{row[0]}</td><td className="qwXlsMoney">{fmt(row[6])}</td><td></td></tr>;
    if(sectionRows.includes(r))return <tr key={r} className={'qwXlsSection'+tail}><td colSpan={8}>{row[0]}</td></tr>;
    if(subtotalRows.includes(r))return <tr key={r} className={'qwXlsSubtotal'+tail}><td colSpan={6}>{row[0]}</td><td className="qwXlsMoney">{fmt(row[6])}</td><td></td></tr>;
    if(typeof row[0]==='number'){const photos=photosByRow.get(r);
      return <tr key={r} className={'qwXlsItem'+tail}><td>{row[0]}</td><td className="qwXlsLeft">{row[1]}</td><td className="qwXlsLeft">{row[2]}</td><td>{row[3]}</td><td>{fmt(row[4])}</td><td className="qwXlsMoney">{fmt(row[5])}</td><td className="qwXlsMoney">{fmt(row[6])}</td><td className="qwXlsPhotos">{photos?photos.map((photo,index)=><img key={index} src={photo.src} alt={photo.name}/>):''}</td></tr>;}
    const label=String(row[0]||'');
    if(label.startsWith('备注：')||label.startsWith('报价备注：'))return <tr key={r} className={'qwXlsNote'+tail}><td colSpan={8}>{label}</td></tr>;
    if(label.startsWith('乙方：')||label==='时间：')return <tr key={r} className={'qwXlsSign'+tail}><td colSpan={3} className="qwXlsLeft">{label}</td><td colSpan={5} className="qwXlsLeft">{label.startsWith('乙方：')?'甲方：':'时间：'}</td></tr>;
    return <tr key={r} className={tail.trim()||undefined}><td colSpan={8}>{label}</td></tr>;
  });
  return createPortal(<main className="qwCustomerPrint"><table><colgroup><col className="c0"/><col className="c1"/><col className="c2"/><col className="c3"/><col className="c4"/><col className="c5"/><col className="c6"/><col className="c7"/></colgroup><tbody>{body}</tbody></table></main>,document.body);
}
