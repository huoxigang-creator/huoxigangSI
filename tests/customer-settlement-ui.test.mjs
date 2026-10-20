import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function harness(overrides={}){
 const slots=[],cache=new Map(),mutations=[];let index,effects,closed=false;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((item,i)=>Object.is(item,b[i]));
 const hooks={...React,useState(initial){const i=index++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},useRef(value){const i=index++;if(!slots[i])slots[i]={value:{current:value}};return slots[i].value;},useEffect(effect,deps){const i=index++;if(!slots[i]||!same(slots[i].deps,deps)){slots[i]={deps};effects.push(effect);}}};
 function load(file){if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const customRequire=name=>{if(name==='react')return hooks;if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});if(name.endsWith('.css'))return {};if(name.startsWith('.')){const target=resolve(dirname(file),name);return load([target,target+'.ts',target+'.tsx'].find(existsSync));}return require(name);};
  runInNewContext('(function(exports,require,module){'+code+'\n})',{Intl,Number,Math,String,window:{addEventListener(){},removeEventListener(){}},document:{body:{style:{}},activeElement:null}})(module.exports,customRequire,module);return module.exports;
 }
 const Component=load(resolve('app/customer-settlement.tsx')).default;
 const props={project:{id:'detached-customer',name:'本机结算验收',contract:100055,received:99900,remaining:155,...overrides},open:true,busy:false,onClose:()=>{closed=true;},mutate:async(action,args)=>{mutations.push({action,args});return true;}};
 return {props,mutations,get closed(){return closed;},render(){index=0;effects=[];let tree=Component(props);for(const effect of effects.splice(0))effect();index=0;effects=[];return Component(props);}};
}
function nodes(node,result=[]){if(Array.isArray(node))for(const child of node)nodes(child,result);else if(React.isValidElement(node)){result.push(node);nodes(node.props.children,result);}return result;}
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):React.isValidElement(node)?text(node.props.children):'';
const find=(tree,predicate)=>{const node=nodes(tree).find(predicate);assert.ok(node);return node;};
const input=(tree,name)=>find(tree,node=>node.props['aria-label']===name);
const button=(tree,name)=>find(tree,node=>node.type==='button'&&text(node)===name);
const submit=tree=>find(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});

test('优惠与抹零剩余尾款精确结清，保存分别记录优惠并保留真实收款',async()=>{
 const app=harness();let tree=app.render();input(tree,'优惠金额').props.onChange({target:{value:'1.00'}});tree=app.render();button(tree,'抹零剩余尾款').props.onClick();tree=app.render();
 assert.equal(input(tree,'抹零金额').props.value,'0.55');assert.match(text(tree),/保存后已结清/);assert.match(text(tree),/¥999.00/);
 input(tree,'优惠抹零说明').props.onChange({target:{value:' 客户议价，尾款抹零 '}});tree=app.render();await submit(tree);
 assert.equal(app.closed,true);assert.equal(app.mutations.length,1);assert.deepEqual(JSON.parse(JSON.stringify(app.mutations[0])),{action:'set_customer_settlement',args:{project_id:'detached-customer',discount_amount:1,rounding_amount:.55,note:'客户议价，尾款抹零'}});
 assert.equal(app.props.project.received,99900);
});
test('过高优惠禁止保存，取消不写数据，清除优惠可以重新恢复原价应收',async()=>{
 const app=harness({discount_amount:100,rounding_amount:55});let tree=app.render();assert.equal(input(tree,'优惠金额').props.value,'1.00');input(tree,'优惠金额').props.onChange({target:{value:'2000'}});tree=app.render();assert.equal(button(tree,'保存结算').props.disabled,true);await submit(tree);assert.equal(app.mutations.length,0);
 button(tree,'清除优惠与抹零').props.onClick();tree=app.render();assert.equal(input(tree,'优惠金额').props.value,'0.00');assert.equal(input(tree,'抹零金额').props.value,'0.00');assert.match(text(tree),/¥1.55/);button(tree,'取消').props.onClick();assert.equal(app.closed,true);assert.equal(app.mutations.length,0);
});
test('多收款不会被剩余尾款按钮改成负抹零，未采纳不能登记非零折让',()=>{
 const paid=harness({received:100100,remaining:-45});let tree=paid.render();assert.equal(button(tree,'抹零剩余尾款').props.disabled,true);assert.match(text(tree),/多收款/);assert.match(text(tree),/¥0.45/);
 const waived=harness({rounding_amount:100,received:100000,remaining:-45});tree=waived.render();assert.equal(button(tree,'抹零剩余尾款').props.disabled,true);assert.equal(input(tree,'抹零金额').props.value,'1.00');
 const empty=harness({contract:0,received:0,remaining:0});tree=empty.render();assert.match(text(tree),/先采纳客户报价/);input(tree,'优惠金额').props.onChange({target:{value:'1'}});tree=empty.render();assert.equal(button(tree,'保存结算').props.disabled,true);assert.doesNotMatch(text(tree),/保存后已结清/);
});
