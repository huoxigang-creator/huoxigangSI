'use client';

import {useEffect, useRef, useState} from 'react';
import {Check, ChevronRight, Copy, FileText, Plus, Settings2, Trash2} from 'lucide-react';
import {useListSelection, SelectionCheckbox, SelectionToolbar} from './list-selection';
import {runBulkActions} from '../lib/bulk-actions';
import {trashRequest} from '../lib/trash-client';
import {getPaymentDetails,isMerchantReceipt} from '../lib/payment-details';
import {projectDeletionWarning} from '../lib/project-deletion';
import {transactionGroupKey,groupQuotes} from '../lib/quotes';
import ManagedTable from './managed-table';
import TransactionAssignment,{transactionAssignmentOptions} from './transaction-assignment';

const money = (n = 0) => <span className="moneyValue">{new Intl.NumberFormat('zh-CN', {style:'currency', currency:'CNY'}).format(n / 100)}</span>;
type RecordRow = {id:string; [key:string]:any};
type SharedProps = {items:RecordRow[]; scope:string; busy:boolean; open:(type:string, record?:any, fundType?:string)=>void; onDeleted:(ids:string[])=>Promise<void>};

function useRecords({items,scope,busy,onDeleted}:SharedProps, extraWarning?:(rows:RecordRow[])=>string) {
  const selection = useListSelection(items,scope);
  const [deleting,setDeleting] = useState(false), [message,setMessage] = useState('');
  const lock = useRef(false);
  async function remove() {
    if(busy || lock.current || !selection.selectedRows.length) return;
    const rows = [...selection.selectedRows], warning = extraWarning?.(rows);
    if(!window.confirm(`将所选 ${rows.length} 条记录移入回收站？删除后可恢复。项目下记录会随项目隐藏；收付款和采纳报价删除后将重新计算统计。`+(warning?'\n\n'+warning:''))) return;
    lock.current = true; setDeleting(true); setMessage('');
    try {
      const result = await runBulkActions(rows, row=>trashRequest('delete_record',{id:row.id}));
      selection.retain(result.failedIds);
      setMessage(`已删除 ${result.successIds.length} 条，失败 ${result.failedIds.length} 条。${result.failures.map(f=>f.error).join('；')}${result.failedIds.length?' 失败项仍勾选，可重试。':' 可从回收站恢复。'}`);
      if(result.successIds.length) await onDeleted(result.successIds);
    } catch(reason) {setMessage(reason instanceof Error ? reason.message : '列表刷新失败，请刷新后核对记录。');}
    finally {lock.current=false;setDeleting(false);}
  }
  return {selection, disabled:busy||deleting, message, remove};
}
function Feedback({message}:{message:string}) {return message?<p role="status" className="sectionNote">{message}</p>:null;}

