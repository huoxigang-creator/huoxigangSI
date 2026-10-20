import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {setImmediate as nextTurn} from 'node:timers/promises';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const row=(overrides={})=>({id:'fixture-row-1',selected:true,category:'五金费用',name:'离线示例铰链',model:'虚构型号',brand:'示例品牌',code:'DEMO-001',unit:'只',quantity:'2',price:'10',sourceAmount:'20',note:'本机虚构测试明细',batch:'演示批次',source:'离线演示图片.png · 第1行',attribute:'辅材',confidence:86,...overrides});
const fixture=(overrides={})=>({rows:[row()],warnings:[],priceKind:'sales',sources:['离线演示图片.png'],...overrides});
const file=(name='离线演示图片.png',size=100)=>({name,size});
const props=()=>({mode:'quote',defaultCategory:'五金费用',disabled:false,maxItems:500,currentItemCount:1,onApply(){}});
function loadComponent(react,readDocumentFiles,environment={}){
 const cache=new Map();
 function load(path){if(cache.has(path))return cache.get(path).exports;const loadedModule={exports:{}};cache.set(path,loadedModule);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  function localRequire(name){if(name==='react')return react;if(name==='react-dom')return {createPortal:children=>children};if(name.endsWith('.css'))return {};if(name.endsWith('/document-scan'))return {readDocumentFiles};if(name.startsWith('.')){const base=resolve(dirname(path),name),target=[base,base+'.ts',base+'.tsx'].find(existsSync);assert.ok(target,name);return load(target);}return require(name);}
  runInNewContext('(function(exports,require,module){'+code+'\n})',{console,Intl,Number,String,Math,Set,Map,Error,AbortController,crypto:globalThis.crypto,...environment})(loadedModule.exports,localRequire,loadedModule);return loadedModule.exports;
 }
 return load(resolve('app/document-import.tsx')).default;
}
function elements(node){if(Array.isArray(node))return node.flatMap(elements);if(!React.isValidElement(node))return[];return[node,...elements(node.props.children)];}
function text(node){if(Array.isArray(node))return node.map(text).join('');return React.isValidElement(node)?text(node.props.children):typeof node==='string'||typeof node==='number'?String(node):'';}
function find(tree,predicate,label){const found=elements(tree).find(predicate);assert.ok(found,label);return found;}
const button=(tree,label)=>find(tree,node=>node.type==='button'&&text(node)===label,label);
const field=(tree,label)=>find(tree,node=>node.props['aria-label']===label,label);
const dialog=tree=>find(tree,node=>node.props.role==='dialog','Import preview dialog');
async function settle(){await nextTurn();await nextTurn();}

function harness({preview=fixture(),read,overrides={},onApply}={}){
 const slots=[],effects=[],calls=[],applied=[],busy=[],draft=[{id:'existing-draft',name:'原列表明细'}];let cursor=0,clicks=0;
 const doc={body:{style:{overflow:''}},activeElement:null};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const hooks={...React,
  useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,value=>{slots[index].value=typeof value==='function'?value(slots[index].value):value;}];},
  useRef(initial){const index=cursor++;if(!slots[index])slots[index]={value:{current:initial}};return slots[index].value;},
  useId(){const index=cursor++;if(!slots[index])slots[index]={value:'offline-import-'+index};return slots[index].value;},
  useEffect(effect,deps){const index=cursor++,old=slots[index];if(!old||!same(old.deps,deps)){slots[index]={deps,cleanup:old?.cleanup};effects.push(()=>{old?.cleanup?.();slots[index].cleanup=effect();});}},
 };
 const scan=async(files,options)=>{calls.push({files,options});return read?read(files,options,calls.length):JSON.parse(JSON.stringify(preview));};
 const Component=loadComponent(hooks,scan,{document:doc});
 const current={...props(),...overrides,onApply:rows=>{onApply?.(rows);applied.push(JSON.parse(JSON.stringify(rows)));draft.push(...rows.map(row=>({...row})));},onBusyChange:value=>busy.push(value)};
 function render(overrides={}){Object.assign(current,overrides);cursor=0;effects.length=0;const tree=Component(current);for(const node of elements(tree)){const ref=node.props.ref;if(ref&&typeof ref==='object'){if(node.props.role==='dialog')ref.current={hidden:false,focus(){doc.activeElement=this;},contains(value){return value===this;},querySelectorAll(){return[];},getAttribute(){return null;}};else ref.current={focus(){doc.activeElement=this;},click(){clicks++;}};}}for(const effect of effects.splice(0))effect();return tree;}
 function choose(files=[file()]){const tree=render(),input=field(tree,'选择需要识别的明细文件'),target={files,value:'previous-selection'};input.props.onChange({currentTarget:target});assert.equal(target.value,'','the file picker resets so the same file can be retried');return render();}
 return {render,choose,calls,applied,busy,draft,current,doc,get clicks(){return clicks;},unmount(){for(const slot of slots)slot?.cleanup?.();}};
}

