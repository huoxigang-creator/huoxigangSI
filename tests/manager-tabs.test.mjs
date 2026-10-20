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
const projects=[
 {id:'a',name:'云顶',customer:'客户甲',project_type:'project',created:'2026-10-13T01:00:00Z',status:'设计中',contract:10000,received:0,paid:0},
 {id:'b',name:'张雪',customer:'客户乙',project_type:'project',created:'2026-10-13T01:00:00Z',status:'生产中',contract:20000,received:0,paid:0},
 {id:'c',name:'终端家庭',customer:'客户丙',project_type:'customer',created:'2026-10-13T01:00:00Z',status:'设计中',contract:30000,received:0,paid:0},
 {id:'d',name:'次订单',customer:'客户甲',parent_id:'a',project_type:'project',created:'2026-10-13T01:00:00Z',status:'洽谈中',contract:0,received:0,paid:0},
];
const copy=value=>structuredClone(value);
const text=value=>typeof value==='string'||typeof value==='number'?String(value):Array.isArray(value)?value.map(text).join(''):React.isValidElement(value)?text(value.props.children):'';
function elements(value,{visible=false}={}){const result=[];function visit(node,hidden=false){if(Array.isArray(node)){node.forEach(child=>visit(child,hidden));return;}if(!React.isValidElement(node))return;hidden=hidden||node.props.hidden||node.props['aria-hidden']===true||node.props['aria-hidden']==='true'||node.props.style?.display==='none';if(!visible||!hidden)result.push(node);visit(node.props.children,hidden);}visit(value);return result;}
function find(tree,match,label,visible=true){const node=elements(tree,{visible}).find(match);assert.ok(node,label);return node;}
const button=(tree,label)=>find(tree,node=>node.type==='button'&&text(node)===label,'Button '+label);
const field=(tree,label,visible=true)=>find(tree,node=>node.type==='input'&&node.props['aria-label']===label,'Input '+label,visible);
const workspace=tree=>find(tree,node=>node.props['aria-label']==='工作空间导航','Workspace navigation');
const workspaceTabs=tree=>elements(workspace(tree)).filter(node=>node.props.role==='tab');
const tab=(tree,label)=>workspaceTabs(tree).find(node=>text(node)===label);
const selectedTab=tree=>workspaceTabs(tree).find(node=>node.props['aria-selected']);
const projectTool=(tree,label)=>button(find(tree,node=>node.props.className==='projectToolbar','Project toolbar'),label);

