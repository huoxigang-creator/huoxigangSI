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
function harness(pdfFailure=false){
 const downloads=[],revoked=[];const slots=[],events=new Map(),windowEvents=new Map(),timers=new Map(),requests=[];let index=0,effects=[],timerId=0,clipboard=[],clipboardReads=0,focused=true;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const hooks={...React,useState(initial){const i=index++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};const slot=slots[i];return [slot.value,value=>{slot.value=typeof value==='function'?value(slot.value):value;}];},useRef(initial){const i=index++;if(!slots[i])slots[i]={value:{current:initial}};return slots[i].value;},useEffect(effect,deps){const i=index++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=effect();});}}};
 const document={createElement:()=>({click(){downloads.push({href:this.href,name:this.download});},remove(){}}),body:{appendChild(){}},visibilityState:'visible',hasFocus:()=>focused,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name,fn)=>{if(events.get(name)===fn)events.delete(name);}};
 const window={isSecureContext:true,addEventListener:(name,fn)=>windowEvents.set(name,fn),removeEventListener:(name,fn)=>{if(windowEvents.get(name)===fn)windowEvents.delete(name);},setInterval:fn=>{timers.set(++timerId,fn);return timerId;},clearInterval:id=>timers.delete(id)};
 const context={console,Intl,Date,Number,String,Math,Set,Map,Error,Promise,File,Blob,AbortController,crypto,Uint8Array,document,window,navigator:{permissions:{query:async()=>({state:'prompt'})},clipboard:{read:async()=>{clipboardReads++;return clipboard;},addEventListener(){},removeEventListener(){}}},URL:{createObjectURL:file=>'blob:'+file.name,revokeObjectURL:url=>revoked.push(url)},fetch:async()=>({json:async()=>({result:{}})}),setTimeout,clearTimeout};
 const cache=new Map();function load(path){if(cache.has(path))return cache.get(path);const mod={exports:{}};cache.set(path,mod.exports);runInNewContext('(function(exports,require,module){'+compile(path)+'\n})',{...context,module:mod,require:localRequire})(mod.exports,localRequire,mod);cache.set(path,mod.exports);return mod.exports;}
 function localRequire(name){if(name==='react')return hooks;if(name==='react-dom')return {createPortal:node=>node};if(name.endsWith('.css'))return {};if(name==='../lib/image-recognition-client')return {requestImageRecognition:(file,_mode,signal,_provider,_multiple,onProgress)=>new Promise((resolve,reject)=>{onProgress?.('正在上传并解析图片，请稍候…');requests.push({file,resolve,reject,onProgress});signal.addEventListener('abort',()=>reject(Error('aborted')));})};if(name==='../lib/drawing-review-pdf')return {drawingReviewPdfName:entries=>(entries[0]?.row.address||'')+'柜体图纸尺寸核对单.pdf',drawingImagePng(){},generateDrawingReviewPdf:async entries=>{if(pdfFailure)throw Error('Synthetic PDF failure');assert.equal(entries.length,1);return new Uint8Array([37,80,68,70]);}};if(name==='../lib/cad-recognition-client')return {...load('lib/cad-recognition-client.ts'),requestCadRecognition:(file,_progress,signal)=>new Promise((resolve,reject)=>{requests.push({file,resolve,reject,cad:true});signal.addEventListener('abort',()=>reject(Error('aborted')));})};if(name==='../lib/document-scan')return {};if(name==='../lib/drawing-import')return load('lib/drawing-import.ts');if(name==='../lib/drawing-clipboard')return load('lib/drawing-clipboard.ts');return require(name);}
 const Component=load('app/drawing-import.tsx').default;
 const render=()=>{index=0;effects=[];const tree=Component({disabled:false,onApply(){}});for(const effect of effects.splice(0))effect();return tree;};
 const flush=async()=>{let tree;for(let i=0;i<6;i++){await turn();tree=render();}return tree;};
 return {render,flush,requests,events,windowEvents,downloads,revoked,setClipboard:files=>clipboard=files.map(file=>({types:[file.type],getType:async()=>file})),get clipboardReads(){return clipboardReads;},poll:()=>timers.forEach(fn=>fn()),focus:value=>focused=value,get timerCount(){return timers.size;},unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
const nodes=(node,result=[])=>{if(Array.isArray(node))node.forEach(n=>nodes(n,result));else if(React.isValidElement(node)){result.push(node);nodes(node.props.children,result);}return result;};
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):React.isValidElement(node)?text(node.props.children):'';
const button=(tree,label)=>{const found=nodes(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(found,label);return found;};
const cards=tree=>nodes(tree).filter(n=>n.props['data-row-card']!==undefined);
const image=value=>new File([value],value+'.png',{type:'image/png'});
const result=(file,width)=>({source:file.name,room:'客厅',name:'电视柜',width:String(width),height:'',price:'',selected:true});

test('paste appends images, queues behind recognition, ignores repeat clipboard bytes and stops on close',async()=>{
 const app=harness();let tree=app.render();assert.equal(app.events.has('paste'),false);assert.equal(nodes(tree).filter(n=>n.type==='button'&&text(n)==='AI智能识别报价').length,1);assert.ok(!text(tree).includes('上传CAD文件识别'));assert.ok(!text(tree).includes('截图快捷识别'));
 const picker=nodes(tree).find(n=>n.type==='input'&&n.props['aria-label']==='上传柜体图纸');picker.props.ref.current={click(){assert.fail('入口不能打开文件选择框');},focus(){}};
 button(tree,'AI智能识别报价').props.onClick();tree=await app.flush();assert.equal(app.events.has('paste'),true);assert.ok(nodes(tree).some(n=>n.props.role==='dialog'));assert.ok(button(tree,'上传图片 / CAD'));
 let prevented=false;app.events.get('paste')({clipboardData:{items:[{kind:'string',type:'text/plain'}],files:[]},preventDefault(){prevented=true;}});assert.equal(prevented,false);
 const paste=file=>app.events.get('paste')({clipboardData:{items:[{kind:'file',type:file.type,getAsFile:()=>file}],files:[file]},preventDefault(){prevented=true;}});
 paste(image('first'));tree=await app.flush();assert.equal(prevented,true);assert.equal(app.requests.length,1);assert.equal(cards(tree).length,1);
 paste(image('second'));paste(image('second'));tree=await app.flush();assert.equal(app.requests.length,1);assert.match(text(tree),/还有1张截图等待识别/);
 app.requests[0].resolve(result(app.requests[0].file,2000));tree=await app.flush();assert.equal(app.requests.length,2);assert.equal(cards(tree).length,2);
 app.requests[1].resolve(result(app.requests[1].file,3000));tree=await app.flush();assert.match(text(tree),/共2个柜体/);assert.match(text(tree),/5.00m/);
 paste(image('third'));tree=await app.flush();assert.equal(app.requests.length,3);button(tree,'取消').props.onClick();tree=await app.flush();assert.equal(app.events.has('paste'),false);assert.equal(nodes(tree).some(n=>n.props.role==='dialog'),false);app.unmount();
});


test('enabling auto intake skips old clipboard, waits for focus and stops polling on close',async()=>{
 const app=harness();app.setClipboard([image('old clipboard')]);let tree=app.render();button(tree,'AI智能识别报价').props.onClick();tree=await app.flush();assert.equal(app.clipboardReads,0);
 button(tree,'开启截图自动接收').props.onClick();tree=await app.flush();assert.equal(app.clipboardReads,1);assert.equal(app.requests.length,0);assert.equal(app.timerCount,1);
 app.focus(false);app.setClipboard([image('new snip')]);app.poll();tree=await app.flush();assert.equal(app.clipboardReads,1);assert.equal(app.requests.length,0);
 app.focus(true);app.poll();tree=await app.flush();assert.equal(app.requests.length,1);assert.equal(cards(tree).length,1);
 button(tree,'取消').props.onClick();tree=await app.flush();assert.equal(app.timerCount,0);const reads=app.clipboardReads;app.poll();await app.flush();assert.equal(app.clipboardReads,reads);app.unmount();
});

test('PDF export triggers a named download, retains manual link and shows failures beside the button',async()=>{
 for(const fails of [false,true]){
  const app=harness(fails);let tree=app.render();button(tree,'AI智能识别报价').props.onClick();tree=await app.flush();const file=image('pdf');app.events.get('paste')({clipboardData:{items:[{kind:'file',type:file.type,getAsFile:()=>file}],files:[file]},preventDefault(){}});tree=await app.flush();app.requests[0].resolve(result(file,2000));tree=await app.flush();assert.equal(button(tree,'一键导出图纸核对PDF').props.disabled,true);button(tree,'一键导出图纸核对PDF').props.onClick();tree=await app.flush();assert.equal(app.downloads.length,0);assert.ok(text(tree).includes('确认后才能生成PDF'));button(tree,'请核对').props.onClick();tree=await app.flush();assert.equal(button(tree,'一键导出图纸核对PDF').props.disabled,false);button(tree,'一键导出图纸核对PDF').props.onClick();tree=await app.flush();
  if(fails){assert.equal(app.downloads.length,0);assert.ok(nodes(tree).some(n=>n.props.role==='alert'&&text(n).includes('Synthetic PDF failure')));}
  else{assert.equal(app.downloads.length,1);assert.equal(app.downloads[0].name,'柜体图纸尺寸核对单.pdf');const link=nodes(tree).find(n=>n.type==='a'&&n.props.download==='柜体图纸尺寸核对单.pdf');assert.ok(link);assert.equal(link.props.href,app.downloads[0].href);assert.equal(app.revoked.includes(link.props.href),false);button(tree,'已核对').props.onClick();tree=await app.flush();assert.equal(button(tree,'一键导出图纸核对PDF').props.disabled,true);assert.ok(!nodes(tree).some(n=>n.type==='a'&&n.props.download==='柜体图纸尺寸核对单.pdf'));button(tree,'取消').props.onClick();await app.flush();assert.equal(app.revoked.includes(link.props.href),true);}
  app.unmount();
 }
});

test('one image expands into multiple cabinets and re-recognition replaces that file group without duplicates',async()=>{
 const app=harness();let tree=app.render();button(tree,'AI智能识别报价').props.onClick();tree=await app.flush();const file=image('two cabinets');app.events.get('paste')({clipboardData:{items:[{kind:'file',type:file.type,getAsFile:()=>file}],files:[file]},preventDefault(){}});tree=await app.flush();
 const first={...result(file,1313),address:'云顶12-1-201',room:'阳台',name:'洗衣机吊柜',height:'940'},second={...result(file,1312),room:'阳台',name:'洗衣机柜',height:'900'};
 app.requests[0].resolve([first,second]);tree=await app.flush();assert.equal(cards(tree).length,2);assert.match(text(tree),/2.41㎡/);assert.ok(!text(tree).includes('云顶12-1-201'));
 const thumbnails=nodes(tree).filter(n=>n.type==='img'&&n.props.alt?.startsWith('图纸'));assert.ok(thumbnails.length===0||thumbnails[0].props.src===thumbnails[1].props.src);
 button(tree,'重新识别').props.onClick();tree=await app.flush();app.requests[1].resolve([first,second]);tree=await app.flush();assert.equal(cards(tree).length,2);assert.match(text(tree),/2.41㎡/);app.unmount();
});

test('screenshot status is immediate before upload and OCR is absent; editing requires PDF reconfirmation',async()=>{
 const app=harness();let tree=app.render();button(tree,'AI智能识别报价').props.onClick();tree=await app.flush();assert.ok(!text(tree).includes('本地OCR'));
 const file=image('status');app.events.get('paste')({clipboardData:{items:[{kind:'file',type:file.type,getAsFile:()=>file}],files:[file]},preventDefault(){}});
 tree=app.render();assert.match(text(tree),/已检测到截图，正在读取图片/);tree=await app.flush();assert.ok(nodes(tree).some(n=>n.props.role==='status'&&text(n).includes('正在上传并解析图片')));
 app.requests[0].resolve(result(file,2000));tree=await app.flush();assert.match(text(tree),/图片上传解析完成/);button(tree,'请核对').props.onClick();tree=await app.flush();assert.equal(button(tree,'一键导出图纸核对PDF').props.disabled,false);
 const width=nodes(tree).find(n=>n.type==='input'&&n.props.value==='2000');width.props.onChange({target:{value:'2200'}});tree=await app.flush();assert.equal(button(tree,'一键导出图纸核对PDF').props.disabled,true);assert.ok(button(tree,'请核对'));app.unmount();
});

test('hidden recognized address names both automatic and manual PDF download without showing it in the dialog',async()=>{
 const app=harness();let tree=app.render();button(tree,'AI智能识别报价').props.onClick();tree=await app.flush();const file=image('address');app.events.get('paste')({clipboardData:{items:[{kind:'file',type:file.type,getAsFile:()=>file}],files:[file]},preventDefault(){}});tree=await app.flush();app.requests[0].resolve({...result(file,2000),address:'云顶12-1-201'});tree=await app.flush();assert.ok(!text(tree).includes('云顶12-1-201'));button(tree,'请核对').props.onClick();tree=await app.flush();button(tree,'一键导出图纸核对PDF').props.onClick();tree=await app.flush();assert.equal(app.downloads[0].name,'云顶12-1-201柜体图纸尺寸核对单.pdf');assert.ok(nodes(tree).some(n=>n.type==='a'&&n.props.download===app.downloads[0].name));assert.ok(!text(tree).includes('云顶12-1-201'));app.unmount();
});

const upload=(tree,files)=>nodes(tree).find(n=>n.type==='input'&&n.props['aria-label']==='上传图片或CAD').props.onChange({target:{files,value:'chosen'}});
test('one picker accepts mixed files in order, appends existing rows and filters duplicate cabinets',async()=>{
 const app=harness();let tree=app.render();button(tree,'AI智能识别报价').props.onClick();tree=await app.flush();assert.equal(nodes(tree).filter(n=>n.type==='button'&&/上传图片|上传CAD|上传图纸|继续上传图\/CAD/.test(text(n))).length,2);
 const sharedPicker=nodes(tree).find(n=>n.type==='input'&&n.props['aria-label']==='上传图片或CAD');let pickerOpens=0;sharedPicker.props.ref.current={click(){pickerOpens++;}};button(tree,'上传图片 / CAD').props.onClick();button(tree,'继续上传图/CAD').props.onClick();assert.equal(pickerOpens,2);
 const photo=image('mixed'),cad=new File(['synthetic'],'sample.DWG');upload(tree,[photo,cad]);tree=await app.flush();assert.equal(app.requests.length,1);assert.equal(app.requests[0].file,photo);assert.equal(button(tree,'上传图片 / CAD').props.disabled,true);
 app.requests[0].resolve(result(photo,2000));tree=await app.flush();assert.equal(app.requests.length,2);assert.equal(app.requests[1].cad,true);app.requests[1].resolve([{...result(cad,3000),name:'地柜',room:'厨房'},result(cad,2000)]);tree=await app.flush();assert.equal(cards(tree).length,2);assert.equal(button(tree,'上传图片 / CAD').props.disabled,false);
 const another=image('later');upload(tree,[another]);tree=await app.flush();app.requests[2].resolve(result(another,4000));tree=await app.flush();assert.equal(cards(tree).length,3);app.unmount();
});
test('mixed upload validates before requests, continues after a failed CAD and stops on close',async()=>{
 const app=harness();let tree=app.render();button(tree,'AI智能识别报价').props.onClick();tree=await app.flush();upload(tree,[image('valid'),new File(['bad'],'unsupported.pdf')]);tree=await app.flush();assert.equal(app.requests.length,0);assert.equal(cards(tree).length,0);assert.match(text(tree),/图片请选择/);
 const cad=new File(['synthetic'],'bad.dxf'),photo=image('after-failure');upload(tree,[cad,photo]);tree=await app.flush();app.requests[0].reject(Error('Synthetic CAD failure'));tree=await app.flush();assert.equal(app.requests.length,2);app.requests[1].resolve(result(photo,2000));tree=await app.flush();assert.equal(cards(tree).length,1);assert.match(text(tree),/部分文件识别失败/);
 upload(tree,[new File(['x'],'cancel.dxf'),image('must-not-upload')]);tree=await app.flush();assert.equal(app.requests.length,3);button(tree,'取消').props.onClick();tree=await app.flush();assert.equal(app.requests.length,3);assert.equal(nodes(tree).some(n=>n.props.role==='dialog'),false);app.unmount();
});
