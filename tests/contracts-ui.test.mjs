import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {setImmediate as nextTurn} from 'node:timers/promises';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require=createRequire(import.meta.url),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Synthetic identity format fixture, used only in local mocked tests; it is not a real identity.
const identityFixture='00000020000101000X';
const record={customer_identity_type:'CRED_PSN_CH_IDCARD',customer_identity_number:identityFixture,id:'10000000-0000-4000-a000-000000000001',revision:'20000000-0000-4000-a000-000000000001',project:'customer-fixture',created:'2026-10-13T01:00:00Z',updated:'2026-10-13T01:00:00Z',title:'示例合同',contract_type:'销售合同',employee:'示例经办人',sign_date:'2026-10-13',number:'GMG-example',paper_number:'纸质001',quote_id:'quote-fixture',quote_snapshot:{title:'原报价'},gross_amount:500000,discount_amount:10000,rounding_amount:100,net_amount:489900,company_name:'示例公司',company_address:'示例公司地址',company_phone:'13900000000',customer_name:'示例客户',customer_phone:'13800000000',customer_address:'示例地址',party_type:'person',customer_company:'',template_id:'gugemei-sales-default',template_snapshot:{id:'gugemei-sales-default',name:'内置模板',body:'{{contract_title}}\n{{customer_name}} {{net_amount}}',company_keyword:'乙方代表（签章）：',customer_keyword:'甲方代表（签章）：',note:'',builtin:true},special_terms:'特殊约定',note:'示例备注',installments:[{id:'30000000-0000-4000-a000-000000000001',name:'合同款',ratio:100,amount:489900,due_date:'',received:10000,remaining:479900}],receipt_allocations:[],allocated_received:10000,unallocated_received:20000,status:'draft'};
const quote={id:'quote-fixture',title:'原报价',total:500000,adopted:true};
const config={configured:false,missing:['ESIGN_APP_ID'],environment:'sandbox',profile:{org_id:'',seal_id:'',company_name:'',transactor_name:'',transactor_phone:'',transactor_id:''},official_url:'https://open.esign.cn/',face_required:true};
const copy=value=>JSON.parse(JSON.stringify(value));
function harness({configured=false,contracts=[record]}={}){
 const cache=new Map(),scopes=new Map(),calls=[],contexts=new Map(),listeners=new Map();let scope,cursor,effects,serial=0,responseOverride=null,uploadFailures=0,configActive=true,focusCount=0;
 const data={contracts:copy(contracts),templates:[copy(record.template_snapshot)],signing_config:{...copy(config),configured},transactions:[{id:'receipt-fixture',type:'收款',category:'普通收款',date:'2026-10-13',amount:20000}]};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const hooks={...React,useContext(context){return contexts.has(context)?contexts.get(context):context._currentValue;},useState(initial){const i=cursor++;if(!scope[i])scope[i]={value:typeof initial==='function'?initial():initial};const slot=scope[i];return [slot.value,value=>{slot.value=typeof value==='function'?value(slot.value):value;}];},useRef(initial){const i=cursor++;if(!scope[i])scope[i]={value:{current:initial}};return scope[i].value;},useMemo(callback,deps){const i=cursor++;if(!scope[i]||!same(scope[i].deps,deps))scope[i]={value:callback(),deps};return scope[i].value;},useCallback(callback,deps){return hooks.useMemo(()=>callback,deps);},useEffect(callback,deps){const i=cursor++;if(!scope[i]||!same(scope[i].deps,deps)){const slot={deps,cleanup:scope[i]?.cleanup};scope[i]=slot;effects.push(()=>{slot.cleanup?.();slot.cleanup=callback();});}}};
 async function fetcher(url,options={}){let action,args;if(options.body instanceof FormData){action='upload_file';args={project_id:options.body.get('project_id'),contract_id:options.body.get('contract_id'),attachment_id:options.body.get('attachment_id'),name:options.body.get('file')?.name};}else if(options.method==='POST'){({action,args}=JSON.parse(options.body));}else {action='list_files';args={};}calls.push({url,action,args:copy(args)});if(responseOverride){const result=await responseOverride(action,args);if(result)return result;}let result;
  if(action==='upload_file'){if(uploadFailures-->0)return {ok:false,json:async()=>({ok:false,error:'示例附件失败'})};return {ok:true,json:async()=>({ok:true,file:{key:'file-fixture'}})};}
  if(action==='list_files')return {ok:true,json:async()=>({files:[]})};
  if(action==='list_contracts')result=data;
  else if(action==='list_templates')result={templates:data.templates};
  else if(action==='get_signing_config')result=data.signing_config;
  else if(action==='save_signing_profile'){data.signing_config.profile={...args};result=data.signing_config;}
  else if(action==='get_contract')result=data.contracts.find(value=>value.id===args.id)||record;
  else if(action==='save_contract'){const previous=data.contracts.find(value=>value.id===args.id)||record,gross=Math.round(args.gross_amount*100),discount=Math.round(args.discount_amount*100),rounding=Math.round(args.rounding_amount*100),net=gross-discount-rounding;let allocated=0;result={...copy(previous),...args,revision:'updated-fixture',updated:'2026-10-13T02:00:00Z',project:args.project_id,gross_amount:gross,discount_amount:discount,rounding_amount:rounding,net_amount:net,template_snapshot:args.template_id===previous.template_id?copy(previous.template_snapshot):copy(data.templates.find(value=>value.id===args.template_id)),installments:args.installments.map((plan,index,all)=>{const amount=index===all.length-1?net-allocated:Math.floor(net*Math.round(Number(plan.ratio)*100)/10000);allocated+=amount;return {...plan,ratio:Number(plan.ratio),amount};})};data.contracts=[result];}
  else if(action==='allocate_receipts'){result={...copy(record),revision:'updated-fixture',receipt_allocations:args.allocations.map(value=>({...value,amount:Math.round(value.amount*100)})),installments:record.installments.map(({received,remaining,...plan})=>plan)};const allocated=result.receipt_allocations.reduce((sum,row)=>sum+row.amount,0);data.contracts=[{...result,allocated_received:allocated,unallocated_received:20000-allocated,installments:result.installments.map(plan=>({...plan,received:allocated,remaining:plan.amount-allocated}))}];}
  else if(action==='start_signing'){result={...copy(record),status:'signing',signature:{flow_id:'flow-fixture'}};data.contracts=[result];}
  else if(action==='get_sign_url')result={url:'https://sign.esign.cn/fixture',expires_at:1791850000000};
  else if(action==='save_template'){result={...args,revision:'updated-template-fixture',builtin:false};data.templates=[...data.templates.filter(value=>value.id!==args.id),result];}
  else throw new Error('Unconfigured fixture action '+action);
  return {ok:true,json:async()=>({ok:true,result:copy(result)})};
 }
 const documentState={body:{style:{overflow:''}},activeElement:{isConnected:true,closest:()=>null,focus(){focusCount++;}},querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}};
 const windowState={confirm:()=>true,print(){},addEventListener(type,handler){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(handler);},removeEventListener(type,handler){listeners.get(type)?.delete(handler);}};
 function load(path){if(cache.has(path))return cache.get(path).exports;const module={exports:{}};cache.set(path,module);const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const localRequire=name=>{if(name==='./contract-pdf-viewer')return {__esModule:true,default:function ContractPdfViewer(props){return React.createElement('div',{'data-pdf-viewer':true,'data-pdf-url':props.url});}};if(name==='react')return hooks;if(name==='react-dom')return {createPortal:children=>children};if(name==='lucide-react')return new Proxy({},{get:(_target,key)=>function Icon(){return null;}});if(name.endsWith('.css'))return {};if(name==='./managed-table')return {__esModule:true,default:function ManagedTable(props){return React.createElement('table',props,props.children);}};if(name.startsWith('.')){const base=resolve(dirname(path),name),target=[base,base+'.ts',base+'.tsx'].find(existsSync);assert.ok(target,'Exists '+name);return load(target);}return require(name);};
  const evaluate=runInNewContext('(function(exports,require,module){'+code+'\n})',{console,Intl,Date,Number,String,Set,Map,Error,URL,URLSearchParams,FormData,Blob,AbortController,setTimeout,clearTimeout,fetch:fetcher,crypto:{randomUUID:()=>`90000000-0000-4000-a000-${String(++serial).padStart(12,'0')}`},document:documentState,window:windowState});evaluate(module.exports,localRequire,module);return module.exports;
 }
 function renderComponent(key,component,props){scope=scopes.get(key)||[];scopes.set(key,scope);cursor=0;effects=[];const tree=component(props);for(const effect of effects.splice(0))effect();return tree;}
 function expand(value,key='root'){if(Array.isArray(value))return value.map((child,index)=>expand(child,key+'/'+index));if(!React.isValidElement(value))return value;if(value.type?.$$typeof===Symbol.for('react.context')||value.type?.$$typeof===Symbol.for('react.provider')){const context=value.type._context||value.type,previous=contexts.get(context),had=contexts.has(context);contexts.set(context,value.props.value);const child=expand(value.props.children,key+'/provider');if(had)contexts.set(context,previous);else contexts.delete(context);return child;}if(typeof value.type==='function')return expand(renderComponent(key+'/'+value.type.name+(value.key||''),value.type,value.props),key+'/'+value.type.name);return {...value,props:{...value.props,children:expand(value.props.children,key+'/children')}};}
 const ui=load(resolve(root,'app/contracts.tsx')),Configuration=load(resolve(root,'app/contract-config.tsx')).default;
 const props={project:{id:'customer-fixture',name:'示例客户订单',customer:'示例客户',phone:'13800000000',address:'示例地址',project_type:'customer',discount_amount:10000,rounding_amount:100},quotes:[quote],companyName:'示例公司',onChanged:async()=>{},onQuote(){},onReceipt(){}};
 return {calls,data,ui,props,document:documentState,listeners,focusCalls:()=>focusCount,setConfigActive(value){configActive=value;},failUploads(number){uploadFailures=number;},override(callback){responseOverride=callback;},render(){return expand(renderComponent('workspace',ui.default,props));},renderConfig(section='合同模板'){return expand(renderComponent('config/'+section,Configuration,{section,companyName:'示例公司',active:configActive}));}};
}
function nodes(value){const list=[];function visit(node){if(Array.isArray(node))node.forEach(visit);else if(React.isValidElement(node)){list.push(node);visit(node.props.children);}}visit(value);return list;}
function text(value){if(typeof value==='string'||typeof value==='number')return String(value);if(Array.isArray(value))return value.map(text).join('');return React.isValidElement(value)?text(value.props.children):'';}
function find(tree,match,label){const result=nodes(tree).find(match);assert.ok(result,label);return result;}
const button=(tree,label)=>find(tree,node=>node.type==='button'&&text(node.props.children)===label,'Button '+label);
const input=(tree,label)=>find(tree,node=>node.props['aria-label']===label,'Input '+label);
const dialog=(tree,title)=>find(tree,node=>node.props.role==='dialog'&&node.props['aria-label']===title,'Dialog '+title);
async function ready(app){app.render();await nextTurn();return app.render();}
async function newEditor(app){let tree=await ready(app);input(tree,'新增合同').props.onClick();tree=app.render();input(tree,'签订人').props.onChange({target:{value:'示例签订人'}});return app.render();}
async function templateDialog(app){const tree=await ready(app);button(tree,'生成签订').props.onClick();return dialog(app.render(),'完善生成模板信息');}
const submit=async tree=>{find(tree,node=>node.type==='form','Form').props.onSubmit({preventDefault(){}});await nextTurn();};