// Execute real Manager handlers, retaining child component state by React keys.
// Child editors are local state probes; their own real draft behavior has separate tests.
function harness(){
 const cache=new Map(),scopes=new Map(),contexts=new Map(),typeIds=new WeakMap(),requests=[],editorProps={quotes:new Map(),contracts:new Map()},controls={workspace:{projects:copy(projects),quotes:projects.map(p=>({id:'q-'+p.id,project:p.id,title:p.name+'报价',total:p.contract,adopted:false,items:[]})),transactions:[],tasks:[],logs:[],reminder_scope:'owner-alice'}};
 let scope,cursor,effects,serial=0,componentSerial=0,visited;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const hooks={...React,useState(initial){const i=cursor++;if(!scope[i])scope[i]={value:typeof initial==='function'?initial():initial};const slot=scope[i];return [slot.value,value=>{slot.value=typeof value==='function'?value(slot.value):value;}];},useRef(initial){const i=cursor++;if(!scope[i])scope[i]={value:{current:initial}};return scope[i].value;},useMemo(callback,deps){const i=cursor++;if(!scope[i]||!same(scope[i].deps,deps))scope[i]={value:callback(),deps};return scope[i].value;},useCallback(callback,deps){return hooks.useMemo(()=>callback,deps);},useContext(context){return contexts.has(context)?contexts.get(context):context._currentValue;},useEffect(callback,deps){const i=cursor++;if(!scope[i]||!same(scope[i].deps,deps)){const old=scope[i];scope[i]={deps};effects.push(()=>{old?.cleanup?.();scope[i].cleanup=callback();});}}};
 function QuoteProbe(props){editorProps.quotes.set(props.projectId,props);const [draft,setDraft]=hooks.useState('');return React.createElement('input',{'aria-label':'报价草稿 '+props.projectId,value:draft,onChange:event=>setDraft(event.target.value)});}
 function ContractProbe(props){editorProps.contracts.set(props.project.id,props);const [draft,setDraft]=hooks.useState('');return React.createElement('div',{className:'contractWorkspace'},React.createElement('input',{'aria-label':'合同草稿 '+props.project.id,value:draft,onChange:event=>setDraft(event.target.value)}),React.createElement('button',{onClick:props.onSigningConfig},'前往电子签约配置'));}
 function ConfigProbe(props){const [draft,setDraft]=hooks.useState('');return React.createElement('input',{'aria-label':'配置草稿 '+(props.section||props.expenseCategory),value:draft,onChange:event=>setDraft(event.target.value)});}
 const Null=()=>null,TableProvider=props=>props.children,TableProbe=props=>React.createElement('table',props,props.children);
 const lists={ProjectList:props=>React.createElement('div',{},props.items.map(p=>React.createElement('button',{key:p.id,onClick:()=>props.onSelect(p)},'打开 '+p.name))),TaskList:Null,TransactionList:Null};
 const stubs={'./project-files':{default:Null},'./manager-lists':lists,'./quote-workspace':{default:QuoteProbe},'./customer-settlement':{default:Null,CustomerSettlementSummary:()=>React.createElement('div',{'data-settlement':true},'客户结算')},'./managed-table':{default:TableProbe,TablePreferencesProvider:TableProvider},'./task-reminders':{default:Null},'./configuration':{default:ConfigProbe},'./contracts':{default:ContractProbe},'./contract-config':{default:ConfigProbe},'./purchase-orders':{default:Null},'./trash':{default:Null},'./payment-details':{PaymentDetailsEditor:Null},'./payment-vouchers':{default:Null,VoucherPicker:Null},'./legacy-hardware-trash':{default:Null}};
 async function fetcher(url,options){const body=JSON.parse(options.body);requests.push({url,...body});if(url==='/api/catalog')return {ok:true,json:async()=>({ok:true,result:{company:{name:'示例公司'},materials:[]}})};return {ok:true,status:200,json:async()=>({ok:true,result:copy(controls.workspace)})};}
 function load(path){if(cache.has(path))return cache.get(path).exports;const module={exports:{}};cache.set(path,module);const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const localRequire=name=>{if(name==='react')return hooks;if(name==='lucide-react')return new Proxy({},{get:()=>Null});if(stubs[name])return {...stubs[name],__esModule:true};if(name.endsWith('.css'))return {};if(name.startsWith('.')){const base=resolve(dirname(path),name),target=[base,base+'.ts',base+'.tsx'].find(existsSync);assert.ok(target,'Module '+name);return load(target);}return require(name);};
  const evaluate=runInNewContext('(function(exports,require,module){'+code+'\n})',{console,Intl,Date,Number,String,Set,Map,Error,Object,FormData,Blob,URL,fetch:fetcher,setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},window:{confirm:()=>true},document:{body:{style:{}}},crypto:{randomUUID:()=>`90000000-0000-4000-a000-${String(++serial).padStart(12,'0')}`}});evaluate(module.exports,localRequire,module);return module.exports;
 }
 const Manager=load(resolve(root,'app/manager.tsx')).default;
 function renderComponent(key,component,props){scope=scopes.get(key)||[];scopes.set(key,scope);visited.add(key);cursor=0;effects=[];const tree=component(props);for(const effect of effects.splice(0))effect();return tree;}
 function expand(value,key='root'){if(Array.isArray(value))return value.map((child,index)=>expand(child,key+'/'+(React.isValidElement(child)&&child.key!==null?child.key:index)));if(!React.isValidElement(value))return value;if(typeof value.type==='function'){if(!typeIds.has(value.type))typeIds.set(value.type,++componentSerial);return expand(renderComponent(key+'/'+typeIds.get(value.type),value.type,value.props),key+'/output');}if(value.type?.$$typeof===Symbol.for('react.context')){const context=value.type,prior=contexts.get(context),exists=contexts.has(context);contexts.set(context,value.props.value);const tree=expand(value.props.children,key+'/context');if(exists)contexts.set(context,prior);else contexts.delete(context);return tree;}return {...value,props:{...value.props,children:expand(value.props.children,key+'/children')}};}
 function render(){visited=new Set();const tree=expand(renderComponent('manager',Manager,{}));for(const [key,slots] of scopes)if(!visited.has(key)){slots.forEach(slot=>slot?.cleanup?.());scopes.delete(key);}return tree;}
 return {render,controls,requests,editorProps};
}
async function ready(app){app.render();await nextTurn();return app.render();}
function clickWorkspace(app,label){const tree=app.render(),node=tab(tree,label);assert.ok(node,'Workspace tab '+label);node.props.onClick();return app.render();}
function openProject(app,name){clickWorkspace(app,name==='终端家庭'?'我的客户':'我的项目');button(app.render(),'打开 '+name).props.onClick();return app.render();}
function chooseTool(app,name){projectTool(app.render(),name).props.onClick();return app.render();}
function close(app,label){find(workspace(app.render()),node=>node.props['aria-label']==='关闭 '+label,'Close '+label).props.onClick();return app.render();}

