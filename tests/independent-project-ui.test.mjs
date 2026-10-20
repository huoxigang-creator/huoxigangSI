import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {runInNewContext} from 'node:vm';
import {setImmediate as turn} from 'node:timers/promises';
import React from 'react';
import ts from 'typescript';
import test from 'node:test';
const require=createRequire(import.meta.url),root=resolve('.');
const base={customer:'测试客户',status:'洽谈中',contract:0,received:0,paid:0,cash:0,budget:0,created:'2026-10-12T00:00:00Z'};
const parent={...base,id:'root',name:'合作客户'},a={...base,id:'a',parent_id:'root',name:'项目甲',received:10000,paid:4000},b={...base,id:'b',parent_id:'root',name:'项目乙',received:20000,paid:8000},other={...base,id:'other',name:'其他合作客户'};
function harness(){
 const slots=[],effects=[],cache=new Map(),requests=[];let cursor=0,serial=0;
 const data={projects:[parent,a,b,other],quotes:[{id:'qa',project:'a',title:'甲报价',items:[],total:0},{id:'qb',project:'b',title:'乙报价',items:[],total:0}],transactions:[{id:'tp',project:'root',type:'收款',amount:2000},{id:'ta',project:'a',type:'收款',amount:10000},{id:'tb',project:'b',type:'收款',amount:20000},{id:'to',project:'other',type:'收款',amount:5000},{id:'payment-a',project:'a',type:'付款',category:'人工费',amount:4000}],tasks:[],logs:[]};
 const hooks={...React,useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return[slots[i].value,update=>{slots[i].value=typeof update==='function'?update(slots[i].value):update;}];},useMemo(callback){cursor++;return callback();},useEffect(callback,deps){const i=cursor++;if(!slots[i]||JSON.stringify(slots[i].deps)!==JSON.stringify(deps)){slots[i]={deps};effects.push(callback);}}};
 function stub(name){const fn=()=>null;fn.displayName=name;return fn;}
 function load(path){if(cache.has(path))return cache.get(path).exports;const module={exports:{}};cache.set(path,module);
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const localRequire=name=>{if(name==='react')return hooks;if(name==='lucide-react')return new Proxy({},{get:(_,key)=>stub(key)});if(name.startsWith('./')&&path.endsWith('manager.tsx'))return new Proxy({__esModule:true},{get:(_,key)=>key==='__esModule'?true:stub(name+'/'+String(key))});if(name.startsWith('.')){const p=resolve(dirname(path),name),target=[p,p+'.ts',p+'.tsx'].find(existsSync);return load(target);}return require(name);};
 const fetch=async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);let result=url==='/api/catalog'?{company:{name:'测试公司'},materials:[],purchase_orders:[]}:data;if(body.action==='create_project'){result={...base,...body.args,id:'new-child'};data.projects.push(result);}return{ok:true,status:200,json:async()=>({ok:true,result})};};
 runInNewContext('(function(exports,module,require){'+code+'\n})',{console,Intl,Date,Map,Set,Number,String,Error,JSON,fetch,FormData:class{constructor(values){this.values=values;}[Symbol.iterator](){return Object.entries(this.values)[Symbol.iterator]();}},setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},crypto:{randomUUID:()=>String(++serial)},window:{}})(module.exports,module,localRequire);return module.exports;
 }
 const Manager=load(resolve(root,'app/manager.tsx')).default;
 function render(){cursor=0;const tree=Manager();for(const effect of effects.splice(0))effect();return tree;}
 return{render,requests,data};
}
function elements(node,visible=false,hidden=false){if(Array.isArray(node))return node.flatMap(child=>elements(child,visible,hidden));if(!node?.props)return[];hidden=hidden||node.props.hidden||node.props['aria-hidden']===true||node.props['aria-hidden']==='true'||node.props.style?.display==='none';return[...(!visible||!hidden?[node]:[]),...elements(node.props.children,visible,hidden)];}
function text(node){if(Array.isArray(node))return node.map(text).join('');return typeof node==='object'?text(node?.props?.children):node==null||typeof node==='boolean'?'':String(node);}
function find(tree,predicate){const node=elements(tree).find(predicate);assert.ok(node);return node;}
function component(tree,name){const matches=elements(tree,true).filter(node=>node.type?.displayName?.endsWith('/'+name));assert.ok(matches.length);return matches.find(node=>node.props.active===true)||matches[0];}
function button(tree,label){return find(tree,node=>node.type==='button'&&text(node)===label);}
function tab(tree,name){return find(tree,node=>node.props.role==='tab'&&text(node)===name);}
async function loaded(){const app=harness();app.render();await turn();await turn();let tree=app.render();button(tree,'我的项目').props.onClick();tree=app.render();component(tree,'ProjectList').props.onSelect(parent);return app;}
test('首页列多个独立项目；切换后报价、收款、采购和文件传各自ID',async()=>{
 const app=await loaded();let tree=app.render();assert.match(text(tree),/合作客户 · 独立项目 2/);const card=find(tree,node=>node.type==='button'&&elements(node).some(n=>n.type==='strong'&&text(n)==='项目甲'));card.props.onClick();tree=app.render();assert.match(text(tree),/返回合作客户/);assert.equal(find(tree,node=>node.type==='h1').props.children,'合作客户');assert.ok(find(tree,node=>node.type==='button'&&node.props['aria-label']==='删除项目 项目甲')); 
 tab(tree,'报价').props.onClick();tree=app.render();const quote=component(tree,'quote-workspace/default');assert.equal(quote.props.projectId,'a');assert.deepEqual(quote.props.items.map(row=>row.id),['qa']);
 tab(tree,'收款').props.onClick();tree=app.render();assert.deepEqual(component(tree,'TransactionList').props.items.map(row=>row.id),['ta']);
 tab(tree,'采购单').props.onClick();tree=app.render();assert.equal(component(tree,'purchase-orders/default').props.projectId,'a');
 tab(tree,'文件上传').props.onClick();tree=app.render();assert.equal(component(tree,'project-files/default').props.project.id,'a');
 tab(tree,'合同').props.onClick();tree=app.render();assert.equal(component(tree,'contracts/default').props.project.id,'a');
 tab(tree,'收款').props.onClick();tree=app.render();const profitPanel=find(tree,node=>node.type?.name==='ProfitPanel');assert.match(text(profitPanel.type(profitPanel.props)),/¥60\.00/);
 button(tree,'返回合作客户').props.onClick();tree=app.render();const other=find(tree,node=>node.type==='button'&&elements(node).some(n=>n.type==='strong'&&text(n)==='项目乙'));other.props.onClick();tree=app.render();tab(tree,'报价').props.onClick();tree=app.render();assert.equal(component(tree,'quote-workspace/default').props.projectId,'b');assert.deepEqual(component(tree,'quote-workspace/default').props.items.map(row=>row.id),['qb']);
});
test('添加项目预填合作客户，保存指定parent_id并进入新独立项目，取消不创建',async()=>{
 const app=await loaded();let tree=app.render();button(tree,'添加项目').props.onClick();tree=app.render();assert.match(text(tree),/所属合作项目：合作客户/);assert.equal(find(tree,node=>node.type==='input'&&node.props.name==='customer').props.defaultValue,'测试客户');button(tree,'取消').props.onClick();assert.equal(app.requests.filter(row=>row.action==='create_project').length,0);
 tree=app.render();button(tree,'添加项目').props.onClick();tree=app.render();await find(tree,node=>node.type==='form').props.onSubmit({preventDefault(){},currentTarget:{name:'新项目',customer:'测试客户',budget:'0'}});await turn();tree=app.render();const request=app.requests.find(row=>row.action==='create_project');assert.equal(request.args.parent_id,'root');assert.equal(find(tree,node=>node.type==='h1').props.children,'合作客户');tab(tree,'采购单').props.onClick();tree=app.render();assert.equal(component(tree,'purchase-orders/default').props.projectId,'new-child');
});