test('actual React server render needs no browser APIs and exposes the supported picker without nested forms',()=>{
 let reads=0;const Component=loadComponent(React,async()=>{reads++;throw new Error('SSR must not recognize');});
 const html=renderToStaticMarkup(React.createElement(Component,props()));assert.match(html,/上传识别/);assert.match(html,/\.docx/);assert.match(html,/multiple/);assert.doesNotMatch(html,/<form|role="dialog"/);assert.equal(reads,0);
});
test('quote cost import keeps blanks and source prices, requires explicit confirmation, and appends only selected corrected drafts',async()=>{
 const preview=fixture({priceKind:'cost',warnings:['成本单价，请核对销售用途。'],rows:[row({sourceAmount:'30'}),row({id:'fixture-missing',name:'待核对项',quantity:'',price:'',sourceAmount:'',source:'离线演示图片.png · 第2行'})]}),before=JSON.stringify(preview),app=harness({preview});
 app.choose();await settle();let tree=app.render();assert.equal(elements(tree).some(node=>node.type==='form'),false);assert.equal(field(tree,'第2行 数量').props.value,'');assert.equal(field(tree,'第2行 销售单价').props.value,'');assert.equal(field(tree,'第1行 销售单价').props.value,'10');assert.match(text(tree),/当前金额差异/);assert.equal(button(tree,'复制到下方列表').props.disabled,true);assert.deepEqual(app.busy,[true]);assert.equal(app.draft.length,1);
 field(tree,'选择第2行 待核对项').props.onChange({target:{checked:false}});tree=app.render();assert.equal(button(tree,'复制到下方列表').props.disabled,true,'cost price confirmation still required after resolving selection');
 field(tree,'第1行 销售单价').props.onChange({target:{value:'15.00'}});tree=app.render();assert.doesNotMatch(text(tree),/当前金额差异/);const consent=find(tree,node=>node.type==='label'&&text(node)==='将识别的采购单价用作销售单价','cost confirmation');find(consent,node=>node.type==='input','consent checkbox').props.onChange({target:{checked:true}});tree=app.render();assert.equal(button(tree,'复制到下方列表').props.disabled,false);
 button(tree,'复制到下方列表').props.onClick();tree=app.render();assert.equal(elements(tree).some(node=>node.props.role==='dialog'),false);assert.deepEqual(app.busy,[true,false]);assert.equal(app.draft[0].name,'原列表明细');assert.equal(app.draft.length,2);assert.equal(app.applied.length,1);assert.equal(app.applied[0][0].price,'15.00');assert.equal(app.applied[0][0].sourceAmount,'30');assert.equal(JSON.stringify(preview),before,'preview edits never mutate the recognition result');
});
test('purchase preview exposes two categories and editable metadata, allows legitimate duplicate rows and keeps original source prices',async()=>{
 const app=harness({preview:fixture({priceKind:'cost',rows:[row(),row({id:'fixture-duplicate',source:'离线演示图片.png · 第2行'})]}),overrides:{mode:'purchase',maxItems:200}});app.choose([file('离线采购演示.docx')]);await settle();let tree=app.render();assert.match(text(tree),/存在重复明细/);assert.equal(button(tree,'复制到下方列表').props.disabled,false);assert.equal(elements(tree).some(node=>node.type==='label'&&text(node).includes('将识别的采购单价')),false);
 const category=field(tree,'第1行 费用类别');assert.deepEqual(elements(category).filter(node=>node.type==='option').map(text),['材料费用','五金费用']);for(const [caption,value] of [['品牌','修改品牌'],['代码','演示编码'],['批次','修改批次'],['规格','新规格']]){field(tree,'第1行 '+caption).props.onChange({target:{value}});tree=app.render();}field(tree,'第1行 属性').props.onChange({target:{value:'主材'}});tree=app.render();button(tree,'复制到下方列表').props.onClick();app.render();assert.equal(app.applied[0].length,2);assert.deepEqual(app.applied[0].map(row=>row.price),['10','10']);assert.equal(app.applied[0][0].brand,'修改品牌');assert.equal(app.applied[0][0].code,'演示编码');assert.equal(app.applied[0][0].batch,'修改批次');assert.equal(app.applied[0][0].attribute,'主材');assert.equal(app.draft.length,3);
});
test('purchase preview rounds 1.005 at one yuan to 1.01 exactly like the purchase draft while quotes keep their existing rule',async()=>{
 const preview=fixture({rows:[row({quantity:'1.005',price:'1',sourceAmount:'1.01'})]});
 const purchase=harness({preview,overrides:{mode:'purchase',maxItems:200}});purchase.choose();await settle();let tree=purchase.render();
 assert.ok(elements(tree).some(node=>node.type==='td'&&node.props.className==='diAmount'&&text(node)==='¥1.01'),'calculated purchase amount is 1.01 yuan');
 assert.doesNotMatch(text(tree),/当前金额差异|与识别原金额不同/);assert.equal(button(tree,'复制到下方列表').props.disabled,false);
 button(tree,'复制到下方列表').props.onClick();purchase.render();assert.equal(purchase.applied[0][0].quantity,'1.005');assert.equal(purchase.applied[0][0].price,'1');
 const quote=harness({preview});quote.choose();await settle();tree=quote.render();
 assert.ok(elements(tree).some(node=>node.type==='td'&&text(node).startsWith('¥1.00')),'quote amount keeps its existing rounding rule');
 assert.match(text(tree),/当前金额差异/);
});
test('progress cancel aborts recognition and ignores late results, with no draft changes',async()=>{
 let resolve;const pending=new Promise(done=>{resolve=done;});const app=harness({read:async()=>pending});let tree=app.choose();assert.equal(app.calls.length,1);const options=app.calls[0].options;assert.equal(options.mode,'quote');assert.equal(options.defaultCategory,'五金费用');options.onProgress('正在识别第2页',42);tree=app.render();assert.match(text(tree),/正在识别第2页/);assert.equal(find(tree,node=>node.type==='progress','progress').props.value,42);button(tree,'取消识别').props.onClick();app.render();assert.equal(options.signal.aborted,true);assert.deepEqual(app.busy,[true,false]);resolve(fixture());await settle();tree=app.render();assert.equal(elements(tree).some(node=>node.props.role==='dialog'),false);assert.equal(app.applied.length,0);assert.equal(app.draft.length,1);
});
test('recognition errors offer safe retry, hide raw English stacks, and remain cancelable when external busy changes',async()=>{
 const app=harness({read:async(_files,_options,attempt)=>{if(attempt===1)throw new Error('Cannot load wasm: C:/private/runtime/path\n at internalEngine:999');return fixture();}});app.choose();await settle();let tree=app.render();assert.match(text(tree),/文件识别失败/);assert.doesNotMatch(text(tree),/Cannot load|private\/runtime|internalEngine/);button(tree,'重新识别').props.onClick();await settle();tree=app.render();assert.equal(app.calls.length,2);assert.equal(button(tree,'复制到下方列表').props.disabled,false);assert.deepEqual(app.busy,[true]);tree=app.render({disabled:true});assert.equal(button(tree,'复制到下方列表').props.disabled,true);button(tree,'取消导入').props.onClick();app.render();assert.equal(app.applied.length,0);assert.deepEqual(app.busy,[true,false]);
});
test('picker enforces count, per-file and aggregate limits before invoking recognition',async()=>{
 for(const files of [Array.from({length:6},(_,index)=>file('file-'+index+'.png')), [file('旧格式.doc')], [file('过大.pdf',10*1024*1024+1)], [file('一.png',9*1024*1024),file('二.png',9*1024*1024),file('三.png',9*1024*1024)], [file('空.txt',0)]]){const app=harness();let tree=app.choose(files);await settle();tree=app.render();assert.equal(app.calls.length,0);assert.equal(app.applied.length,0);assert.ok(elements(tree).some(node=>node.props.role==='alert'));button(tree,'取消导入').props.onClick();app.render();assert.deepEqual(app.busy,[true,false]);}
});
test('remaining row capacity blocks oversized append and Escape closes the preview without applying',async()=>{
 const app=harness({preview:fixture({rows:[row(),row({id:'row-2',name:'另一项'})]}),overrides:{currentItemCount:499,maxItems:500}});app.choose();await settle();let tree=app.render();assert.match(text(tree),/合计超过500条/);assert.equal(button(tree,'复制到下方列表').props.disabled,true);field(tree,'选择第2行 另一项').props.onChange({target:{checked:false}});tree=app.render();assert.equal(button(tree,'复制到下方列表').props.disabled,false);let prevented=false,stopped=false;dialog(tree).props.onKeyDown({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});tree=app.render();assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(elements(tree).some(node=>node.props.role==='dialog'),false);assert.equal(app.applied.length,0);assert.equal(app.doc.body.style.overflow,'');
});
test('unknown price kind warns, amount OCR can be corrected explicitly, and failed copy preserves preview for retry',async()=>{
 let attempts=0;const app=harness({preview:fixture({priceKind:'unknown',rows:[row({sourceAmount:'识别错误金额'})]}),onApply:()=>{if(++attempts===1)throw new Error('当前草稿不能复制，请重试。');}});app.choose();await settle();let tree=app.render();assert.match(text(tree),/未明确识别单价类型/);assert.equal(button(tree,'复制到下方列表').props.disabled,true);field(tree,'第1行 识别原金额').props.onChange({target:{value:'20'}});tree=app.render();assert.equal(button(tree,'复制到下方列表').props.disabled,false);button(tree,'复制到下方列表').props.onClick();tree=app.render();assert.match(text(tree),/当前草稿不能复制/);assert.equal(app.applied.length,0);assert.ok(dialog(tree));button(tree,'复制到下方列表').props.onClick();app.render();assert.equal(app.applied.length,1);assert.equal(app.applied[0][0].price,'10');
});