test('新增合同默认关联采纳报价、明确计划100%，保存金额为元，生成id可复用',async()=>{const app=harness({contracts:[]});let tree=await newEditor(app);assert.equal(input(tree,'合同原价').props.value,'5000.00');assert.equal(input(tree,'合同优惠金额').props.value,'100.00');assert.equal(input(tree,'第1期比例').props.value,'100');assert.match(text(tree),/不代表客户已付款|实际收到款项/);await submit(tree);const saved=app.calls.find(value=>value.action==='save_contract');assert.equal(saved.args.project_id,'customer-fixture');assert.equal(saved.args.gross_amount,5000);assert.equal(saved.args.discount_amount,100);assert.equal(saved.args.rounding_amount,1);assert.equal(saved.args.installments[0].ratio,100);assert.ok(saved.args.id);assert.equal(app.calls.some(value=>value.action==='start_signing'||value.action==='record_transaction'),false);});

test('优惠不能超原价、分期不满100%会阻止保存',async()=>{const app=harness({contracts:[]});let tree=await newEditor(app);input(tree,'合同优惠金额').props.onChange({target:{value:'6000'}});tree=app.render();await submit(tree);assert.equal(app.calls.some(value=>value.action==='save_contract'),false);assert.match(text(app.render()),/不能超过合同原价/);input(app.render(),'合同优惠金额').props.onChange({target:{value:'100'}});tree=app.render();input(tree,'第1期比例').props.onChange({target:{value:'99'}});await submit(app.render());assert.equal(app.calls.some(value=>value.action==='save_contract'),false);assert.match(text(app.render()),/合计须为100%/);});

