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
const roomA='8133f6a9-2349-4d5c-a165-17cdb1dc3e4e',roomB='12993450-44a1-4902-a9cb-dc2be0915e43';
const line=(name,category,quantity,price,room_id)=>({name,category,quantity,price,room_id,model:'原规格',unit:'项',note:'原明细备注'});
const source={id:'old-customer',name:'老客户测试',customer:'老客户',quotes:[{id:'old-quote',title:'老客户整户方案',adopted:true,total:15100,created:'2026-10-13T01:00:00Z',rooms:[{id:roomA,name:'主卧室'},{id:roomB,name:'厨房'}],items:[line('衣柜','材料费用',2,50,roomA),line('拉手','五金费用',3,17,roomB)],note:'原整户备注'}]};

// Exercise real UI handlers against detached fixtures, with no network or business data.
function harness(sources=[source]) {
 const cache=new Map(),scopes=new Map(),mutations=[],requests=[];let scope,cursor,effects,serial=0;
 const document={body:{style:{overflow:''}},querySelector:()=>null};
 const window={confirm:()=>true,addEventListener(){},removeEventListener(){}};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const hooks={...React,
  useContext(context){return context._currentValue;},
  useState(initial){const i=cursor++;if(!scope[i])scope[i]={value:typeof initial==='function'?initial():initial};const slot=scope[i];return [slot.value,value=>{slot.value=typeof value==='function'?value(slot.value):value;}];},
  useRef(initial){const i=cursor++;if(!scope[i])scope[i]={value:{current:initial}};return scope[i].value;},
  useMemo(create,deps){const i=cursor++;if(!scope[i]||!same(scope[i].deps,deps))scope[i]={value:create(),deps};return scope[i].value;},
  useCallback(callback,deps){return hooks.useMemo(()=>callback,deps);},
  useEffect(effect,deps){const i=cursor++;if(!scope[i]||!same(scope[i].deps,deps)){scope[i]={deps};effects.push(effect);}},
 };
 function load(path){if(cache.has(path))return cache.get(path).exports;const module={exports:{}};cache.set(path,module);const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  function localRequire(name){if(name==='react')return hooks;if(name==='lucide-react')return new Proxy({},{get:(_target,key)=>function Icon(){return String(key);}});if(name.endsWith('.css'))return {};if(name.startsWith('.')){const base=resolve(dirname(path),name),target=[base,base+'.ts',base+'.tsx'].find(existsSync);assert.ok(target,'Module exists: '+name);return load(target);}return require(name);}
  const evaluate=runInNewContext('(function(exports,require,module){'+code+'\n})',{console,Intl,Date,Set,Map,Error,Number,String,document,window,fetch:async(url)=>{requests.push(url);return {ok:true,json:async()=>({ok:true,result:{materials:[],purchase_orders:[]}})};},crypto:{randomUUID:()=>`00000000-0000-4000-a000-${String(++serial).padStart(12,'0')}`}});evaluate(module.exports,localRequire,module);return module.exports;
 }
 const Workspace=load(resolve(root,'app/quote-workspace.tsx')).default,dialogs=load(resolve(root,'app/quote-copy-dialog.tsx'));
 const props={customerMode:true,copySources:sources,projectId:'new-customer',projectName:'新客户测试',items:[],busy:false,mutate:async(action,args)=>{mutations.push({action,args:JSON.parse(JSON.stringify(args))});return true;},onDeleted:async()=>{}};
 function renderComponent(key,component,props){scope=scopes.get(key)||[];scopes.set(key,scope);cursor=0;effects=[];const tree=component(props);for(const effect of effects.splice(0))effect();return tree;}
 const render=()=>renderComponent('workspace',Workspace,props);
 const copyDialog=node=>renderComponent('copy-dialog',dialogs.default,node.props);
 return {render,copyDialog,props,mutations,requests,dialogs};
}
function elements(node,result=[]){if(Array.isArray(node)){for(const child of node)elements(child,result);}else if(React.isValidElement(node)){result.push(node);elements(node.props.children,result);}return result;}
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):React.isValidElement(node)?text(node.props.children):'';
function find(tree,check,label){const node=elements(tree).find(check);assert.ok(node,label);return node;}
const button=(tree,label)=>find(tree,node=>node.type==='button'&&text(node)===label,'Button: '+label);
const input=(tree,label)=>find(tree,node=>node.type==='input'&&node.props['aria-label']===label,'Input: '+label);
function beginCopy(app){let tree=app.render();button(tree,'新建客户报价').props.onClick();tree=app.render();const choice=find(tree,node=>node.type===app.dialogs.QuoteCreateDialog,'Type selection');choice.props.onCopy();tree=app.render();return find(tree,node=>node.type===app.dialogs.default,'Copy dialog');}
function chooseSource(app,node,id){let tree=app.copyDialog(node);find(tree,node=>node.type==='select'&&node.props['aria-label']==='来源客户或项目','Source select').props.onChange({target:{value:id}});tree=app.copyDialog(node);find(tree,node=>node.type==='button'&&node.props.role==='radio','Quotation card').props.onClick();return app.copyDialog(node);}

