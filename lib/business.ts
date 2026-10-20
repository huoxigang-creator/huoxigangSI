import { z } from 'zod';
import {paymentAmountCents} from './payment-details';
import {QUOTE_CATEGORIES,getAdoptedQuotes,quoteGroupKey,transactionGroupKey} from './quotes';
export {quoteGroupKey,getAdoptedQuotes,transactionGroupKey} from './quotes';
export {paymentAmountCents} from './payment-details';
export const lineSchema=z.object({room_id:z.string().uuid().transform(value=>value.toLowerCase()).optional(),cabinet_id:z.string().uuid().transform(value=>value.toLowerCase()).optional(),name:z.string().max(100),category:z.enum(QUOTE_CATEGORIES).default('材料费用'),model:z.string().max(100).default(''),unit:z.string().max(10),quantity:z.number().finite().positive().max(100000),price:z.number().finite().nonnegative().max(10000000),sale_price:z.number().finite().nonnegative().max(10000000).optional(),internal_price:z.number().finite().nonnegative().max(10000000).optional(),contract_price:z.number().finite().nonnegative().max(10000000).optional(),note:z.string().max(500).default(''),photos:z.array(z.object({key:z.string().min(1).max(300),name:z.string().min(1).max(240),mime:z.string().min(1).max(100),size:z.number().int().nonnegative().max(10_485_760)})).max(10).default([])});
export function quoteTotal(items:z.infer<typeof lineSchema>[]){return items.reduce((s,i)=>s+Math.round(i.quantity*Math.round(i.price*100)),0);}
export const projectSchema=z.object({project_type:z.enum(['project','customer']).optional(),price_type:z.enum(['sale','internal','contract']).optional(),parent_id:z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).optional(),order_date:z.string().refine(value=>value===''||validTaskDate(value),'接单日期不合法').optional(),name:z.string().trim().min(1).max(100),customer:z.string().trim().min(1).max(50),phone:z.string().max(30).default(''),address:z.string().max(200).default(''),status:z.enum(['意向','洽谈中','设计中','生产中','安装中','收尾中','已完工','已归档']).default('洽谈中'),budget:z.number().nonnegative().max(100000000).default(0),note:z.string().max(2000).default('')});
export const quoteRoomSchema=z.object({id:z.string().uuid().transform(value=>value.toLowerCase()),name:z.string().trim().min(1,'房间名称不能为空').max(100)});
export const quoteCabinetSchema=z.object({id:z.string().uuid().transform(value=>value.toLowerCase()),room_id:z.string().uuid().transform(value=>value.toLowerCase()),name:z.string().trim().min(1,'柜体名称不能为空').max(100)});
export const quoteSchema=z.object({project_id:z.string().min(1),subproject_id:z.union([z.string().uuid(),z.literal('')]).transform(value=>value.toLowerCase()).optional(),subproject_name:z.string().trim().max(100).optional(),title:z.string().trim().min(1).max(100),rooms:z.array(quoteRoomSchema).max(100).optional(),cabinets:z.array(quoteCabinetSchema).max(500).optional(),items:z.array(lineSchema).max(500).refine(items=>Number.isSafeInteger(quoteTotal(items)),'报价总额超出可准确计算的范围'),note:z.string().max(2000).default('')}).superRefine((value,ctx)=>{
 const rooms=value.rooms||[],ids=new Set(rooms.map(room=>room.id));
 if(ids.size!==rooms.length)ctx.addIssue({code:'custom',path:['rooms'],message:'房间编号不能重复'});
 if(!value.items.length&&!rooms.length)ctx.addIssue({code:'custom',path:['items'],message:'报价至少需要一条明细或一个房间'});
 value.items.forEach((item,index)=>{if((value.rooms!==undefined||item.room_id!==undefined)&&(!item.room_id||!ids.has(item.room_id)))ctx.addIssue({code:'custom',path:['items',index,'room_id'],message:'报价明细必须关联有效房间'});});
 const cabinets=value.cabinets||[],cabinetMap=new Map(cabinets.map(cabinet=>[cabinet.id,cabinet]));
 if(cabinetMap.size!==cabinets.length)ctx.addIssue({code:'custom',path:['cabinets'],message:'柜体编号不能重复'});
 cabinets.forEach((cabinet,index)=>{if(!ids.has(cabinet.room_id))ctx.addIssue({code:'custom',path:['cabinets',index,'room_id'],message:'柜体必须关联有效房间'});});
 value.items.forEach((item,index)=>{if(item.cabinet_id!==undefined){const cabinet=cabinetMap.get(item.cabinet_id);if(!cabinet)ctx.addIssue({code:'custom',path:['items',index,'cabinet_id'],message:'报价明细必须关联有效柜体'});else if(cabinet.room_id!==item.room_id)ctx.addIssue({code:'custom',path:['items',index,'cabinet_id'],message:'报价明细的柜体与房间必须一致'});}});
});
const settlementAmountSchema=z.number().finite().nonnegative().max(100000000).refine(value=>Number.isFinite(value)&&value>=0&&value<=100000000&&Number.isSafeInteger(paymentAmountCents(value)),'折让金额超出可准确计算的范围');
export const customerSettlementSchema=z.object({project_id:z.string().min(1),discount_amount:settlementAmountSchema,rounding_amount:settlementAmountSchema,note:z.string().max(2000).default('')});
export const paymentItemSchema=z.object({name:z.string().trim().min(1,'付款明细名称不能为空').max(100,'付款明细名称不能超过100个字符'),amount:z.number().positive('付款明细金额必须大于零').max(100000000,'付款明细金额不能超过100,000,000元').refine(value=>Number.isFinite(value)&&value>=0&&value<=100000000&&paymentAmountCents(value)>=1,'付款明细金额四舍五入后不能小于0.01元')});
export function normalizePaymentItems(items:z.infer<typeof paymentItemSchema>[]){return items.map(item=>({name:item.name.trim(),amount:paymentAmountCents(item.amount)}));}
const assignmentGroupSchema=z.union([z.string().uuid(),z.literal('legacy'),z.literal('')]);
export const transactionAssignmentSchema=z.object({
 id:z.string().min(1).max(1024).refine(value=>!/[\x00-\x1f\x7f]/.test(value),'流水编号不合法'),
 project_id:z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
 subproject_id:assignmentGroupSchema.transform(value=>value.toLowerCase()),
 expected_project_id:z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
 expected_subproject_id:assignmentGroupSchema,
 expected_updated:z.string().min(1).max(64),
}).strict();
export const transactionSchema=z.object({project_id:z.string().min(1),subproject_id:z.union([z.string().uuid(),z.literal('legacy'),z.literal('')]).transform(value=>value.toLowerCase()).optional(),type:z.enum(['收款','付款']),amount:z.number().positive().max(100000000),category:z.string().min(1).max(30),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(s+'T00:00:00Z');return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===s},'日期不合法'),note:z.string().max(1000).default(''),request_id:z.string().min(8).max(100),payment_items:z.array(paymentItemSchema).max(100,'付款明细最多100项').optional()}).superRefine((value,ctx)=>{
 if(!value.payment_items?.length||!Number.isFinite(value.amount)||value.amount<0||value.amount>100000000)return;
 if(value.payment_items.some(item=>!Number.isFinite(item.amount)||item.amount<0||item.amount>100000000))return;
 if(value.type!=='付款'){ctx.addIssue({code:'custom',path:['payment_items'],message:'收款不能包含付款明细'});return;}
 if(normalizePaymentItems(value.payment_items).reduce((sum,item)=>sum+item.amount,0)!==paymentAmountCents(value.amount))ctx.addIssue({code:'custom',path:['payment_items'],message:'付款明细合计必须与付款总额一致'});
});
export function validTaskDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const parsed=new Date(value+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;}
export function normalizeTaskReminder(value:string):string|null {
 if(value==='')return '';
 const parts=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!parts||!validTaskDate(parts[1])||Number(parts[2])>23||Number(parts[3])>59||Number(parts[4])>59)return null;
 const offset=parts[5];if(offset!=='Z'&&(Number(offset.slice(1,3))>23||Number(offset.slice(4,6))>59))return null;
 const parsed=new Date(value);if(!Number.isFinite(parsed.getTime()))return null;
 const normalized=parsed.toISOString(),beijingDate=new Date(parsed.getTime()+8*60*60*1000).toISOString();return /^\d{4}-/.test(normalized)&&/^\d{4}-/.test(beijingDate)?normalized:null;
}
export const taskSchema=z.object({project_id:z.string().min(1),title:z.string().trim().min(1).max(200),assignee:z.string().max(50).default(''),date:z.string().max(10).refine(value=>value===''||validTaskDate(value),'待办日期不合法').default(''),due_at:z.string().max(35).refine(value=>normalizeTaskReminder(value)!==null,'待办时间必须是有效且包含时区的 ISO 时间').transform(value=>normalizeTaskReminder(value)!).optional(),done:z.boolean().default(false)});
export function summarize(projects:any[],quotes:any[],transactions:any[]){return projects.filter(p=>!p.deleted).map(p=>{
 const ownQuotes=quotes.filter(q=>q.project===p.id&&!q.deleted),adopted=getAdoptedQuotes(ownQuotes);
 const tx=transactions.filter(t=>t.project===p.id&&!t.void&&!t.deleted);
 const received=tx.filter(t=>t.type==='收款').reduce((s,t)=>s+t.amount,0),paid=tx.filter(t=>t.type==='付款').reduce((s,t)=>s+t.amount,0);
 const contract=adopted.reduce((sum,q)=>sum+(q.total||0),0),discount=p.project_type==='customer'?(p.discount_amount||0):0,rounding=p.project_type==='customer'?(p.rounding_amount||0):0,receivable=contract-discount-rounding;
 const grouped=p.project_type!=='customer'&&(ownQuotes.some(q=>!!q.subproject_id)||projects.some(child=>!child.deleted&&child.parent_id===p.id)),knownGroups=new Set(ownQuotes.map(quoteGroupKey));
 const unallocated=tx.filter(t=>{const group=transactionGroupKey(t,quotes);return grouped?!group||!knownGroups.has(group):!!group&&group!=='legacy';});
 return {...p,contract,discount,rounding,receivable,received,paid,remaining:receivable-received,cash:received-paid,estimatedProfit:receivable-p.budget,actualGrossProfit:receivable-paid,
  unallocated_received:unallocated.filter(t=>t.type==='收款').reduce((sum,t)=>sum+t.amount,0),unallocated_paid:unallocated.filter(t=>t.type==='付款').reduce((sum,t)=>sum+t.amount,0)};
});}
