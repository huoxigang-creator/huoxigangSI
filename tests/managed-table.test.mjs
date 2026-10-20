import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node==null||typeof node==='boolean'?'':String(node);
const nodes=node=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'&&node.props?[node,...nodes(node.props.children)]:[];
const button=(tree,label)=>{const value=nodes(tree).find(node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label));assert.ok(value,label);return value;};
const body=tree=>nodes(tree).find(node=>node.type==='tbody');
const rowIDs=tree=>React.Children.toArray(body(tree).props.children).map(row=>row.props['data-row-id']);
function harness({stored=[],measuredWidths={},document:fakeDocument}={}){
  const storage=new Map(stored),writes=[],slots=[],effects=[],cache=new Map();let cursor=0,owner='offline-owner';
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const hooks={...React,useContext:()=>owner,useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},useRef(initial){const i=cursor++;if(!slots[i])slots[i]={value:{current:initial}};return slots[i].value;},useEffect(effect,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){slots[i]={deps};effects.push(effect);}}};
  function load(path){if(cache.has(path))return cache.get(path).exports;const module={exports:{}};cache.set(path,module);const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    const context={console,Set,Map,Array,JSON,Symbol,...(fakeDocument?{document:fakeDocument}:{}),localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{writes.push(key);storage.set(key,value);}},fetch(){throw Error('Table preferences must not write business data');}};
    runInNewContext('(function(exports,require,module){'+code+'\n})',context)(module.exports,name=>{if(name==='react')return hooks;if(name==='lucide-react')return new Proxy({},{get:(_t,key)=>()=>String(key)});if(name.endsWith('.css'))return{};if(name.startsWith('.')){const base=resolve(dirname(path),name);return load([base,base+'.ts',base+'.tsx'].find(existsSync));}return require(name);},module);return module.exports;}
  const Table=load(resolve('app/managed-table.tsx')).default;
  function render(props){cursor=0;effects.length=0;const tree=Table(props),table=nodes(tree).find(node=>node.type==='table');let left=0;const headers=nodes(nodes(tree).find(node=>node.type==='thead')).filter(node=>node.type==='th').map((node,index)=>{const id=node.props['data-column-id'],width=columnWidths(tree)[id]??measuredWidths[id]??[40,240,160,102][index]??140,start=left;left+=width;return{dataset:{columnId:id},getBoundingClientRect:()=>({width,left:start,right:start+width,top:0,bottom:40})};});table.props.ref.current={contains:element=>element?.insideTable===true,querySelectorAll:selector=>selector.includes('[data-column-id]')?headers.filter(header=>header.dataset.columnId):headers};effects.splice(0).forEach(effect=>effect());return tree;}
  return {render,storage,writes,setOwner:value=>{owner=value;}};
}
function inputCheckbox(){return React.createElement('input',{type:'checkbox'});}
function props(rows=[['a','甲',100],['b','乙',200]],more={}){
  return {tableKey:'offline-table',allRowOrder:['a','b','c'],...more,children:[React.createElement('thead',{key:'head'},React.createElement('tr',null,React.createElement('th',null,inputCheckbox()),React.createElement('th',null,'名称'),React.createElement('th',null,'金额'))),React.createElement('tbody',{key:'body'},rows.map(([id,name,amount])=>React.createElement('tr',{key:id,'data-row-id':id},React.createElement('td',null,inputCheckbox()),React.createElement('td',null,name),React.createElement('td',null,amount)))),React.createElement('tfoot',{key:'foot'},React.createElement('tr',null,React.createElement('td',{colSpan:2},'合计'),React.createElement('td',null,300)))]};
}