test('附件失败后只重传剩余附件，不再次创建合同',async()=>{const app=harness({contracts:[]});let tree=await newEditor(app);app.failUploads(1);const file=new Blob(['fixture'],{type:'application/pdf'});Object.defineProperty(file,'name',{value:'合同示例.pdf'});input(tree,'选择合同附件').props.onChange({target:{files:[file],value:'fixture'}});tree=app.render();await submit(tree);tree=app.render();assert.match(text(tree),/合同已保存，重试只上传剩余附件/);assert.equal(app.calls.filter(value=>value.action==='save_contract').length,1);assert.equal(button(tree,'重试上传附件').props.disabled,false);await submit(tree);assert.equal(app.calls.filter(value=>value.action==='save_contract').length,1);assert.equal(app.calls.filter(value=>value.action==='upload_file').length,2);assert.equal(app.calls.filter(value=>value.action==='upload_file')[0].args.attachment_id,app.calls.filter(value=>value.action==='upload_file')[1].args.attachment_id);});

test('历史同报价已变金额时编辑仍显示保存快照，删除来源保留快照模板选项',async()=>{const app=harness();app.props.quotes=[{...quote,total:999999}];let tree=await ready(app);button(tree,'编辑').props.onClick();tree=app.render();assert.equal(input(tree,'合同原价').props.value,'5000.00');assert.equal(input(tree,'合同模板').props.value,record.template_id);const draft=app.ui.contractDraftFor(app.props.project,'示例公司',[],record);assert.equal(draft.gross_amount,'5000.00');assert.equal(draft.quote_id,quote.id);assert.equal(draft.template_id,record.template_id);});

test('分期按整数分向下取整，末期承接尾差，与服务端算法一致',()=>{const app=harness();const plans=app.ui.installmentPreview([{id:'a',name:'一期',ratio:'33.33',due_date:''},{id:'b',name:'二期',ratio:'66.67',due_date:''}],101);assert.deepEqual(Array.from(plans,value=>value.amount),[33,68]);assert.equal(plans.reduce((sum,row)=>sum+row.amount,0),101);});

test('未配置签约时入口禁用，打开合同详情只读取合同和附件',async()=>{const app=harness();let tree=await ready(app);input(tree,'选择合同 示例合同').props.onClick();await nextTurn();tree=app.render();const detail=find(tree,node=>node.props['aria-label']==='合同详情','Inline detail');assert.equal(button(detail,'发起电子签署').props.disabled,true);assert.match(text(detail),/电子签约未配置/);assert.match(text(detail),/未关联实际收款/);assert.equal(app.calls.some(value=>value.action==='start_signing'||value.action==='get_sign_url'),false);});

test('发起电子签署需独立确认，确认前无供应商调用，禁止直接改为signed',async()=>{const app=harness({configured:true});let tree=await ready(app);input(tree,'选择合同 示例合同').props.onClick();await nextTurn();tree=app.render();button(tree,'发起电子签署').props.onClick();tree=app.render();const sign=dialog(tree,'电子签署确认');assert.match(text(sign),/示例客户/);assert.match(text(sign),/13800000000/);assert.match(text(sign),/4,899\.00/);assert.equal(button(sign,'确认发起电子签署').props.disabled,true);assert.equal(app.calls.some(value=>value.action==='start_signing'),false);input(sign,'确认合同签署信息').props.onChange({target:{checked:true}});tree=app.render();await button(dialog(tree,'电子签署确认'),'确认发起电子签署').props.onClick();await nextTurn();assert.equal(app.calls.filter(value=>value.action==='start_signing').length,1);assert.equal(app.calls.filter(value=>value.action==='get_sign_url').length,1);assert.equal(app.calls.some(value=>value.action==='confirm_offline_signed'),false);assert.equal(app.data.contracts[0].status,'signing');});

