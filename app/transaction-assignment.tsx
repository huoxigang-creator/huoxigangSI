'use client';

import {useEffect,useRef,useState,type FormEvent} from 'react';
import {X} from 'lucide-react';
import {receiptTargets} from '../lib/order-overview';
import {transactionGroupKey} from '../lib/quotes';
import {useWorkspaceActive,visibleWorkspaceDialogs,isWorkspaceElementVisible} from './workspace-active';
import './receipt-project-fields.css';
import './transaction-assignment.css';

type Row={id:string;project?:string;[key:string]:any};
const money=(amount:number)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(amount/100);

export function transactionAssignmentOptions(record:Row,projects:Row[],quotes:Row[],transactions:Row[]=[]){
 const project=projects.find(row=>row.id===record.project&&!row.deleted);
 const root=project?.parent_id?projects.find(row=>row.id===project.parent_id&&!row.deleted):project;
 const targets=root?receiptTargets(root,projects,quotes,transactions.filter(row=>row.id!==record.id)).targets.filter(row=>row.projectId!==root.id||Boolean(row.subprojectId)):[];
 const group=transactionGroupKey(record,quotes);
 const current=targets.find(row=>row.projectId===record.project&&(row.subprojectId||'')===(group||''));
 const reason=record.void||record.deleted?'已作废或已删除的流水不能分配':!root?'所属项目已不可用':root.project_type==='customer'?'客户收付款按整户订单管理':record.source_quote_id||record.payment_provider||record.wechat_transaction_id||record.payment_order_id?'关联报价或线上收款的流水按原订单归属':!targets.length?'请先在该项目下添加小项目':'';
 return {root,targets,current,reason};
}

type Props={record:Row;projects:Row[];quotes:Row[];transactions:Row[];busy:boolean;mutate:(action:string,args:any)=>Promise<any>;onClose:()=>void};

export default function TransactionAssignment({record,projects,quotes,transactions,busy,mutate,onClose}:Props){
 const active=useWorkspaceActive(),panel=useRef<HTMLElement>(null),lock=useRef(false);
 const options=transactionAssignmentOptions(record,projects,quotes,transactions);
 const [targetId,setTargetId]=useState(options.current?.id||''),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const disabled=busy||saving,latest=useRef({disabled,onClose,active});latest.current={disabled,onClose,active};
 const target=options.targets.find(row=>row.id===targetId);
 const afterReceived=target?target.received+(record.type==='收款'?record.amount:0):0;
 const afterRemaining=target?.receivable===null||target?.receivable===undefined?null:Math.max(0,target.receivable-afterReceived);
 const overpaid=target?.receivable===null||target?.receivable===undefined?0:Math.max(0,afterReceived-target.receivable);
 useEffect(()=>{
  if(!active){if(!lock.current)latest.current.onClose();return;}
  const previous=document.body.style.overflow,focused=document.activeElement as HTMLElement|null;
  document.body.style.overflow='hidden';panel.current?.querySelector<HTMLElement>('select')?.focus();
  const keyboard=(event:KeyboardEvent)=>{
   if(!['Escape','Tab'].includes(event.key)||event.defaultPrevented)return;
   const dialogs=visibleWorkspaceDialogs();if(dialogs.length&&dialogs[dialogs.length-1]!==panel.current)return;
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!latest.current.disabled&&!lock.current)latest.current.onClose();return;}
   const targets=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]')||[]),first=targets[0],last=targets[targets.length-1];
   if(!first){event.preventDefault();return;}
   const outside=!panel.current?.contains(document.activeElement);
   if(event.shiftKey&&(document.activeElement===first||outside)){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||outside)){event.preventDefault();first.focus();}
  };
  window.addEventListener('keydown',keyboard,true);
  return()=>{document.body.style.overflow=previous;window.removeEventListener('keydown',keyboard,true);if(latest.current.active&&focused?.isConnected&&isWorkspaceElementVisible(focused))focused.focus();};
 },[active]);
 async function save(event:FormEvent){
  event.preventDefault();if(disabled||lock.current||!active)return;
  if(options.reason){setError(options.reason);return;}
  if(!target){setError('请选择这笔款对应的小项目');return;}
  lock.current=true;setSaving(true);setError('');
  try{
   const result=await mutate('assign_transaction_subproject',{id:record.id,project_id:target.projectId,subproject_id:target.subprojectId||'',expected_project_id:record.project,expected_subproject_id:record.subproject_id||'',expected_updated:record.updated||record.created});
   if(result===false)throw new Error('分配未保存，请核对页面提示后重试。');
   onClose();
  }catch(reason){setError(reason instanceof Error?reason.message:'分配失败，请重试');}
  finally{lock.current=false;setSaving(false);}
 }
 if(!active)return null;
 return <div className="overlay transactionAssignmentOverlay"><section ref={panel} className="modal transactionAssignmentModal" role="dialog" aria-modal="true" aria-label="分配到小项目"><form onSubmit={event=>void save(event)}>
  <div className="modalHead"><div><span className="eyebrow">{options.root?.name||'项目资金流水'}</span><h2>分配到小项目</h2></div><button type="button" aria-label="关闭小项目分配" disabled={disabled} onClick={()=>{if(!lock.current)onClose();}}><X size={20}/></button></div>
  <div className="formBody"><p className="transactionAssignmentRecord">{record.date} · {record.type} · {record.category}<strong>{money(record.amount)}</strong></p>
   <fieldset className="paymentFields" disabled={disabled||Boolean(options.reason)}><label>所属小项目 *<select aria-label="分配所属小项目" required value={targetId} onChange={event=>setTargetId(event.target.value)}><option value="" disabled>请选择小项目</option>{options.targets.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    {target&&<div className="receiptBalance" aria-label="分配后小项目收款情况" aria-live="polite"><strong>{target.name}</strong><dl><div><dt>应收金额</dt><dd>{target.receivable===null?'报价未采纳，尚未确定':money(target.receivable)}</dd></div><div><dt>{record.type==='收款'?'分配后累计已收':'累计已收'}</dt><dd>{money(afterReceived)}</dd></div><div><dt>{record.type==='收款'?'分配后待收':'当前待收'}</dt><dd>{afterRemaining===null?'尚未确定':money(afterRemaining)}</dd></div></dl>{overpaid>0&&<p>该小项目将超收 {money(overpaid)}，请核对账目。</p>}</div>}
   </fieldset><p className="sectionNote">保存后更新这条流水的小项目归属，金额、日期和备注保留。</p>{(error||options.reason)&&<p className="transactionAssignmentError" role="alert">{error||options.reason}</p>}
  </div><div className="modalFoot"><button type="button" disabled={disabled} onClick={()=>{if(!lock.current)onClose();}}>取消</button><button type="submit" className="primary" disabled={disabled||!target||Boolean(options.reason)}>{saving?'保存中…':'保存分配'}</button></div>
 </form></section></div>;
}