test('fixed row controls move only visible rows, keep hidden slots, values and editable order callbacks',()=>{
  const app=harness(),changed=[],p=props([['a','甲',100],['c','丙',300]],{onRowsReorder:ids=>changed.push([...ids])});app.render(p);let tree=app.render(p);
  button(tree,'下移第1行').props.onClick();tree=app.render(p);
  assert.deepEqual(rowIDs(tree),['c','a']);assert.deepEqual(changed,[['c','a']]);
  const saved=JSON.parse([...app.storage.values()][0]);assert.deepEqual(saved.order,['c','b','a']);
  assert.match(text(body(tree)),/丙300/);assert.match(text(body(tree)),/甲100/);
  assert.equal(button(tree,'上移第1行').props.disabled,true);assert.equal(button(tree,'下移第2行').props.disabled,true);
  assert.equal(nodes(tree).filter(node=>node.props.className==='managedTableControls').length,3);
});
test('column settings cancel cleanly and applied visibility keeps headers, rows and total spans aligned',()=>{
  const app=harness(),p=props();app.render(p);let tree=app.render(p);button(tree,'显示字段设置').props.onClick();tree=app.render(p);
  const amount=nodes(tree).find(node=>node.type==='label'&&text(node).startsWith('金额'));
  nodes(amount).find(node=>node.type==='input').props.onChange({target:{checked:false}});tree=app.render(p);button(tree,'取消').props.onClick();tree=app.render(p);
  assert.equal(app.writes.length,0);assert.ok(nodes(tree).some(node=>node.type==='th'&&text(node)==='金额'));
  button(tree,'显示字段设置').props.onClick();tree=app.render(p);const current=nodes(tree).find(node=>node.type==='label'&&text(node).startsWith('金额'));nodes(current).find(node=>node.type==='input').props.onChange({target:{checked:false}});tree=app.render(p);button(tree,'确定').props.onClick();tree=app.render(p);
  assert.ok(!nodes(tree).some(node=>node.type==='th'&&text(node)==='金额'));assert.equal(React.Children.count(React.Children.toArray(body(tree).props.children)[0].props.children),3);
  const footer=nodes(tree).find(node=>node.type==='tfoot'),span=nodes(footer).find(node=>node.type==='td'&&text(node)==='合计');assert.equal(span.props.colSpan,2);
  assert.ok(button(tree,'显示字段设置'));assert.equal(app.writes.length,1);
});
test('stored preferences reload and switching accounts never exposes another account layout',()=>{
  const app=harness(),p=props();app.render(p);let tree=app.render(p);button(tree,'下移第1行').props.onClick();tree=app.render(p);assert.deepEqual(rowIDs(tree),['b','a']);
  app.setOwner('other-offline-owner');tree=app.render(p);assert.deepEqual(rowIDs(tree),['a','b']);tree=app.render(p);assert.deepEqual(rowIDs(tree),['a','b']);
  app.setOwner('offline-owner');app.render(p);tree=app.render(p);assert.deepEqual(rowIDs(tree),['b','a']);assert.equal(app.storage.size,1);
});
test('drag drop reorders rows and pending operations lock every movement and column entry',()=>{
  const app=harness(),p=props();app.render(p);let tree=app.render(p);const grip=button(tree,'移动第1行');grip.props.onDragStart({dataTransfer:{setData(){}}});
  const target=React.Children.toArray(body(tree).props.children)[1];target.props.onDrop({preventDefault(){}});tree=app.render(p);assert.deepEqual(rowIDs(tree),['b','a']);
  tree=app.render({...p,disabled:true});for(const node of nodes(tree).filter(node=>node.type==='button'))assert.equal(node.props.disabled,true);
  button(tree,'下移第1行').props.onClick();tree=app.render({...p,disabled:true});assert.deepEqual(rowIDs(tree),['b','a']);
});
test('hidden columns recompute partial total spans and fixed selection cannot be hidden',()=>{
  const app=harness(),p=props();app.render(p);let tree=app.render(p);button(tree,'显示字段设置').props.onClick();tree=app.render(p);
  const selection=nodes(tree).find(node=>node.type==='label'&&text(node).startsWith('勾选'));assert.equal(nodes(selection).find(node=>node.type==='input').props.disabled,true);
  const name=nodes(tree).find(node=>node.type==='label'&&text(node).startsWith('名称'));nodes(name).find(node=>node.type==='input').props.onChange({target:{checked:false}});tree=app.render(p);button(tree,'确定').props.onClick();tree=app.render(p);
  const span=nodes(tree).find(node=>node.type==='td'&&text(node)==='合计');assert.equal(span.props.colSpan,1);assert.ok(nodes(tree).some(node=>node.type==='td'&&text(node)==='300'));
});

const separator=(tree,label)=>{const value=nodes(tree).find(node=>node.props.role==='separator'&&node.props['aria-label']==='调整'+label+'列宽');assert.ok(value,label);return value;};
const tableNode=tree=>nodes(tree).find(node=>node.type==='table');
const columnWidths=tree=>Object.fromEntries(nodes(tree).filter(node=>node.type==='col'&&node.props['data-column-id']).map(node=>[node.props['data-column-id'],node.props.style.width]));
function pointerTarget(){const captures=new Set();return {setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id),captures};}
function pointer(type,x,target,id=7,y=20){const event=new Event(type,{cancelable:true});Object.defineProperties(event,{clientX:{value:x},clientY:{value:y},pointerId:{value:id},button:{value:0},currentTarget:{value:target}});return event;}
function key(key,shiftKey=false){const event=new Event('keydown',{cancelable:true});Object.defineProperties(event,{key:{value:key},shiftKey:{value:shiftKey}});return event;}
function setColumnHidden(app,p,tree,label,hidden){button(tree,'显示字段设置').props.onClick();tree=app.render(p);const field=nodes(tree).find(node=>node.type==='label'&&text(node).startsWith(label));nodes(field).find(node=>node.type==='input').props.onChange({target:{checked:!hidden}});tree=app.render(p);button(tree,'确定').props.onClick();return app.render(p);}

