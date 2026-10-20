import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {setImmediate as nextTurn} from 'node:timers/promises';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url),codeId='8133f6a9-2349-4d5c-a165-17cdb1dc3e4e',newCodeId='12993450-44a1-4902-a9cb-dc2be0915e43',token='a'.repeat(64);
const code={id:codeId,label:'测试收款码',content_type:'image/png',width:200,height:230,created:'2026-10-13T01:00:00Z',image_url:'https://untrusted.test/must-not-load.png'};
const snapshot={company_name:'测试公司',project_name:'样例项目',customer:'样例客户',title:'样例报价',created:'2026-10-13T01:00:00Z',expires_at:'2099-10-13T01:00:00Z',rooms:[],items:[{name:'衣柜',model:'样例规格',unit:'项',quantity:1,price:500,category:'柜体'}],total:50000,settlement:null,customer_note:'仅为离线验证样例',collection:{name:'定金',amount:10000},payment_mode:'manual_code',payment_code:code,payment_enabled:false};
const response=result=>({ok:true,status:200,headers:{get:()=>null},json:async()=>({ok:true,result,availability:{enabled:false,message:'仅供测试预览'}})});

// Real component handlers run with detached hook scopes and entirely in-memory API fixtures.
// No request reaches a server, and the image fixture is never uploaded to production.
function harness(file,api){
  const scopes=new Map(),requests=[],dimensions=new WeakMap(),qrTexts=[];let scope,cursor,effects,serial=0;
  class Element{focus(){}getClientRects(){return [1];}querySelectorAll(){return [];}}
  const document={activeElement:null,body:{style:{overflow:''}},createElement:tag=>tag==='canvas'?{getContext:()=>({fillRect(){},beginPath(){},roundRect(){},fill(){},stroke(){},drawImage(){},fillText(value){qrTexts.push(value);}}),toDataURL:()=> 'data:image/png;base64,OFFLINE_QR_CARD'}:{click(){},remove(){},style:{}}};
  const window={location:{origin:'https://quote.test'},addEventListener(){},removeEventListener(){},open(){},innerWidth:800,matchMedia:()=>({matches:true})};
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  const hooks={...React,
    useState(initial){const index=cursor++;if(!scope[index])scope[index]={value:typeof initial==='function'?initial():initial};const slot=scope[index];return [slot.value,value=>{slot.value=typeof value==='function'?value(slot.value):value;}];},
    useRef(initial){const index=cursor++;if(!scope[index])scope[index]={value:{current:initial}};return scope[index].value;},
    useMemo(callback,deps){const index=cursor++;if(!scope[index]||!same(scope[index].deps,deps))scope[index]={value:callback(),deps};return scope[index].value;},
    useCallback(callback,deps){return hooks.useMemo(()=>callback,deps);},
    useEffect(effect,deps){const index=cursor++;if(!scope[index]||!same(scope[index].deps,deps)){const old=scope[index];scope[index]={deps};effects.push(()=>{old?.cleanup?.();scope[index].cleanup=effect();});}},
  };
  function MerchantPayment(){return React.createElement('merchant-payment-probe');}
  const source=ts.transpileModule(readFileSync(resolve(file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const loadedModule={exports:{}};
  function localRequire(name){if(name==='react')return hooks;if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});if(name.endsWith('.css'))return {};if(name==='./quote-payment')return {__esModule:true,default:MerchantPayment};if(name==='qrcode')return {toDataURL:async url=>'data:image/png;base64,'+Buffer.from(url).toString('base64')};return require(name);}
  runInNewContext('(function(exports,require,module){'+source+'\n})',{console,Intl,Date,Number,String,Math,Set,Map,Error,Promise,URL,AbortController,FormData,File,Blob,HTMLElement:Element,Image:class{async decode(){}},document,window,navigator:{clipboard:{writeText:async()=>{}}},setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},crypto:{randomUUID:()=>`00000000-0000-4000-a000-${String(++serial).padStart(12,'0')}`},createImageBitmap:async file=>{const size=dimensions.get(file)||{width:200,height:230};return {...size,close(){}};},fetch:async(url,options={})=>{requests.push({url,options});return api(url,options);}})(loadedModule.exports,localRequire,loadedModule);
  function render(component=loadedModule.exports.default,props={}){const key=component;scope=scopes.get(key)||[];scopes.set(key,scope);cursor=0;effects=[];const tree=component(props);for(const effect of effects.splice(0))effect();return tree;}
  function unmount(){for(const slots of scopes.values())for(const slot of slots)slot?.cleanup?.();}
  return {exports:loadedModule.exports,render,requests,dimensions,qrTexts,MerchantPayment,unmount};
}
function nodes(node,result=[]){if(Array.isArray(node))for(const value of node)nodes(value,result);else if(React.isValidElement(node)){result.push(node);nodes(node.props.children,result);}return result;}
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):React.isValidElement(node)?text(node.props.children):'';
function find(tree,predicate,label){const node=nodes(tree).find(predicate);assert.ok(node,label);return node;}
const input=(tree,label)=>find(tree,node=>node.type==='input'&&node.props['aria-label']===label,'Input: '+label);
const select=(tree,label)=>find(tree,node=>node.type==='select'&&node.props['aria-label']===label,'Select: '+label);
const shareProps={quoteId:'quote-fixture',title:'离线测试报价',total:50000,onClose(){}};
const prevent={preventDefault(){}};