test('打开多个项目和客户有各自活动页签，同一id重复打开复用；固定列表入口继续可用',async()=>{
 const app=harness();await ready(app);openProject(app,'云顶');openProject(app,'张雪');openProject(app,'终端家庭');
 assert.deepEqual(workspaceTabs(app.render()).map(text),['首页','今日待办','我的项目','我的客户','项目：云顶','项目：张雪','客户：终端家庭']);assert.equal(text(selectedTab(app.render())),'客户：终端家庭');
 openProject(app,'云顶');assert.equal(workspaceTabs(app.render()).length,7);assert.equal(text(selectedTab(app.render())),'项目：云顶');
 clickWorkspace(app,'我的客户');assert.equal(text(selectedTab(app.render())),'我的客户');assert.equal(workspaceTabs(app.render()).length,7);
 assert(app.requests.every(request=>['get_workspace','get_catalog'].includes(request.action)));
});

test('每项目分别记住功能栏目，切回原项目恢复报价/合同，并明确hidden active状态',async()=>{
 const app=harness();await ready(app);openProject(app,'云顶');chooseTool(app,'报价');openProject(app,'张雪');chooseTool(app,'合同');openProject(app,'终端家庭');chooseTool(app,'报价');
 clickWorkspace(app,'项目：云顶');assert.equal(projectTool(app.render(),'报价').props['aria-selected'],true);assert.equal(app.editorProps.quotes.get('a').active,true);assert.equal(app.editorProps.quotes.get('c').active,false);assert.equal(app.editorProps.contracts.get('b').active,false);
 clickWorkspace(app,'项目：张雪');assert.equal(projectTool(app.render(),'合同').props['aria-selected'],true);clickWorkspace(app,'客户：终端家庭');assert.equal(projectTool(app.render(),'报价').props['aria-selected'],true);
 assert.equal(elements(app.render(),{visible:true}).filter(node=>node.props.role==='tabpanel').length,1);
});

test('切换项目、列表和同项目功能栏保留未保存报价与合同状态，彼此草稿不串户',async()=>{
 const app=harness();await ready(app);openProject(app,'云顶');chooseTool(app,'报价');field(app.render(),'报价草稿 a').props.onChange({target:{value:'甲未保存报价'}});chooseTool(app,'合同');field(app.render(),'合同草稿 a').props.onChange({target:{value:'甲未保存合同'}});
 openProject(app,'张雪');chooseTool(app,'报价');field(app.render(),'报价草稿 b').props.onChange({target:{value:'乙未保存报价'}});clickWorkspace(app,'首页');clickWorkspace(app,'项目：云顶');assert.equal(field(app.render(),'合同草稿 a').props.value,'甲未保存合同');
 chooseTool(app,'报价');assert.equal(field(app.render(),'报价草稿 a').props.value,'甲未保存报价');assert.equal(field(app.render(),'报价草稿 b',false).props.value,'乙未保存报价');clickWorkspace(app,'项目：张雪');assert.equal(field(app.render(),'报价草稿 b').props.value,'乙未保存报价');
 assert.equal(app.editorProps.quotes.get('a').items[0].project,'a');assert.equal(app.editorProps.quotes.get('b').items[0].project,'b');
});

test('合同模板与电子签约配置分别开页签，配置草稿切换保留且重复打开复用',async()=>{
 const app=harness();await ready(app);button(app.render(),'配置').props.onClick();button(app.render(),'合同模板').props.onClick();field(app.render(),'配置草稿 合同模板').props.onChange({target:{value:'待保存条款'}});button(app.render(),'电子签约').props.onClick();field(app.render(),'配置草稿 电子签约').props.onChange({target:{value:'待保存经办人'}});
 openProject(app,'云顶');chooseTool(app,'合同');button(app.render(),'前往电子签约配置').props.onClick();assert.equal(text(selectedTab(app.render())),'电子签约');assert.equal(field(app.render(),'配置草稿 电子签约').props.value,'待保存经办人');
 clickWorkspace(app,'合同模板');assert.equal(field(app.render(),'配置草稿 合同模板').props.value,'待保存条款');assert.equal(workspaceTabs(app.render()).filter(node=>text(node)==='电子签约').length,1);
});