test('column resizing is on by default and an explicit false retains the original layout',()=>{
  const app=harness(),p=props();app.render(p);const tree=app.render(p);
  assert.equal(nodes(tree).filter(node=>node.props.role==='separator').length,3);
  assert.equal(nodes(tree).filter(node=>node.type==='colgroup').length,1);
  assert.equal(tableNode(tree).props.style.tableLayout,'fixed');assert.equal(app.writes.length,0);
  const optOut=app.render({...p,resizable:false});assert.equal(nodes(optOut).filter(node=>node.props.role==='separator').length,0);assert.equal(nodes(optOut).filter(node=>node.type==='colgroup').length,0);assert.equal(tableNode(optOut).props.style.tableLayout,undefined);
});

test('pointer resizing starts from measured widths, changes only its column and persists on release',()=>{
  const app=harness(),p=props(undefined,{resizable:true});app.render(p);let tree=app.render(p),handle=separator(tree,'名称'),target=pointerTarget();
  assert.deepEqual(columnWidths(tree),{'selection-0':40,'名称':240,'金额':160});assert.equal(tableNode(tree).props.style.width,542);
  const down=pointer('pointerdown',100,target);handle.props.onPointerDown(down);assert.equal(down.defaultPrevented,true);assert.ok(target.captures.has(7));
  handle.props.onPointerMove(pointer('pointermove',170,target));tree=app.render(p);
  assert.deepEqual(columnWidths(tree),{'selection-0':40,'名称':310,'金额':160});assert.equal(tableNode(tree).props.style.tableLayout,'fixed');assert.equal(tableNode(tree).props.style.width,612);assert.equal(app.writes.length,0);
  handle=separator(tree,'名称');handle.props.onPointerUp(pointer('pointerup',180,target));tree=app.render(p);
  assert.equal(columnWidths(tree)['名称'],320);assert.equal(tableNode(tree).props.style.width,622);assert.equal(app.writes.length,1);assert.equal(target.captures.size,0);
  const saved=JSON.parse([...app.storage.values()][0]);assert.deepEqual(saved,{hidden:[],order:[],widths:{'selection-0':40,'名称':320,'金额':160}});
  assert.match(text(body(tree)),/甲100/);assert.match(text(body(tree)),/乙200/);
});

test('pointer boundaries and capture cancel preserve previous preferences without a business write',()=>{
  const app=harness(),p=props(undefined,{resizable:true});app.render(p);let tree=app.render(p),handle=separator(tree,'名称'),target=pointerTarget();
  handle.props.onPointerDown(pointer('pointerdown',200,target));handle.props.onPointerMove(pointer('pointermove',-3000,target));tree=app.render(p);assert.equal(columnWidths(tree)['名称'],80);
  separator(tree,'名称').props.onPointerMove(pointer('pointermove',9999,target,99));tree=app.render(p);assert.equal(columnWidths(tree)['名称'],80,'an unrelated touch cannot resize');
  separator(tree,'名称').props.onPointerCancel(pointer('pointercancel',-3000,target));tree=app.render(p);assert.equal(columnWidths(tree)['名称'],240);assert.equal(app.writes.length,0);assert.equal(target.captures.size,0);
  handle=separator(tree,'名称');handle.props.onPointerDown(pointer('pointerdown',0,target));handle.props.onPointerMove(pointer('pointermove',9999,target));tree=app.render(p);assert.equal(columnWidths(tree)['名称'],1200);
  separator(tree,'名称').props.onLostPointerCapture(pointer('lostpointercapture',undefined,target));tree=app.render(p);assert.equal(columnWidths(tree)['名称'],240);assert.equal(app.writes.length,0);
});

test('keyboard column controls provide accessible current widths, larger steps and bounded endpoints',()=>{
  const app=harness(),p=props(undefined,{resizable:true});app.render(p);let tree=app.render(p),handle=separator(tree,'名称');
  assert.equal(handle.props.tabIndex,0);assert.equal(handle.props['aria-orientation'],'vertical');assert.equal(handle.props['aria-valuenow'],240);
  const right=key('ArrowRight');handle.props.onKeyDown(right);assert.equal(right.defaultPrevented,true);tree=app.render(p);assert.equal(columnWidths(tree)['名称'],250);
  separator(tree,'名称').props.onKeyDown(key('ArrowLeft',true));tree=app.render(p);assert.equal(columnWidths(tree)['名称'],200);
  separator(tree,'名称').props.onKeyDown(key('Home'));tree=app.render(p);assert.equal(columnWidths(tree)['名称'],80);assert.equal(separator(tree,'名称').props['aria-valuetext'],'80像素');
  separator(tree,'名称').props.onKeyDown(key('End'));tree=app.render(p);assert.equal(columnWidths(tree)['名称'],1200);
  separator(tree,'勾选').props.onKeyDown(key('Home'));tree=app.render(p);assert.equal(columnWidths(tree)['selection-0'],36);assert.equal(separator(tree,'勾选').props['aria-valuemin'],36);
  const writes=app.writes.length;separator(tree,'名称').props.onKeyDown(key('Enter'));assert.equal(app.writes.length,writes);
});

