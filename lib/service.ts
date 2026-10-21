import {env} from './local-env';
import {projectSchema,quoteSchema,customerSettlementSchema,transactionSchema,transactionAssignmentSchema,taskSchema,quoteTotal,summarize,paymentAmountCents,normalizePaymentItems,quoteGroupKey,getAdoptedQuotes} from './business';
export class BusinessError extends Error {constructor(message:string,public status=400){super(message)}}
function db(){if(!env.DB)throw new BusinessError('数据库尚未就绪',503);return env.DB;}
type StoredRow={id:string;owner:string;kind:string;project:string;data:string;created:string};
const SNAPSHOTS=Symbol('raw record snapshots');
const ACTIVE_PARENT="EXISTS (SELECT 1 FROM records AS parent WHERE parent.id = ? AND parent.owner = ? AND parent.kind = 'project' AND COALESCE(json_extract(parent.data, '$.deleted'), 0) = 0)";
const PARENT_TYPE="EXISTS (SELECT 1 FROM records AS typed_parent WHERE typed_parent.id = ? AND typed_parent.owner = ? AND typed_parent.kind = 'project' AND COALESCE(json_extract(typed_parent.data, '$.project_type'), 'project') = ?)";
const EMPTY_PROJECT_STRUCTURE="NOT EXISTS (SELECT 1 FROM records AS related WHERE related.owner = ? AND ((related.kind = 'project' AND json_extract(related.data, '$.parent_id') = ?) OR (related.kind = 'quote' AND related.project = ?)))";
const QUOTE_GROUP="COALESCE(NULLIF(json_extract(data, '$.subproject_id'), ''), 'legacy')";
const UNUSED_QUOTE_GROUP="NOT EXISTS (SELECT 1 FROM records AS grouped WHERE grouped.kind = 'quote' AND json_extract(grouped.data, '$.subproject_id') = ? AND (grouped.owner <> ? OR grouped.project <> ?))";
const ACTIVE_TRANSACTION_GROUP="EXISTS (SELECT 1 FROM records AS transaction_group WHERE transaction_group.owner = ? AND transaction_group.project = ? AND transaction_group.kind = 'quote' AND COALESCE(json_extract(transaction_group.data, '$.deleted'), 0) = 0 AND COALESCE(NULLIF(json_extract(transaction_group.data, '$.subproject_id'), ''), 'legacy') = ?)";
const SAFE_QUOTE_CONTRACT="(? + COALESCE((SELECT SUM(json_extract(other.data, '$.total')) FROM records AS other WHERE other.owner = ? AND other.project = ? AND other.kind = 'quote' AND COALESCE(json_extract(other.data, '$.deleted'), 0) = 0 AND json_extract(other.data, '$.adopted') = 1 AND COALESCE(NULLIF(json_extract(other.data, '$.subproject_id'), ''), 'legacy') <> ?), 0)) BETWEEN 0 AND 9007199254740991";
const SAFE_QUOTE_SETTLEMENT="EXISTS (SELECT 1 FROM records AS customer WHERE customer.id = ? AND customer.owner = ? AND customer.kind = 'project' AND (COALESCE(json_extract(customer.data, '$.project_type'), 'project') <> 'customer' OR (COALESCE(json_extract(customer.data, '$.discount_amount'), 0) + COALESCE(json_extract(customer.data, '$.rounding_amount'), 0)) <= (? + COALESCE((SELECT SUM(json_extract(other.data, '$.total')) FROM records AS other WHERE other.owner = ? AND other.project = ? AND other.kind = 'quote' AND COALESCE(json_extract(other.data, '$.deleted'), 0) = 0 AND json_extract(other.data, '$.adopted') = 1 AND COALESCE(NULLIF(json_extract(other.data, '$.subproject_id'), ''), 'legacy') <> ?), 0))))";
const SAFE_SETTLEMENT_CONTRACT="? <= COALESCE((SELECT SUM(json_extract(adopted.data, '$.total')) FROM records AS adopted WHERE adopted.owner = ? AND adopted.project = ? AND adopted.kind = 'quote' AND COALESCE(json_extract(adopted.data, '$.deleted'), 0) = 0 AND json_extract(adopted.data, '$.adopted') = 1), 0)";
function unpack(row:StoredRow){const data=JSON.parse(row.data);return {...data,...(row.kind==='project'?{project_type:data.project_type||'project'}:{}),id:row.id,project:row.project,created:row.created,kind:row.kind};}
function validateCustomerQuote(data:any){if(!data.rooms?.length)throw new BusinessError('终端客户报价至少需要一个房间');if(data.subproject_id)throw new BusinessError('终端客户按整份报价管理版本，不能建立独立小项目');}
function affected(result:any){const value=result?.meta?.changes??result?.changes;if(value===undefined)throw new BusinessError('无法确认保存结果，请刷新后核对',503);return Number(value);}
async function rawTransaction(owner:string,id:string){const result=await db().prepare('SELECT * FROM records WHERE owner = ? AND id = ? AND kind = ?').bind(owner,id,'transaction').all<StoredRow>();return result.results[0]?unpack(result.results[0]):undefined;}
function matchingTransaction(old:any,data:any,project:string){
 if(old.deleted)throw new BusinessError('流水已移入回收站，请恢复后查看',409);
 const items=Array.isArray(old.payment_items)?old.payment_items.map((item:any)=>({name:typeof item?.name==='string'?item.name.trim():item?.name,amount:item?.amount})):[];
 if(old.project!==project||(old.subproject_id||'')!==(data.subproject_id||'')||old.type!==data.type||old.amount!==data.amount||old.category!==data.category||old.date!==data.date||old.note!==data.note||JSON.stringify(items)!==JSON.stringify(data.payment_items||[]))throw new BusinessError('重复请求编号对应不同内容',409);
 return old;
}
export async function state(owner:string){
 const res=await db().prepare('SELECT * FROM records WHERE owner = ? ORDER BY created DESC').bind(owner).all<StoredRow>();
 const all=res.results.map(unpack),projects=all.filter(r=>r.kind==='project'&&!r.deleted),activeProjects=new Set(projects.map(p=>p.id));
 const visible=(r:any)=>!r.deleted&&activeProjects.has(r.project);
 const quotes=all.filter(r=>r.kind==='quote'&&visible(r)),transactions=all.filter(r=>r.kind==='transaction'&&visible(r)),tasks=all.filter(r=>r.kind==='task'&&!r.deleted&&(!r.project||activeProjects.has(r.project))),logs=all.filter(r=>r.kind==='audit');
 const result={reminder_scope:owner,projects:summarize(projects,quotes,transactions),quotes,transactions,tasks,hardware:all.filter(r=>r.kind==='hardware'&&visible(r)),logs:logs.slice(0,150)};
 // Symbols are not enumerated or JSON-serialized into API and MCP responses.
 return Object.defineProperty(result,SNAPSHOTS,{value:new Map(res.results.map(row=>[row.id,row]))}) as typeof result&{[SNAPSHOTS]:Map<string,StoredRow>};
}
const NO_CONTRACT_RECEIPT_ALLOCATION="NOT EXISTS (SELECT 1 FROM records AS assigned_contract, json_each(assigned_contract.data, '$.receipt_allocations') AS assigned_part WHERE assigned_contract.owner = ? AND assigned_contract.kind = 'contract' AND json_extract(assigned_part.value, '$.transaction_id') = ?)";
// WeChat merchant receipts mirror money that really arrived; they are never voided or deleted.
function merchantReceipt(transaction:any){return Boolean(transaction.payment_provider||transaction.wechat_transaction_id||transaction.payment_order_id);}
function assignmentLocked(transaction:any){return Boolean(transaction.source_quote_id||transaction.payment_provider||transaction.wechat_transaction_id||transaction.payment_order_id);}
async function assignTransactionSubproject(owner:string,s:Awaited<ReturnType<typeof state>>,args:any){
 const input=transactionAssignmentSchema.parse(args),snapshot=s[SNAPSHOTS].get(input.id);
 const old=s.transactions.find(row=>row.id===input.id);
 if(!old||!snapshot||snapshot.kind!=='transaction')throw new BusinessError('流水不存在、已删除或无权访问',404);
 if(old.void)throw new BusinessError('已作废流水不能修改所属小项目',409);
 if(assignmentLocked(old))throw new BusinessError('此流水已关联报价或商户收款，所属小项目已锁定，不能手动调整',409);
 const ownProject=s.projects.find(row=>row.id===old.project);
 const root=ownProject?.parent_id?s.projects.find(row=>row.id===ownProject.parent_id):ownProject;
 const target=s.projects.find(row=>row.id===input.project_id);
 if(!ownProject||!root||!target)throw new BusinessError('所属项目或目标项目不存在、已删除或无权访问',404);
 if(root.project_type==='customer'||target.project_type==='customer')throw new BusinessError('终端客户收付款按整户归属，不能分配到独立小项目');
 if(target.id!==root.id&&target.parent_id!==root.id)throw new BusinessError('只能选择当前合作项目下面的小项目，不能跨客户移动流水');
 const targetQuotes=s.quotes.filter(quote=>quote.project===target.id&&!quote.deleted);
 if(input.subproject_id){
  if(!targetQuotes.some(quote=>quoteGroupKey(quote)===input.subproject_id))throw new BusinessError('报价小项目不存在或不属于所选项目');
 }else if(target.id===root.id||targetQuotes.some(quote=>Boolean(quote.subproject_id))){
  throw new BusinessError('请选择本合作项目下的独立小项目或报价小项目');
 }
 // A successful response can be lost; repeating that same assignment is a no-op.
 if(old.project===target.id&&(old.subproject_id||'')===input.subproject_id)return old;
 if(old.project!==input.expected_project_id||(old.subproject_id||'')!==input.expected_subproject_id||(old.updated||old.created)!==input.expected_updated)throw new BusinessError('流水归属或内容已发生变化，请刷新后重新选择',409);
 // Deleted contracts also keep their links, so restoring one cannot create a dangling allocation.
 for(const record of s[SNAPSHOTS].values())if(record.kind==='contract'){
  const contract=JSON.parse(record.data),allocations=contract.receipt_allocations;
  if(Array.isArray(allocations)&&allocations.some(part=>part?.transaction_id===old.id))throw new BusinessError(contract.deleted?'此流水关联的合同已在回收站，请先恢复合同并解除收款关联，再调整所属小项目':'此流水已关联合同分期，请先在合同中解除收款关联，再调整所属小项目',409);
 }
 const now=new Date().toISOString(),data:any={...JSON.parse(snapshot.data),project_id:target.id,updated:now};
 if(Object.prototype.hasOwnProperty.call(data,'project'))data.project=target.id;
 if(input.subproject_id)data.subproject_id=input.subproject_id;else delete data.subproject_id;
 // Invoices stay at their original immutable R2 location when a manual payment moves.
 if(old.type==='付款'&&old.project!==target.id)data.voucher_project_id=data.voucher_project_id||old.project;
 const rootSnapshot=s[SNAPSHOTS].get(root.id)!,targetSnapshot=s[SNAPSHOTS].get(target.id)!,ownSnapshot=s[SNAPSHOTS].get(ownProject.id)!;
 const projectGuard="EXISTS (SELECT 1 FROM records AS assignment_project WHERE assignment_project.id = ? AND assignment_project.owner = ? AND assignment_project.kind = 'project' AND assignment_project.data = ? AND COALESCE(json_extract(assignment_project.data, '$.deleted'), 0) = 0)";
 let guards=[projectGuard,projectGuard,projectGuard,NO_CONTRACT_RECEIPT_ALLOCATION].join(' AND ');
 const guardBindings:any[]=[root.id,owner,rootSnapshot.data,target.id,owner,targetSnapshot.data,ownProject.id,owner,ownSnapshot.data,owner,old.id];
 if(input.subproject_id){guards+=' AND '+ACTIVE_TRANSACTION_GROUP;guardBindings.push(owner,target.id,input.subproject_id);}
 else {guards+=" AND NOT EXISTS (SELECT 1 FROM records AS fresh_group WHERE fresh_group.owner = ? AND fresh_group.project = ? AND fresh_group.kind = 'quote' AND COALESCE(json_extract(fresh_group.data, '$.deleted'), 0) = 0 AND COALESCE(json_extract(fresh_group.data, '$.subproject_id'), '') <> '')";guardBindings.push(owner,target.id);}
 const mutation=db().prepare("UPDATE records SET project = ?, data = ? WHERE id = ? AND owner = ? AND kind = 'transaction' AND project = ? AND data = ? AND COALESCE(json_extract(data, '$.deleted'), 0) = 0 AND COALESCE(json_extract(data, '$.void'), 0) = 0 AND "+guards).bind(target.id,JSON.stringify(data),old.id,owner,old.project,snapshot.data,...guardBindings);
 const targetName=input.subproject_id?targetQuotes.find(quote=>quoteGroupKey(quote)===input.subproject_id)?.subproject_name||targetQuotes.find(quote=>quoteGroupKey(quote)===input.subproject_id)?.title||target.name:target.name;
 const audit={action:'assign_transaction_subproject',detail:'调整流水所属小项目：'+targetName,record_id:old.id,actor:owner,from_project_id:old.project,from_subproject_id:old.subproject_id||'',to_project_id:target.id,to_subproject_id:input.subproject_id};
 const results=await db().batch([mutation,db().prepare('INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,? WHERE changes() > 0').bind(crypto.randomUUID(),owner,'audit',target.id,JSON.stringify(audit),now)]);
 if(affected(results[0])<1){
  const currentState=await state(owner),current=currentState.transactions.find(row=>row.id===old.id);
  const targetStillExists=currentState.projects.some(row=>row.id===target.id)&&currentState.projects.some(row=>row.id===root.id);
  const groupStillExists=!input.subproject_id||currentState.quotes.some(quote=>quote.project===target.id&&quoteGroupKey(quote)===input.subproject_id);
  if(current&&targetStillExists&&groupStillExists&&!current.void&&!assignmentLocked(current)&&current.project===target.id&&(current.subproject_id||'')===input.subproject_id)return current;
  throw new BusinessError('流水、合同关联或项目已发生变化，请刷新后重试',409);
 }
 return {...data,id:old.id,project:target.id,kind:'transaction',created:snapshot.created};
}
export async function execute(owner:string,action:string,args:any,employee=false){
 if(!owner)throw new BusinessError('请先登录',401);
 const s=await state(owner);const all=[...s.projects,...s.quotes,...s.transactions,...s.tasks,...s.hardware];const get=(id:string,kind:string)=>{const r=all.find(r=>r.id===id&&r.kind===kind);if(!r)throw new BusinessError('记录不存在或无权访问',404);return r};
 if(action==='get_workspace')return s;
 if(action==='assign_transaction_subproject')return assignTransactionSubproject(owner,s,args);
 if(action==='list_projects'){if(args.project_type!==undefined&&!['project','customer'].includes(args.project_type))throw new BusinessError('项目类型无效');return s.projects.filter(p=>(!args.project_type||p.project_type===args.project_type)&&(!args.search||[p.name,p.customer,p.address].join(' ').includes(args.search)));}
 if(action==='get_project'){const p=get(args.id,'project');return {project:p,quotes:s.quotes.filter(r=>r.project===p.id),transactions:s.transactions.filter(r=>r.project===p.id),hardware:s.hardware.filter(r=>r.project===p.id),tasks:s.tasks.filter(r=>r.project===p.id)}}
 if(action==='get_report')return {unit:'分',projects:s.projects,totals:s.projects.reduce((a:any,p:any)=>{for(const k of ['contract','discount','rounding','receivable','received','paid','remaining','cash','estimatedProfit','actualGrossProfit'])a[k]=(a[k]||0)+p[k];return a},{})};
 let id=args.id||crypto.randomUUID(),kind='',project='',data:any,detail='',changingProjectType=false,quoteDeletionBackup:any=null;
 if(action==='create_project'||action==='update_project'){
  data=projectSchema.parse(args);data.budget=employee?0:paymentAmountCents(data.budget);kind='project';project=id;
  if(action==='update_project'){
   const old=get(id,kind);if(employee)data.budget=old.budget;if(data.parent_id!==undefined&&data.parent_id!==old.parent_id)throw new BusinessError('项目不能移动到其他合作项目');if(old.parent_id)data.parent_id=old.parent_id;
   if(data.project_type===undefined)data.project_type=old.project_type||'project';
   if(data.order_date===undefined&&old.order_date!==undefined)data.order_date=old.order_date;
   for(const field of ['discount_amount','rounding_amount','settlement_note','customer_no'])if(old[field]!==undefined)data[field]=old[field];
   changingProjectType=data.project_type!==(old.project_type||'project');
   if(changingProjectType){const related=await db().prepare("SELECT id FROM records WHERE owner = ? AND ((kind = 'project' AND json_extract(data, '$.parent_id') = ?) OR (kind = 'quote' AND project = ?)) LIMIT 1").bind(owner,id,id).all<StoredRow>();if(related.results.length)throw new BusinessError('已有独立项目或报价记录，不能切换项目类型');}
  }else if(data.project_type===undefined)data.project_type='project';
  if(data.project_type==='customer'&&data.parent_id)throw new BusinessError('终端客户不能归属于合作项目');
  if(data.parent_id){const parent=get(data.parent_id,'project');if(parent.project_type==='customer')throw new BusinessError('终端客户不能添加独立项目，请在报价中添加房间');if(parent.parent_id||parent.id===id)throw new BusinessError('只能在合作项目下面添加独立项目');}
  // 新建客户时自动生成唯一客户编号：SID+日期+N+5位序号
  if(action==='create_project'&&data.project_type==='customer'){
   const now=new Date(Date.now()+8*60*60*1000);
   const ymd=now.toISOString().slice(0,10).replace(/-/g,'');
   const prefix='SID'+ymd+'N';
   const res=await db().prepare("SELECT json_extract(data,'$.customer_no') AS no FROM records WHERE owner=? AND kind='project' AND json_extract(data,'$.project_type')='customer' AND json_extract(data,'$.customer_no') LIKE ?").bind(owner,prefix+'%').all<{no:string|null}>();
   let maxSeq=0;
   for(const row of res.results){if(row.no){const m=row.no.match(/(\d+)$/);if(m){const n=parseInt(m[1],10);if(n>maxSeq)maxSeq=n;}}}
   data.customer_no=prefix+String(maxSeq+1).padStart(5,'0');
  }
  detail=action==='create_project'?(data.project_type==='customer'?'新建客户':'新建项目'):'修改项目';
 }
 else if(action==='create_quote'||action==='update_quote'){
  const old=action==='update_quote'?get(id,'quote'):undefined;
  data=quoteSchema.parse({...args,...(args.rooms===undefined&&old?.rooms!==undefined?{rooms:old.rooms}:{}),...(args.cabinets===undefined&&old?.cabinets!==undefined?{cabinets:old.cabinets}:{})});const parent=get(data.project_id,'project');kind='quote';project=data.project_id;
  if(action==='update_quote'){
   if(old!.adopted)throw new BusinessError('已采纳报价不能直接修改，请新建报价版本');
   if(old!.project!==project)throw new BusinessError('报价不能移动到其他项目');
   if(data.subproject_id===undefined){if(old!.subproject_id!==undefined)data.subproject_id=old!.subproject_id;}
   else if(quoteGroupKey(data)!==quoteGroupKey(old!))throw new BusinessError('报价不能移动到其他小项目');
   if(data.subproject_name===undefined&&old!.subproject_name!==undefined)data.subproject_name=old!.subproject_name;
  }
  if(parent.project_type==='customer')validateCustomerQuote(data);
  if(data.subproject_id){
   const conflict=await db().prepare("SELECT id FROM records WHERE kind = 'quote' AND json_extract(data, '$.subproject_id') = ? AND (owner <> ? OR project <> ?) LIMIT 1").bind(data.subproject_id,owner,project).all<StoredRow>();
   if(conflict.results.length)throw new BusinessError('小项目编号已被使用，请新建小项目',409);
  }
  data.total=quoteTotal(data.items);data.adopted=false;detail='保存报价';
 }
 else if(action==='delete_quote_items'){
  const old=get(id,'quote');
  if(old.adopted)throw new BusinessError('已采纳报价不能删除明细，请复制为新版后编辑');
  if(typeof args.expected_updated!=='string'||args.expected_updated!==(old.updated||old.created)||!Array.isArray(args.expected_items)||JSON.stringify(args.expected_items)!==JSON.stringify(old.items))throw new BusinessError('报价已发生变化，请刷新后重新勾选明细',409);
  const indexes=args.item_indexes;
  if(!Array.isArray(indexes)||!indexes.length||indexes.length>500||indexes.some(index=>!Number.isInteger(index)||index<0||index>=old.items.length)||new Set(indexes).size!==indexes.length)throw new BusinessError('请勾选有效且不重复的报价明细');
  const removed=new Set(indexes),raw=JSON.parse(s[SNAPSHOTS].get(id)!.data);
  kind='quote';project=old.project;data={...raw,items:raw.items.filter((_item:any,index:number)=>!removed.has(index))};data.total=quoteTotal(data.items);
  const suffix='（删除明细前副本）',backupTitle=String(raw.title||'报价').slice(0,100-suffix.length).replace(/[\uD800-\uDBFF]$/,'')+suffix;
  quoteDeletionBackup={...raw,adopted:false,title:backupTitle,source_quote_id:id,deleted:true};
  detail='删除 '+indexes.length+' 条报价明细；删除前副本保留在回收站';
 }
 else if(action==='unadopt_quote'){const q=get(id,'quote');if(!q.adopted)return q;kind='quote';project=q.project;data={...q,adopted:false};detail='取消采纳报价';}
 else if(action==='adopt_quote'){const q=get(id,'quote');kind='quote';project=q.project;if(get(project,'project').project_type==='customer')validateCustomerQuote(quoteSchema.parse({...q,project_id:project}));data={...q,adopted:true};detail='采纳报价';}
 else if(action==='set_customer_settlement'){
  const input=customerSettlementSchema.parse(args),old=get(input.project_id,'project');
  if(old.project_type!=='customer')throw new BusinessError('优惠和抹零仅适用于终端客户');
  const discount=paymentAmountCents(input.discount_amount),rounding=paymentAmountCents(input.rounding_amount),total=discount+rounding;
  if(!Number.isSafeInteger(total)||!Number.isSafeInteger(old.contract)||total>old.contract)throw new BusinessError('优惠和抹零合计不能超过当前采纳报价总额');
  if((old.discount_amount||0)===discount&&(old.rounding_amount||0)===rounding&&(old.settlement_note||'')===input.note)return old;
  id=old.id;kind='project';project=id;data={...JSON.parse(s[SNAPSHOTS].get(id)!.data),discount_amount:discount,rounding_amount:rounding,settlement_note:input.note};detail='设置客户优惠和抹零';
 }
 else if(action==='record_transaction'){
  data=transactionSchema.parse(args);get(data.project_id,'project');kind='transaction';project=data.project_id;
  // All entry paths use decimal half-up cents so 1.005 is always 1.01, with or without details.
  data.amount=paymentAmountCents(data.amount);if(data.amount<1)throw new BusinessError('金额不能小于0.01元');
  if(data.payment_items!==undefined)data.payment_items=normalizePaymentItems(data.payment_items);
  data.void=false;id='tx:'+owner+':'+data.request_id;
  // Include recycled records: reusing an old request must never restore a deleted payment.
  const old=await rawTransaction(owner,id);if(old)return matchingTransaction(old,data,project);
  if(data.subproject_id){
   const parent=get(project,'project');
   if(parent.project_type==='customer')throw new BusinessError('终端客户收付款按整户归属，不能选择报价小项目');
   if(!s.quotes.some(quote=>quote.project===project&&quoteGroupKey(quote)===data.subproject_id))throw new BusinessError('报价小项目不存在或不属于当前项目');
  }
  detail=data.type==='收款'?'登记收款':'登记付款';
 }
 else if(action==='void_transaction'){const old=get(id,'transaction');if(old.void)return old;if(merchantReceipt(old))throw new BusinessError('微信商户自动登记的收款对应真实到账，不能作废；如需退款请在微信商户平台办理',409);kind='transaction';project=old.project;data={...old,void:true,void_reason:zString(args.reason)};detail='作废流水：'+data.void_reason;}
 else if(action==='create_task'||action==='update_task'){data=taskSchema.parse(args);if(data.project_id)get(data.project_id,'project');kind='task';project=data.project_id;if(action==='update_task'){const old=get(id,kind);if(old.project!==project)throw new BusinessError('任务不能移动到其他项目');if(!Object.prototype.hasOwnProperty.call(args,'note'))data.note=old.note||'';if(data.due_at===undefined)data.due_at=old.due_at||'';if(!Object.prototype.hasOwnProperty.call(args,'date'))data.date=old.date||'';}else if(data.due_at===undefined)data.due_at='';if(data.due_at&&Object.prototype.hasOwnProperty.call(args,'due_at'))data.date=new Date(new Date(data.due_at).getTime()+8*60*60*1000).toISOString().slice(0,10);detail='更新任务';}
 else throw new BusinessError('不支持的操作');
 const now=new Date().toISOString();data.updated=now;
 const updated=['update_project','update_quote','delete_quote_items','update_task','void_transaction','adopt_quote','unadopt_quote','set_customer_settlement'].includes(action);
 const snapshot=updated?s[SNAPSHOTS].get(id):undefined;
 if(updated&&!snapshot)throw new BusinessError('记录不存在或无权访问',404);
 const serialized=JSON.stringify(data),statements:D1PreparedStatement[]=[];
 const needsTypeGuard=kind==='quote'||action==='set_customer_settlement'||(action==='record_transaction'&&!!data.subproject_id);
 const typeGuard=needsTypeGuard?' AND '+PARENT_TYPE:'',typeBindings:any[]=needsTypeGuard?[project,owner,get(project,'project').project_type||'project']:[];
 const adoptionRangeBindings:any[]=action==='adopt_quote'?[data.total,owner,project,quoteGroupKey(data)]:[];
 const changesAdoption=action==='adopt_quote'||action==='unadopt_quote',settlementGuard=changesAdoption?' AND '+SAFE_QUOTE_SETTLEMENT:action==='set_customer_settlement'?' AND '+SAFE_SETTLEMENT_CONTRACT:'',settlementBindings:any[]=changesAdoption?[project,owner,action==='adopt_quote'?data.total:0,owner,project,quoteGroupKey(data)]:action==='set_customer_settlement'?[data.discount_amount+data.rounding_amount,owner,project]:[];
 if(changesAdoption){const parent=get(project,'project'),nextContract=getAdoptedQuotes(s.quotes.filter(q=>q.project===project&&quoteGroupKey(q)!==quoteGroupKey(data))).reduce((sum,q)=>sum+(q.total||0),action==='adopt_quote'?data.total:0);if(parent.project_type==='customer'&&(parent.discount+parent.rounding)>nextContract)throw new BusinessError('报价总额不足以保留现有优惠和抹零，请先调整或清零折让后再操作');}
 if(action==='adopt_quote'){
  const nextContract=getAdoptedQuotes(s.quotes.filter(q=>q.project===project&&quoteGroupKey(q)!==quoteGroupKey(data))).reduce((sum,q)=>sum+(q.total||0),data.total);
  if(!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(nextContract)||nextContract<0)throw new BusinessError('采纳后合同总额超出可准确计算的范围');
  // This guard exactly matches the target CAS. Inside one atomic batch, target
  // failure also leaves every other quote unchanged. Restored quotes are read now.
  const targetGuard="EXISTS (SELECT 1 FROM records AS target WHERE target.id = ? AND target.owner = ? AND target.kind = 'quote' AND target.project = ? AND target.data = ? AND COALESCE(json_extract(target.data, '$.deleted'), 0) = 0) AND "+SAFE_QUOTE_CONTRACT;
  statements.push(db().prepare("UPDATE records SET data = json_set(data, '$.adopted', json('false'), '$.updated', ?) WHERE owner = ? AND project = ? AND kind = 'quote' AND id <> ? AND "+QUOTE_GROUP+" = ? AND COALESCE(json_extract(data, '$.deleted'), 0) = 0 AND json_extract(data, '$.adopted') = 1 AND "+targetGuard+' AND '+ACTIVE_PARENT+typeGuard+settlementGuard).bind(now,owner,project,id,quoteGroupKey(data),id,owner,project,snapshot!.data,...adoptionRangeBindings,project,owner,...typeBindings,...settlementBindings));
 }
 const parentGuard=kind==='task'&&!project?"(? = '' AND ? = ?)":ACTIVE_PARENT;
 const parentBindings=kind==='task'&&!project?[project,owner,owner]:[project,owner];
 let mutation:D1PreparedStatement;
 if(updated){
  mutation=db().prepare("UPDATE records SET data = ? WHERE id = ? AND owner = ? AND kind = ? AND project = ? AND data = ? AND COALESCE(json_extract(data, '$.deleted'), 0) = 0 AND "+parentGuard+(action==='adopt_quote'?' AND '+SAFE_QUOTE_CONTRACT:'')+typeGuard+settlementGuard+(changingProjectType?' AND '+EMPTY_PROJECT_STRUCTURE:'')).bind(serialized,id,owner,kind,project,snapshot!.data,...parentBindings,...adoptionRangeBindings,...typeBindings,...settlementBindings,...(changingProjectType?[owner,id,id]:[]));
 }else{
  // New records, especially stable financial IDs, are immutable insertions.
  let guard=kind==='project'?(data.parent_id?' WHERE '+ACTIVE_PARENT+" AND EXISTS (SELECT 1 FROM records AS root WHERE root.id = ? AND root.owner = ? AND COALESCE(json_extract(root.data, '$.parent_id'), '') = '' AND COALESCE(json_extract(root.data, '$.project_type'), 'project') = 'project')":''):' WHERE '+parentGuard+typeGuard;
  const bindings:any[]=[id,owner,kind,project,serialized,now,...(kind==='project'?(data.parent_id?[data.parent_id,owner,data.parent_id,owner]:[]):parentBindings),...typeBindings];
  // Reserve a subproject ID to one owner and one parent, including recycled versions.
  // The atomic guard also covers two requests that both passed the earlier lookup.
  if(kind==='quote'&&data.subproject_id){guard+=' AND '+UNUSED_QUOTE_GROUP;bindings.push(data.subproject_id,owner,project);}
  if(action==='record_transaction'&&data.subproject_id){guard+=' AND '+ACTIVE_TRANSACTION_GROUP;bindings.push(owner,project,data.subproject_id);}
  mutation=db().prepare('INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,?'+guard+' ON CONFLICT(id) DO NOTHING').bind(...bindings);
 }
 const mutationIndex=statements.length;statements.push(mutation);
 if(quoteDeletionBackup){
  // The backup is inserted only after a successful CAS, in the same atomic batch.
  // Restoring it creates an unadopted quote version; it never changes customer cash.
  const backup={...quoteDeletionBackup,updated:now,deleted_at:now,deleted_by:owner};
  statements.push(db().prepare('INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,? WHERE changes() > 0').bind(crypto.randomUUID(),owner,'quote',project,JSON.stringify(backup),now));
 }
 // changes() observes the immediately preceding mutation in this atomic batch.
 statements.push(db().prepare('INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,? WHERE changes() > 0').bind(crypto.randomUUID(),owner,'audit',project,JSON.stringify({action,detail,record_id:id,actor:owner}),now));
 const results=await db().batch(statements);
 if(affected(results[mutationIndex])<1){
  if(action==='record_transaction'){const old=await rawTransaction(owner,id);if(old)return matchingTransaction(old,data,project);}
  if(action==='set_customer_settlement'){const current=(await state(owner)).projects.find(value=>value.id===project);if(current?.project_type==='customer'&&(current.discount_amount||0)===data.discount_amount&&(current.rounding_amount||0)===data.rounding_amount&&(current.settlement_note||'')===data.settlement_note)return current;}
  throw new BusinessError(updated?'记录或项目已发生变化，请刷新后重试':'记录编号已存在或项目已发生变化，请刷新后重试',409);
 }
 return {...data,id,project,kind,created:snapshot?.created||now};
}
function zString(v:any){if(typeof v!=='string'||!v.trim()||v.length>500)throw new BusinessError('请填写作废原因');return v.trim()}
