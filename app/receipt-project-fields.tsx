'use client';

import {useMemo,useState} from 'react';
import {receiptTargets,type OrderRow} from '../lib/order-overview';
import {paymentAmountCents} from '../lib/payment-details';
import './receipt-project-fields.css';

const money=(amount:number)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(amount/100);
type Props={projects:any[];quotes:any[];transactions:any[];initialProjectId:string;initialTargetId?:string;type:string;amount:string};

export default function ReceiptProjectFields({projects,quotes,transactions,initialProjectId,initialTargetId,type,amount}:Props){
 const initial=projects.find(project=>project.id===initialProjectId);
 const initialRoot=initial?.parent_id?projects.find(project=>project.id===initial.parent_id):initial;
 const [rootId,setRootId]=useState(initialRoot?.id||'');
 const root=projects.find(project=>project.id===rootId);
 const basis=useMemo(()=>root?receiptTargets(root,projects,quotes,transactions):{targets:[],unallocated:0,unallocatedPayment:0},[root,projects,quotes,transactions]);
 const initialTargets=initialRoot?receiptTargets(initialRoot,projects,quotes,transactions).targets:[];
 const defaultTarget=(targets:OrderRow[],projectId:string)=>{
  const own=targets.filter(target=>target.projectId===projectId);
  return own.find(target=>target.receivable!==null&&target.receivable!==undefined)?.id||own.find(target=>Boolean(target.subprojectId))?.id||(own.length===1?own[0].id:targets.length===1?targets[0].id:'');
 };
 const [targetId,setTargetId]=useState(()=>{if(initialTargetId&&initialTargets.some(row=>row.id===initialTargetId))return initialTargetId;return defaultTarget(initialTargets,initialProjectId);});
 const target=basis.targets.find(row=>row.id===targetId);
 const customer=root?.project_type==='customer';
 const hasSubprojects=Boolean(root&&(customer?basis.targets.length>1:basis.targets.length>1||basis.targets.some(row=>row.projectId!==root.id||row.subprojectId)));
 const actualTarget=hasSubprojects?target:basis.targets[0];
 const pending=type==='收款'?(()=>{try{return paymentAmountCents(amount);}catch{return 0;}})():0;
 const balance=actualTarget?.remaining;
 function changeRoot(value:string){
  setRootId(value);
  const next=projects.find(project=>project.id===value);
  setTargetId(next?defaultTarget(receiptTargets(next,projects,quotes,transactions).targets,value):'');
 }
 return <div className="receiptProjectFields">
  <label>所属项目 *<select aria-label="所属项目" required value={rootId} onChange={event=>changeRoot(event.target.value)}>
   <option value="" disabled>请选择项目或客户</option>
   {projects.filter(project=>!project.parent_id&&!project.deleted).map(project=><option key={project.id} value={project.id}>{project.name}</option>)}
  </select></label>
  <input type="hidden" name="project_id" value={actualTarget?.projectId||rootId}/>
  {actualTarget?.subprojectId&&<input type="hidden" name="subproject_id" value={actualTarget.subprojectId}/>}
  {hasSubprojects&&<label>所属小项目{type==='收款'?' *':''}<select aria-label="所属小项目" value={targetId} required={type==='收款'} onChange={event=>setTargetId(event.target.value)}>
   <option value="">{type==='收款'?'请选择本次收款的小项目':'合作项目公共付款（不分配小项目）'}</option>
   {basis.targets.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}
  </select></label>}
  {actualTarget&&<div className="receiptBalance" aria-label="所选订单收款情况" aria-live="polite">
   <strong>{customer?'本客户':hasSubprojects?'本小项目':'本项目'}：{actualTarget.name}</strong>
   <dl>
    <div><dt>应收金额</dt><dd>{actualTarget.receivable===null?'报价未采纳，尚未确定':money(actualTarget.receivable)}</dd></div>
    <div><dt>累计已收</dt><dd>{money(actualTarget.received)}</dd></div>
    <div><dt>当前待收</dt><dd>{balance===null||balance===undefined?'尚未确定':money(balance)}</dd></div>
    {type==='收款'&&pending>0&&balance!==null&&balance!==undefined&&<div><dt>本次登记后待收</dt><dd>{money(Math.max(balance-pending,0))}</dd></div>}
   </dl>
   {actualTarget.overpaid>0&&<p>该订单已超收 {money(actualTarget.overpaid)}，请核对账目。</p>}
   {pending>0&&balance!==null&&balance!==undefined&&pending>balance&&<p>本次金额超过当前待收 {money(pending-balance)}，请核对是否为预收款。</p>}
  </div>}
  {root&&basis.unallocated>0&&hasSubprojects&&<p className="receiptUnallocated" role="status">该合作项目有 {money(basis.unallocated)} 历史收款未分配到小项目，尚未抵扣上方小项目的待收款。</p>}
 </div>;
}
