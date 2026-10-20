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
  const scopes=new Map(),requests=[],dimensions=new WeakMap();let scope,cursor,effects,serial=0;
  class Element{focus(){}getClientRects(){return [1];}querySelectorAll(){return [];}}
  const document={activeElement:null,body:{style:{overflow:''}},createElement:()=>({click(){},remove(){},style:{}})};
  const window={location:{origin:'https://quote.test'},addEventListener(){},removeEventListener(){},open(){}};
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
  runInNewContext('(function(exports,require,module){'+source+'\n})',{console,Intl,Date,Number,String,Math,Set,Map,Error,Promise,URL,AbortController,FormData,File,Blob,HTMLElement:Element,document,window,navigator:{clipboard:{writeText:async()=>{}}},setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},crypto:{randomUUID:()=>`00000000-0000-4000-a000-${String(++serial).padStart(12,'0')}`},createImageBitmap:async file=>{const size=dimensions.get(file)||{width:200,height:230};return {...size,close(){}};},fetch:async(url,options={})=>{requests.push({url,options});return api(url,options);}})(loadedModule.exports,localRequire,loadedModule);
  function render(component=loadedModule.exports.default,props={}){const key=component;scope=scopes.get(key)||[];scopes.set(key,scope);cursor=0;effects=[];const tree=component(props);for(const effect of effects.splice(0))effect();return tree;}
  function unmount(){for(const slots of scopes.values())for(const slot of slots)slot?.cleanup?.();}
  return {exports:loadedModule.exports,render,requests,dimensions,MerchantPayment,unmount};
}
function nodes(node,result=[]){if(Array.isArray(node))for(const value of node)nodes(value,result);else if(React.isValidElement(node)){result.push(node);nodes(node.props.children,result);}return result;}
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):React.isValidElement(node)?text(node.props.children):'';
function find(tree,predicate,label){const node=nodes(tree).find(predicate);assert.ok(node,label);return node;}
const input=(tree,label)=>find(tree,node=>node.type==='input'&&node.props['aria-label']===label,'Input: '+label);
const select=(tree,label)=>find(tree,node=>node.type==='select'&&node.props['aria-label']===label,'Select: '+label);
const shareProps={quoteId:'quote-fixture',title:'离线测试报价',total:50000,onClose(){}};
const prevent={preventDefault(){}};

test('管理端选用已上传图片：只发 manual_code、图片ID和付款说明，预览不加载外部URL',async()=>{
  let created;
  const app=harness('app/quote-share.tsx',(url,options)=>{if(url==='/api/payment-codes')return response([code]);if(url.startsWith('/api/quote-shares?'))return response([]);assert.equal(url,'/api/quote-shares');created=JSON.parse(options.body);return response({id:'share-fixture',url:'https://quote.test/s/q/'+token,expires_at:snapshot.expires_at,payment_mode:'manual_code',payment_code:code,collection:snapshot.collection});});
  app.render(undefined,shareProps);await nextTurn();let tree=app.render(undefined,shareProps);
  assert.match(text(tree),/不附收款码/);select(tree,'选择收款码图片').props.onChange({target:{value:codeId}});tree=app.render(undefined,shareProps);
  assert.equal(find(tree,node=>node.type==='img','Selected preview').props.src,'/api/payment-codes?id='+codeId);
  input(tree,'收款项目名称').props.onChange({target:{value:'定金'}});input(tree,'本次收款金额（元）').props.onChange({target:{value:'100'}});tree=app.render(undefined,shareProps);
  find(tree,node=>node.type==='form','Share form').props.onSubmit(prevent);await nextTurn();tree=app.render(undefined,shareProps);
  assert.equal(created.args.payment_mode,'manual_code');assert.equal(created.args.payment_code_id,codeId);assert.equal(created.args.collection_name,'定金');assert.equal(created.args.collection_amount,100);assert.equal(created.action,'create');
  assert.match(text(tree),/付款后需联系你确认到账/);assert.match(text(tree),/查看报价二维码 · 用于打开报价/);assert.doesNotMatch(text(tree),/商户开通|自动登记|自动关联|自动同步|识别钱数/);
  assert.ok(app.requests.every(request=>!request.url.includes('quote-payments')&&!request.url.startsWith('https:')));app.unmount();
});