test('分期关联提交原收款id和元金额，不创建交易',async()=>{const app=harness();let tree=await ready(app);input(tree,'选择合同 示例合同').props.onClick();await nextTurn();tree=app.render();button(tree,'关联已收款').props.onClick();tree=app.render();button(dialog(tree,'关联已收款'),'添加收款关联').props.onClick();tree=app.render();input(tree,'第1条关联收款').props.onChange({target:{value:'receipt-fixture'}});input(tree,'第1条关联分期').props.onChange({target:{value:record.installments[0].id}});input(tree,'第1条关联金额').props.onChange({target:{value:'123.45'}});await submit(dialog(app.render(),'关联已收款'));const call=app.calls.find(value=>value.action==='allocate_receipts');assert.deepEqual(call.args.allocations,[{transaction_id:'receipt-fixture',installment_id:record.installments[0].id,amount:123.45}]);assert.equal(app.calls.some(value=>value.action==='record_transaction'),false);});

test('模板配置可复制内置模板、纯文本预览、保存保留模板变量',async()=>{const app=harness();app.renderConfig();await nextTurn();let tree=app.renderConfig();button(tree,'复制编辑').props.onClick();tree=app.renderConfig();assert.equal(input(tree,'模板名称').props.value,'内置模板（副本）');assert.match(text(find(tree,node=>node.props['aria-label']==='合同模板示例预览','Preview')),/定制柜体销售合同（示例）/);input(tree,'合同模板正文').props.onChange({target:{value:'{{contract_title}}\n{{customer_name}}\n{{net_amount}}'}});tree=app.renderConfig();await submit(tree);const call=app.calls.find(value=>value.action==='save_template');assert.notEqual(call.args.id,record.template_id);assert.equal(call.args.revision,undefined);assert.equal(call.args.body,'{{contract_title}}\n{{customer_name}}\n{{net_amount}}');});

test('电子签约配置只存公开企业字段，解释沙箱及IP白名单条件，不采集人脸或密钥',async()=>{const app=harness();app.renderConfig('电子签约');await nextTurn();let tree=app.renderConfig('电子签约');assert.match(text(tree),/出口 IP 白名单/);assert.match(text(tree),/API 刷脸套餐/);assert.equal(nodes(tree).some(node=>node.type==='input'&&node.props.type==='file'),false);assert.equal(nodes(tree).some(node=>node.type==='input'&&/secret|密钥/i.test(node.props['aria-label']||'')),false);input(tree,'企业经办人姓名').props.onChange({target:{value:'示例经办人'}});input(tree,'企业经办人手机').props.onChange({target:{value:'13900000000'}});input(tree,'企业印章ID').props.onChange({target:{value:'seal-fixture'}});tree=app.renderConfig('电子签约');await submit(tree);const call=app.calls.find(value=>value.action==='save_signing_profile');assert.equal(call.args.transactor_phone,'13900000000');assert.equal(call.args.transactor_name,'示例经办人');assert.equal(call.args.seal_id,'seal-fixture');assert.equal(Object.keys(call.args).some(key=>/secret/i.test(key)),false);});

test('切换企业经办人二维码仅获取company链接，展示签署时冻结信息，不重复start',async()=>{const frozen={org_id:'org-saved',seal_id:'seal-saved',company_name:'冻结公司',transactor_name:'冻结经办人',transactor_phone:'13900000001'},app=harness({configured:true,contracts:[{...record,status:'signing',signature:{flow_id:'flow-fixture',environment:'sandbox',profile:frozen}}]});let tree=await ready(app);input(tree,'选择合同 示例合同').props.onClick();await nextTurn();tree=app.render();button(tree,'手机扫码签署').props.onClick();tree=app.render();const sign=dialog(tree,'电子签署确认');assert.match(text(sign),/冻结公司/);assert.match(text(sign),/13900000001/);assert.match(text(sign),/沙箱环境，仅用于测试/);button(sign,'企业经办人扫码盖章').props.onClick();await nextTurn();tree=app.render();assert.equal(app.calls.find(value=>value.action==='get_sign_url').args.role,'company');assert.equal(app.calls.some(value=>value.action==='start_signing'),false);assert.match(text(dialog(tree,'电子签署确认')),/当前二维码：乙方企业经办人盖章/);button(dialog(tree,'电子签署确认'),'客户扫码签署').props.onClick();await nextTurn();assert.equal(app.calls.filter(value=>value.action==='get_sign_url')[1].args.role,'customer');assert.equal(app.calls.some(value=>value.action==='start_signing'),false);});

test('签署网络结果不明后读取服务器状态并阻止重复发起；沙箱signed显示测试完成',async()=>{const app=harness({configured:true});app.override(async action=>{if(action==='start_signing'){app.data.contracts=[{...copy(record),status:'uncertain',signature:{environment:'sandbox',error:'结果待核实'}}];return {ok:false,json:async()=>({ok:false,error:'结果待核实'})};}});let tree=await ready(app);input(tree,'选择合同 示例合同').props.onClick();await nextTurn();tree=app.render();button(tree,'发起电子签署').props.onClick();tree=app.render();input(tree,'确认合同签署信息').props.onChange({target:{checked:true}});tree=app.render();button(tree,'确认发起电子签署').props.onClick();await nextTurn();tree=app.render();assert.match(text(dialog(tree,'电子签署确认')),/签署状态待核实/);assert.equal(nodes(dialog(tree,'电子签署确认')).some(node=>node.type==='button'&&text(node.props.children)==='确认发起电子签署'),false);assert.equal(app.calls.filter(value=>value.action==='start_signing').length,1);assert.equal(app.calls.some(value=>value.action==='get_sign_url'),false);assert.equal(app.ui.contractStatusLabel('signed','sandbox'),'沙箱签署测试完成');assert.equal(app.ui.contractStatusLabel('rejected'),'已拒签');assert.equal(app.ui.isContractEditable({...record,status:'expired'}),false);});