test('父项目收款列表包含全部独立项目流水，进入真实子项目只显示自身收款',async()=>{
 const app=await loaded();let tree=app.render();tab(tree,'收款').props.onClick();tree=app.render();
 let list=component(tree,'TransactionList');assert.deepEqual(list.props.items.map(row=>row.id),['tp','ta','tb']);assert.equal(list.props.preferenceScope,'root');assert.equal(list.props.fundType,'收款');assert.equal(list.props.quotes.length,2);
 tab(tree,'首页').props.onClick();tree=app.render();find(tree,node=>node.type==='button'&&elements(node).some(n=>n.type==='strong'&&text(n)==='项目甲')).props.onClick();tree=app.render();tab(tree,'收款').props.onClick();tree=app.render();
 list=component(tree,'TransactionList');assert.deepEqual(list.props.items.map(row=>row.id),['ta']);assert.equal(list.props.preferenceScope,'a');assert.equal(list.props.scope,'a收款');
 button(tree,'返回合作客户').props.onClick();tree=app.render();tab(tree,'收款').props.onClick();tree=app.render();assert.deepEqual(component(tree,'TransactionList').props.items.map(row=>row.id),['tp','ta','tb']);
 assert(app.requests.every(request=>['get_workspace','get_catalog'].includes(request.action)));
});
