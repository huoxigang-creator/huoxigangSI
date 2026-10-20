import {normalizeQuoteItem} from './quotes';
import type {QuoteCabinet, QuoteItem, QuoteRoom} from './quotes';

export type QuoteBudgetSource={title?:string;rooms?:QuoteRoom[];cabinets?:QuoteCabinet[];items:any[];note?:string};
export type CopiedQuoteBudget={rooms:QuoteRoom[];cabinets:QuoteCabinet[];items:(QuoteItem&{room_id:string})[];note:string};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Copy only quotation content; the destination owns every new room and version. */
export function copyQuoteBudget(source:QuoteBudgetSource,options?:{createId?:()=>string}):CopiedQuoteBudget{
 if(!source||!Array.isArray(source.items))throw new Error('源报价明细无效，无法复制。');
 const sourceRooms=source.rooms??[];
 if(!Array.isArray(sourceRooms))throw new Error('源报价房间信息无效，无法复制。');
 const sourceIds=new Set<string>();
 for(const room of sourceRooms){
  if(!room||typeof room.id!=='string'||typeof room.name!=='string')throw new Error('源报价房间信息无效，无法复制。');
  const id=room.id.toLowerCase();
  if(sourceIds.has(id))throw new Error('源报价存在重复房间编号，请先核对房间后复制。');
  sourceIds.add(id);
 }
 const sourceCabinets=source.cabinets??[],cabinetSources=new Map<string,QuoteCabinet>();
 if(!Array.isArray(sourceCabinets))throw new Error('源报价柜体信息无效，无法复制。');
 for(const cabinet of sourceCabinets){
  if(!cabinet||typeof cabinet.id!=='string'||!UUID.test(cabinet.id)||typeof cabinet.room_id!=='string'||!UUID.test(cabinet.room_id)||typeof cabinet.name!=='string'||!cabinet.name.trim())throw new Error('源报价柜体信息无效，无法复制。');
  const id=cabinet.id.toLowerCase(),room_id=cabinet.room_id.toLowerCase();
  if(cabinetSources.has(id))throw new Error('源报价存在重复柜体编号，请先核对柜体后复制。');
  if(!sourceIds.has(room_id))throw new Error('源报价柜体未关联有效房间，无法复制。');
  cabinetSources.set(id,cabinet);
 }
 for(const raw of source.items){
  if(raw?.cabinet_id===undefined)continue;
  const cabinet=typeof raw.cabinet_id==='string'?cabinetSources.get(raw.cabinet_id.toLowerCase()):undefined;
  if(!cabinet)throw new Error('源报价明细未关联有效柜体，无法复制。');
  if(typeof raw.room_id!=='string'||raw.room_id.toLowerCase()!==cabinet.room_id.toLowerCase())throw new Error('源报价明细与柜体所属房间不一致，无法复制。');
 }
 sourceCabinets.forEach(cabinet=>sourceIds.add(cabinet.id.toLowerCase()));
 const createId=options?.createId??(()=>crypto.randomUUID()),newIds=new Set<string>(),roomMap=new Map<string,string>(),cabinetMap=new Map<string,string>(),rooms:QuoteRoom[]=[],cabinets:QuoteCabinet[]=[];
 const nextId=()=>{
  const value=createId();
  if(typeof value!=='string'||!UUID.test(value))throw new Error('新房间编号无效，请重新复制。');
  const id=value.toLowerCase();
  if(sourceIds.has(id)||newIds.has(id))throw new Error('新房间编号重复，请重新复制。');
  newIds.add(id);return id;
 };
 const addRoom=(name:string)=>{const id=nextId();rooms.push({id,name});return id;};
 for(const room of sourceRooms){const id=addRoom(room.name);if(UUID.test(room.id))roomMap.set(room.id.toLowerCase(),id);}
 for(const cabinet of sourceCabinets){const id=nextId(),room_id=roomMap.get(cabinet.room_id.toLowerCase())!;cabinetMap.set(cabinet.id.toLowerCase(),id);cabinets.push({id,room_id,name:cabinet.name});}
 let overallRoom=rooms.length?undefined:addRoom('整体空间');
 const items=source.items.map(raw=>{
  const item=normalizeQuoteItem(raw),mapped=item.room_id&&roomMap.get(item.room_id.toLowerCase());
  const room_id=mapped||(overallRoom??=addRoom('整体空间'));
  return {...item,room_id,...(raw?.cabinet_id!==undefined?{cabinet_id:cabinetMap.get(raw.cabinet_id.toLowerCase())!}:{})};
 });
 return {rooms,cabinets,items,note:typeof source.note==='string'?source.note:''};
}