export function ProjectList(props:SharedProps & {onSelect:(row:any)=>void; allRowOrder?:string[]; customerMode?:boolean; onCopyQuote?:(row:any)=>void; onReceipt?:(row:any)=>void; onDeleteRow?:(row:any)=>void}) {
  const {selection,disabled,message,remove}=useRecords(props,projectDeletionWarning), one=selection.selectedRows.length===1?selection.selectedRows[0]:null;
  const noun=props.customerMode?'客户':'项目';
  return <><SelectionToolbar selection={selection.selectedIds.length} count={props.items.length} busy={disabled} onClear={selection.clear}>
    <button className="primary" disabled={disabled} onClick={()=>props.open(props.customerMode?'客户':'项目')}><Plus size={15}/>新建{noun}</button>
    <button disabled={disabled||!one} onClick={()=>one&&props.onSelect(one)}><ChevronRight size={15}/>进入{noun}</button>
    <button disabled={disabled||!one} onClick={()=>one&&props.open('项目',one)}><Settings2 size={15}/>编辑</button>
    <button className="dangerLink" disabled={disabled||!selection.selectedIds.length} onClick={()=>void remove()}><Trash2 size={15}/>删除所选</button>
  </SelectionToolbar><Feedback message={message}/>{props.items.length?<div className="tableWrap"><ManagedTable tableKey={props.customerMode?"customers/common":"projects/common"} allRowOrder={props.allRowOrder} disabled={disabled}><thead><tr><th className="selectionCell"><SelectionCheckbox checked={selection.allSelected} mixed={selection.partiallySelected} label={"全选当前"+noun} onChange={selection.toggleAll} disabled={disabled}/></th>{props.customerMode&&<th>客户编号</th>}<th>{props.customerMode?'客户 / 订单':'项目 / 客户'}</th><th>当前阶段</th><th>{props.customerMode?'采纳报价原价':'采纳报价'}</th>{props.customerMode&&<><th>优惠 / 抹零</th><th>优惠后应收</th></>}<th>已收款</th><th>待收款</th>{props.customerMode&&<th>操作</th>}</tr></thead><tbody>{props.items.map(p=><tr key={p.id} data-row-id={p.id} className={selection.selectedIds.includes(p.id)?'selectionRowSelected':''}><td className="selectionCell"><SelectionCheckbox checked={selection.selectedIds.includes(p.id)} label={'选择'+noun+' '+p.name} onChange={()=>selection.toggle(p.id)} disabled={disabled}/></td>{props.customerMode&&<td style={{fontFamily:'monospace',fontSize:11,color:'#667'}}>{p.customer_no||'—'}</td>}<td><button className="projectLink" disabled={disabled} onClick={()=>props.onSelect(p)}>{p.name}</button><small className="block muted">{p.customer} · {p.address||'未填写地址'}</small></td><td><span className={'badge '+(p.status==='已完工'?'green':'blue')}>{p.status}</span></td><td>{money(p.contract)}</td>{props.customerMode&&<><td>{money((p.discount_amount||0)+(p.rounding_amount||0))}</td><td>{money(p.receivable??p.contract)}</td></>}<td>{money(p.received)}</td><td className={p.remaining>0?'orangeText':''}>{money(p.remaining)}</td>{props.customerMode&&<td className="rowActions"><button type="button" disabled={disabled} onClick={()=>props.onCopyQuote?.(p)}><Copy size={13}/>复制报价</button><button type="button" disabled={disabled} onClick={()=>props.onReceipt?.(p)}>收款</button><button type="button" className="dangerLink" disabled={disabled} onClick={()=>props.onDeleteRow?.(p)}><Trash2 size={13}/>删除</button></td>}</tr>)}</tbody></ManagedTable></div>:<p className="sectionNote">暂无{noun}</p>}</>;
}