test('合同页自动显示首张卡的页内详情，切卡更新内容且不弹出详情窗口，真实已签才显示角标',async()=>{const second={...record,id:'second-contract',title:'第二份合同',customer_name:'第二位示例客户',status:'offline_signed'},sandbox={...record,id:'sandbox-contract',title:'沙箱合同',status:'signed',signature:{environment:'sandbox',flow_id:'sandbox-flow'}};const app=harness({contracts:[record,second,sandbox]});let tree=await ready(app);assert.equal(input(tree,'选择合同 示例合同').props['aria-pressed'],true);assert.equal(nodes(tree).some(node=>node.props.role==='dialog'),false);let detail=find(tree,node=>node.props['aria-label']==='合同详情','Inline detail');assert.match(text(detail),/特殊约定/);assert.equal(nodes(input(tree,'选择合同 示例合同')).some(node=>node.props.className==='contractSignedRibbon'),false);assert.equal(nodes(input(tree,'选择合同 第二份合同')).some(node=>node.props.className==='contractSignedRibbon'),true);assert.equal(nodes(input(tree,'选择合同 沙箱合同')).some(node=>node.props.className==='contractSignedRibbon'),false);input(tree,'选择合同 第二份合同').props.onClick();await nextTurn();tree=app.render();assert.equal(input(tree,'选择合同 第二份合同').props['aria-pressed'],true);assert.equal(input(tree,'选择合同 示例合同').props['aria-pressed'],false);detail=find(tree,node=>node.props['aria-label']==='合同详情','Inline detail');assert.match(text(detail),/第二位示例客户/);assert.equal(button(detail,'编辑').props.disabled,true);assert.equal(button(detail,'删除').props.disabled,true);assert.equal(nodes(tree).some(node=>node.props.role==='dialog'),false);assert.ok(find(detail,node=>node.props.className==='contractDetails','Two column details'));assert.ok(find(detail,node=>node.props.className==='paymentVouchers'||node.props.className==='contractAttachmentPicker','Inline attachments'));});

test('关联收款保存后详情使用刷新列表的计算实收金额，打印继续打开PDF窗口',async()=>{const app=harness();let tree=await ready(app);button(tree,'关联已收款').props.onClick();tree=app.render();button(dialog(tree,'关联已收款'),'添加收款关联').props.onClick();tree=app.render();input(tree,'第1条关联收款').props.onChange({target:{value:'receipt-fixture'}});input(tree,'第1条关联分期').props.onChange({target:{value:record.installments[0].id}});input(tree,'第1条关联金额').props.onChange({target:{value:'123.45'}});await submit(dialog(app.render(),'关联已收款'));tree=app.render();const detail=find(tree,node=>node.props['aria-label']==='合同详情','Inline detail'),table=find(detail,node=>node.props.tableKey==='contracts/installments','Installment table');assert.match(text(table),/¥123\.45/);assert.match(text(table),/¥4,775\.55/);assert.match(text(detail),/已关联实收：¥123\.45/);button(tree,'打印').props.onClick();tree=app.render();const preview=dialog(tree,'合同预览 · 示例合同');assert.ok(find(preview,node=>node.props['data-pdf-viewer']&&node.props['data-pdf-url'].includes('document=1'),'Rendered PDF viewer'));assert.equal(nodes(tree).filter(node=>node.props.role==='dialog').length,1);});

test('切换工作页签保留合同草稿，隐藏时释放滚动和Escape且不抢焦点，返回后仅保存一次',async()=>{const app=harness({contracts:[]});let tree=await newEditor(app);input(tree,'合同名称').props.onChange({target:{value:'切换后继续的合同'}});tree=app.render();assert.equal(app.document.body.style.overflow,'hidden');assert.equal(app.listeners.get('keydown').size,1);const calls=app.calls.length,focus=app.focusCalls();app.props.active=false;tree=app.render();assert.equal(app.document.body.style.overflow,'');assert.equal(app.listeners.get('keydown').size,0);assert.equal(app.focusCalls(),focus);assert.equal(input(tree,'合同名称').props.value,'切换后继续的合同');assert.equal(app.calls.length,calls);app.props.active=true;tree=app.render();assert.equal(app.document.body.style.overflow,'hidden');assert.equal(app.listeners.get('keydown').size,1);assert.equal(input(tree,'合同名称').props.value,'切换后继续的合同');await submit(dialog(tree,'新增合同'));assert.equal(app.calls.filter(value=>value.action==='save_contract').length,1);assert.equal(app.calls.find(value=>value.action==='save_contract').args.title,'切换后继续的合同');});

test('合同模板隐藏时保留名称和正文草稿，不响应其他页签Escape，返回继续保存',async()=>{const app=harness();app.renderConfig();await nextTurn();let tree=app.renderConfig();button(tree,'复制编辑').props.onClick();tree=app.renderConfig();input(tree,'模板名称').props.onChange({target:{value:'切换保留的模板'}});input(tree,'合同模板正文').props.onChange({target:{value:'{{contract_title}}\n新草稿正文'}});tree=app.renderConfig();assert.equal(app.listeners.get('keydown').size,1);app.setConfigActive(false);tree=app.renderConfig();assert.equal(app.listeners.get('keydown').size,0);assert.equal(app.document.body.style.overflow,'');assert.equal(input(tree,'模板名称').props.value,'切换保留的模板');assert.equal(input(tree,'合同模板正文').props.value,'{{contract_title}}\n新草稿正文');app.setConfigActive(true);tree=app.renderConfig();assert.equal(app.listeners.get('keydown').size,1);await submit(dialog(tree,'新增合同模板'));assert.equal(app.calls.find(value=>value.action==='save_template').args.name,'切换保留的模板');assert.equal(app.calls.find(value=>value.action==='save_template').args.body,'{{contract_title}}\n新草稿正文');});