test('hidden columns keep resized widths and resizing preserves full row order on reload',()=>{
  const app=harness(),p=props(undefined,{resizable:true});app.render(p);let tree=app.render(p);separator(tree,'金额').props.onKeyDown(key('ArrowRight',true));tree=app.render(p);
  button(tree,'下移第1行').props.onClick();tree=app.render(p);tree=setColumnHidden(app,p,tree,'金额',true);
  assert.deepEqual(columnWidths(tree),{'selection-0':40,'名称':240});assert.equal(tableNode(tree).props.style.width,382);assert.deepEqual(rowIDs(tree),['b','a']);
  let saved=JSON.parse([...app.storage.values()][0]);assert.equal(saved.widths['金额'],210);assert.deepEqual(saved.hidden,['金额']);assert.deepEqual(saved.order,['b','a','c']);
  separator(tree,'名称').props.onKeyDown(key('ArrowRight'));tree=app.render(p);tree=setColumnHidden(app,p,tree,'金额',false);assert.equal(columnWidths(tree)['金额'],210);
  const reloaded=harness({stored:[...app.storage]});reloaded.render(p);tree=reloaded.render(p);assert.deepEqual(columnWidths(tree),{'selection-0':40,'名称':250,'金额':210});assert.deepEqual(rowIDs(tree),['b','a']);assert.equal(reloaded.writes.length,0);
});

test('stored widths are isolated by account, table and scope and old preferences retain hidden rows',()=>{
  const oldKey='gugemei:table:v1:'+JSON.stringify(['offline-owner','offline-table','project-a']);
  const app=harness({stored:[[oldKey,JSON.stringify({hidden:['金额'],order:['b','a']})]]}),p=props(undefined,{resizable:true,preferenceScope:'project-a'});app.render(p);let tree=app.render(p);
  assert.deepEqual(rowIDs(tree),['b','a']);assert.equal(columnWidths(tree)['金额'],undefined);separator(tree,'名称').props.onKeyDown(key('End'));tree=app.render(p);
  app.setOwner('other-owner');app.render(p);tree=app.render(p);assert.equal(columnWidths(tree)['名称'],240);assert.deepEqual(rowIDs(tree),['a','b']);
  app.setOwner('offline-owner');app.render({...p,preferenceScope:'project-b'});tree=app.render({...p,preferenceScope:'project-b'});assert.equal(columnWidths(tree)['名称'],240);
  app.render({...p,tableKey:'other-table'});tree=app.render({...p,tableKey:'other-table'});assert.equal(columnWidths(tree)['名称'],240);
  app.render(p);tree=app.render(p);assert.equal(columnWidths(tree)['名称'],1200);assert.equal(columnWidths(tree)['金额'],undefined);assert.deepEqual(rowIDs(tree),['b','a']);assert.equal(app.storage.size,1);
});

test('busy operations cancel pending resize and disable pointer and keyboard changes',()=>{
  const app=harness(),p=props(undefined,{resizable:true});app.render(p);let tree=app.render(p),target=pointerTarget();separator(tree,'名称').props.onPointerDown(pointer('pointerdown',0,target));separator(tree,'名称').props.onPointerMove(pointer('pointermove',100,target));tree=app.render(p);assert.equal(columnWidths(tree)['名称'],340);
  app.render({...p,disabled:true});tree=app.render({...p,disabled:true});assert.equal(columnWidths(tree)['名称'],240);assert.equal(target.captures.size,0);const handle=separator(tree,'名称');assert.equal(handle.props.tabIndex,-1);assert.equal(handle.props['aria-disabled'],true);
  handle.props.onPointerDown(pointer('pointerdown',0,target));handle.props.onPointerMove(pointer('pointermove',100,target));handle.props.onPointerUp(pointer('pointerup',100,target));handle.props.onKeyDown(key('End'));tree=app.render({...p,disabled:true});assert.equal(columnWidths(tree)['名称'],240);assert.equal(app.writes.length,0);
});

