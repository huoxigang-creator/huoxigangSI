import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const roomA='room-a',roomB='room-b';
const line=(name,category,quantity,price,room_id)=>({name,category,quantity,price,room_id,model:'',unit:'项',note:'原备注'});
const items=[line('衣柜','柜体',2.35,480,roomA),line('安装','人工费用',2,10.005,roomA),line('板材','材料费用',1.5,25,roomB),line('拉手','五金费用',3,1.5,roomB)];
const catalog=items.map((item,index)=>({id:'config-'+index,name:item.name,expense_category:item.category,model:'',unit:'项',purchase_price:[30000,501,1000,50][index],sale_price:999999}));
const fixtures={name:'两室客户报价',budget:119002,items,rooms:[{id:roomA,name:'主卧室'},{id:roomB,name:'厨房'},{id:'empty-room',name:'空房间'}],catalog,loading:false,companyName:'本机验收公司',draft:true};

/** Actual component handlers and effects, detached DOM and catalog fixtures only. */
function harness(overrides={}){
 const slots=[],cache=new Map(),listeners=new Map(),attributes=new Map(),mediaListeners=new Set(),extraDialogs=[];let cursor=0,effects=[],printCalls=0,closed=0,retries=0,throwPrint=false,reportDialog=null;
 const document={activeElement:null,body:{style:{overflow:'hidden'},getAttribute:key=>attributes.get(key)??null,setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key)},querySelectorAll:()=>[...(reportDialog?[reportDialog]:[]),...extraDialogs]};
 class FakeElement{constructor(label){this.label=label;this.isConnected=true;this.targets=[];this.focusCount=0;this.hidden=false;}focus(){this.focusCount++;document.activeElement=this;}contains(element){return this.targets.includes(element);}querySelectorAll(){return this.targets;}closest(){return this.hidden?{}:null;}}
 const origin=new FakeElement('open-profit');document.activeElement=origin;
 const window={addEventListener(event,callback){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(callback);},removeEventListener(event,callback){listeners.get(event)?.delete(callback);},matchMedia(){return {addEventListener(_event,callback){mediaListeners.add(callback);},removeEventListener(_event,callback){mediaListeners.delete(callback);}};},print(){printCalls++;if(throwPrint)throw Error('disabled print');}};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const hooks={...React,
  useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};const slot=slots[i];return [slot.value,value=>{slot.value=typeof value==='function'?value(slot.value):value;}];},
  useRef(initial){const i=cursor++;if(!slots[i])slots[i]={value:{current:initial}};return slots[i].value;},
  useMemo(create,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:create(),deps};return slots[i].value;},
  useSyncExternalStore(_subscribe,snapshot){cursor++;return snapshot();},
  useEffect(effect,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const previous=slots[i];slots[i]={deps};effects.push(()=>{previous?.cleanup?.();slots[i].cleanup=effect();});}}
 };
 function load(file){if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const localRequire=name=>{if(name==='react')return hooks;if(name==='react-dom')return {createPortal:(children,target)=>{assert.equal(target,document.body);return React.createElement('test-portal',{},children);}};if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});if(name==='./managed-table')return {__esModule:true,default:({tableKey,preferenceScope,disabled,resizable,columnReorder,...props})=>React.createElement('table',{...props,'data-managed-table-key':tableKey,'data-preference-scope':preferenceScope,'data-preferences-disabled':disabled})};if(name.endsWith('.css'))return {};if(name.startsWith('.')){const target=resolve(dirname(file),name);return load([target,target+'.ts',target+'.tsx'].find(existsSync));}return require(name);};
  runInNewContext('(function(exports,require,module){'+code+'\n})',{Intl,Number,Math,String,Set,Map,Error,HTMLElement:FakeElement,window,document})(module.exports,localRequire,module);return module.exports;
 }
 const exports=load(resolve('app/quote-profit.tsx')),Component=exports.default;
 const props={...fixtures,close:()=>closed++,retry:()=>retries++,...overrides};
 function expand(node){if(Array.isArray(node))return node.map(expand);if(!React.isValidElement(node))return node;if(typeof node.type==='function')return expand(node.type(node.props));return React.cloneElement(node,{},expand(node.props.children));}
 let lastTree;
 function render(){cursor=0;effects=[];lastTree=expand(Component(props));const buttons=[];for(const node of nodes(lastTree)){if(node.type==='button'){const element=node.props.ref?.current||new FakeElement(text(node));buttons.push(element);if(node.props.ref)node.props.ref.current=element;}else if(node.props.ref){node.props.ref.current=node.props.ref.current||new FakeElement('screen');}}const screen=nodes(lastTree).find(node=>node.props.className==='qpScreen')?.props.ref.current;if(screen)screen.targets=buttons;reportDialog=screen;for(const effect of effects.splice(0))effect();return lastTree;}
 function emit(event,detail={}){for(const callback of listeners.get(event)||[])callback(detail);}
 return {props,render,exports,document,origin,emit,attributes,mediaListeners,window,addDialog(label){const dialog=new FakeElement(label);extraDialogs.push(dialog);return dialog;},get closed(){return closed;},get retries(){return retries;},get printCalls(){return printCalls;},get listenerCount(){return [...listeners.values()].reduce((sum,set)=>sum+set.size,0);},setThrowPrint(value){throwPrint=value;},unmount(){for(const slot of slots)slot?.cleanup?.();}};
}
function nodes(node,result=[]){if(Array.isArray(node))for(const child of node)nodes(child,result);else if(React.isValidElement(node)){result.push(node);nodes(node.props.children,result);}return result;}
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):React.isValidElement(node)?text(node.props.children):'';
const find=(tree,predicate)=>{const node=nodes(tree).find(predicate);assert.ok(node);return node;};
const screen=tree=>find(tree,node=>node.props.className==='qpScreen');
const printSurface=tree=>find(tree,node=>node.props.className==='qpPrint');
const button=(tree,label)=>find(tree,node=>node.type==='button'&&text(node).startsWith(label));
const tab=(tree,label)=>find(tree,node=>node.props.role==='tab'&&text(node).startsWith(label));
const reportRows=tree=>nodes(tree).filter(node=>node.type==='tr'&&node.props['data-profit-row']!==undefined);
const summary=(tree,label)=>find(tree,node=>node.type==='dl'&&node.props['aria-label']===label);