test('老客户报价导入只建立目标客户可编辑草稿；手动保存才创建新记录，来源保持不变',async()=>{
 const original=JSON.stringify(source),app=harness();const dialog=beginCopy(app);let tree=chooseSource(app,dialog,source.id);
 input(tree,'复制后的报价名称').props.onChange({target:{value:'新客户厨房与衣柜报价'}});tree=app.copyDialog(dialog);
 assert.equal(find(tree,node=>node.props.role==='radio','Selected quotation').props['aria-checked'],true);
 find(tree,node=>node.type==='form','Copy form').props.onSubmit({preventDefault(){}});await nextTurn();tree=app.render();
 assert.equal(app.mutations.length,0);assert.equal(JSON.stringify(source),original);
 assert.equal(input(tree,'报价版本名称').props.value,'新客户厨房与衣柜报价');
 const rooms=find(tree,node=>node.props.editable&&Array.isArray(node.props.rooms),'Editable rooms');
 assert.deepEqual(Array.from(rooms.props.rooms,room=>room.name),['主卧室','厨房']);
 assert.ok(rooms.props.rooms.every(room=>![roomA,roomB].includes(room.id)));
 assert.equal(input(tree,'材料费用第1行销售单价').props.value,50);
 input(tree,'材料费用第1行数量').props.onChange({target:{value:'4'}});tree=app.render();
 find(tree,node=>node.type==='form','Draft form').props.onSubmit({preventDefault(){}});await nextTurn();
 assert.equal(app.mutations.length,1);const {action,args}=app.mutations[0];assert.equal(action,'create_quote');assert.equal(args.project_id,'new-customer');assert.equal(args.title,'新客户厨房与衣柜报价');assert.equal(args.note,'原整户备注');
 assert.equal(args.items[0].quantity,4);assert.equal(args.items[0].price,50);assert.equal(args.items[1].quantity,3);assert.equal(args.items[1].price,17);assert.equal(args.items[1].note,'原明细备注');
 assert.ok(args.items.every(row=>args.rooms.some(room=>room.id===row.room_id)));assert.ok(args.items.every(row=>!('key' in row)));
 for(const field of ['id','adopted','subproject_id','subproject_name'])assert.equal(field in args,false,field+' must not be inherited');
 assert.equal(JSON.stringify(source),original);assert.ok(app.requests.every(url=>url==='/api/catalog'));
});

test('复制旧合作项目报价自动放入整体空间；取消编辑不保存任何记录',async()=>{
 const legacy={id:'old-project',name:'旧合作项目',quotes:[{id:'legacy-quote',title:'旧预算',subproject_id:'old-group',subproject_name:'原小项目',adopted:true,total:2500,items:[line('安装','人工费用',1,25)],note:'旧备注'}]};
 const original=JSON.stringify(legacy),app=harness([legacy]),dialog=beginCopy(app);const tree=chooseSource(app,dialog,legacy.id);find(tree,node=>node.type==='form','Copy form').props.onSubmit({preventDefault(){}});await nextTurn();const draft=app.render();
 const rooms=find(draft,node=>node.props.editable&&Array.isArray(node.props.rooms),'Rooms');assert.equal(rooms.props.rooms.length,1);assert.equal(rooms.props.rooms[0].name,'整体空间');assert.equal(input(draft,'人工费用第1行销售单价').props.value,25);assert.equal(input(draft,'人工费用第1行数量').props.value,1);
 button(draft,'取消').props.onClick();assert.equal(app.mutations.length,0);assert.equal(JSON.stringify(legacy),original);
});

test('复制来源支持搜索，未选报价不能导入，返回可继续空白新建',()=>{
 const app=harness(),dialog=beginCopy(app);let tree=app.copyDialog(dialog);assert.equal(button(tree,'导入报价').props.disabled,true);
 input(tree,'搜索来源客户或项目').props.onChange({target:{value:'不存在的名字'}});tree=app.copyDialog(dialog);assert.match(text(tree),/没有匹配的来源客户或项目/);
 assert.equal(elements(tree).filter(node=>node.type==='option').length,1);
 dialog.props.onBack();tree=app.render();find(tree,node=>node.type===app.dialogs.QuoteCreateDialog,'Type selection').props.onNew();tree=app.render();assert.equal(input(tree,'报价版本名称').props.value,'新客户测试报价');assert.equal(app.mutations.length,0);
});
