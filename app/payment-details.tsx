'use client';
import {Plus,X} from 'lucide-react';
import {getPaymentDetails,paymentDetailsTotal,type PaymentItem,type PaymentItemDraft} from '../lib/payment-details';
const money=(amount:number)=><span className="moneyValue">{new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(amount/100)}</span>;

export function PaymentDetailsEditor({items,onChange}:{items:PaymentItemDraft[];onChange:(items:PaymentItemDraft[])=>void}){
 function complete(index:number){if(items.length>=100||!items[index]?.amount.trim()||!Number.isFinite(Number(items[index].amount))||Number(items[index].amount)<=0||items.some(item=>!item.name.trim()&&!item.amount.trim()))return;onChange([...items,{name:'',amount:''}]);}
 function change(index:number,key:'name'|'amount',value:string){onChange(items.map((item,i)=>i===index?{...item,[key]:value}:item));}
 return <section className="paymentDetailEditor" aria-label="付款明细">
  <div className="paymentDetailHeading"><h3>付款明细</h3><button type="button" disabled={items.length>=100} onClick={()=>onChange([...items,{name:'',amount:''}])}><Plus size={14}/>添加明细</button></div>
  <div className="paymentDetailLabels"><span>明细名称</span><span>金额（元）</span><span/></div>
  {items.map((item,index)=><div className="paymentDetailInputs" key={index}>
   <input aria-label={'明细名称'+(index+1)} placeholder="例如：板材款" maxLength={100} value={item.name} required={Boolean(item.amount.trim())} onChange={event=>change(index,'name',event.target.value)}/>
   <input aria-label={'明细金额'+(index+1)} type="number" placeholder="0.00" min="0.01" max="100000000" step="0.01" value={item.amount} required={Boolean(item.name.trim())} onChange={event=>change(index,'amount',event.target.value)} onBlur={()=>complete(index)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();complete(index);}}}/>
   <button type="button" aria-label={'删除明细行'+(index+1)} onClick={()=>onChange(items.length===1?[{name:'',amount:''}]:items.filter((_,i)=>i!==index))}><X size={15}/></button>
  </div>)}
  <p className="paymentDetailTotal">明细合计 <b>{money(paymentDetailsTotal(items))}</b></p>
  <p className="note">填写明细后，付款金额按明细合计自动计算。</p>
 </section>;
}

export function PaymentDetailSummary({transaction}:{transaction:{type?:string;amount:number;payment_items?:PaymentItem[];note?:string;category?:string}}){
 const detail=getPaymentDetails(transaction);
 return <section className="paymentDetailSummary" aria-label="付款明细与备注"><h3>付款明细</h3>{detail.items.length?<ul>{detail.items.map((item,index)=><li key={index}><span>{item.name}</span><b>{money(item.amount)}</b></li>)}</ul>:<p className="note">未填写付款明细</p>}<div className="paymentDetailNote"><span>备注</span><p>{detail.note||'—'}</p></div></section>;
}