test('fullscreen profit switches room and four categories, preserves original prices, and prints all rooms',()=>{
 const before=JSON.stringify({items,catalog}),app=harness();let tree=app.render(),view=screen(tree);
 assert.equal(view.props.role,'dialog');assert.equal(view.props['aria-modal'],'true');assert.match(text(view),/未保存草稿快照/);assert.match(text(view),/未扣优惠和抹零.*不影响实际收付款利润/);
 assert.deepEqual(nodes(view).filter(node=>node.props.role==='tab').map(node=>text(node).replace(/\d+$/,'')),['柜体','人工费用','材料费用','五金费用']);
 assert.match(text(summary(view,'整户')),/1,190\.02.*731\.52.*458\.50.*38\.53%/);assert.equal(reportRows(view).length,1);assert.match(text(reportRows(view)[0]),/衣柜.*480\.00.*1,128\.00.*300\.00.*705\.00.*423\.00.*37\.50%/);
 button(view,'主卧室').props.onClick();tree=app.render();view=screen(tree);tab(view,'人工费用').props.onClick();tree=app.render();view=screen(tree);assert.equal(reportRows(view).length,1);assert.match(text(reportRows(view)[0]),/安装.*10\.01.*20\.02.*5\.01.*10\.02.*10\.00/);
 button(view,'厨房').props.onClick();tree=app.render();view=screen(tree);assert.equal(reportRows(view).length,0);tab(view,'材料费用').props.onClick();tree=app.render();view=screen(tree);assert.match(text(reportRows(view)),/板材/);assert.doesNotMatch(text(reportRows(view)),/衣柜|安装/);
 button(view,'空房间').props.onClick();tree=app.render();assert.match(text(screen(tree)),/暂无明细/);
 const report=printSurface(tree);assert.equal(reportRows(report).length,4);assert.match(text(report),/主卧室.*柜体.*衣柜.*人工费用.*安装.*厨房.*材料费用.*板材.*五金费用.*拉手.*空房间/);assert.equal(nodes(tree).filter(node=>node.props.className==='qpPrint').length,1);assert.equal(JSON.stringify({items,catalog}),before);
 app.unmount();
});

