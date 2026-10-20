import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {setImmediate as nextTurn} from 'node:timers/promises';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const base={owner:'offline-assignment-owner',customer:'本地分配验收客户',created:'2026-10-14T00:00:00Z',status:'生产中',project_type:'project'};
const fixtures={
  projects:[
    {...base,id:'qa-root',name:'本地验收合作项目'},
    {...base,id:'qa-child-a',parent_id:'qa-root',name:'本地验收厨房柜'},
    {...base,id:'qa-child-b',parent_id:'qa-root',name:'本地验收卧室柜'},
    {...base,id:'qa-legacy-root',name:'本地验收旧报价项目'},
    {...base,id:'qa-other-root',name:'本地验收另一合作项目'},
    {...base,id:'qa-other-child',parent_id:'qa-other-root',name:'另一合作项目小项目'},
    {...base,id:'qa-deleted-child',parent_id:'qa-root',name:'已删除小项目',deleted:true},
    {...base,id:'qa-customer',name:'本地验收整户客户',project_type:'customer'},
  ],
  quotes:[
    {id:'qa-child-a-quote',project:'qa-child-a',adopted:true,total:10000,title:'厨房柜报价'},
    {id:'qa-child-b-quote',project:'qa-child-b',adopted:true,total:20000,title:'卧室柜报价'},
    {id:'qa-legacy-a',project:'qa-legacy-root',subproject_id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',subproject_name:'旧报价组甲',adopted:true,total:15000,title:'旧报价组甲已采纳'},
    {id:'qa-legacy-b',project:'qa-legacy-root',subproject_id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',subproject_name:'旧报价组乙',adopted:false,total:25000,title:'旧报价组乙草稿'},
    {id:'qa-legacy-ungrouped',project:'qa-legacy-root',adopted:true,total:5000,title:'旧无组报价'},
  ],
  transactions:[
    {id:'qa-unallocated',project:'qa-root',owner:base.owner,type:'收款',category:'定金',amount:2000,date:'2026-10-14',note:'原备注应保留',request_id:'original-receipt-request',created:'2026-10-14T00:00:00Z'},
    {id:'qa-child-a-receipt',project:'qa-child-a',owner:base.owner,type:'收款',category:'进度款',amount:3000,date:'2026-10-14'},
    {id:'qa-child-b-receipt',project:'qa-child-b',owner:base.owner,type:'收款',category:'进度款',amount:1000,date:'2026-10-14'},
    {id:'qa-payment',project:'qa-root',owner:base.owner,type:'付款',category:'材料付款',amount:5000,date:'2026-10-14',note:'付款备注',payment_items:[{name:'原付款明细',amount:5000}]},
    {id:'qa-source-linked',project:'qa-legacy-root',owner:base.owner,type:'收款',category:'尾款',amount:1500,date:'2026-10-14',source_quote_id:'qa-legacy-a',payment_provider:'wechat',wechat_transaction_id:'offline-wechat-transaction'},
  ],
};
fixtures.transactions=fixtures.transactions.map(row=>({created:'2026-10-14T00:00:00Z',updated:'2026-10-14T01:00:00Z',...row}));

/** Real component callbacks in an isolated hook host; no business DB or live fetch. */
function harness({componentFile,componentExport='default',props={},request=async()=>true}={}){
  const slots=[],cache=new Map(),effects=[],calls=[],closed=[],opened=[],listeners=new Map();let cursor=0,serial=0,active=true;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  let hasPanel=false,fields=[];const fakeFields=new Map(),extraDialogs=[];
  const document={body:{style:{overflow:''}},activeElement:null,querySelector:()=>null,querySelectorAll:()=>[...(hasPanel?[panelElement]:[]),...extraDialogs]};
  const outsideFocus={isConnected:true,closest:()=>null,focus(){document.activeElement=outsideFocus;}};document.activeElement=outsideFocus;
  const panelElement={closest:()=>active?null:{hidden:true},contains:element=>fields.includes(element),querySelector:tag=>fields.find(field=>field.tag===tag),querySelectorAll:()=>fields.filter(field=>!field.disabled)};
  const window={addEventListener(name,listener){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(listener);},removeEventListener(name,listener){listeners.get(name)?.delete(listener);},confirm:()=>true,prompt:()=>null};
  const hooks={...React,
    useContext(context){return typeof context._currentValue==='boolean'?active&&context._currentValue:context._currentValue;},
    useState(initial){const index=cursor++;slots[index]??={value:typeof initial==='function'?initial():initial};return[slots[index].value,update=>{slots[index].value=typeof update==='function'?update(slots[index].value):update;}];},
    useRef(initial){const index=cursor++;slots[index]??={value:{current:initial}};return slots[index].value;},
    useId(){const index=cursor++;slots[index]??={value:'local-assignment-id-'+index};return slots[index].value;},
    useMemo(callback,deps){const index=cursor++;if(!slots[index]||!same(slots[index].deps,deps))slots[index]={deps,value:callback()};return slots[index].value;},
    useCallback(callback,deps){return hooks.useMemo(()=>callback,deps);},
    useEffect(effect,deps){const index=cursor++;if(!slots[index]||!same(slots[index].deps,deps)){const entry={deps,cleanup:slots[index]?.cleanup};slots[index]=entry;effects.push(()=>{entry.cleanup?.();entry.cleanup=effect();});}},
  };
  const mutate=async(action,args)=>{const call={action,args:structuredClone(args)};calls.push(call);return request(call);};
  function load(path){
    if(cache.has(path))return cache.get(path).exports;
    const module={exports:{}};cache.set(path,module);
    const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    const localRequire=name=>{
      if(name==='react')return hooks;
      if(name==='lucide-react')return new Proxy({},{get:(_target,key)=>function Icon(){return String(key);}});
      if(name.endsWith('.css'))return{};
      if(name.endsWith('/trash-client'))return{trashRequest:mutate};
      if(name.startsWith('.')){const base=resolve(dirname(path),name),target=[base,base+'.ts',base+'.tsx'].find(existsSync);assert.ok(target,'Local dependency '+name);return load(target);}
      return require(name);
    };
    runInNewContext('(function(exports,require,module){'+code+'\n})',{console,Intl,Date,Number,Math,String,Set,Map,Error,TypeError,DOMException,document,window,setTimeout,clearTimeout,crypto:{randomUUID:()=>`00000000-0000-4000-a000-${String(++serial).padStart(12,'0')}`},fetch(){throw Error('Assignment UI tests must use only the supplied mutation mock');}})(module.exports,localRequire,module);
    return module.exports;
  }
  const module=load(resolve(componentFile)),Component=module[componentExport];assert.ok(Component,'Component export '+componentExport);
  const runtimeProps={...structuredClone(fixtures),record:structuredClone(fixtures.transactions[0]),transaction:structuredClone(fixtures.transactions[0]),busy:false,mutate,onClose:()=>closed.push(true),open:(...args)=>opened.push(args),onDeleted:async()=>{},...props};
  function commitPanel(tree){const panel=nodes(tree).find(node=>node.props.role==='dialog');hasPanel=Boolean(panel);fields=[];if(!panel)return;function visit(node,disabled=false){if(Array.isArray(node)){node.forEach(child=>visit(child,disabled));return;}if(!React.isValidElement(node))return;const inherited=disabled||Boolean(node.props.disabled);if(['button','select','input','textarea'].includes(node.type)){const key=node.props['aria-label']||node.props.name||node.type+':'+text(node);let field=fakeFields.get(key);if(!field){field={key,tag:node.type,isConnected:true,closest:()=>active?null:{hidden:true},focus(){if(!field.disabled)document.activeElement=field;}};fakeFields.set(key,field);}field.disabled=inherited;fields.push(field);}visit(node.props.children,inherited);}visit(panel);if(panel.props.ref)panel.props.ref.current=panelElement;}
  function render(overrides={}){cursor=0;effects.length=0;const tree=Component({...runtimeProps,...overrides});commitPanel(tree);for(const effect of effects.splice(0))effect();return tree;}
  function keypress(key,shiftKey=false){const event={key,shiftKey,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};for(const listener of listeners.get('keydown')||[])listener(event);return event;}
  function unmount(){hasPanel=false;for(const slot of slots){slot?.cleanup?.();if(slot)slot.cleanup=undefined;}}
  return{props:runtimeProps,render,unmount,calls,closed,opened,document,listeners,fields:()=>fields, outsideFocus,keypress,setActive:value=>{active=value;},setOverlayOpen:value=>{extraDialogs.splice(0,extraDialogs.length,...(value?[{closest:()=>null}]:[]));},module};
}
function nodes(value){if(Array.isArray(value))return value.flatMap(nodes);if(!React.isValidElement(value))return[];return[value,...nodes(value.props.children)];}
function text(value){if(Array.isArray(value))return value.map(text).join('');if(React.isValidElement(value))return text(value.props.children);return value==null||typeof value==='boolean'?'':String(value);}
function find(tree,predicate,label='Expected element'){const node=nodes(tree).find(predicate);assert.ok(node,label);return node;}
function control(tree,label){return find(tree,node=>node.props['aria-label']===label,'Control '+label);}
function button(tree,label){return find(tree,node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label),'Button '+label);}
async function settle(){await nextTurn();await nextTurn();}

const assignment=options=>harness({componentFile:'app/transaction-assignment.tsx',...options});
function selectTarget(tree,value){control(tree,'分配所属小项目').props.onChange({target:{value}});}
function submit(tree){find(tree,node=>node.type==='form','Assignment form').props.onSubmit({preventDefault(){}});}
function balanceEntry(tree,label){return find(control(tree,'分配后小项目收款情况'),node=>node.type==='div'&&React.Children.toArray(node.props.children).some(child=>React.isValidElement(child)&&child.type==='dt'&&text(child)===label),'Balance '+label);}

test('未分配流水只列出同合作项目的有效小项目，取消不保存且原记录完整保留',()=>{
 const app=assignment(),snapshot=JSON.stringify(app.props);let tree=app.render();
 const select=control(tree,'分配所属小项目'),options=nodes(select).filter(node=>node.type==='option');
 assert.deepEqual(options.map(node=>node.props.value),['','qa-child-a','qa-child-b']);assert.equal(select.props.value,'');assert.equal(button(tree,'保存分配').props.disabled,true);assert.equal(app.document.body.style.overflow,'hidden');
 selectTarget(tree,'qa-child-a');tree=app.render();assert.equal(button(tree,'保存分配').props.disabled,false);button(tree,'取消').props.onClick();
 assert.equal(app.closed.length,1);assert.equal(app.calls.length,0);assert.equal(JSON.stringify(app.props),snapshot);
});

test('收款预览排除原流水后再加金额，选择当前归属不会重复计算',()=>{
 const record={...fixtures.transactions[0],project:'qa-child-a'},transactions=fixtures.transactions.map(row=>row.id===record.id?record:row);
 const app=assignment({props:{record,transactions}});let tree=app.render();assert.equal(control(tree,'分配所属小项目').props.value,'qa-child-a');
 assert.equal(text(balanceEntry(tree,'分配后累计已收')),'分配后累计已收¥50.00');assert.equal(text(balanceEntry(tree,'分配后待收')),'分配后待收¥50.00');
 selectTarget(tree,'qa-child-b');tree=app.render();assert.equal(text(balanceEntry(tree,'分配后累计已收')),'分配后累计已收¥30.00');assert.equal(text(balanceEntry(tree,'分配后待收')),'分配后待收¥170.00');
 assert.equal(app.calls.length,0);
});

test('保存分配仅发送新action及CAS归属，不新建流水、不提交金额或附件',async()=>{
 const app=assignment(),before=JSON.stringify(app.props.record);let tree=app.render();selectTarget(tree,'qa-child-b');tree=app.render();submit(tree);await settle();
 assert.deepEqual(app.calls,[{action:'assign_transaction_subproject',args:{id:'qa-unallocated',project_id:'qa-child-b',subproject_id:'',expected_project_id:'qa-root',expected_subproject_id:'',expected_updated:'2026-10-14T01:00:00Z'}}]);assert.equal(app.closed.length,1);assert.equal(JSON.stringify(app.props.record),before);
 assert.ok(!Object.hasOwn(app.calls[0].args,'amount'));assert.ok(!Object.hasOwn(app.calls[0].args,'payment_items'));assert.ok(!app.calls.some(call=>call.action==='record_transaction'));
});

test('旧报价小项目与legacy均有明确稳定目标，保存旧组ID不换成报价版本ID',async()=>{
 const record={...fixtures.transactions[0],project:'qa-legacy-root'},app=assignment({props:{record}});let tree=app.render();
 const options=nodes(control(tree,'分配所属小项目')).filter(node=>node.type==='option');assert.equal(options.length,4);
 const group='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';assert.ok(options.some(node=>node.props.value==='qa-legacy-root:'+group));assert.ok(options.some(node=>node.props.value==='qa-legacy-root:legacy'));
 selectTarget(tree,'qa-legacy-root:'+group);tree=app.render();assert.equal(text(balanceEntry(tree,'分配后累计已收')),'分配后累计已收¥35.00');assert.equal(text(balanceEntry(tree,'分配后待收')),'分配后待收¥115.00');submit(tree);await settle();
 assert.equal(app.calls[0].args.project_id,'qa-legacy-root');assert.equal(app.calls[0].args.subproject_id,group);assert.notEqual(app.calls[0].args.subproject_id,'qa-legacy-a');
 const legacy=assignment({props:{record}});tree=legacy.render();selectTarget(tree,'qa-legacy-root:legacy');tree=legacy.render();submit(tree);await settle();assert.equal(legacy.calls[0].args.subproject_id,'legacy');
});

test('未采纳目标应收保持未知，超额收款显示超收，付款分配不改变收款余额',()=>{
 const draft=assignment({props:{record:{...fixtures.transactions[0],project:'qa-legacy-root'}}});let tree=draft.render();selectTarget(tree,'qa-legacy-root:bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb');tree=draft.render();assert.match(text(balanceEntry(tree,'应收金额')),/尚未确定/);assert.equal(text(balanceEntry(tree,'分配后待收')),'分配后待收尚未确定');
 const over=assignment({props:{record:{...fixtures.transactions[0],amount:12000}}});tree=over.render();selectTarget(tree,'qa-child-a');tree=over.render();assert.equal(text(balanceEntry(tree,'分配后待收')),'分配后待收¥0.00');assert.match(text(tree),/超收 ¥50\.00/);
 const payment=assignment({props:{record:fixtures.transactions.find(row=>row.id==='qa-payment')}});tree=payment.render();selectTarget(tree,'qa-child-a');tree=payment.render();assert.equal(text(balanceEntry(tree,'累计已收')),'累计已收¥30.00');assert.equal(text(balanceEntry(tree,'当前待收')),'当前待收¥70.00');assert.doesNotMatch(text(tree),/分配后累计已收|分配后待收/);assert.equal(payment.calls.length,0);
});

test('作废删除、整户、关联报价及线上流水、失效目标都不能发送分配请求',async()=>{
 const blocked=[{void:true},{deleted:true},{project:'qa-customer'},{project:'nonexistent'},{source_quote_id:'qa-legacy-a'},{payment_provider:'wechat'},{wechat_transaction_id:'offline-provider-id'},{payment_order_id:'offline-order'}];
 for(const patch of blocked){const app=assignment({props:{record:{...fixtures.transactions[0],...patch}}});let tree=app.render();assert.ok(nodes(tree).some(node=>node.props.role==='alert'));assert.equal(button(tree,'保存分配').props.disabled,true);submit(tree);await settle();assert.equal(app.calls.length,0);}
 const app=assignment();let tree=app.render();selectTarget(tree,'qa-other-child');tree=app.render();assert.equal(button(tree,'保存分配').props.disabled,true);submit(tree);await settle();tree=app.render();assert.equal(app.calls.length,0);assert.match(text(tree),/请选择这笔款对应的小项目/);
});

test('保存失败保留选择与错误，重试使用原CAS版本；pending期间旧submit也只执行一次',async()=>{
 let succeed=false;const app=assignment({request:async()=>succeed});let tree=app.render();selectTarget(tree,'qa-child-a');tree=app.render();submit(tree);await settle();tree=app.render();assert.equal(app.closed.length,0);assert.equal(control(tree,'分配所属小项目').props.value,'qa-child-a');assert.match(text(tree),/分配未保存/);succeed=true;submit(tree);await settle();assert.equal(app.calls.length,2);assert.deepEqual(app.calls[1],app.calls[0]);assert.equal(app.closed.length,1);
 let finish;const pending=assignment({request:()=>new Promise(resolve=>{finish=resolve;})});tree=pending.render();selectTarget(tree,'qa-child-b');tree=pending.render();submit(tree);submit(tree);assert.equal(pending.calls.length,1);tree=pending.render();assert.equal(button(tree,'取消').props.disabled,true);assert.equal(button(tree,'保存中…').props.disabled,true);finish(true);await settle();assert.equal(pending.calls.length,1);assert.equal(pending.closed.length,1);
});

test('后端错误可见且无假关闭，busy禁提交，工作空间隐藏释放滚动与键盘监听',async()=>{
 const failed=assignment({request:async()=>{throw Error('该收款已经关联合同分期，不能移动所属项目');}});let tree=failed.render();selectTarget(tree,'qa-child-a');tree=failed.render();submit(tree);await settle();tree=failed.render();assert.match(text(tree),/已经关联合同分期/);assert.equal(failed.closed.length,0);assert.equal(control(tree,'分配所属小项目').props.value,'qa-child-a');
 const busy=assignment({props:{busy:true}});tree=busy.render();selectTarget(tree,'qa-child-a');tree=busy.render();submit(tree);await settle();assert.equal(busy.calls.length,0);
 const app=assignment();app.render();assert.equal(app.document.body.style.overflow,'hidden');assert.equal(app.listeners.get('keydown').size,1);app.setActive(false);assert.equal(app.render(),null);assert.equal(app.document.body.style.overflow,'');assert.equal(app.listeners.get('keydown').size,0);assert.equal(app.closed.length,1);assert.equal(app.calls.length,0);
});

const transactionList=options=>harness({componentFile:'app/manager-lists.tsx',componentExport:'TransactionList',...options,props:{items:[structuredClone(fixtures.transactions[0])],scope:'assignment-ui-list',fundType:'收款',...options?.props}});
const assignmentNode=tree=>nodes(tree).find(node=>typeof node.type==='function'&&node.type.name==='TransactionAssignment');
const assignmentCell=tree=>find(tree,node=>node.type==='td'&&node.props.className==='transactionAssignmentCell','Subproject cell');

test('流水小项目单元格单击打开原记录分配，转交全量资金数据且保留取消入口',()=>{
 const app=transactionList();let tree=app.render();assert.equal(assignmentNode(tree),undefined);assert.match(text(assignmentCell(tree)),/未分配/);
 assert.equal(assignmentCell(tree).props.onDoubleClick,undefined);assignmentCell(tree).props.onClick();tree=app.render();const modal=assignmentNode(tree);assert.ok(modal);assert.deepEqual(structuredClone(modal.props.record),app.props.items[0]);assert.notEqual(modal.props.record,app.props.items[0]);assert.equal(modal.props.transactions,app.props.transactions);assert.equal(modal.props.transactions.length,fixtures.transactions.length);
 assert.equal(control(tree,'分配收款 定金到小项目').props.disabled,true);modal.props.onClose();tree=app.render();assert.equal(assignmentNode(tree),undefined);assert.equal(app.calls.length,0);
 assert.equal(nodes(tree).some(node=>node.type==='button'&&['编辑','复制'].includes(text(node))),false);
});

test('原生按钮激活与单选工具栏均能打开分配，阻止父单元格重复触发且多选禁用',()=>{
 const native=transactionList();let nativeTree=native.render(),stopped=false;const entry=control(nativeTree,'分配收款 定金到小项目');assert.equal(entry.type,'button');assert.equal(entry.props.type,'button');assert.equal(entry.props.onKeyDown,undefined);entry.props.onClick({detail:0,stopPropagation(){stopped=true;}});nativeTree=native.render();assert.equal(stopped,true);assert.ok(assignmentNode(nativeTree));assert.equal(native.calls.length,0);
 const app=transactionList({props:{items:structuredClone(fixtures.transactions.slice(0,2))}});let tree=app.render();assert.equal(button(tree,'分配小项目').props.disabled,true);
 find(tree,node=>node.props.label?.startsWith('选择收款 定金'),'First receipt checkbox').props.onChange();tree=app.render();assert.equal(button(tree,'分配小项目').props.disabled,false);button(tree,'分配小项目').props.onClick();tree=app.render();assert.equal(assignmentNode(tree).props.record.id,'qa-unallocated');assignmentNode(tree).props.onClose();tree=app.render();
 find(tree,node=>node.props.label?.startsWith('选择收款 进度款'),'Second receipt checkbox').props.onChange();tree=app.render();assert.equal(button(tree,'分配小项目').props.disabled,true);assert.equal(app.calls.length,0);
});

test('busy及锁定流水拒绝单击与原生按钮激活和工具栏进入，scope变更清除旧分配弹窗',()=>{
 for(const patch of [{busy:true},{items:[{...fixtures.transactions[0],void:true}]},{items:[{...fixtures.transactions[0],source_quote_id:'qa-child-a-quote'}]},{items:[{...fixtures.transactions[0],project:'qa-customer'}]}]){
  const app=transactionList({props:patch});let tree=app.render();const row=app.props.items[0],label=`分配${row.type} ${row.category}到小项目`;
  assert.equal(control(tree,label).props.disabled,true);assignmentCell(tree).props.onClick();tree=app.render();assert.equal(assignmentNode(tree),undefined);control(tree,label).props.onClick({stopPropagation(){}});tree=app.render();assert.equal(assignmentNode(tree),undefined);assert.equal(button(tree,'分配小项目').props.disabled,true);assert.equal(app.calls.length,0);
 }
 const app=transactionList();let tree=app.render();assignmentCell(tree).props.onClick();tree=app.render();assert.ok(assignmentNode(tree));app.props.scope='another-workspace-list';app.render();tree=app.render();assert.equal(assignmentNode(tree),undefined);assert.equal(app.calls.length,0);
});

test('分配键盘焦点限制在当前顶层弹窗，Escape恢复可见原焦点，背景弹窗不抢按键',()=>{
 const app=assignment();let tree=app.render();assert.equal(app.document.activeElement.tag,'select');selectTarget(tree,'qa-child-a');tree=app.render();
 const enabled=app.fields().filter(field=>!field.disabled),first=enabled[0],last=enabled[enabled.length-1];last.focus();assert.equal(app.keypress('Tab').defaultPrevented,true);assert.equal(app.document.activeElement,first);
 first.focus();assert.equal(app.keypress('Tab',true).defaultPrevented,true);assert.equal(app.document.activeElement,last);
 app.outsideFocus.focus();assert.equal(app.keypress('Tab').defaultPrevented,true);assert.equal(app.document.activeElement,first);
 app.setOverlayOpen(true);last.focus();assert.equal(app.keypress('Tab').defaultPrevented,false);assert.equal(app.document.activeElement,last);assert.equal(app.keypress('Escape').defaultPrevented,false);assert.equal(app.closed.length,0);
 app.setOverlayOpen(false);assert.equal(app.keypress('Escape').defaultPrevented,true);assert.equal(app.closed.length,1);app.unmount();assert.equal(app.document.activeElement,app.outsideFocus);assert.equal(app.document.body.style.overflow,'');assert.equal(app.listeners.get('keydown').size,0);assert.equal(app.calls.length,0);
});

test('全局及项目资金列表都转交完整报价与资金数据，筛选列表不会漏算目标已有收款',()=>{
 const file=ts.createSourceFile('manager.tsx',readFileSync('app/manager.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),calls=[];
 function visit(node){if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText()==='TransactionList')calls.push(node);ts.forEachChild(node,visit);}visit(file);assert.ok(calls.length>=2);
 for(const call of calls){const attributes=call.attributes.properties.filter(ts.isJsxAttribute);for(const [name,value] of [['transactions','data.transactions'],['quotes','data.quotes']]){const prop=attributes.find(attribute=>attribute.name.getText()===name);assert.ok(prop,`${name} must be passed by each manager list entry`);assert.equal(prop.initializer.expression.getText(),value);}}
});