test('关闭后台页签保持活动项目，关闭当前回到邻页签；最后客户关闭回客户列表，再开为新状态',async()=>{
 const app=harness();await ready(app);openProject(app,'云顶');openProject(app,'张雪');openProject(app,'终端家庭');chooseTool(app,'报价');field(app.render(),'报价草稿 c').props.onChange({target:{value:'准备关闭'}});
 close(app,'项目：张雪');assert.equal(text(selectedTab(app.render())),'客户：终端家庭');close(app,'客户：终端家庭');assert.equal(text(selectedTab(app.render())),'项目：云顶');
 close(app,'项目：云顶');assert.equal(text(selectedTab(app.render())),'我的项目');openProject(app,'终端家庭');chooseTool(app,'报价');assert.equal(field(app.render(),'报价草稿 c').props.value,'');close(app,'客户：终端家庭');assert.equal(text(selectedTab(app.render())),'我的客户');
});

test('关闭活动中间页签先回左邻居，关闭首个则回右邻居，关闭最后配置回首页',async()=>{
 const app=harness();await ready(app);openProject(app,'云顶');openProject(app,'张雪');openProject(app,'终端家庭');clickWorkspace(app,'项目：张雪');close(app,'项目：张雪');assert.equal(text(selectedTab(app.render())),'项目：云顶');close(app,'项目：云顶');assert.equal(text(selectedTab(app.render())),'客户：终端家庭');close(app,'客户：终端家庭');
 button(app.render(),'配置').props.onClick();close(app,'材料费用');assert.equal(text(selectedTab(app.render())),'首页');
});

test('刷新会移除已删除项目页签并切至邻居，保留其他已打开草稿与功能',async()=>{
 const app=harness();await ready(app);openProject(app,'云顶');openProject(app,'张雪');chooseTool(app,'报价');field(app.render(),'报价草稿 b').props.onChange({target:{value:'乙保留'}});clickWorkspace(app,'项目：云顶');
 app.controls.workspace.projects=app.controls.workspace.projects.filter(p=>p.id!=='a'&&p.id!=='d');find(app.render(),node=>node.props['aria-label']==='刷新数据','Refresh').props.onClick();await nextTurn();app.render();const tree=app.render();assert.equal(tab(tree,'项目：云顶'),undefined);assert.equal(text(selectedTab(tree)),'项目：张雪');assert.equal(projectTool(tree,'报价').props['aria-selected'],true);assert.equal(field(tree,'报价草稿 b').props.value,'乙保留');
});

test('合同内容紧接功能导航，客户首页显示进度而不重复金额，收款页保留指标与折让',async()=>{
 const app=harness();await ready(app);openProject(app,'终端家庭');chooseTool(app,'合同');let tree=app.render();assert.equal(elements(tree,{visible:true}).some(node=>node.props.className==='pageTitle'||node.props.className==='metrics'||node.props['data-settlement']),false);assert.equal(find(tree,node=>typeof node.props.className==='string'&&node.props.className.includes('projectContractPage'),'Contract page').props.className,'content projectContractPage');assert.ok(field(tree,'合同草稿 c'));
 chooseTool(app,'首页');tree=app.render();assert.equal(elements(tree,{visible:true}).some(node=>node.props.className==='pageTitle'),true);assert.equal(elements(tree,{visible:true}).some(node=>node.props.className==='metrics'||node.props['data-settlement']),false);assert.equal(elements(tree,{visible:true}).some(node=>node.props['aria-label']==='工作环节'),true);
 chooseTool(app,'收款');tree=app.render();assert.equal(elements(tree,{visible:true}).some(node=>node.props.className==='metrics'),true);assert.equal(elements(tree,{visible:true}).some(node=>node.props['data-settlement']),true);
 chooseTool(app,'合同');tree=app.render();assert.equal(elements(tree,{visible:true}).some(node=>node.props.className==='pageTitle'||node.props.className==='metrics'||node.props['data-settlement']),false);assert.ok(field(tree,'合同草稿 c'));
});