test('loading and retry keep quote sales visible, and unavailable costs are never presented as zero profit',()=>{
 const app=harness({catalog:null,loading:true});let tree=app.render();assert.match(text(screen(tree)),/正在加载当前配置成本/);assert.equal(button(screen(tree),'打印利润报告').props.disabled,true);assert.match(text(reportRows(screen(tree))[0]),/1,128\.00/);assert.equal(text(reportRows(screen(tree))[0]).match(/—/g).length,4);
 app.props.loading=false;app.props.error='成本目录读取失败';tree=app.render();assert.match(text(screen(tree)),/成本目录读取失败/);button(screen(tree),'重新加载成本').props.onClick();assert.equal(app.retries,1);
 app.props.error=undefined;app.props.catalog=[catalog[1],catalog[2],catalog[3]];tree=app.render();assert.match(text(screen(tree)),/1 条明细缺少有效成本/);assert.match(text(summary(screen(tree),'整户')),/1,190\.02估算成本—估算毛利—毛利率—/);assert.match(text(reportRows(screen(tree))[0]),/未匹配到唯一且单位一致/);assert.equal(text(reportRows(screen(tree))[0]).match(/—/g).length,4);
 app.unmount();
});

test('legacy quotes without rooms use overall space; partial draft values and integrity differences show warnings',()=>{
 const app=harness({items:[{...items[0],room_id:undefined,quantity:'',price:''}],rooms:[],budget:0,catalog:[catalog[0]]});let tree=app.render();assert.match(text(screen(tree)),/整体空间/);assert.match(text(screen(tree)),/明细未填写完整/);assert.match(text(reportRows(screen(tree))[0]),/数量无效/);assert.equal(text(reportRows(screen(tree))[0]).match(/—/g).length,7);assert.match(text(summary(screen(tree),'整户')),/估算毛利—/);
 const report=printSurface(tree);assert.equal(reportRows(report).length,1);assert.match(text(report),/整体空间.*衣柜/);
 app.unmount();
});

test('Escape and Tab stay in the fullscreen report; rerender never moves focus and close restores prior overflow',()=>{
 const app=harness();let tree=app.render(),view=screen(tree),dialog=view.props.ref.current;const closeButton=find(view,node=>node.props['aria-label']==='关闭利润报告').props.ref.current;
 assert.equal(app.document.activeElement,closeButton);assert.equal(app.document.body.style.overflow,'hidden');const closeFocuses=closeButton.focusCount;
 app.props.close=()=>{app.props.didClose=true;};app.props.loading=true;app.render();assert.equal(closeButton.focusCount,closeFocuses);
 app.document.activeElement=dialog.targets.at(-1);let prevented=0;app.emit('keydown',{key:'Tab',preventDefault(){prevented++;},stopPropagation(){}});assert.equal(prevented,1);assert.equal(app.document.activeElement,dialog.targets[0]);
 app.emit('keydown',{key:'Escape',preventDefault(){prevented++;},stopPropagation(){}});assert.equal(app.props.didClose,true);app.unmount();assert.equal(app.document.body.style.overflow,'hidden');assert.equal(app.document.activeElement,app.origin);assert.equal(app.listenerCount,0);assert.equal(app.mediaListeners.size,0);
});