test('explicitly required quote selection columns remain visible even with hidden accessibility labels',()=>{
  const storageKey='gugemei:table:v1:'+JSON.stringify(['offline-owner','offline-table','']);
  const app=harness({stored:[[storageKey,JSON.stringify({hidden:['quote-line-selection'],order:['b','a'],widths:{'quote-line-selection':38}})]]}),p=props(undefined,{resizable:true});
  const header=p.children[0],row=header.props.children,cells=React.Children.toArray(row.props.children);
  cells[0]=React.cloneElement(cells[0],{'data-column-key':'quote-line-selection','data-column-required':true},React.createElement('label',null,inputCheckbox(),React.createElement('span',{className:'selectionVisuallyHidden'},'选择当前柜体全部明细')));
  p.children[0]=React.cloneElement(header,{},React.cloneElement(row,{},cells));app.render(p);let tree=app.render(p);
  assert.ok(nodes(tree).some(node=>node.type==='th'&&node.props['data-column-id']==='quote-line-selection'));assert.equal(columnWidths(tree)['quote-line-selection'],38);assert.equal(separator(tree,'勾选').props['aria-valuemin'],36);assert.deepEqual(rowIDs(tree),['b','a']);
  button(tree,'显示字段设置').props.onClick();tree=app.render(p);const selection=nodes(tree).find(node=>node.type==='label'&&text(node).startsWith('勾选')),checkbox=nodes(selection).find(node=>node.type==='input');assert.equal(checkbox.props.disabled,true);assert.equal(checkbox.props.checked,true);
  button(tree,'确定').props.onClick();tree=app.render(p);assert.ok(nodes(tree).some(node=>node.type==='th'&&node.props['data-column-id']==='quote-line-selection'));assert.equal(columnWidths(tree)['quote-line-selection'],38);
});

test('adding a quote checkbox before the old sequence column cannot shift persisted sequence and data widths',()=>{
  const storageKey='gugemei:table:v1:'+JSON.stringify(['offline-owner','offline-table','']);
  const app=harness({stored:[[storageKey,JSON.stringify({hidden:[],order:['b','a'],widths:{'序号':44,'名称':260,'金额':180}})]]}),p=props(undefined,{resizable:true});
  const header=p.children[0],row=header.props.children,cells=React.Children.toArray(row.props.children);cells[0]=React.createElement('th',{key:'sequence'},'序号');p.children[0]=React.cloneElement(header,{},React.cloneElement(row,{},cells));
  const originalBody=p.children[1],bodyRows=React.Children.toArray(originalBody.props.children).map((value,index)=>{const data=React.Children.toArray(value.props.children);data[0]=React.createElement('td',{key:'sequence'},index+1);return React.cloneElement(value,{},data);});p.children[1]=React.cloneElement(originalBody,{},bodyRows);
  app.render(p);let tree=app.render(p);assert.deepEqual(columnWidths(tree),{'序号':44,'名称':260,'金额':180});
  const selection=React.createElement('th',{key:'new-selection','data-column-key':'quote-line-selection','data-column-required':true},inputCheckbox());
  p.children[0]=React.cloneElement(header,{},React.cloneElement(row,{},[selection,...cells]));p.children[1]=React.cloneElement(originalBody,{},bodyRows.map(value=>React.cloneElement(value,{},[React.createElement('td',{key:'new-selection'},inputCheckbox()),...React.Children.toArray(value.props.children)])));p.children=p.children.slice(0,2);tree=app.render(p);tree=app.render(p);
  assert.equal(columnWidths(tree)['序号'],44);assert.equal(columnWidths(tree)['名称'],260);assert.equal(columnWidths(tree)['金额'],180);assert.equal(columnWidths(tree)['quote-line-selection'],48);assert.deepEqual(rowIDs(tree),['b','a']);
  separator(tree,'勾选').props.onKeyDown(key('ArrowRight'));tree=app.render(p);assert.equal(columnWidths(tree)['quote-line-selection'],58);assert.equal(columnWidths(tree)['序号'],44);
  const saved=JSON.parse(app.storage.get(storageKey));assert.equal(saved.widths['序号'],44);assert.equal(saved.widths['名称'],260);assert.equal(saved.widths['金额'],180);assert.equal(saved.widths['quote-line-selection'],58);
});

const headerIDs=tree=>nodes(tree).filter(node=>node.type==='th'&&node.props['data-column-id']).map(node=>node.props['data-column-id']);
const headerHandle=(tree,id)=>{const value=nodes(tree).find(node=>node.type==='th'&&node.props['data-column-id']===id&&node.props.onPointerDown);assert.ok(value,'movable header '+id);return value;};
const noColumnMoveButtons=tree=>assert.ok(!nodes(tree).some(node=>node.type==='button'&&typeof node.props['aria-label']==='string'&&/^移动.+列$/.test(node.props['aria-label'])),'列移动按钮（三道横线）应已移除');
const cellIDs=tree=>React.Children.toArray(React.Children.toArray(body(tree).props.children)[0].props.children).filter(cell=>cell.props['data-column-id']).map(cell=>cell.props['data-column-id']);
const sortableProps=more=>{const value=props(undefined,more);value.children=value.children.slice(0,2);return value;};
function centerOfColumn(tree,id){let left=0;for(const column of nodes(tree).filter(node=>node.type==='col'&&node.props['data-column-id'])){const width=column.props.style.width;if(column.props['data-column-id']===id)return left+width/2;left+=width;}throw Error('No column '+id);}

