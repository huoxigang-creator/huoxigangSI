'use client';

import {useRef,useState} from 'react';
import {FileText} from 'lucide-react';
import {ContractModal,ContractPdfPreview,contractRequest} from './contracts';
import {TemplateEditor} from './contract-config';
import {renderContractTemplate} from '../lib/contract-template';
import {normalizeIdentityNumber,identityNumberError} from '../lib/contract-identity';
import type {ContractRecord,ContractTemplate,SigningConfig} from '../lib/contract-types';

type Quote={id:string;title:string;total:number;adopted?:boolean;subproject_name?:string};
type Props={contract:ContractRecord;templates:ContractTemplate[];quotes:Quote[];config:SigningConfig;onClose:()=>void;onGenerated:(record:ContractRecord)=>Promise<void>};

export default function ContractTemplateDialog({contract,templates,quotes,config,onClose,onGenerated}:Props){
 const [draft,setDraft]=useState(()=>({template_id:contract.template_id,company_name:contract.company_name,party_type:contract.party_type,customer_name:contract.customer_name,customer_phone:contract.customer_phone,customer_company:contract.customer_company,customer_identity_type:contract.customer_identity_type||'CRED_PSN_CH_IDCARD' as const,customer_identity_number:normalizeIdentityNumber(contract.customer_identity_number||''),quote_id:contract.quote_id}));
 const [choices,setChoices]=useState(templates),[editing,setEditing]=useState<ContractTemplate|null>(null),[preview,setPreview]=useState(false),[generated,setGenerated]=useState<ContractRecord|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),committed=useRef<ContractRecord|null>(null);
 const selectedTemplate=draft.template_id===contract.template_id?contract.template_snapshot:choices.find(value=>value.id===draft.template_id);
 const selectedQuote=quotes.find(value=>value.id===draft.quote_id);
 const sameQuote=draft.quote_id===contract.quote_id;
 const gross=sameQuote?contract.gross_amount:selectedQuote?.total??contract.gross_amount;
 const net=gross-contract.discount_amount-contract.rounding_amount;
 const plans=contract.installments.map((row,index,all)=>({...row,amount:index===all.length-1?net-all.slice(0,index).reduce((sum,plan)=>sum+Math.floor(net*Math.round(plan.ratio*100)/10000),0):Math.floor(net*Math.round(row.ratio*100)/10000)}));
 const previewRecord:ContractRecord={...contract,...draft,template_snapshot:selectedTemplate||contract.template_snapshot,quote_snapshot:sameQuote?contract.quote_snapshot:selectedQuote?{...selectedQuote}:null,gross_amount:gross,net_amount:net,installments:plans};
 const companyNames=Array.from(new Set([contract.company_name,config.profile.company_name].filter(Boolean)));
 const change=<K extends keyof typeof draft>(key:K,value:typeof draft[K])=>{setDraft(current=>({...current,[key]:key==='customer_identity_number'?normalizeIdentityNumber(value):value}));setError('');};
 async function generate(){
  if(lock.current)return;
  if(!selectedTemplate||!draft.company_name.trim()||!draft.customer_name.trim()||!draft.customer_phone.trim()){setError('请填写模板、签约主体、真实姓名和电话号码。');return;}
  if(draft.party_type==='organization'&&!draft.customer_company.trim()){setError('请填写签约公司名称。');return;}
  const identityError=identityNumberError(draft.customer_identity_number,true);if(identityError){setError(identityError);return;}
  if(!Number.isSafeInteger(net)||net<0){setError('所选报价金额不能小于合同优惠与抹零合计，请在编辑合同中核对金额。');return;}
  lock.current=true;setBusy(true);setError('');
  try{
   const record=committed.current||await contractRequest<ContractRecord>('save_contract',{...contract,...draft,project_id:contract.project,gross_amount:gross/100,discount_amount:contract.discount_amount/100,rounding_amount:contract.rounding_amount/100,installments:contract.installments.map(({id,name,ratio,due_date})=>({id,name,ratio,due_date}))});
   committed.current=record;
   await onGenerated(record);setGenerated(record);
  }catch(reason){setError(reason instanceof Error?reason.message:'模板生成失败，请重试。');}finally{lock.current=false;setBusy(false);}
 }
 function editTemplate(){
  if(!selectedTemplate)return;
  setEditing({...selectedTemplate,id:crypto.randomUUID(),revision:undefined,builtin:false,name:selectedTemplate.name+'（副本）'});
 }
 async function templateSaved(saved?:ContractTemplate){
  const result=await contractRequest<{templates:ContractTemplate[]}>('list_templates');setChoices(result.templates);
  if(saved){setDraft(current=>({...current,template_id:saved.id}));}
 }
 if(generated)return <ContractPdfPreview contract={generated} onClose={onClose}/>;
 return <>
  <ContractModal title="完善生成模板信息" className="contractVerticalModal contractGenerateModal" onClose={onClose} busy={busy}>
   <form onSubmit={event=>{event.preventDefault();void generate();}}>
    <div className="contractGenerateBody">
     <fieldset className="contractFields" disabled={busy||Boolean(committed.current)}>
      <section className="contractGenerateSection"><h3><FileText size={14}/>模板信息</h3><div className="contractVerticalFields">
       <label><span><em>*</em> 模板</span><select aria-label="模板" required value={draft.template_id} onChange={event=>change('template_id',event.target.value)}>{!choices.some(value=>value.id===contract.template_id)&&<option value={contract.template_id}>{contract.template_snapshot.name}</option>}{choices.map(value=><option value={value.id} key={value.id}>{value.name}</option>)}</select></label>
       <label><span><em>*</em> 签约主体</span><select aria-label="签约主体" required value={draft.company_name} onChange={event=>change('company_name',event.target.value)}>{companyNames.map(name=><option key={name}>{name}</option>)}</select></label>
       <label><span><em>*</em> 主体印章</span><select aria-label="主体印章" value={config.profile.seal_id||''} disabled={!config.profile.seal_id} onChange={()=>{}}><option value={config.profile.seal_id||''}>{config.profile.seal_id?'公章':'请先配置主体印章'}</option></select></label>
      </div></section>
      <section className="contractGenerateSection"><h3><FileText size={14}/>实名认证</h3><div className="contractVerticalFields">
       <label><span>签约类型</span><div className="contractPartyOptions"><label><input aria-label="公司" type="radio" name="contractPartyType" checked={draft.party_type==='organization'} onChange={()=>change('party_type','organization')}/>公司</label><label><input aria-label="个人" type="radio" name="contractPartyType" checked={draft.party_type==='person'} onChange={()=>change('party_type','person')}/>个人</label></div></label>
       {draft.party_type==='organization'&&<label><span><em>*</em> 公司名称</span><input aria-label="签约公司名称" required maxLength={200} value={draft.customer_company} onChange={event=>change('customer_company',event.target.value)}/></label>}
       <label><span><em>*</em> 真实姓名</span><div className="contractClearField"><input aria-label="真实姓名" autoComplete="off" required maxLength={100} value={draft.customer_name} onChange={event=>change('customer_name',event.target.value)}/>{draft.customer_name&&<button type="button" aria-label="清空真实姓名" onClick={()=>change('customer_name','')}>×</button>}</div></label>
       <label><span><em>*</em> 电话号码</span><input aria-label="电话号码" autoComplete="off" required maxLength={30} inputMode="tel" value={draft.customer_phone} onChange={event=>change('customer_phone',event.target.value)}/></label>
       <label><span>证件类型</span><select aria-label="证件类型" value={draft.customer_identity_type} onChange={()=>{}}><option value="CRED_PSN_CH_IDCARD">大陆身份证</option></select></label>
       <label><span><em>*</em> 证件号码</span><div className="contractClearField"><input aria-label="证件号码" autoComplete="off" required maxLength={18} placeholder={draft.party_type==='organization'?'填写经办人身份证号码':'填写签署人身份证号码'} value={draft.customer_identity_number} onChange={event=>change('customer_identity_number',event.target.value)}/>{draft.customer_identity_number&&<button type="button" aria-label="清空证件号码" onClick={()=>change('customer_identity_number','')}>×</button>}</div></label>
      </div></section>
      <section className="contractGenerateSection"><h3><FileText size={14}/>追加报价</h3><div className="contractVerticalFields">
       <label><span>报价名称</span><select aria-label="报价名称" value={draft.quote_id} onChange={event=>change('quote_id',event.target.value)}><option value="">请选择报价</option>{contract.quote_id&&!quotes.some(value=>value.id===contract.quote_id)&&<option value={contract.quote_id}>{contract.quote_snapshot?.title||'保存时报价'}</option>}{quotes.map(value=><option key={value.id} value={value.id}>{value.subproject_name?value.subproject_name+' / ':''}{value.title}</option>)}</select></label>
      </div></section>
     </fieldset>
     {error&&<p role="alert" className="contractError">{error}</p>}
    </div>
    <div className="modalFoot"><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="button" disabled={busy||!selectedTemplate||Boolean(committed.current)} onClick={editTemplate}>编辑模板</button><button type="button" disabled={busy||net<0} onClick={()=>setPreview(true)}>预览模板</button><button type="submit" disabled={busy}>{busy?'生成中…':'确认生成模板'}</button></div>
   </form>
  </ContractModal>
  {preview&&<ContractModal title="预览模板" onClose={()=>setPreview(false)} className="contractTemplatePreviewModal" footer={<button type="button" onClick={()=>setPreview(false)}>关闭</button>}><div className="formBody"><div className="contractTemplatePage">{renderContractTemplate(previewRecord)}</div></div></ContractModal>}
  {editing&&<TemplateEditor key={editing.id} template={editing} companyName={draft.company_name} onClose={()=>setEditing(null)} onSaved={templateSaved}/>}
 </>;
}