const quote={company_name:'隔离测试公司',title:'虚构报价',signature:null,signed_at:null,expires_at:'2099-10-13T01:00:00Z'};
const btn=(tree,label)=>find(tree,n=>n.type==='button'&&text(n)===label,label);
test('客户必须实际手写并核对才可提交，确认后使用服务器时间并显示三种下载方式',async()=>{
 let posted;
 const app=harness('app/s/q/[token]/shared-quote.tsx',(_url,options)=>{if(options.method==='POST'){posted=JSON.parse(options.body);return response({signed_at:'2026-10-20T13:00:00.000Z'});}return response(quote);});
 const props={token};app.render(undefined,props);await nextTurn();let tree=app.render(undefined,props);
 assert.match(text(tree),/待确认/);assert.equal(btn(tree,'确认提交').props.disabled,true);btn(tree,'点击此处签字').props.onClick();tree=app.render(undefined,props);
 const node=find(tree,n=>n.type==='canvas','signature canvas');
 const fake={width:1200,height:420,getBoundingClientRect:()=>({left:10,top:20,right:210,width:200,height:600}),getContext:()=>({beginPath(){},moveTo(){},lineTo(){},stroke(){},fillRect(){}}),setPointerCapture(){},toDataURL:()=> 'data:image/png;base64,ISOLATED_CANVAS_PROBE'};
 node.props.ref.current=fake;
 btn(tree,'完成书写').props.onClick();tree=app.render(undefined,props);assert.match(text(tree),/请先手写签名/);
 const event=(x,y)=>({preventDefault(){},clientX:x,clientY:y,pointerId:1,currentTarget:fake});
 node.props.onPointerDown(event(180,80));node.props.onPointerMove(event(100,280));node.props.onPointerUp();
 btn(tree,'完成书写').props.onClick();tree=app.render(undefined,props);
 assert.equal(btn(tree,'确认提交').props.disabled,false);btn(tree,'确认提交').props.onClick();await nextTurn();tree=app.render(undefined,props);
 assert.deepEqual(posted,{signature:'data:image/png;base64,ISOLATED_CANVAS_PROBE'});
 assert.match(text(tree),/已签字确认/);assert.equal(nodes(tree).filter(n=>n.type==='a'&&n.props.download).length,2);
 assert.match(text(tree),/下载签字表格图片/);assert.equal(nodes(tree).some(n=>n.type==='button'&&text(n).includes('重新手写签字')),false);
 app.unmount();
});
test('后台二维码绑定所选报价且保存Excel模式快照，签字刷新后可访问存根',async()=>{
 let posted,signed=false;const record={id:'00000000-0000-4000-a000-000000000001',url:'https://quote.test/s/q/'+token,created:'2026-10-20T10:00:00.000Z',expires_at:'2099-10-13T01:00:00Z',signed:false,signed_at:null};
 const app=harness('app/quote-confirm-share.tsx',(_url,options)=>{if(options.method==='POST'){posted=JSON.parse(options.body);return response(record);}return response(posted?[{...record,signed,signed_at:signed?'2026-10-20T13:00:00.000Z':null}]:[]);});
 app.render(undefined,shareProps);await nextTurn();let tree=app.render(undefined,shareProps);
 btn(tree,'生成待确认表格二维码').props.onClick();await nextTurn();await nextTurn();tree=app.render(undefined,shareProps);
 assert.equal(posted.args.quote_id,shareProps.quoteId);assert.equal(posted.args.document_mode,'excel_confirmation');assert.match(text(tree),/待客户确认/);assert.match(text(tree),/客户确定单/);assert.match(text(tree),/固美格SI超级智能平台/);assert.doesNotMatch(text(tree),/微信扫一扫|逐项确认并手写签字/);
 assert.ok(nodes(tree).some(n=>n.type==='img'&&n.props.alt==='Excel版式报价确认单存根'));
 await nextTurn();tree=app.render(undefined,shareProps);assert.equal(btn(tree,'下载二维码').props.disabled,false);btn(tree,'下载二维码').props.onClick();await nextTurn();assert.ok(app.qrTexts.includes('固美格全屋定制'));assert.ok(app.qrTexts.includes('客户确定单'));assert.ok(app.qrTexts.includes('固美格SI超级智能平台'));assert.ok(!app.qrTexts.some(value=>/扫码|查看完整表格/.test(value)));
 signed=true;btn(tree,'刷新签字状态').props.onClick();await nextTurn();tree=app.render(undefined,shareProps);assert.match(text(tree),/已签字确认/);
 const links=nodes(tree).filter(n=>n.type==='a').map(n=>n.props.href);assert.ok(links.some(url=>url.includes('receipt_id='+record.id)&&url.endsWith('format=pdf')));
 app.unmount();
});