export function TaskList(props:SharedProps & {projects:RecordRow[]; mutate:(action:string,args:any)=>Promise<any>}) {
  const {selection,disabled,message,remove}=useRecords(props), one=selection.selectedRows.length===1?selection.selectedRows[0]:null;
  const [sms,setSms]=useState<{id:string;status:'sending'|'ok'|'err';message?:string}>();
  async function sendTaskSms(task:any){
    if(sms?.id===task.id&&sms.status==='sending')return;
    setSms({id:task.id,status:'sending'});
    try{
      const response=await fetch('/api/task-sms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task_id:task.id})});
      const body=await response.json() as {error?:string;phone?:string};
      if(!response.ok)throw new Error(body.error||'短信发送失败');
      setSms({id:task.id,status:'ok',message:body.phone});
      setTimeout(()=>setSms(current=>current?.id===task.id?undefined:current),4000);
    }catch(reason){setSms({id:task.id,status:'err',message:reason instanceof Error?reason.message:'发送失败'});}
  }
  return <><SelectionToolbar selection={selection.selectedIds.length} count={props.items.length} busy={disabled} onClear={selection.clear}>
    <SelectionCheckbox checked={selection.allSelected} mixed={selection.partiallySelected} label="全选当前任务" onChange={selection.toggleAll} disabled={disabled||!props.items.length}/>
    <button className="primary" disabled={disabled} onClick={()=>props.open('任务')}><Plus size={15}/>新建任务</button>
    <button disabled={disabled||!one} onClick={()=>one&&props.open('任务',one)}><Settings2 size={15}/>编辑</button>
    <button className="dangerLink" disabled={disabled||!selection.selectedIds.length} onClick={()=>void remove()}><Trash2 size={15}/>删除所选</button>
  </SelectionToolbar><Feedback message={message}/>{props.items.length?<div className="taskList">{props.items.map(t=><div className={'taskRow '+(selection.selectedIds.includes(t.id)?'selectionRowSelected':'')} key={t.id}><SelectionCheckbox checked={selection.selectedIds.includes(t.id)} label={'选择任务 '+t.title} onChange={()=>selection.toggle(t.id)} disabled={disabled}/><button aria-label={t.done?'标记未完成 '+t.title:'标记完成 '+t.title} disabled={disabled} className={'check '+(t.done?'checked':'')} onClick={()=>props.mutate('update_task',{id:t.id,project_id:t.project,title:t.title,note:t.note||'',assignee:t.assignee,date:t.date,due_at:t.due_at||'',done:!t.done})}>{t.done&&<Check size={14}/>}</button><div><b className={t.done?'strike':''}>{t.title}</b>{t.note&&<p>{t.note}</p>}<small>{props.projects.find(p=>p.id===t.project)?.name||'独立待办'} · {t.assignee||'未指定负责人'} · {t.due_at?new Date(t.due_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):t.date||'未设时间'}</small></div><button type="button" className="taskSmsButton" disabled={disabled||!props.projects.find(p=>p.id===t.project)?.phone} title={sms?.id===t.id&&sms.status==='err'?sms.message||'发送失败，点击重试':props.projects.find(p=>p.id===t.project)?.phone?('给客户 '+props.projects.find(p=>p.id===t.project)?.phone+' 发送提醒短信（到访 / 测量提醒）'):'任务未关联客户手机号，无法发送短信'} onClick={()=>void sendTaskSms(t)}>{sms?.id===t.id&&sms.status==='sending'?'发送中…':sms?.id===t.id&&sms.status==='ok'?'已发送✓':sms?.id===t.id&&sms.status==='err'?'重试':'短信提醒'}</button></div>)}</div>:<p className="sectionNote">暂无任务</p>}</>;
}

export function TransactionList(props:SharedProps & {projects:RecordRow[]; quotes?:RecordRow[]; transactions?:RecordRow[]; fundType?:string; showProject?:boolean; preferenceScope?:string; allRowOrder?:string[]; mutate:(action:string,args:any)=>Promise<any>}) {
  const {selection,disabled,message,remove}=useRecords(props), one=selection.selectedRows.length===1?selection.selectedRows[0]:null;
  const [assignment,setAssignment]=useState<RecordRow|null>(null);
  const transactions=props.transactions||props.items;
  const assignmentDisabled=disabled||Boolean(assignment);
  useEffect(()=>{setAssignment(null);},[props.scope]);
  function assignmentReason(row:RecordRow){return transactionAssignmentOptions(row,props.projects,props.quotes||[],transactions).reason;}
  function assign(row:RecordRow){if(!assignmentDisabled&&!assignmentReason(row))setAssignment({...row});}
  const hasPayments=props.fundType==='付款'||props.items.some(t=>t.type==='付款');
  function projectName(transaction:RecordRow){const project=props.projects.find(row=>row.id===transaction.project);const parent=project?.parent_id?props.projects.find(row=>row.id===project.parent_id):null;return parent?.name||project?.name||'—';}
  function subprojectName(transaction:RecordRow){
    const project=props.projects.find(row=>row.id===transaction.project);
    if(project?.parent_id)return project.name;
    if(project?.project_type==='customer'){
      if(transaction.subproject_id){const linked=(props.quotes||[]).find(quote=>quote.id===transaction.subproject_id&&!quote.deleted);return linked?.title||'原报价（已删除）';}
      return '整户订单';
    }
    const quotes=(props.quotes||[]).filter(quote=>quote.project===transaction.project&&!quote.deleted);
    const groupId=transactionGroupKey({project:transaction.project,subproject_id:transaction.subproject_id,source_quote_id:transaction.source_quote_id,owner:transaction.owner},quotes);
    if(groupId)return groupQuotes(quotes).find(group=>group.id===groupId)?.name||'原小项目（报价已删除）';
    return props.projects.some(row=>row.parent_id===transaction.project)||quotes.some(quote=>quote.subproject_id)?'未分配':'整项目';
  }
  return <><SelectionToolbar selection={selection.selectedIds.length} count={props.items.length} busy={disabled} onClear={selection.clear}>
    <button className="primary" disabled={disabled} onClick={()=>props.open('收付款',null,props.fundType||'收款')}><Plus size={15}/>登记{props.fundType||'收付款'}</button>
    <button disabled={assignmentDisabled||!one||Boolean(one&&assignmentReason(one))} onClick={()=>one&&assign(one)}><Settings2 size={15}/>分配小项目</button>
    {hasPayments&&<button disabled={disabled||!one||one.type!=='付款'} onClick={()=>one&&props.open('付款单据',one)}><FileText size={15}/>明细 / 单据</button>}
    <button disabled={disabled||!one||one.void||isMerchantReceipt(one)} title={one&&isMerchantReceipt(one)?'微信商户自动登记的收款不能作废，如需退款请在微信商户平台办理':undefined} onClick={()=>{if(!one||isMerchantReceipt(one))return;const reason=window.prompt('请输入作废原因。原流水会保留，作废后不再计入统计。');if(reason)void props.mutate('void_transaction',{id:one.id,reason});}}>作废</button>
    <button className="dangerLink" disabled={disabled||!selection.selectedIds.length} onClick={()=>void remove()}><Trash2 size={15}/>删除所选</button>
  </SelectionToolbar><Feedback message={message}/>{props.items.length?<div className="tableWrap"><ManagedTable tableKey="transactions/common" preferenceScope={props.preferenceScope || "all"} allRowOrder={props.allRowOrder} disabled={disabled}><thead><tr><th className="selectionCell"><SelectionCheckbox checked={selection.allSelected} mixed={selection.partiallySelected} label="全选当前流水" onChange={selection.toggleAll} disabled={disabled}/></th><th>日期</th>{props.showProject!==false&&<th>项目</th>}<th>所属小项目</th><th>类型 / 分类</th><th>关联报价 / 收款项</th><th>金额</th>{hasPayments&&<th>付款明细</th>}<th>备注</th><th>状态</th></tr></thead><tbody>{props.items.map(t=><tr key={t.id} data-row-id={t.id} className={(t.void?'void ':'')+(selection.selectedIds.includes(t.id)?'selectionRowSelected':'')}><td className="selectionCell"><SelectionCheckbox checked={selection.selectedIds.includes(t.id)} label={'选择'+t.type+' '+t.category+' '+money(t.amount)} onChange={()=>selection.toggle(t.id)} disabled={disabled}/></td><td>{t.date}</td>{props.showProject!==false&&<td>{projectName(t)}</td>}<td className="transactionAssignmentCell" title={assignmentReason(t)||'点击分配到小项目'} onClick={()=>assign(t)}><button type="button" className="transactionAssignmentButton" disabled={assignmentDisabled||Boolean(assignmentReason(t))} aria-label={'分配'+t.type+' '+t.category+'到小项目'} title={assignmentReason(t)||'点击分配到小项目'} onClick={event=>{event.stopPropagation();assign(t);}}><span className={subprojectName(t)==='未分配'?'receiptUnassignedLabel':'receiptSubprojectLabel'}>{subprojectName(t)}</span></button></td><td><span className={'badge '+(t.type==='收款'?'green':'orange')}>{t.type}</span> {t.category}</td><td>{t.source_quote_id?<><b>{t.quote_title||t.source_quote_id}</b><small className="block muted">{t.payment_item||t.category}{t.payment_provider==='wechat'?' · 微信商户收款':''}</small>{t.wechat_transaction_id&&<small className="block muted">交易号：{t.wechat_transaction_id}</small>}</>:'—'}</td><td><b>{money(t.amount)}</b></td>{hasPayments&&<td className="paymentDetailCell">{t.type==='付款'?(getPaymentDetails(t).items.length?getPaymentDetails(t).items.map((item:any,i:number)=><div key={i}><span>{item.name}</span><b>{money(item.amount)}</b></div>):'—'):'—'}</td>}<td>{t.type==='付款'?getPaymentDetails(t).note||'—':t.note||'—'}</td><td>{t.void?<span title={t.void_reason}>已作废</span>:'有效'}</td></tr>)}</tbody></ManagedTable></div>:<p className="sectionNote">暂无{props.fundType||'资金流水'}记录</p>}{assignment&&<TransactionAssignment key={assignment.id} record={assignment} projects={props.projects} quotes={props.quotes||[]} transactions={transactions} busy={disabled} mutate={props.mutate} onClose={()=>setAssignment(null)}/>}</>;
}

export function QuoteList(props:SharedProps & {mutate:(action:string,args:any)=>Promise<any>; onCopy:(row:any)=>void}) {
  const {selection,disabled,message,remove}=useRecords(props), one=selection.selectedRows.length===1?selection.selectedRows[0]:null;
  return <><SelectionToolbar selection={selection.selectedIds.length} count={props.items.length} busy={disabled} onClear={selection.clear}>
    <SelectionCheckbox checked={selection.allSelected} mixed={selection.partiallySelected} label="全选当前报价" onChange={selection.toggleAll} disabled={disabled||!props.items.length}/>
    <button className="primary" disabled={disabled} onClick={()=>props.open('报价')}><Plus size={15}/>新建报价</button>
    <button disabled={disabled||!one} onClick={()=>one&&props.open('查看报价',one)}>查看</button>
    <button disabled={disabled||!one||one.adopted} onClick={()=>one&&props.open('报价',one)}>编辑</button>
    <button disabled={disabled||!one} onClick={()=>one&&props.onCopy(one)}><Copy size={15}/>复制</button>
    <button disabled={disabled||!one||one.adopted} onClick={()=>{if(one&&window.confirm('采纳此报价并替换原采纳版本？项目合同金额将更新。'))void props.mutate('adopt_quote',{id:one.id});}}>采纳报价</button>
    <button className="dangerLink" disabled={disabled||!selection.selectedIds.length} onClick={()=>void remove()}><Trash2 size={15}/>删除所选</button>
  </SelectionToolbar><Feedback message={message}/>{props.items.length?<div className="quoteGrid">{props.items.map(q=><article className={'quoteCard '+(q.adopted?'adopted ':'')+(selection.selectedIds.includes(q.id)?'selectionRowSelected':'')} key={q.id}>{q.adopted&&<span className="quoteCardRibbon">采纳</span>}<div><SelectionCheckbox checked={selection.selectedIds.includes(q.id)} label={'选择报价 '+q.title} onChange={()=>selection.toggle(q.id)} disabled={disabled}/><span className={'badge '+(q.adopted?'green':'blue')}>{q.adopted?'已采纳':'草稿'}</span><small>{q.created.slice(0,10)}</small></div><h3>{q.title}</h3><strong>{money(q.total)}</strong><p>{q.items.length} 条报价明细</p><button className="link" disabled={disabled} onClick={()=>props.open('查看报价',q)}>查看</button></article>)}</div>:<p className="sectionNote">这个项目还没有报价</p>}</>;
}