test('keyboard header movement reorders columns and cells together without changing rows or row callbacks',()=>{
  const changes=[],app=harness(),p=sortableProps({onRowsReorder:ids=>changes.push(ids)});app.render(p);let tree=app.render(p);
  assert.ok(!nodes(tree).some(node=>node.props['aria-label']==='移动勾选列'));noColumnMoveButtons(tree);
  headerHandle(tree,'名称').props.onKeyDown(key('ArrowRight'));tree=app.render(p);
  assert.deepEqual(headerIDs(tree),['selection-0','金额','名称']);assert.deepEqual(cellIDs(tree),headerIDs(tree));
  assert.deepEqual(rowIDs(tree),['a','b']);assert.deepEqual(changes,[]);assert.match(text(body(tree)),/100甲/);
  const saved=JSON.parse([...app.storage.values()][0]);assert.deepEqual(saved.columnOrder,['selection-0','金额','名称']);assert.deepEqual(saved.order,[]);
  separator(tree,'名称').props.onKeyDown(key('ArrowRight'));tree=app.render(p);assert.equal(columnWidths(tree)['名称'],250);assert.equal(columnWidths(tree)['金额'],160);
  const reload=harness({stored:[...app.storage]});reload.render(p);tree=reload.render(p);assert.deepEqual(headerIDs(tree),['selection-0','金额','名称']);assert.equal(columnWidths(tree)['名称'],250);assert.equal(reload.writes.length,0);
  const writes=app.writes.length;headerHandle(tree,'名称').props.onKeyDown(key('ArrowRight'));headerHandle(tree,'名称').props.onKeyDown(key('Enter'));assert.equal(app.writes.length,writes);
});

test('editable name/model inputs retain values, field handlers and stable cell keys after moving columns',()=>{
  const fields={name:'榆木板',model:'18mm'},updates=[],focused={insideTable:true,isConnected:true,selectionStart:1,selectionEnd:3,selectionDirection:'forward',matches:()=>true},doc={activeElement:focused},focusCalls=[];
  focused.focus=options=>{doc.activeElement=focused;focusCalls.push(options);};focused.setSelectionRange=(start,end,direction)=>{focusCalls.push([start,end,direction]);};
  const app=harness({document:doc}),input=(field)=>React.createElement('input',{'aria-label':field,value:fields[field],onChange:event=>{fields[field]=event.target.value;updates.push(field);}});
  const p={tableKey:'editor',children:[React.createElement('thead',null,React.createElement('tr',null,React.createElement('th',{'data-column-key':'pick','data-column-fixed':true,'data-column-required':true},'选择'),React.createElement('th',{'data-column-required':true},'名称'),React.createElement('th',null,'规格型号'),React.createElement('th',null,'操作'))),React.createElement('tbody',null,React.createElement('tr',{'data-row-id':'one',key:'one'},React.createElement('td',null,inputCheckbox()),React.createElement('td',null,input('name')),React.createElement('td',null,input('model')),React.createElement('td',null,React.createElement('button',null,'删除'))))]};
  app.render(p);let tree=app.render(p);const before=Object.fromEntries(nodes(body(tree)).filter(node=>node.type==='td'&&node.props['data-column-id']).map(node=>[node.props['data-column-id'],node]));
  headerHandle(tree,'名称').props.onKeyDown(key('ArrowRight'));doc.activeElement=null;tree=app.render(p);
  assert.deepEqual(headerIDs(tree),['pick','规格型号','名称','操作']);assert.deepEqual(cellIDs(tree),headerIDs(tree));
  for(const id of ['名称','规格型号']){const after=nodes(body(tree)).find(node=>node.type==='td'&&node.props['data-column-id']===id);assert.equal(after.key,before[id].key);assert.equal(after.props.children,before[id].props.children);}
  const model=nodes(tree).find(node=>node.type==='input'&&node.props['aria-label']==='model'),name=nodes(tree).find(node=>node.type==='input'&&node.props['aria-label']==='name');
  assert.equal(model.props.value,'18mm');assert.equal(name.props.value,'榆木板');model.props.onChange({target:{value:'25mm'}});assert.deepEqual(fields,{name:'榆木板',model:'25mm'});assert.deepEqual(updates,['model']);
  assert.equal(doc.activeElement,focused);assert.equal(focusCalls[0].preventScroll,true);assert.deepEqual(focusCalls[1],[1,3,'forward']);
  assert.ok(!nodes(tree).some(node=>node.props['aria-label']==='移动选择列'||node.props['aria-label']==='移动操作列'));
});