test('新增及编辑合同使用窄竖排弹窗，编辑保留原字段值和金额',async()=>{
 const create=harness({contracts:[]});let tree=await newEditor(create);
 assert.match(dialog(tree,'新增合同').props.className,/(?:^|\s)contractVerticalModal(?:\s|$)/);
 const edit=harness();tree=await ready(edit);button(tree,'编辑').props.onClick();tree=edit.render();
 assert.match(dialog(tree,'编辑合同').props.className,/(?:^|\s)contractVerticalModal(?:\s|$)/);
 assert.equal(input(tree,'合同名称').props.value,record.title);assert.equal(input(tree,'签订人').props.value,record.employee);
 assert.equal(input(tree,'纸质合同编号').props.value,record.paper_number);assert.equal(input(tree,'特殊条款').props.value,record.special_terms);
 assert.equal(input(tree,'合同备注').props.value,record.note);assert.equal(input(tree,'合同原价').props.value,'5000.00');
 assert.equal(input(tree,'合同优惠金额').props.value,'100.00');assert.equal(input(tree,'合同抹零金额').props.value,'1.00');
});

test('生成签订打开截图同名竖排弹窗，栏目、字段及四个底部按钮顺序逐字一致',async()=>{
 const app=harness(),tree=await templateDialog(app);
 assert.match(tree.props.className,/(?:^|\s)contractVerticalModal(?:\s|$)/);assert.match(tree.props.className,/(?:^|\s)contractGenerateModal(?:\s|$)/);
 assert.deepEqual(nodes(tree).filter(node=>node.type==='h3').map(node=>text(node)),['模板信息','实名认证','追加报价']);
 assert.deepEqual(nodes(tree).filter(node=>['input','select'].includes(node.type)).map(node=>node.props['aria-label']),['模板','签约主体','主体印章','公司','个人','真实姓名','电话号码','证件类型','证件号码','报价名称']);
 const footer=find(tree,node=>node.props.className==='modalFoot','Generator footer');
 assert.deepEqual(nodes(footer).filter(node=>node.type==='button').map(node=>text(node)),['取消','编辑模板','预览模板','确认生成模板']);
 assert.equal(input(tree,'个人').props.checked,true);assert.equal(input(tree,'公司').props.checked,false);
 assert.equal(input(tree,'真实姓名').props.value,record.customer_name);assert.equal(input(tree,'电话号码').props.value,record.customer_phone);
 assert.equal(text(input(tree,'证件类型')),'大陆身份证');assert.equal(app.calls.some(call=>call.action==='save_contract'),false);
});

test('模板预览替换本合同字段且保留冻结正文，不写入合同、不声称实名完成',async()=>{
 const app=harness();app.data.templates[0].body='实时模板已改动，不能替换保存时条款';let tree=await templateDialog(app);
 input(tree,'真实姓名').props.onChange({target:{value:'本次示例签署人'}});tree=app.render();const before=app.calls.length;
 button(dialog(tree,'完善生成模板信息'),'预览模板').props.onClick();tree=app.render();
 const preview=dialog(tree,'预览模板');assert.match(text(preview),/示例合同/);assert.match(text(preview),/本次示例签署人/);
 assert.doesNotMatch(text(preview),/实时模板已改动/);assert.doesNotMatch(text(tree),/已完成实名认证|实名认证成功|已通过人脸识别/);
 assert.deepEqual(app.calls.slice(before),[]);assert.equal(app.calls.some(call=>['save_contract','save_template','start_signing','record_transaction','confirm_offline_signed'].includes(call.action)),false);
 button(preview,'关闭').props.onClick();tree=app.render();assert.equal(input(dialog(tree,'完善生成模板信息'),'真实姓名').props.value,'本次示例签署人');
});

test('未配置电子签约也能确认生成PDF，身份与旧财务条款保存，不签署或新收款',async()=>{
 const app=harness();let tree=await templateDialog(app);assert.equal(input(tree,'主体印章').props.disabled,true);
 assert.equal(button(tree,'确认生成模板').props.disabled,false);
 input(tree,'真实姓名').props.onChange({target:{value:'更正后的示例姓名'}});input(tree,'电话号码').props.onChange({target:{value:'13800000001'}});
 input(tree,'证件号码').props.onChange({target:{value:' 00000020000101000x '}});tree=app.render();await submit(dialog(tree,'完善生成模板信息'));tree=app.render();
 const saved=app.calls.filter(call=>call.action==='save_contract');assert.equal(saved.length,1);const args=saved[0].args;
 assert.equal(args.id,record.id);assert.equal(args.revision,record.revision);assert.equal(args.project_id,record.project);
 assert.equal(args.customer_name,'更正后的示例姓名');assert.equal(args.customer_phone,'13800000001');assert.equal(args.customer_identity_type,'CRED_PSN_CH_IDCARD');assert.equal(args.customer_identity_number,identityFixture);
 assert.equal(args.gross_amount,5000);assert.equal(args.discount_amount,100);assert.equal(args.rounding_amount,1);
 assert.equal(args.special_terms,record.special_terms);assert.equal(args.note,record.note);assert.equal(args.paper_number,record.paper_number);assert.equal(args.employee,record.employee);
 assert.deepEqual(args.installments,record.installments.map(({id,name,ratio,due_date})=>({id,name,ratio,due_date})));
 assert.equal(app.data.contracts[0].revision,'updated-fixture');assert.equal(app.data.contracts[0].net_amount,record.net_amount);assert.equal(app.data.contracts[0].status,'draft');
 const pdf=dialog(tree,'合同预览 · '+record.title),viewer=find(pdf,node=>node.props['data-pdf-viewer'],'Generated PDF viewer');
 assert.equal(viewer.props['data-pdf-url'],'/api/contracts?id='+record.id+'&document=1');
 assert.equal(app.calls.some(call=>['start_signing','get_sign_url','record_transaction','allocate_receipts','confirm_offline_signed'].includes(call.action)),false);
});

