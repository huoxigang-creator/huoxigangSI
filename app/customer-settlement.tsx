'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {BadgePercent,X} from 'lucide-react';
import {paymentAmountCents} from '../lib/payment-details';
import './customer-settlement.css';

export type CustomerAccount={id:string;name:string;contract:number;received:number;remaining:number;discount_amount?:number;rounding_amount?:number;settlement_note?:string};
const money=(amount:number)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(amount/100);
function preview(value:string){try{return paymentAmountCents(value.trim()||'0');}catch{return null;}}

export function CustomerSettlementSummary({project,busy,onOpen}:{project:CustomerAccount;busy:boolean;onOpen:()=>void}){
 const discount=project.discount_amount||0,rounding=project.rounding_amount||0,receivable=project.contract-discount-rounding;
 return <section className="customerSettlementSummary" aria-label="客户结算">
  <div><span>优惠</span><b>{money(discount)}</b></div><div><span>抹零</span><b>{money(rounding)}</b></div><div><span>优惠后应收</span><strong>{money(receivable)}</strong></div>
  {project.contract>0&&project.remaining===0&&<span className="badge green">已结清</span>}
  {project.remaining<0&&<span className="badge blue">多收 {money(-project.remaining)}</span>}
  <button type="button" disabled={busy} onClick={onOpen}><BadgePercent size={16}/>优惠 / 抹零</button>
 </section>;
}

export default function CustomerSettlement({project,open,busy,mutate,onClose}:{project:CustomerAccount;open:boolean;busy:boolean;mutate:(action:string,args:Record<string,unknown>)=>Promise<boolean>;onClose:()=>void}){
 const [discount,setDiscount]=useState('0.00'),[rounding,setRounding]=useState('0.00'),[note,setNote]=useState(''),[error,setError]=useState('');
 const discountInput=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(open){setDiscount(((project.discount_amount||0)/100).toFixed(2));setRounding(((project.rounding_amount||0)/100).toFixed(2));setNote(project.settlement_note||'');setError('');}},[open,project.id]);
 useEffect(()=>{if(!open)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';const focused=document.activeElement as HTMLElement|null;discountInput.current?.focus();return()=>{document.body.style.overflow=previous;focused?.focus();};},[open,project.id]);
 useEffect(()=>{if(!open)return;const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopImmediatePropagation();if(!busy)onClose();}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[open,busy,onClose]);
 if(!open)return null;
 const discountCents=preview(discount),roundingCents=preview(rounding),valid=discountCents!==null&&roundingCents!==null&&discountCents+roundingCents<=project.contract;
 const receivable=valid?project.contract-discountCents!-roundingCents!:null,remaining=receivable===null?null:receivable-project.received;
 function writeOff(){if(!valid||remaining===null||remaining<=0)return;setRounding((Math.max(0,project.contract-discountCents!-project.received)/100).toFixed(2));setError('');}
 async function save(event:FormEvent){event.preventDefault();if(busy)return;if(!valid){setError('请填写有效金额，优惠与抹零合计不能超过采纳报价。');return;}setError('');const saved=await mutate('set_customer_settlement',{project_id:project.id,discount_amount:discountCents!/100,rounding_amount:roundingCents!/100,note:note.trim()});if(saved)onClose();else setError('保存未成功，请根据提示检查金额后重试。');}
 return <div className="overlay customerSettlementOverlay"><section className="modal customerSettlementModal" role="dialog" aria-modal="true" aria-label="优惠与抹零">
  <div className="modalHead"><div><span className="eyebrow">{project.name}</span><h2>优惠与抹零</h2></div><button type="button" aria-label="关闭优惠与抹零" disabled={busy} onClick={onClose}><X size={20}/></button></div>
  <form onSubmit={save}><div className="formBody">
   <div className="customerSettlementBase"><div><span>采纳报价原价</span><b>{money(project.contract)}</b></div><div><span>实际已收款</span><b>{money(project.received)}</b></div></div>
   {project.contract===0&&<p className="sectionNote">先采纳客户报价，再登记优惠或抹零。</p>}
   <div className="formGrid"><label>优惠金额（元）<input ref={discountInput} aria-label="优惠金额" type="number" min="0" max="100000000" step="0.01" required value={discount} disabled={busy} onChange={event=>{setDiscount(event.target.value);setError('');}}/></label><label>抹零金额（元）<input aria-label="抹零金额" type="number" min="0" max="100000000" step="0.01" required value={rounding} disabled={busy} onChange={event=>{setRounding(event.target.value);setError('');}}/></label></div>
   <div className="customerSettlementTools"><button type="button" disabled={busy||!valid||remaining===null||remaining<=0} onClick={writeOff}>抹零剩余尾款</button><button type="button" disabled={busy} onClick={()=>{setDiscount('0.00');setRounding('0.00');setError('');}}>清除优惠与抹零</button></div>
   <label>优惠 / 抹零说明<textarea aria-label="优惠抹零说明" maxLength={1000} value={note} disabled={busy} onChange={event=>setNote(event.target.value)} placeholder="例如：客户议价优惠500元，尾款抹零20元"/></label>
   <div className="customerSettlementPreview" aria-live="polite"><div><span>优惠后应收</span><strong>{receivable===null?'—':money(receivable)}</strong></div><div><span>{remaining!==null&&remaining<0?'多收款':'保存后待收款'}</span><strong>{remaining===null?'—':money(Math.abs(remaining))}</strong></div>{project.contract>0&&remaining===0&&<span className="badge green">保存后已结清</span>}</div>
   <p className="sectionNote">优惠后应收 = 原价 − 优惠 − 抹零；待收款 = 优惠后应收 − 实际已收款。优惠和抹零会保留记录。</p>
   {!valid&&<p className="customerSettlementError" role="alert">优惠与抹零合计不能超过采纳报价，请检查金额。</p>}{error&&<p className="customerSettlementError" role="alert">{error}</p>}
  </div><div className="modalFoot"><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary" type="submit" disabled={busy||!valid}>{busy?'正在保存…':'保存结算'}</button></div></form>
 </section></div>;
}