test('图片上传使用multipart原File，上传成功自动选择；不能生成时篡改旧图片记录',async()=>{
  let posted;
  const uploaded={...code,id:newCodeId,label:'我的微信收款码'};
  const app=harness('app/quote-share.tsx',(url,options)=>{if(url.startsWith('/api/quote-shares?'))return response([]);assert.equal(url,'/api/payment-codes');if(options.method==='POST'){posted=options;return response(uploaded);}return response([code]);});
  app.render(undefined,shareProps);await nextTurn();let tree=app.render(undefined,shareProps);
  input(tree,'上传收款码名称').props.onChange({target:{value:'我的微信收款码'}});tree=app.render(undefined,shareProps);
  const file=new File([new Uint8Array([137,80,78,71])],'fixture.png',{type:'image/png'});
  input(tree,'上传收款码图片文件').props.onChange({target:{files:[file]}});tree=app.render(undefined,shareProps);assert.match(text(tree),/正在上传收款码/);await nextTurn();tree=app.render(undefined,shareProps);
  assert.ok(posted.body instanceof FormData);assert.equal(posted.headers,undefined);assert.equal(posted.body.get('label'),'我的微信收款码');assert.equal(posted.body.get('image').name,'fixture.png');assert.equal(posted.body.get('image').type,'image/png');
  assert.equal(select(tree,'选择收款码图片').props.value,newCodeId);assert.equal(nodes(tree).filter(node=>node.type==='option'&&[codeId,newCodeId].includes(node.props.value)).length,2);assert.match(text(tree),/已上传并选中/);assert.ok(app.requests.every(request=>!['PUT','PATCH','DELETE'].includes(request.options.method)));app.unmount();
});

test('非法格式、超过5MB和超4096像素的文件都在发起上传前被拒绝',async()=>{
  const app=harness('app/quote-share.tsx',url=>url==='/api/payment-codes'?response([]):response([]));app.render(undefined,shareProps);await nextTurn();
  const files=[new File(['x'],'fixture.svg',{type:'image/svg+xml'}),new File([new Uint8Array(5*1024*1024+1)],'large.png',{type:'image/png'}),new File(['x'],'wide.jpg',{type:'image/jpeg'})];
  app.dimensions.set(files[2],{width:4097,height:100});
  for(const [index,file] of files.entries()){const tree=app.render(undefined,shareProps);input(tree,'上传收款码图片文件').props.onChange({target:{files:[file]}});await nextTurn();const updated=app.render(undefined,shareProps);assert.match(text(updated),[/PNG 或 JPG/,/不超过 5 MB/,/不能超过 4096 像素/][index]);}
  assert.equal(app.requests.filter(request=>request.options.method==='POST').length,0);app.unmount();
});

test('不附收款码生成纯报价，显式使用manual模式且省略图片与收款说明字段',async()=>{
  let created;
  const app=harness('app/quote-share.tsx',(url,options)=>{if(options.method==='POST'){created=JSON.parse(options.body);return response({id:'share-fixture',url:'https://quote.test/s/q/'+token,expires_at:snapshot.expires_at,payment_mode:'manual_code',payment_code:null,collection:null});}return response([]);});
  app.render(undefined,shareProps);await nextTurn();const tree=app.render(undefined,shareProps);find(tree,node=>node.type==='form','Form').props.onSubmit(prevent);await nextTurn();
  assert.equal(created.args.payment_mode,'manual_code');for(const field of ['payment_code_id','collection_name','collection_amount'])assert.equal(field in created.args,false);app.unmount();
});