test('pointer and touch column drags persist only a valid release; cancel, lost capture and outside drops do nothing',()=>{
  const app=harness(),p=sortableProps();app.render(p);let tree=app.render(p),target=pointerTarget();
  const start=()=>headerHandle(tree,'名称').props.onPointerDown(pointer('pointerdown',centerOfColumn(tree,'名称'),target));
  start();headerHandle(tree,'名称').props.onPointerMove(pointer('pointermove',centerOfColumn(tree,'金额'),target));tree=app.render(p);assert.deepEqual(headerIDs(tree),['selection-0','名称','金额']);assert.equal(app.writes.length,0);
  headerHandle(tree,'名称').props.onPointerCancel(pointer('pointercancel',400,target));tree=app.render(p);assert.equal(target.captures.size,0);assert.equal(app.writes.length,0);
  start();headerHandle(tree,'名称').props.onPointerMove(pointer('pointermove',400,target,99));headerHandle(tree,'名称').props.onLostPointerCapture(pointer('lostpointercapture',400,target));tree=app.render(p);assert.equal(app.writes.length,0);
  start();headerHandle(tree,'名称').props.onPointerUp(pointer('pointerup',400,target,7,100));tree=app.render(p);assert.equal(app.writes.length,0,'a drop outside the header cannot commit');
  start();headerHandle(tree,'名称').props.onPointerUp(pointer('pointerup',centerOfColumn(tree,'selection-0'),target));tree=app.render(p);assert.equal(app.writes.length,0,'fixed selection is not a drop target');
  start();headerHandle(tree,'名称').props.onPointerMove(pointer('pointermove',centerOfColumn(tree,'金额'),target));headerHandle(tree,'名称').props.onPointerUp(pointer('pointerup',centerOfColumn(tree,'金额'),target));tree=app.render(p);
  assert.deepEqual(headerIDs(tree),['selection-0','金额','名称']);assert.deepEqual(cellIDs(tree),headerIDs(tree));assert.equal(app.writes.length,1);assert.equal(target.captures.size,0);
});

test('hidden column slots and field widths survive reorder, row movements, hide/show and reload',()=>{
  const storageKey='gugemei:table:v1:'+JSON.stringify(['offline-owner','offline-table','']);
  const app=harness({stored:[[storageKey,JSON.stringify({hidden:['金额'],order:['b','a'],widths:{名称:280,金额:190},columnOrder:['selection-0','金额','名称']})]]}),p=sortableProps();app.render(p);let tree=app.render(p);
  assert.deepEqual(headerIDs(tree),['selection-0','名称']);assert.deepEqual(rowIDs(tree),['b','a']);assert.equal(columnWidths(tree)['名称'],280);
  const before=app.writes.length;headerHandle(tree,'名称').props.onKeyDown(key('ArrowLeft'));assert.equal(app.writes.length,before);
  tree=setColumnHidden(app,p,tree,'金额',false);assert.deepEqual(headerIDs(tree),['selection-0','金额','名称']);assert.equal(columnWidths(tree)['金额'],190);
  headerHandle(tree,'名称').props.onKeyDown(key('ArrowLeft'));tree=app.render(p);assert.deepEqual(headerIDs(tree),['selection-0','名称','金额']);assert.deepEqual(rowIDs(tree),['b','a']);
  app.setOwner('another-owner');app.render(p);tree=app.render(p);assert.deepEqual(headerIDs(tree),['selection-0','名称','金额']);assert.deepEqual(rowIDs(tree),['a','b']);assert.equal(columnWidths(tree)['名称'],240);
  app.setOwner('offline-owner');app.render(p);tree=app.render(p);assert.deepEqual(rowIDs(tree),['b','a']);assert.equal(columnWidths(tree)['名称'],280);
});

test('columnReorder=false preserves original source column positions while keeping resize and stored order',()=>{
  const storageKey='gugemei:table:v1:'+JSON.stringify(['offline-owner','offline-table','']);
  const app=harness({stored:[[storageKey,JSON.stringify({hidden:[],order:[],columnOrder:['金额','名称']})]]}),p=sortableProps({columnReorder:false});app.render(p);let tree=app.render(p);
  assert.deepEqual(headerIDs(tree),['selection-0','名称','金额']);assert.ok(!nodes(tree).some(node=>node.props.className==='managedColumnOrderHandle'));
  separator(tree,'名称').props.onKeyDown(key('ArrowRight'));tree=app.render(p);assert.equal(columnWidths(tree)['名称'],250);assert.deepEqual(JSON.parse(app.storage.get(storageKey)).columnOrder,['金额','名称']);
});