test('only four fields can copy without a price, but an explicitly invalid price still blocks copying',async()=>{
 const app=harness({preview:fixture({priceKind:'cost',rows:[row({name:'需补报价板材',model:'18mm',quantity:'2.5',unit:'张',price:'',sourceAmount:''})]})});app.choose();await settle();let tree=app.render();assert.equal(field(tree,'第1行 销售单价').props.value,'');assert.match(text(tree),/价格会保留空白，请在保存前补齐/);assert.equal(elements(tree).some(node=>node.type==='label'&&text(node).includes('将识别的采购单价')),false);assert.equal(button(tree,'复制到下方列表').props.disabled,false);field(tree,'第1行 销售单价').props.onChange({target:{value:'待报价'}});tree=app.render();assert.equal(button(tree,'复制到下方列表').props.disabled,true);field(tree,'第1行 销售单价').props.onChange({target:{value:''}});tree=app.render();button(tree,'复制到下方列表').props.onClick();app.render();assert.deepEqual(app.applied[0].map(value=>[value.name,value.model,value.quantity,value.unit,value.price]),[['需补报价板材','18mm','2.5','张','']]);assert.equal(app.draft[0].name,'原列表明细');
});

test('manual column correspondence maps reordered four-column source into same fields and replaces only its source preview',async()=>{
 const sourceA={id:'source-a',source:'无表头图片 · 第1页',headerRow:null,mapping:{},priceKind:'unknown',cells:[['18mm','2.5','识别板材','张'],['9mm','1','识别背板','张']]};
 const sourceB={id:'source-b',source:'其它文件.csv',headerRow:0,mapping:{name:0,model:1,quantity:2,unit:3,price:4},priceKind:'sales',cells:[['名称','规格','数量','单位','销售单价'],['保留其它来源','其它规格','3','只','8']]};
 const preserved=row({id:'preserved-source',tableId:'source-b',name:'保留其它来源',model:'其它规格',quantity:'3',unit:'只',price:'8',sourceAmount:'',source:'其它文件.csv · 第2行'});
 const preview=fixture({priceKind:'unknown',sources:[sourceA.source,sourceB.source],tables:[sourceA,sourceB],rows:[row({tableId:'source-a',name:'18mm',model:'',quantity:'',unit:'',price:'',sourceAmount:'',note:'待核对原文：18mm | 2.5 | 识别板材 | 张'}),preserved]});const original=JSON.stringify(preview),app=harness({preview});app.choose();await settle();let tree=app.render();assert.equal(button(tree,'栏目对应').props['aria-expanded'],true);assert.equal(field(tree,'数据起始行').props.value,'1');assert.match(text(find(tree,node=>node.props.className==='diRawTable','Raw source')),/18mm.*2.5.*识别板材.*张/);
 for(const [caption,column]of [['名称','2'],['规格','0'],['数量','1'],['单位','3']]){field(tree,'对应'+caption+'列').props.onChange({target:{value:column}});tree=app.render();}assert.equal(button(tree,'复制到下方列表').props.disabled,true,'unapplied column edits cannot copy stale rows');button(tree,'应用栏目对应').props.onClick();tree=app.render();assert.equal(field(tree,'第1行 名称').props.value,'识别板材');assert.equal(field(tree,'第1行 规格').props.value,'18mm');assert.equal(field(tree,'第1行 数量').props.value,'2.5');assert.equal(field(tree,'第1行 单位').props.value,'张');assert.equal(field(tree,'第1行 销售单价').props.value,'');assert.equal(field(tree,'第3行 名称').props.value,'保留其它来源');assert.equal(app.applied.length,0);assert.equal(app.draft.length,1);assert.match(text(tree),/仅更新本来源的识别预览/);button(tree,'应用栏目对应').props.onClick();tree=app.render();assert.equal(elements(tree).filter(node=>node.props['aria-label']?.match(/^第\d+行 名称$/)).length,3,'remapping again replaces rather than duplicating rows');field(tree,'第1行 名称').props.onChange({target:{value:'修正名称错字'}});tree=app.render();button(tree,'复制到下方列表').props.onClick();app.render();assert.deepEqual(app.applied[0].slice(0,2).map(value=>[value.name,value.model,value.quantity,value.unit,value.price]),[['修正名称错字','18mm','2.5','张',''],['识别背板','9mm','1','张','']]);assert.deepEqual(app.applied[0][2],preserved);assert.equal(app.draft[0].name,'原列表明细');assert.equal(JSON.stringify(preview),original);
});