test('独立项目新建报价单击按钮使用子项目id，保存回调只切目标栏目；父子项目名称清楚且各自复用',async()=>{
 const app=harness();await ready(app);openProject(app,'云顶');const create=find(app.render(),node=>node.type==='button'&&node.props['aria-label']==='新建报价 次订单','New independent quote');assert.equal(create.props.onDoubleClick,undefined);create.props.onClick();let tree=app.render();assert.equal(text(selectedTab(tree)),'项目：云顶 / 次订单');assert.equal(projectTool(tree,'报价').props['aria-selected'],true);assert.equal(app.editorProps.quotes.get('d').projectId,'d');assert.equal(app.editorProps.quotes.get('d').initialNew,true);
 app.editorProps.quotes.get('d').onSavedProject('b');tree=app.render();assert.equal(text(selectedTab(tree)),'项目：张雪');assert.equal(projectTool(tree,'报价').props['aria-selected'],true);clickWorkspace(app,'项目：云顶');assert.equal(projectTool(app.render(),'首页').props['aria-selected'],true);clickWorkspace(app,'项目：云顶 / 次订单');assert.equal(workspaceTabs(app.render()).filter(node=>text(node)==='项目：云顶 / 次订单').length,1);
});

test('名称单击进入独立项目且保留已有报价草稿，显式单击新建仍按旧语义重置新草稿',async()=>{
 const app=harness();await ready(app);openProject(app,'云顶');
 const entry=tree=>find(tree,node=>node.type==='button'&&elements(node).some(child=>child.type==='strong'&&text(child)==='次订单'),'Independent project name');
 const create=tree=>find(tree,node=>node.type==='button'&&node.props['aria-label']==='新建报价 次订单','New independent quote');
 assert.equal(entry(app.render()).props.onDoubleClick,undefined);entry(app.render()).props.onClick();assert.equal(projectTool(app.render(),'首页').props['aria-selected'],true);chooseTool(app,'报价');assert.equal(app.editorProps.quotes.get('d').initialNew,false);field(app.render(),'报价草稿 d').props.onChange({target:{value:'已有报价草稿'}});
 clickWorkspace(app,'项目：云顶');entry(app.render()).props.onClick();assert.equal(projectTool(app.render(),'报价').props['aria-selected'],true);assert.equal(field(app.render(),'报价草稿 d').props.value,'已有报价草稿');assert.equal(app.editorProps.quotes.get('d').initialNew,false);
 clickWorkspace(app,'项目：云顶');create(app.render()).props.onClick();app.render();assert.equal(field(app.render(),'报价草稿 d').props.value,'');assert.equal(app.editorProps.quotes.get('d').initialNew,true);field(app.render(),'报价草稿 d').props.onChange({target:{value:'已有新建草稿'}});
 clickWorkspace(app,'项目：云顶');entry(app.render()).props.onClick();assert.equal(field(app.render(),'报价草稿 d').props.value,'已有新建草稿');
 clickWorkspace(app,'项目：云顶');create(app.render()).props.onClick();app.render();assert.equal(field(app.render(),'报价草稿 d').props.value,'');assert.equal(app.editorProps.quotes.get('d').initialNew,true);assert(app.requests.every(request=>['get_workspace','get_catalog'].includes(request.action)));
});

test('品牌入口打开月度订单，点击订单进入真实子项目或对应报价组并保留原草稿',async()=>{
 const app=harness();await ready(app);openProject(app,'云顶');chooseTool(app,'报价');field(app.render(),'报价草稿 a').props.onChange({target:{value:'月度切换前的草稿'}});
 const brand=tree=>find(tree,node=>node.type==='button'&&node.props['aria-label']==='SI超级智能平台 · 月度订单总览','Brand monthly overview');
 brand(app.render()).props.onClick();let tree=app.render();assert.equal(text(selectedTab(tree)),'首页');assert.equal(elements(tree,{visible:true}).some(node=>node.props.className==='monthlyOrders'),true);assert.equal(elements(tree,{visible:true}).some(node=>node.props.className==='metrics'||node.props['data-settlement']),false);
 find(tree,node=>node.type==='button'&&node.props['aria-label']==='进入项目 次订单','Enter actual child').props.onClick();tree=app.render();assert.equal(text(selectedTab(tree)),'项目：云顶 / 次订单');assert.equal(projectTool(tree,'首页').props['aria-selected'],true);chooseTool(app,'报价');assert.equal(app.editorProps.quotes.get('d').projectId,'d');
 brand(app.render()).props.onClick();tree=app.render();find(tree,node=>node.type==='button'&&node.props['aria-label']==='进入项目 云顶报价','Enter quote group').props.onClick();tree=app.render();assert.equal(text(selectedTab(tree)),'项目：云顶');assert.equal(projectTool(tree,'报价').props['aria-selected'],true);assert.equal(app.editorProps.quotes.get('a').focusGroupId,'legacy');assert.equal(field(tree,'报价草稿 a').props.value,'月度切换前的草稿');
 assert(app.requests.every(request=>['get_workspace','get_catalog'].includes(request.action)));
});