test('printing uses its own body portal, isolates the old customer print CSS, and cleans flags after print and errors',()=>{
 const app=harness();let tree=app.render();button(screen(tree),'打印利润报告').props.onClick();assert.equal(app.printCalls,1);assert.equal(app.attributes.get('data-quote-profit-print'),'true');app.emit('beforeprint');app.emit('afterprint');assert.equal(app.attributes.has('data-quote-profit-print'),false);
 app.attributes.set('data-quote-profit-print','previous-owner');app.emit('beforeprint');assert.equal(app.attributes.get('data-quote-profit-print'),'true');app.emit('afterprint');assert.equal(app.attributes.get('data-quote-profit-print'),'previous-owner');app.attributes.delete('data-quote-profit-print');
 app.setThrowPrint(true);button(screen(tree),'打印利润报告').props.onClick();tree=app.render();assert.match(text(screen(tree)),/无法打开打印，请重试/);assert.equal(app.attributes.has('data-quote-profit-print'),false);
 app.emit('beforeprint');app.unmount();assert.equal(app.attributes.has('data-quote-profit-print'),false);
 const css=readFileSync('app/quote-profit.css','utf8'),legacy=readFileSync('app/quote-workspace.css','utf8');assert.match(legacy,/body:has\(>\.qwCustomerPrint\)>:not\(\.qwCustomerPrint\)\{display:none!important\}/);
 // Adding the html ancestor wins the legacy :has() specificity regardless of load order.
 assert.match(css,/html body\[data-quote-profit-print\]>:not\(\.qpPrint\)\{display:none!important\}/);assert.match(css,/html body\[data-quote-profit-print\]>\.qwCustomerPrint\{display:none!important\}/);assert.match(css,/html body\[data-quote-profit-print\]>\.qpPrint\{display:block!important;page:quote-profit/);assert.match(css,/@page quote-profit\{size:A4 landscape/);
 assert.doesNotMatch(readFileSync('app/quote-profit.tsx','utf8'),/window\.open/);
});

test('screen profit uses shared column controls with report/room/category scopes; printed tables remain plain',()=>{
 const app=harness();let tree=app.render(),view=screen(tree),table=find(view,node=>node.type==='table');
 assert.equal(table.props['data-managed-table-key'],'quote-profit/details');assert.deepEqual(JSON.parse(table.props['data-preference-scope']),[fixtures.name,'all','柜体']);assert.equal(table.props['data-preferences-disabled'],false);
 assert.equal(reportRows(view)[0].props['data-row-id'],'profit-line-0');
 button(view,'厨房').props.onClick();tree=app.render();view=screen(tree);tab(view,'材料费用').props.onClick();tree=app.render();view=screen(tree);table=find(view,node=>node.type==='table');
 assert.deepEqual(JSON.parse(table.props['data-preference-scope']),[fixtures.name,roomB,'材料费用']);assert.equal(reportRows(view)[0].props['data-row-id'],'profit-line-2');assert.match(text(reportRows(view)[0]),/板材.*25\.00.*37\.50.*10\.00.*15\.00.*22\.50/);
 const printed=nodes(printSurface(tree)).filter(node=>node.type==='table');assert.equal(printed.length,4);assert.ok(printed.every(node=>node.props['data-managed-table-key']===undefined));
 app.props.loading=true;tree=app.render();assert.equal(find(screen(tree),node=>node.type==='table').props['data-preferences-disabled'],true);app.unmount();
});

test('a visible field-settings dialog above the profit portal owns Escape and Tab; hidden background dialogs are ignored',()=>{
 const app=harness();app.render();const settings=app.addDialog('显示字段管理');settings.focus();let prevented=0,stopped=0;
 app.emit('keydown',{key:'Escape',preventDefault(){prevented++;},stopPropagation(){stopped++;}});assert.equal(app.closed,0);assert.equal(prevented,0);assert.equal(stopped,0);
 app.emit('keydown',{key:'Tab',preventDefault(){prevented++;},stopPropagation(){stopped++;}});assert.equal(app.document.activeElement,settings);assert.equal(prevented,0,'the lower report must not trap field-settings focus');
 settings.hidden=true;app.emit('keydown',{key:'Escape',preventDefault(){prevented++;},stopPropagation(){stopped++;}});assert.equal(app.closed,1);assert.equal(prevented,1);assert.equal(stopped,1);app.unmount();
});