test('公司签约生成要求公司名，切换和清空字段后仍按真实输入保存',async()=>{
 const app=harness();let tree=await templateDialog(app);input(tree,'公司').props.onChange();tree=app.render();
 let form=dialog(tree,'完善生成模板信息');assert.equal(input(form,'公司').props.checked,true);assert.equal(input(form,'个人').props.checked,false);
 await submit(form);tree=app.render();assert.match(text(dialog(tree,'完善生成模板信息')),/请填写签约公司名称/);assert.equal(app.calls.some(call=>call.action==='save_contract'),false);
 input(tree,'签约公司名称').props.onChange({target:{value:'示例企业客户'}});input(tree,'证件号码').props.onChange({target:{value:'旧示例证件'}});tree=app.render();
 input(tree,'清空真实姓名').props.onClick();input(tree,'清空证件号码').props.onClick();tree=app.render();
 assert.equal(input(tree,'真实姓名').props.value,'');assert.equal(input(tree,'证件号码').props.value,'');
 await submit(dialog(tree,'完善生成模板信息'));tree=app.render();assert.equal(app.calls.some(call=>call.action==='save_contract'),false);
 input(tree,'真实姓名').props.onChange({target:{value:'示例企业经办人'}});input(tree,'证件号码').props.onChange({target:{value:identityFixture}});await submit(dialog(app.render(),'完善生成模板信息'));
 const saved=app.calls.find(call=>call.action==='save_contract');assert.equal(saved.args.party_type,'organization');assert.equal(saved.args.customer_company,'示例企业客户');assert.equal(saved.args.customer_name,'示例企业经办人');assert.equal(saved.args.customer_identity_number,identityFixture);
});

test('模板编辑另建副本，新ID的正文应用于生成且原模板与合同冻结正文不改变',async()=>{
 const app=harness();let tree=await templateDialog(app);button(tree,'编辑模板').props.onClick();tree=app.render();
 const editor=dialog(tree,'新增合同模板');assert.equal(input(editor,'模板名称').props.value,'内置模板（副本）');
 input(editor,'合同模板正文').props.onChange({target:{value:'显式修改的副本条款\n{{customer_name}}'}});await submit(dialog(app.render(),'新增合同模板'));tree=app.render();
 const templateCall=app.calls.find(call=>call.action==='save_template');assert.notEqual(templateCall.args.id,record.template_id);assert.equal(templateCall.args.revision,undefined);
 assert.equal(app.data.templates.find(value=>value.id===record.template_id).body,record.template_snapshot.body);
 assert.equal(app.data.contracts[0].template_snapshot.body,record.template_snapshot.body);
 let generator=dialog(tree,'完善生成模板信息');assert.equal(input(generator,'模板').props.value,templateCall.args.id);
 button(generator,'预览模板').props.onClick();tree=app.render();assert.match(text(dialog(tree,'预览模板')),/显式修改的副本条款/);
 button(dialog(tree,'预览模板'),'关闭').props.onClick();await submit(dialog(app.render(),'完善生成模板信息'));tree=app.render();
 assert.equal(app.calls.find(call=>call.action==='save_contract').args.template_id,templateCall.args.id);
 assert.equal(app.data.contracts[0].template_snapshot.body,'显式修改的副本条款\n{{customer_name}}');
 assert.equal(app.calls.some(call=>call.action==='start_signing'),false);
});

test('追加报价金额重新计算但优惠与分期保持，重复确认生成仅保存一次',async()=>{
 const app=harness();app.props.quotes.push({id:'quote-next',title:'新增示例报价',total:600050});let tree=await templateDialog(app);
 input(tree,'报价名称').props.onChange({target:{value:'quote-next'}});tree=app.render();const form=dialog(tree,'完善生成模板信息');
 const event={preventDefault(){}};find(form,node=>node.type==='form','Generator form').props.onSubmit(event);find(form,node=>node.type==='form','Generator form').props.onSubmit(event);await nextTurn();tree=app.render();
 const saved=app.calls.filter(call=>call.action==='save_contract');assert.equal(saved.length,1);assert.equal(saved[0].args.quote_id,'quote-next');assert.equal(saved[0].args.gross_amount,6000.5);
 assert.equal(saved[0].args.discount_amount,100);assert.equal(saved[0].args.rounding_amount,1);assert.equal(app.data.contracts[0].net_amount,589950);
 assert.equal(app.data.contracts[0].installments[0].amount,589950);assert.ok(dialog(tree,'合同预览 · '+record.title));
 assert.equal(app.calls.some(call=>['start_signing','record_transaction','allocate_receipts'].includes(call.action)),false);
});