test('merged totals and incomplete rows keep original alignment, retain preferences and still allow width changes',()=>{
  const storageKey='gugemei:table:v1:'+JSON.stringify(['offline-owner','offline-table','']);
  const app=harness({stored:[[storageKey,JSON.stringify({hidden:[],order:[],columnOrder:['金额','名称']})]]}),p=props();app.render(p);let tree=app.render(p);
  assert.deepEqual(headerIDs(tree),['selection-0','名称','金额']);assert.deepEqual(cellIDs(tree),headerIDs(tree));assert.ok(!nodes(tree).some(node=>node.props.className==='managedColumnOrderHandle'));assert.match(text(tree),/合并单元格，列顺序固定/);
  assert.equal(nodes(tree).find(node=>node.type==='td'&&text(node)==='合计').props.colSpan,2);separator(tree,'名称').props.onKeyDown(key('ArrowRight'));tree=app.render(p);assert.equal(columnWidths(tree)['名称'],250);assert.deepEqual(JSON.parse(app.storage.get(storageKey)).columnOrder,['金额','名称']);
  const enabled={...p,children:p.children.slice(0,2)};tree=app.render(enabled);assert.deepEqual(headerIDs(tree),['selection-0','金额','名称']);assert.deepEqual(cellIDs(tree),headerIDs(tree));
});

test('pending operation or scope changes cancel column gestures without saving the previous table layout',()=>{
  const app=harness(),p=sortableProps();app.render(p);let tree=app.render(p),target=pointerTarget();
  headerHandle(tree,'名称').props.onPointerDown(pointer('pointerdown',100,target));headerHandle(tree,'名称').props.onPointerMove(pointer('pointermove',400,target));tree=app.render({...p,disabled:true});assert.equal(target.captures.size,0);assert.equal(app.writes.length,0);
  headerHandle(tree,'名称').props.onKeyDown(key('ArrowRight'));tree=app.render({...p,disabled:true});assert.deepEqual(headerIDs(tree),['selection-0','名称','金额']);assert.equal(app.writes.length,0);
  tree=app.render(p);headerHandle(tree,'名称').props.onPointerDown(pointer('pointerdown',100,target));headerHandle(tree,'名称').props.onPointerMove(pointer('pointermove',400,target));app.setOwner('new-owner');app.render(p);tree=app.render(p);assert.equal(target.captures.size,0);assert.equal(app.writes.length,0);assert.deepEqual(headerIDs(tree),['selection-0','名称','金额']);
});

test('restore columns defaults is a draft until confirmed, keeps existing row order and restores widths and positions',()=>{
  const app=harness(),p=sortableProps();app.render(p);let tree=app.render(p);headerHandle(tree,'名称').props.onKeyDown(key('ArrowRight'));tree=app.render(p);separator(tree,'名称').props.onKeyDown(key('ArrowRight',true));tree=app.render(p);button(tree,'下移第1行').props.onClick();tree=app.render(p);
  const before=app.writes.length;button(tree,'显示字段设置').props.onClick();tree=app.render(p);button(tree,'恢复默认').props.onClick();tree=app.render(p);button(tree,'取消').props.onClick();tree=app.render(p);assert.equal(app.writes.length,before);assert.deepEqual(headerIDs(tree),['selection-0','金额','名称']);assert.equal(columnWidths(tree)['名称'],290);
  button(tree,'显示字段设置').props.onClick();tree=app.render(p);button(tree,'恢复默认').props.onClick();tree=app.render(p);button(tree,'确定').props.onClick();tree=app.render(p);assert.deepEqual(headerIDs(tree),['selection-0','名称','金额']);assert.equal(columnWidths(tree)['名称'],240);assert.deepEqual(rowIDs(tree),['b','a']);
});

test('failed pointer capture and competing row/column gestures leave preferences unchanged',()=>{
  const app=harness(),p=sortableProps();app.render(p);let tree=app.render(p);
  const failed={setPointerCapture(){throw Error('Pointer is no longer active');},hasPointerCapture:()=>false};
  separator(tree,'名称').props.onPointerDown(pointer('pointerdown',100,failed));tree=app.render(p);assert.equal(columnWidths(tree)['名称'],240);assert.equal(app.writes.length,0);
  headerHandle(tree,'名称').props.onPointerDown(pointer('pointerdown',100,failed));tree=app.render(p);assert.deepEqual(headerIDs(tree),['selection-0','名称','金额']);assert.equal(app.writes.length,0);
  const target=pointerTarget();separator(tree,'名称').props.onPointerDown(pointer('pointerdown',100,target));separator(tree,'名称').props.onPointerMove(pointer('pointermove',150,target));tree=app.render(p);
  button(tree,'下移第1行').props.onClick();headerHandle(tree,'名称').props.onKeyDown(key('ArrowRight'));separator(tree,'金额').props.onKeyDown(key('ArrowRight'));button(tree,'显示字段设置').props.onClick();tree=app.render(p);
  assert.deepEqual(rowIDs(tree),['a','b']);assert.deepEqual(headerIDs(tree),['selection-0','名称','金额']);assert.equal(app.writes.length,0);assert.ok(!nodes(tree).some(node=>node.props.role==='dialog'));
  separator(tree,'名称').props.onPointerCancel(pointer('pointercancel',150,target));tree=app.render(p);assert.equal(columnWidths(tree)['名称'],240);assert.equal(app.writes.length,0);
});