test('source switching defaults to row after header and invalid duplicate column correspondence preserves all preview rows',async()=>{
 const tableA={id:'a',source:'来源A',headerRow:null,mapping:{name:0,model:1,quantity:2,unit:3},priceKind:'unknown',cells:[['保留A','A规格','1','张']]},tableB={id:'b',source:'来源B',headerRow:0,mapping:{name:0,model:1,quantity:2,unit:3},priceKind:'unknown',cells:[['名称','规格','数量','单位'],['保留B','B规格','2','只']]};const app=harness({preview:fixture({priceKind:'unknown',tables:[tableA,tableB],rows:[row({tableId:'a',name:'保留A',model:'A规格',price:'',sourceAmount:''}),row({id:'row-b',tableId:'b',name:'保留B',model:'B规格',price:'',sourceAmount:''})]})});app.choose();await settle();let tree=app.render();button(tree,'栏目对应').props.onClick();tree=app.render();field(tree,'栏目来源').props.onChange({target:{value:'b'}});tree=app.render();assert.equal(field(tree,'数据起始行').props.value,'2');assert.equal(field(tree,'对应名称列').props.value,0);field(tree,'对应名称列').props.onChange({target:{value:'1'}});tree=app.render();button(tree,'应用栏目对应').props.onClick();tree=app.render();assert.match(text(tree),/同一原始列不能同时对应多个字段/);assert.equal(field(tree,'第1行 名称').props.value,'保留A');assert.equal(field(tree,'第2行 名称').props.value,'保留B');assert.equal(button(tree,'复制到下方列表').props.disabled,true);field(tree,'对应名称列').props.onChange({target:{value:'0'}});tree=app.render();field(tree,'数据起始行').props.onChange({target:{value:'0'}});tree=app.render();button(tree,'应用栏目对应').props.onClick();tree=app.render();assert.match(text(tree),/数据起始行无效/);assert.equal(app.applied.length,0);field(tree,'数据起始行').props.onChange({target:{value:'2'}});tree=app.render();button(tree,'应用栏目对应').props.onClick();tree=app.render();assert.equal(button(tree,'复制到下方列表').props.disabled,false);assert.equal(field(tree,'第1行 名称').props.value,'保留A');assert.equal(field(tree,'第2行 规格').props.value,'B规格');
});