test('新增草稿允许身份证留空，已填格式错误阻止保存，正规化号码会保存并回填生成弹窗',async()=>{
 const app=harness({contracts:[]});let tree=await newEditor(app);
 assert.equal(input(tree,'甲方证件类型').props.value,'CRED_PSN_CH_IDCARD');assert.equal(input(tree,'甲方身份证号码').props.value,'');
 input(tree,'甲方身份证号码').props.onChange({target:{value:'not-an-id'}});await submit(dialog(app.render(),'新增合同'));
 assert.match(text(dialog(app.render(),'新增合同')),/身份证号码格式不正确/);assert.equal(app.calls.some(call=>call.action==='save_contract'),false);
 input(app.render(),'甲方身份证号码').props.onChange({target:{value:' 00000020000101000x '}});tree=app.render();assert.equal(input(tree,'甲方身份证号码').props.value,identityFixture);
 await submit(dialog(tree,'新增合同'));tree=app.render();const saved=app.calls.find(call=>call.action==='save_contract');
 assert.equal(saved.args.customer_identity_type,'CRED_PSN_CH_IDCARD');assert.equal(saved.args.customer_identity_number,identityFixture);
 const detail=find(tree,node=>node.props['aria-label']==='合同详情','Inline detail');assert.match(text(detail),/000\*{11}000X/);assert.doesNotMatch(text(detail),new RegExp(identityFixture));
 button(tree,'生成签订').props.onClick();tree=app.render();assert.equal(input(dialog(tree,'完善生成模板信息'),'证件号码').props.value,identityFixture);
 assert.equal(app.calls.some(call=>call.action==='start_signing'),false);
 const blank=harness({contracts:[]});tree=await newEditor(blank);await submit(dialog(tree,'新增合同'));
 assert.equal(blank.calls.find(call=>call.action==='save_contract').args.customer_identity_number,'');
});

test('编辑合同回填身份证，企业经办人使用同一证件字段，原金额及详情结构保留',async()=>{
 const app=harness();let tree=await ready(app);button(tree,'编辑').props.onClick();tree=app.render();
 assert.equal(input(tree,'甲方身份证号码').props.value,identityFixture);
 input(tree,'甲方类型').props.onChange({target:{value:'organization'}});tree=app.render();
 assert.equal(input(tree,'甲方经办人身份证号码').props.value,identityFixture);input(tree,'甲方企业名称').props.onChange({target:{value:'示例企业'}});
 await submit(dialog(app.render(),'编辑合同'));tree=app.render();
 const call=app.calls.find(value=>value.action==='save_contract');assert.equal(call.args.customer_identity_number,identityFixture);assert.equal(call.args.gross_amount,5000);assert.equal(call.args.discount_amount,100);
 const detail=find(tree,node=>node.props['aria-label']==='合同详情','Inline detail');assert.ok(find(detail,node=>node.props.className==='contractInlineToolbar','Kept toolbar'));
 assert.ok(find(detail,node=>node.props.className==='contractSigningPanel','Kept signing panel'));assert.ok(find(detail,node=>node.props.tableKey==='contracts/installments','Kept receipt table'));
});

test('生成模板缺身份证或格式错误不会保存，空号码仍可只预览，企业经办人也必须填写',async()=>{
 const app=harness({contracts:[{...record,customer_identity_number:''}]});let tree=await templateDialog(app);
 await submit(tree);tree=app.render();assert.match(text(dialog(tree,'完善生成模板信息')),/请填写签署人的身份证号码/);assert.equal(app.calls.some(call=>call.action==='save_contract'),false);
 const before=app.calls.length;button(dialog(tree,'完善生成模板信息'),'预览模板').props.onClick();tree=app.render();assert.ok(dialog(tree,'预览模板'));assert.deepEqual(app.calls.slice(before),[]);
 button(dialog(tree,'预览模板'),'关闭').props.onClick();tree=app.render();input(tree,'证件号码').props.onChange({target:{value:'123'}});await submit(dialog(app.render(),'完善生成模板信息'));
 assert.match(text(dialog(app.render(),'完善生成模板信息')),/身份证号码格式不正确/);assert.equal(app.calls.some(call=>call.action==='save_contract'),false);
 input(app.render(),'公司').props.onChange();tree=app.render();input(tree,'签约公司名称').props.onChange({target:{value:'示例企业'}});input(tree,'证件号码').props.onChange({target:{value:''}});
 await submit(dialog(app.render(),'完善生成模板信息'));assert.match(text(dialog(app.render(),'完善生成模板信息')),/请填写签署人的身份证号码/);assert.equal(app.calls.some(call=>call.action==='save_contract'),false);
});

test('旧合同缺身份证先提示编辑，签署确认完整显示已填号码且缺号不可发起',async()=>{
 const missing=harness({configured:true,contracts:[{...record,customer_identity_number:''}]});let tree=await ready(missing);button(tree,'发起电子签署').props.onClick();tree=missing.render();
 let sign=dialog(tree,'电子签署确认');assert.match(text(sign),/请先编辑合同/);assert.match(text(sign),/请填写签署人的身份证号码/);assert.equal(input(sign,'确认合同签署信息').props.disabled,true);
 input(sign,'确认合同签署信息').props.onChange({target:{checked:true}});sign=dialog(missing.render(),'电子签署确认');assert.equal(button(sign,'确认发起电子签署').props.disabled,true);
 button(sign,'确认发起电子签署').props.onClick();await nextTurn();assert.equal(missing.calls.some(call=>['start_signing','get_sign_url'].includes(call.action)),false);
 const complete=harness({configured:true});tree=await ready(complete);button(tree,'发起电子签署').props.onClick();sign=dialog(complete.render(),'电子签署确认');
 assert.match(text(sign),/大陆身份证/);assert.match(text(sign),new RegExp(identityFixture));assert.equal(complete.calls.some(call=>call.action==='start_signing'),false);
});

test('合同数字完成后补空白分期，空行不强制填写且保存不计入分期',async()=>{const app=harness({contracts:[]});let tree=await newEditor(app);input(tree,'第1期比例').props.onBlur();tree=app.render();assert.equal(input(tree,'第2期名称').props.required,false);assert.equal(input(tree,'第2期比例').props.required,false);assert.equal(input(tree,'第2期比例').props.value,'');input(tree,'第1期比例').props.onBlur();tree=app.render();assert.equal(nodes(tree).filter(node=>node.type==='input'&&/^第\d+期比例$/.test(node.props['aria-label']||'')).length,2);await submit(tree);const saved=app.calls.find(value=>value.action==='save_contract');assert.equal(saved.args.installments.length,1);assert.equal(saved.args.installments[0].ratio,100);});