test('上传接口失败保留原选中收款码，以中文错误提示而不泄露原始解析异常',async()=>{
  const app=harness('app/quote-share.tsx',(url,options)=>{if(options.method==='POST')return {ok:false,status:503,json:async()=>{throw new SyntaxError('Unexpected token secret_internal_response');}};return response(url==='/api/payment-codes'?[code]:[]);});
  app.render(undefined,shareProps);await nextTurn();let tree=app.render(undefined,shareProps);select(tree,'选择收款码图片').props.onChange({target:{value:codeId}});tree=app.render(undefined,shareProps);
  input(tree,'上传收款码图片文件').props.onChange({target:{files:[new File(['mock image only'],'fixture.png',{type:'image/png'})]}});await nextTurn();tree=app.render(undefined,shareProps);
  assert.equal(select(tree,'选择收款码图片').props.value,codeId);assert.match(text(tree),/收款码上传失败，请重试/);assert.doesNotMatch(text(tree),/Unexpected|secret_internal_response/);app.unmount();
});

test('客户收款图片只请求token受控路径，微信长按说明和人工确认始终可见',async()=>{
  const app=harness('app/s/q/[token]/shared-quote.tsx',url=>{assert.equal(url,'/api/shared-quote?token='+token);return response(snapshot);});
  app.render(undefined,{token});await nextTurn();const tree=app.render(undefined,{token});assert.equal(nodes(tree).some(node=>node.type===app.MerchantPayment),false);
  const manual=find(tree,node=>node.type===app.exports.ManualQuotePayment,'Manual payment');let section=app.render(app.exports.ManualQuotePayment,manual.props);
  const image=find(section,node=>node.type==='img','Customer image');assert.equal(image.props.src,'/api/shared-quote?token='+token+'&format=payment-code');assert.match(text(section),/定金/);assert.match(text(section),/100\.00/);assert.match(text(section),/长按收款码图片识别/);assert.match(text(section),/付款后请联系商家确认到账/);assert.doesNotMatch(text(section),/付款成功|已确认到账|自动/);
  image.props.onError();section=app.render(app.exports.ManualQuotePayment,manual.props);assert.match(text(section),/图片暂时无法显示/);assert.equal(nodes(section).some(node=>node.type==='img'),false);assert.equal(app.requests.length,1);app.unmount();
});

test('manual模式或静态图片不会挂载商户组件；纯报价没有空付款区域',async()=>{
  for(const overrides of [{payment_mode:'manual_code',payment_enabled:true},{payment_mode:'wechat',payment_enabled:true,payment_code:code},{payment_mode:'manual_code',payment_code:null,collection:null}]){
    const app=harness('app/s/q/[token]/shared-quote.tsx',()=>response({...snapshot,...overrides}));app.render(undefined,{token});await nextTurn();const tree=app.render(undefined,{token});assert.equal(nodes(tree).some(node=>node.type===app.MerchantPayment),false);
    if(overrides.collection===null)assert.equal(nodes(tree).some(node=>node.type===app.exports.ManualQuotePayment),false);assert.ok(app.requests.every(request=>!request.url.includes('quote-payments')));app.unmount();
  }
  const app=harness('app/s/q/[token]/shared-quote.tsx',()=>response({...snapshot,payment_mode:'wechat',payment_enabled:true,payment_code:null}));app.render(undefined,{token});await nextTurn();assert.equal(nodes(app.render(undefined,{token})).some(node=>node.type===app.MerchantPayment),true);app.unmount();
});

test('静态收款模块SSR输出受控图片与付款说明，不出现支付成功或自动入账承诺',()=>{
  const file='app/s/q/[token]/shared-quote.tsx',source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,loadedModule={exports:{}};
  const localRequire=name=>name.endsWith('.css')?{}:name==='./quote-payment'?{__esModule:true,default:()=>null}:require(name);
  runInNewContext('(function(exports,require,module){'+source+'\n})',{Intl,Number,String,Math,Date,Set,Error})(loadedModule.exports,localRequire,loadedModule);
  const html=renderToStaticMarkup(React.createElement(loadedModule.exports.ManualQuotePayment,{token,collection:snapshot.collection,code}));
  assert.match(html,/format=payment-code/);assert.match(html,/aria-label="收款码及付款说明"/);assert.match(html,/定金/);assert.match(html,/100\.00/);assert.match(html,/付款后请联系商家确认到账/);assert.doesNotMatch(html,/untrusted\.test|quote-payments|付款成功|自动/);
});