test('remapping one of mixed sources retains cost-price confirmation before quote copy',async()=>{
 const tableA={id:'cost-table',source:'成本表.csv',headerRow:0,mapping:{name:0,model:1,quantity:2,unit:3,price:4},priceKind:'cost',cells:[['名称','规格','数量','单位','采购单价'],['成本材料','18mm','1','张','50']]},tableB={id:'sales-table',source:'销售表.csv',headerRow:0,mapping:{name:0,model:1,quantity:2,unit:3,price:4},priceKind:'sales',cells:[['名称','规格','数量','单位','销售单价'],['销售五金','B规格','2','只','8']]};const app=harness({preview:fixture({priceKind:'unknown',tables:[tableA,tableB],rows:[row({tableId:'cost-table',name:'成本材料',sourceAmount:'',price:'50'}),row({id:'sales-row',tableId:'sales-table',name:'销售五金',sourceAmount:'',price:'8'})]})});app.choose();await settle();let tree=app.render();assert.equal(button(tree,'复制到下方列表').props.disabled,true);button(tree,'栏目对应').props.onClick();tree=app.render();field(tree,'栏目来源').props.onChange({target:{value:'sales-table'}});tree=app.render();button(tree,'应用栏目对应').props.onClick();tree=app.render();assert.equal(button(tree,'复制到下方列表').props.disabled,true);const consent=find(tree,node=>node.type==='label'&&text(node)==='将识别的采购单价用作销售单价','mixed cost confirmation');find(consent,node=>node.type==='input','consent').props.onChange({target:{checked:true}});tree=app.render();assert.equal(button(tree,'复制到下方列表').props.disabled,false);button(tree,'复制到下方列表').props.onClick();app.render();assert.equal(app.applied[0].length,2);
});

test('quote toolbar picker request waits for room availability, focuses upload, and fires once per request',()=>{
 const app=harness();app.render();assert.equal(app.clicks,0);app.render({requestOpen:1,disabled:true});assert.equal(app.clicks,0);app.render({disabled:false});assert.equal(app.clicks,1);assert.ok(app.doc.activeElement,'upload button focused as fallback if browser blocks file picker');app.render();assert.equal(app.clicks,1);app.render({requestOpen:2});assert.equal(app.clicks,2);app.render({requestOpen:0});assert.equal(app.clicks,2);
});
