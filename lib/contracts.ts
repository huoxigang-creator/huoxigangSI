import {env} from './local-env';
import {z} from 'zod';
import {DEFAULT_CONTRACT_TEMPLATE} from './contract-template';
import {generateContractPdf} from './contract-pdf';
import {createEsignAdapter,configFromEnv,EsignError,type EsignEnv} from './esign';
import {identityNumberError,normalizeIdentityNumber} from './contract-identity';
import type {ContractRecord,ContractTemplate,SigningProfile,SigningConfig,ReceiptAllocation} from './contract-types';

type Row={id:string;owner:string;kind:string;project:string;data:string;created:string};
type Value=Row&{value:any};
type Deps={database:()=>D1Database|undefined;bucket:()=>R2Bucket|undefined;environment:()=>EsignEnv;adapter?:()=>ReturnType<typeof createEsignAdapter>;pdf?:typeof generateContractPdf};
export class ContractError extends Error{constructor(message:string,public status=400){super(message);}}
const identifier=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/,'记录编号无效');
const receiptIdentifier=z.string().min(1).max(1024).refine(value=>!/[\x00-\x1f\x7f]/.test(value),'收款编号无效');
const txt=(max:number)=>z.string().trim().max(max).default('');
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;},'日期不合法');
const moneyInput=z.number().finite().min(0).max(100000000).default(0);
const identityNumber=z.string().max(40).refine(value=>!identityNumberError(value),'身份证号码格式不正确，请填写18位号码，末位可为X').transform(normalizeIdentityNumber);
const inputSchema=z.object({id:z.string().uuid(),revision:z.string().uuid().optional(),project_id:identifier,title:z.string().trim().min(1).max(100),contract_type:txt(100),employee:txt(100),sign_date:date,number:txt(100),paper_number:txt(100),quote_id:txt(128),gross_amount:moneyInput,discount_amount:moneyInput,rounding_amount:moneyInput,company_name:z.string().trim().min(1).max(200),company_address:txt(500),company_phone:txt(100),customer_name:z.string().trim().min(1).max(100),customer_phone:txt(100),customer_address:txt(500),party_type:z.enum(['person','organization']).default('person'),customer_company:txt(200),customer_identity_type:z.literal('CRED_PSN_CH_IDCARD').optional(),customer_identity_number:identityNumber.optional(),template_id:identifier,special_terms:txt(10000),note:txt(5000),installments:z.array(z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(100),ratio:z.number().finite().min(0).max(100),due_date:z.union([date,z.literal('')]).default('')})).min(1).max(20)});
const templateSchema=z.object({id:z.string().uuid(),revision:z.string().uuid().optional(),name:z.string().trim().min(1).max(100),body:z.string().trim().min(1).max(60000),company_keyword:z.string().trim().min(1).max(100),customer_keyword:z.string().trim().min(1).max(100),note:txt(2000)});
const profileSchema=z.object({org_id:txt(128),seal_id:txt(128),company_name:txt(200),transactor_name:txt(100),transactor_phone:txt(100),transactor_id:txt(128)});
const ACTIVE_PARENT="EXISTS (SELECT 1 FROM records AS parent WHERE parent.id=? AND parent.owner=? AND parent.kind='project' AND COALESCE(json_extract(parent.data,'$.deleted'),0)=0)";
const immutable=(v:any)=>v.status!=='draft'&&!(v.status==='failed'&&!v.signature?.flow_id);
const cents=(v:number)=>{const n=Math.round((v+Number.EPSILON)*100);if(!Number.isSafeInteger(n))throw new ContractError('金额超出可准确计算范围');return n;};
function shown(row:Value){return {...row.value,id:row.id,project:row.project,created:row.created};}
function active(row:Value){return row.value.deleted!==true;}
export function createContractService(deps:Deps){
 function db(){const value=deps.database();if(!value)throw new ContractError('数据库尚未就绪',503);return value;}
 async function load(owner:string){if(!owner)throw new ContractError('请先登录',401);const r=await db().prepare('SELECT * FROM records WHERE owner=? ORDER BY created DESC').bind(owner).all<Row>();return r.results.map(row=>({...row,value:JSON.parse(row.data)})) as Value[];}
 function get(all:Value[],id:unknown,kind:string){const row=all.find(r=>r.id===id&&r.kind===kind&&active(r));if(!row)throw new ContractError('记录不存在、已删除或无权访问',404);return row;}
 function contract(all:Value[],id:unknown){const row=get(all,id,'contract');get(all,row.project,'project');return row;}
 function revision(row:Value,value:unknown){if(value!==row.value.revision)throw new ContractError('合同资料已变化，请刷新后重试',409);}
 function templates(all:Value[]){return [DEFAULT_CONTRACT_TEMPLATE,...all.filter(r=>r.kind==='contract_template'&&active(r)).map(shown)] as ContractTemplate[];}
 function profile(all:Value[]):SigningProfile{return all.find(r=>r.kind==='signing_profile'&&active(r))?.value||{org_id:'',seal_id:'',company_name:'',transactor_name:'',transactor_phone:'',transactor_id:''};}
 function config(all:Value[]):SigningConfig{const base=configFromEnv(deps.environment()),p=profile(all),missing=[...base.missing];if(!p.company_name)missing.push('企业签署主体');if(!p.transactor_name)missing.push('企业经办人姓名');if(!/^1\d{10}$/.test(p.transactor_phone||''))missing.push('企业经办人手机号');if(!p.seal_id)missing.push('已授权企业印章ID');return {...base,configured:missing.length===0,missing,profile:p,official_url:'https://open.esign.cn/',face_required:true};}
 async function commit(owner:string,row:Value|undefined,id:string,kind:string,project:string,data:any,action:string,extra='',extraBindings:any[]=[]){
  const now=new Date().toISOString(),value={...data,revision:crypto.randomUUID(),updated:now},serialized=JSON.stringify(value);
  const scope=kind==='contract'?' AND '+ACTIVE_PARENT:'',scopeBindings=kind==='contract'?[project,owner]:[];
  const mutation=row?db().prepare("UPDATE records SET data=? WHERE id=? AND owner=? AND kind=? AND data=? AND COALESCE(json_extract(data,'$.deleted'),0)=0"+scope+extra).bind(serialized,id,owner,kind,row.data,...scopeBindings,...extraBindings):db().prepare('INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,?'+(scope?' WHERE '+ACTIVE_PARENT:'')+extra+' ON CONFLICT(id) DO NOTHING').bind(id,owner,kind,project,serialized,now,...scopeBindings,...extraBindings);
  const results=await db().batch([mutation,db().prepare('INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,? WHERE changes()>0').bind(crypto.randomUUID(),owner,'audit',project,JSON.stringify({action,detail:action==='save_contract'?'保存合同草稿':action==='start_signing'?'发起电子签署':action==='allocate_receipts'?'关联实际收款到合同分期':action==='refresh_signing'?'同步电子签署状态':action==='confirm_offline_signed'?'确认线下已签':'更新合同资料',record_id:id,actor:owner}),now)]);
  if(!results[0].meta.changes)throw new ContractError('资料在操作期间已变化，请刷新后核对',409);
  return {...value,id,project,created:row?.created||now} as ContractRecord;
 }
 function receipts(all:Value[],row:Value){
  const value=shown(row) as ContractRecord,tx=all.filter(r=>r.kind==='transaction'&&r.project===row.project&&active(r)&&!r.value.void&&r.value.type==='收款');
  const allocation=(value.receipt_allocations||[]).filter(a=>tx.some(t=>t.id===a.transaction_id));
  const other=all.filter(r=>r.kind==='contract'&&r.project===row.project&&active(r));
  const allocated=other.flatMap(r=>r.value.receipt_allocations||[]).filter((a:ReceiptAllocation)=>tx.some(t=>t.id===a.transaction_id)).reduce((s:number,a:ReceiptAllocation)=>s+a.amount,0);
  value.installments=value.installments.map(i=>{const received=allocation.filter(a=>a.installment_id===i.id).reduce((s,a)=>s+a.amount,0);return {...i,received,remaining:i.amount-received};});
  return {...value,allocated_received:allocation.reduce((s,a)=>s+a.amount,0),unallocated_received:tx.reduce((s,t)=>s+t.value.amount,0)-allocated};
 }
 async function execute(owner:string,action:string,args:any={}){
  const all=await load(owner);
  if(action==='list_templates')return {templates:templates(all)};
  if(action==='get_signing_config'||action==='signing_config'||action==='config')return config(all);
  if(action==='list_contracts'){const p=get(all,args.project_id,'project');return {contracts:all.filter(r=>r.kind==='contract'&&r.project===p.id&&active(r)).map(r=>receipts(all,r)),templates:templates(all),signing_config:config(all),transactions:all.filter(r=>r.kind==='transaction'&&r.project===p.id&&active(r)&&r.value.type==='收款'&&!r.value.void).map(shown)};}
  if(action==='get_contract')return receipts(all,contract(all,args.id));
  if(action==='save_signing_profile'){const p=profileSchema.parse(args),old=all.find(r=>r.kind==='signing_profile'&&active(r));await commit(owner,old,old?.id||crypto.randomUUID(),'signing_profile','',p,action);return config(await load(owner));}
  if(action==='save_template'){const input=templateSchema.parse(args),old=all.find(r=>r.id===input.id);if(old){if(old.kind!=='contract_template'||!active(old))throw new ContractError('模板编号已存在或已删除',409);revision(old,input.revision);}const {id,revision:_,...data}=input;return commit(owner,old,id,'contract_template','',data,action);}
  if(action==='delete_template'){const old=get(all,args.id,'contract_template');revision(old,args.revision);return commit(owner,old,old.id,old.kind,'',{...old.value,deleted:true,deleted_at:new Date().toISOString(),deleted_by:owner},action);}
  if(action==='save_contract'){
   const input=inputSchema.parse(args),p=get(all,input.project_id,'project'),old=all.find(r=>r.id===input.id);
   if(old){if(old.kind!=='contract'||!active(old))throw new ContractError('合同编号已存在或已删除',409);if(old.project!==p.id)throw new ContractError('合同不能移动到其他项目');if(input.revision!==undefined)revision(old,input.revision);if(immutable(old.value))throw new ContractError('已签或签署中的合同不能编辑，请新建合同草稿',409);}
   const preserveTemplate=old&&old.value.template_id===input.template_id;
   const selectedTemplate=preserveTemplate?old.value.template_snapshot:templates(all).find(t=>t.id===input.template_id);if(!selectedTemplate)throw new ContractError('合同模板已删除，请重新选择');
   const preserveQuote=!!old&&old.value.quote_id===input.quote_id&&!!input.quote_id;
   const q=input.quote_id&&!preserveQuote?get(all,input.quote_id,'quote'):null;if(q&&q.project!==p.id)throw new ContractError('报价不属于当前项目');
   const quoteSnapshot=preserveQuote?old!.value.quote_snapshot:q?{...q.value,id:q.id,created:q.created}:null;
   const gross=quoteSnapshot?Number(quoteSnapshot.total):cents(input.gross_amount),discount=cents(input.discount_amount),rounding=cents(input.rounding_amount),net=gross-discount-rounding;
   if(!Number.isSafeInteger(gross)||gross<0||!Number.isSafeInteger(net)||net<0)throw new ContractError('优惠和抹零不能超过合同原价');
   const ratios=input.installments.map(i=>{const n=Math.round(i.ratio*100);if(Math.abs(n/100-i.ratio)>0.0000001)throw new ContractError('分期比例最多两位小数');return n;});
   if(ratios.reduce((s,n)=>s+n,0)!==10000||new Set(input.installments.map(i=>i.id)).size!==input.installments.length)throw new ContractError('分期比例合计必须为100%，编号不能重复');
   let allocated=0;const installments=input.installments.map((i,index)=>{const amount=index===input.installments.length-1?net-allocated:Math.floor(net*ratios[index]/10000);allocated+=amount;return {...i,amount};});
   if(input.party_type==='organization'&&!input.customer_company)throw new ContractError('请填写客户公司名称');
   const allocations:ReceiptAllocation[]=old?.value.receipt_allocations||[];if(allocations.some(a=>!installments.some(i=>i.id===a.installment_id)))throw new ContractError('有实际收款关联的分期不能删除，请先解除关联');
   for(const i of installments){const sum=allocations.filter(a=>a.installment_id===i.id&&all.some(t=>t.id===a.transaction_id&&active(t)&&!t.value.void)).reduce((s,a)=>s+a.amount,0);if(sum>i.amount)throw new ContractError('分期计划金额不能小于已关联收款');}
   const {id,revision:_,project_id:__,customer_identity_type:identityType,customer_identity_number:identityValue,...data}=input,now=new Date().toISOString();
   const number=data.number||'GMG-'+data.sign_date.replaceAll('-','')+'-'+id.slice(0,8).toUpperCase();if(all.some(r=>r.kind==='contract'&&r.id!==id&&active(r)&&r.value.number===number))throw new ContractError('合同编号已被使用');
   const guard=" AND NOT EXISTS (SELECT 1 FROM records AS other WHERE other.owner=? AND other.kind='contract' AND other.id<>? AND COALESCE(json_extract(other.data,'$.deleted'),0)=0 AND json_extract(other.data,'$.number')=?)";
   let extra=guard,bindings:any[]=[owner,id,number];if(q){extra+=" AND EXISTS (SELECT 1 FROM records AS source WHERE source.id=? AND source.owner=? AND source.kind='quote' AND source.project=? AND source.data=?)";bindings.push(q.id,owner,p.id,q.data);}const t=!preserveTemplate&&all.find(r=>r.id===selectedTemplate.id);if(t){extra+=" AND EXISTS (SELECT 1 FROM records AS template WHERE template.id=? AND template.owner=? AND template.data=?)";bindings.push(t.id,owner,t.data);}
   const identity:Pick<ContractRecord,'customer_identity_type'|'customer_identity_number'>={};
   const savedIdentityType=identityType??old?.value.customer_identity_type,savedIdentityNumber=identityValue??old?.value.customer_identity_number;
   if(savedIdentityType!==undefined)identity.customer_identity_type=savedIdentityType;
   if(savedIdentityNumber!==undefined)identity.customer_identity_number=savedIdentityNumber;
   const candidate={...data,...identity,number,gross_amount:gross,discount_amount:discount,rounding_amount:rounding,net_amount:net,installments,quote_snapshot:quoteSnapshot,template_snapshot:structuredClone(selectedTemplate),receipt_allocations:allocations,status:'draft',created:old?.value.created||old?.created||now};
   if(old&&input.revision===undefined){if(Object.entries(candidate).every(([key,value])=>JSON.stringify(value)===JSON.stringify(old.value[key])))return shown(old);throw new ContractError('相同合同编号已保存不同内容，请刷新后重新编辑',409);}
   return commit(owner,old,id,'contract',p.id,candidate,action,extra,bindings);
  }
  const old=contract(all,args.id),value=old.value as ContractRecord;
  if(action==='delete_contract'){revision(old,args.revision);if(immutable(value))throw new ContractError('签署中或已签合同不能删除');return commit(owner,old,old.id,'contract',old.project,{...value,deleted:true,deleted_at:new Date().toISOString(),deleted_by:owner},action);}
  if(action==='confirm_offline_signed'){revision(old,args.revision);if(immutable(value))throw new ContractError('请先核对当前合同状态');return commit(owner,old,old.id,'contract',old.project,{...value,status:'offline_signed',confirmed_at:new Date().toISOString()},action);}
  if(action==='allocate_receipts'){
   revision(old,args.revision);if(value.status==='preparing')throw new ContractError('正在创建签署流程，请完成后再关联收款',409);const entries=z.array(z.object({transaction_id:receiptIdentifier,installment_id:z.string().uuid(),amount:z.number().finite().positive().max(100000000)})).max(200).parse(args.allocations);
   const next=entries.map(a=>({...a,amount:cents(a.amount)}));if(new Set(next.map(a=>a.transaction_id+'/'+a.installment_id)).size!==next.length)throw new ContractError('同一分期收款不能重复关联');
   for(const i of value.installments){if(next.filter(a=>a.installment_id===i.id).reduce((s,a)=>s+a.amount,0)>i.amount)throw new ContractError('关联收款不能超过分期金额');}
   if(next.some(a=>a.amount<1||!value.installments.some(i=>i.id===a.installment_id)))throw new ContractError('分期编号或金额无效');
   let guard='',bindings:any[]=[];for(const txid of new Set(next.map(a=>a.transaction_id))){const tx=get(all,txid,'transaction');if(tx.project!==old.project||tx.value.type!=='收款'||tx.value.void)throw new ContractError('请选择当前项目有效的实际收款');const amount=next.filter(a=>a.transaction_id===txid).reduce((s,a)=>s+a.amount,0);const other=all.filter(r=>r.kind==='contract'&&r.id!==old.id&&r.project===old.project&&active(r)).flatMap(r=>r.value.receipt_allocations||[]).filter((a:ReceiptAllocation)=>a.transaction_id===txid).reduce((s:number,a:ReceiptAllocation)=>s+a.amount,0);if(other+amount>tx.value.amount)throw new ContractError('已关联金额超过该笔实际收款');
    guard+=" AND EXISTS (SELECT 1 FROM records AS receipt WHERE receipt.id=? AND receipt.owner=? AND receipt.project=? AND receipt.data=? AND receipt.kind='transaction' AND COALESCE(json_extract(receipt.data,'$.deleted'),0)=0 AND COALESCE(json_extract(receipt.data,'$.void'),0)=0 AND json_extract(receipt.data,'$.type')='收款' AND (? + COALESCE((SELECT SUM(json_extract(part.value,'$.amount')) FROM records AS c, json_each(c.data,'$.receipt_allocations') AS part WHERE c.owner=receipt.owner AND c.project=receipt.project AND c.kind='contract' AND c.id<>? AND COALESCE(json_extract(c.data,'$.deleted'),0)=0 AND json_extract(part.value,'$.transaction_id')=receipt.id),0)) <= json_extract(receipt.data,'$.amount'))";bindings.push(txid,owner,old.project,tx.data,amount,old.id);}
   return commit(owner,old,old.id,'contract',old.project,{...value,receipt_allocations:next},action,guard,bindings);
  }
  const adapter=deps.adapter?deps.adapter():createEsignAdapter({env:deps.environment()});
  if(action==='start_signing'){
   const requestId=z.string().uuid().parse(args.request_id);if(value.signature?.request_id===requestId&&value.signature.flow_id)return shown(old);revision(old,args.revision);if(immutable(value)||value.signature?.flow_id)throw new ContractError('合同已签署或存在签署流程，请先核对状态，不能重复发起',409);
   const identityValue=typeof value.customer_identity_number==='string'?value.customer_identity_number:'',identityError=identityNumberError(identityValue,true);if(identityError)throw new ContractError(identityError);
   if(value.customer_identity_type!==undefined&&value.customer_identity_type!=='CRED_PSN_CH_IDCARD')throw new ContractError('当前签署仅支持大陆身份证');
   const identityNumber=normalizeIdentityNumber(identityValue);
   const configuration=config(all);if(!configuration.configured)throw new ContractError('e签宝尚未接通，请先在配置中完成账号和企业签章设置',503);
   if(value.company_name.trim()!==configuration.profile.company_name.trim())throw new ContractError('合同乙方公司与电子签章企业不一致，请先修改合同草稿或企业签章配置');
   if(!/^1\d{10}$/.test(value.customer_phone))throw new ContractError('请填写客户真实姓名及11位签署手机号码');
   const pdf=await (deps.pdf||generateContractPdf)(shown(old) as ContractRecord),bucket=deps.bucket();if(!bucket)throw new ContractError('合同文件存储未就绪',503);
   const key=encodeURIComponent(owner)+'/'+encodeURIComponent(old.project)+'/contracts/'+old.id+'/'+requestId+'.pdf';await bucket.put(key,new Uint8Array(pdf.bytes),{httpMetadata:{contentType:'application/pdf'}});
   const started=new Date().toISOString(),signature:any={request_id:requestId,environment:configuration.environment,started_at:started,document_key:key,profile:configuration.profile};
   await commit(owner,old,old.id,'contract',old.project,{...value,status:'preparing',signature},action);
   let knownFlow:{flowId:string;fileId:string}|undefined;
   try{
    knownFlow=await adapter.createFlow({pdfBytes:pdf.bytes,pdfName:'合同-'+old.id+'.pdf',title:value.title,customer:{name:value.customer_name,phone:value.customer_phone,type:value.party_type,companyName:value.customer_company,identityNumber,identityType:'CRED_PSN_CH_IDCARD'},organization:{name:configuration.profile.company_name,orgId:configuration.profile.org_id,sealId:configuration.profile.seal_id,transactorName:configuration.profile.transactor_name,transactorPhone:configuration.profile.transactor_phone,transactorId:configuration.profile.transactor_id},positions:{customer:pdf.positions.customer,organization:pdf.positions.company},requireFace:true});
    const current=contract(await load(owner),old.id);if(current.value.signature?.request_id!==requestId||current.value.status!=='preparing')throw new ContractError('签署资料在创建期间发生变化',409);
    return await commit(owner,current,old.id,'contract',old.project,{...current.value,status:'signing',signature:{...signature,flow_id:knownFlow.flowId,file_id:knownFlow.fileId}},action);
   }catch(error){
    // Network ambiguity must never automatically create another legal signing flow.
    const definitive=!knownFlow&&error instanceof EsignError&&['INVALID_INPUT','NOT_CONFIGURED','UPLOAD_FAILED','UPLOAD_PENDING','UNSAFE_URL'].includes(error.code);
    try{const current=contract(await load(owner),old.id);if(current.value.signature?.request_id===requestId&&current.value.status==='preparing')await commit(owner,current,old.id,'contract',old.project,{...current.value,status:definitive?'failed':'uncertain',signature:{...signature,...(knownFlow?{flow_id:knownFlow.flowId,file_id:knownFlow.fileId}:{}),error:definitive?'签署准备未完成，请核对资料和配置':'发起结果尚未确认，请在e签宝后台核对，勿重复发起'}},'signing_failure');}catch{}
    throw new ContractError(knownFlow?'已创建e签宝流程（编号 '+knownFlow.flowId+'），本站保存结果待核对。请在e签宝后台核对，勿重复发起':definitive?'签署准备未完成，请核对资料和e签宝配置':'签署结果未能确认，请在e签宝后台核对，不能重复发起',502);
   }
  }
  if(action==='get_sign_url'){
   if(value.status!=='signing'||!value.signature?.flow_id)throw new ContractError('当前合同没有可签署的电子流程');if(value.signature.environment!==configFromEnv(deps.environment()).environment)throw new ContractError('电子签环境已切换，请先核对原流程');
   const role=z.enum(['customer','company']).default('customer').parse(args.role),signedProfile=(value.signature as any).profile as SigningProfile;
   const request=role==='company'?{account:signedProfile.transactor_phone,organization:{orgName:signedProfile.company_name}}:{account:value.customer_phone,...(value.party_type==='organization'?{organization:{orgName:value.customer_company}}:{})};
   if(!request.account)throw new ContractError('冻结的签署人资料不完整，请在e签宝后台核对');
   const result=await adapter.signUrl(value.signature.flow_id,request);return {url:result.url,expires_at:result.expiresAt,role};
  }
  if(action==='refresh_signing'){
   if(!value.signature?.flow_id)throw new ContractError('尚未取得电子签流程编号，请在e签宝后台核对发起结果');if(value.signature.environment!==configFromEnv(deps.environment()).environment)throw new ContractError('电子签环境已切换，请核对原流程');
   const detail=await adapter.flowDetail(value.signature.flow_id);const status=detail.status===2?'signed':detail.status===3?'cancelled':detail.status===5?'expired':detail.status===7?'rejected':'signing';
   if(['signed','cancelled','expired','rejected'].includes(value.status)){if(status!==value.status)throw new ContractError('服务商状态与已记录的终态不一致，请在e签宝后台核对',409);return shown(old);}
   // Only provider-confirmed completion marks an electronic contract signed.
   return commit(owner,old,old.id,'contract',old.project,{...value,status,signature:{...value.signature,last_checked:new Date().toISOString(),...(status==='signed'?{finished_at:detail.finishedAt?new Date(detail.finishedAt).toISOString():new Date().toISOString()}:{} )}},action);
  }
  throw new ContractError('不支持的合同操作');
 }
 async function document(owner:string,id:string,signed=false){const all=await load(owner),row=contract(all,id),record=shown(row) as ContractRecord;if(signed){if(record.status!=='signed'||!record.signature?.flow_id)throw new ContractError('合同尚未由e签宝确认签署完成');if(record.signature.environment!==configFromEnv(deps.environment()).environment)throw new ContractError('电子签环境已切换，请核对原流程');return (deps.adapter?deps.adapter():createEsignAdapter({env:deps.environment()})).downloadSignedFile(record.signature.flow_id);}
  const key=(record.signature as any)?.document_key;if(key){const object=await deps.bucket()?.get(key);if(!object)throw new ContractError('冻结的签署合同文件未找到，请核对存储',503);return new Uint8Array(await object.arrayBuffer());}return (await (deps.pdf||generateContractPdf)(record)).bytes;}
 return {execute,document};
}
const service=createContractService({database:()=>env.DB,bucket:()=>env.BUCKET,environment:()=>env as unknown as EsignEnv});
export const contractExecute=service.execute;
export const contractDocument=service.document;
