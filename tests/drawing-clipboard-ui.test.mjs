import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {setImmediate as turn} from 'node:timers/promises';
import React from 'react';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const compile=path=>ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function harness(){
 const slots=[],events=new Map(),windowEvents=new Map(),timers=new Map(),requests=[];let index=0,effects=[],timerId=0,clipboard=[],clipboardReads=0,focused=true;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const hooks={...React,useState(initial){const i=index++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};const slot=slots[i];return [slot.value,value=>{slot.value=typeof value==='function'?value(slot.value):value;}];},useRef(initial){const i=index++;if(!slots[i])slots[i]={value:{current:initial}};return slots[i].value;},useEffect(effect,deps){const i=index++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=effect();});}}};
 const document={body:{},visibilityState:'visible',hasFocus:()=>focused,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name,fn)=>{if(events.get(name)===fn)events.delete(name);}};
 const window={isSecureContext:true,addEventListener:(name,fn)=>windowEvents.set(name,fn),removeEventListener:(name,fn)=>{if(windowEvents.get(name)===fn)windowEvents.delete(name);},setInterval:fn=>{timers.set(++timerId,fn);return timerId;},clearInterval:id=>timers.delete(id)};
 const context={console,Intl,Date,Number,String,Math,Set,Map,Error,Promise,File,Blob,AbortController,crypto,Uint8Array,document,window,navigator:{permissions:{query:async()=>({state:'prompt'})},clipboard:{read:async()=>{clipboardReads++;return clipboard;},addEventListener(){},removeEventListener(){}}},URL:{createObjectURL:file=>'blob:'+file.name,revokeObjectURL(){}},fetch:async()=>({json:async()=>({result:{}})}),setTimeout,clearTimeout};
 const cache=new Map();function load(path){if(cache.has(path))return cache.get(path);const mod={exports:{}};cache.set(path,mod.exports);runInNewContext('(function(exports,require,module){'+compile(path)+'\n})',{...context,module:mod,require:localRequire})(mod.exports,localRequire,mod);cache.set(path,mod.exports);return mod.exports;}
 function localRequire(name){if(name==='react')return hooks;if(name==='react-dom')return {createPortal:node=>node};if(name.endsWith('.css'))return {};if(name==='../lib/image-recognition-client')return {requestImageRecognition:(file,_mode,signal)=>new Promise((resolve,reject)=>{requests.push({file,resolve,reject});signal.addEventListener('abort',()=>reject(Error('aborted')));})};if(name==='../lib/cad-recognition-client')return {};if(name==='../lib/document-scan')return {};if(name==='../lib/drawing-import')return load('lib/drawing-import.ts');if(name==='../lib/drawing-clipboard')return load('lib/drawing-clipboard.ts');return require(name);}
 const Component=load('app/drawing-import.tsx').default;
 const render=()=>{index=0;effects=[];const tree=Component({disabled:false,onApply(){}});for(const effect of effects.splice(0))effect();return tree;};
 const flush=async()=>{let tree;for(let i=0;i<6;i++){await turn();tree=render();}return tree;};
 return {render,flush,requests,events,setClipboard:files=>clipboard=files.map(file=>({types:[file.type],getType:async()=>file})),get clipboardReads(){return clipboardReads;},poll:()=>timers.forEach(fn=>fn()),focus:value=>focused=value,get timerCount(){return timers.size;},unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
const nodes=(node,result=[])=>{if(Array.isArray(node))node.forEach(n=>nodes(n,result));else if(React.isValidElement(node)){result.push(node);nodes(node.props.children,result);}return result;};
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):React.isValidElement(node)?text(node.props.children):'';
const button=(tree,label)=>{const found=nodes(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(found,label);return found;};
const cards=tree=>nodes(tree).filter(n=>n.props['data-row-card']!==undefined);
const image=value=>new File([value],value+'.png',{type:'image/png'});
const result=(file,width)=>({source:file.name,room:'客厅',name:'电视柜',width:String(width),height:'',price:'',selected:true});

test('paste appends images, queues behind recognition, ignores repeat clipboard bytes and stops on close',async()=>{
 const app=harness();let tree=app.render();assert.equal(app.events.has('paste'),false);
 button(tree,'截图快捷识别').props.onClick();tree=await app.flush();assert.equal(app.events.has('paste'),true);
 let prevented=false;app.events.get('paste')({clipboardData:{items:[{kind:'string',type:'text/plain'}],files:[]},preventDefault(){prevented=true;}});assert.equal(prevented,false);
 const paste=file=>app.events.get('paste')({clipboardData:{items:[{kind:'file',type:file.type,getAsFile:()=>file}],files:[file]},preventDefault(){prevented=true;}});
 paste(image('first'));tree=await app.flush();assert.equal(prevented,true);assert.equal(app.requests.length,1);assert.equal(cards(tree).length,1);
 paste(image('second'));paste(image('second'));tree=await app.flush();assert.equal(app.requests.length,1);assert.match(text(tree),/还有1张截图等待识别/);
 app.requests[0].resolve(result(app.requests[0].file,2000));tree=await app.flush();assert.equal(app.requests.length,2);assert.equal(cards(tree).length,2);
 app.requests[1].resolve(result(app.requests[1].file,3000));tree=await app.flush();assert.match(text(tree),/共2个图/);assert.match(text(tree),/5.00m/);
 paste(image('third'));tree=await app.flush();assert.equal(app.requests.length,3);button(tree,'取消').props.onClick();tree=await app.flush();assert.equal(app.events.has('paste'),false);assert.equal(nodes(tree).some(n=>n.props.role==='dialog'),false);app.unmount();
});


test('enabling auto intake skips old clipboard, waits for focus and stops polling on close',async()=>{
 const app=harness();app.setClipboard([image('old clipboard')]);let tree=app.render();button(tree,'截图快捷识别').props.onClick();tree=await app.flush();assert.equal(app.clipboardReads,0);
 button(tree,'开启截图自动接收').props.onClick();tree=await app.flush();assert.equal(app.clipboardReads,1);assert.equal(app.requests.length,0);assert.equal(app.timerCount,1);
 app.focus(false);app.setClipboard([image('new snip')]);app.poll();tree=await app.flush();assert.equal(app.clipboardReads,1);assert.equal(app.requests.length,0);
 app.focus(true);app.poll();tree=await app.flush();assert.equal(app.requests.length,1);assert.equal(cards(tree).length,1);
 button(tree,'取消').props.onClick();tree=await app.flush();assert.equal(app.timerCount,0);const reads=app.clipboardReads;app.poll();await app.flush();assert.equal(app.clipboardReads,reads);app.unmount();
});
