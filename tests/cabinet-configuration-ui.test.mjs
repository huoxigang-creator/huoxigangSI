import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {setImmediate as nextTurn} from 'node:timers/promises';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require=createRequire(import.meta.url);
// Actual configuration handlers and catalog/trash services use only this SQLite database.
async function harness(t){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('drizzle/0000_slippery_lenny_balinger.sql','utf8'));t.after(()=>sqlite.close());
 const database={prepare(sql){let args=[];return{sql,get args(){return args;},bind(...values){args=values;return this;},async all(){return{results:sqlite.prepare(sql).all(...args)};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(statement=>({meta:{changes:Number(sqlite.prepare(statement.sql).run(...statement.args).changes)}}));sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const cache=new Map(),slots=[],requests=[],confirmations=[],changes=[];let cursor=0,effects=[],serial=0,catalog,trash;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const hooks={...React,useContext(context){return context._currentValue;},useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};const slot=slots[i];return[slot.value,value=>{slot.value=typeof value==='function'?value(slot.value):value;}];},useRef(initial){const i=cursor++;slots[i]??={value:{current:initial}};return slots[i].value;},useMemo(create,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:create(),deps};return slots[i].value;},useCallback(callback,deps){return hooks.useMemo(()=>callback,deps);},useEffect(effect,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){slots[i]?.cleanup?.();const slot={deps};slots[i]=slot;effects.push(()=>{slot.cleanup=effect();});}}};
 const fetch=async(path,options)=>{const request=JSON.parse(options.body);requests.push({path,...request});try{const result=await(path==='/api/catalog'?catalog.execute('offline-owner',request.action,request.args):path==='/api/trash'?trash.execute('offline-owner',request.action,request.args):Promise.reject(Error('Unexpected fixture route')));return{ok:true,json:async()=>({ok:true,result})};}catch(error){return{ok:false,json:async()=>({ok:false,error:error.message})};}};
 function load(path){if(cache.has(path))return cache.get(path).exports;const module={exports:{}};cache.set(path,module);const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  function localRequire(name){if(name==='react')return hooks;if(name==='cloudflare:workers')return{env:{}};if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});if(name.endsWith('.css'))return{};if(name.startsWith('.')){const base=resolve(dirname(path),name),target=[base,base+'.ts',base+'.tsx'].find(existsSync);assert.ok(target,name);return load(target);}return require(name);}
  runInNewContext('(function(exports,require,module){'+code+'\n})',{Intl,Date,Set,Map,Error,Number,String,BigInt,fetch,crypto:{randomUUID:()=>`00000000-0000-4000-a000-${String(++serial).padStart(12,'0')}`},window:{confirm:message=>{confirmations.push(message);return true;},addEventListener(){},removeEventListener(){}}})(module.exports,localRequire,module);return module.exports;
 }
 catalog=load(resolve('lib/catalog.ts')).createCatalogService({database:()=>database});trash=load(resolve('lib/trash.ts')).createTrashService({database:()=>database,bucket:()=>undefined});
 const configured=await catalog.execute('offline-owner','create_material',{name:'衣柜',expense_category:'柜体',model:'旧18mm',unit:'㎡',purchase_price:200,sale_price:480,code:'CAB01'});
 const material=await catalog.execute('offline-owner','create_material',{name:'板材',expense_category:'材料费用',unit:'张',code:'MAT01'});
 const hardware=await catalog.execute('offline-owner','create_material',{name:'铰链',expense_category:'五金费用',unit:'只',code:'HW01'});
 const Configuration=load(resolve('app/configuration.tsx')).default,helper=load(resolve('lib/cabinet-catalog.ts'));
 const props={expenseCategory:'柜体',onChanged:async()=>changes.push(await catalog.execute('offline-owner','get_catalog'))};
 function render(category=props.expenseCategory){props.expenseCategory=category;cursor=0;effects=[];const tree=Configuration(props);for(const effect of effects.splice(0))effect();return tree;}
 const records=()=>sqlite.prepare("SELECT * FROM records WHERE kind='material'").all().map(row=>({id:row.id,...JSON.parse(row.data)}));
 render();await settle();
 return{render,requests,confirmations,changes,configured,material,hardware,records,helper,catalog,trash};
}
function elements(node){return Array.isArray(node)?node.flatMap(elements):React.isValidElement(node)?[node,...elements(node.props.children)]:[];}
const text=node=>Array.isArray(node)?node.map(text).join(''):React.isValidElement(node)?text(node.props.children):typeof node==='string'||typeof node==='number'?String(node):'';
function find(tree,predicate,label){const node=elements(tree).find(predicate);assert.ok(node,label);return node;}
const button=(tree,label)=>find(tree,node=>node.type==='button'&&text(node)===label,'Button: '+label);
const input=(tree,name)=>find(tree,node=>node.type==='input'&&node.props.name===name,'Input: '+name);
const choice=(tree,label)=>find(tree,node=>node.type==='select'&&node.props['aria-label']===label,'Choice: '+label);
const rows=tree=>elements(tree).filter(node=>node.type==='tr'&&node.props['data-row-id']).map(node=>node.props['data-row-id']);
const writes=app=>app.requests.filter(request=>request.action!=='get_catalog');
async function settle(){await nextTurn();await nextTurn();}
async function save(app){const tree=app.render(),dialog=find(tree,node=>node.props['aria-labelledby']==='material-editor-title','Editor');await find(dialog,node=>node.type==='form','Editor form').props.onSubmit({preventDefault(){}});await settle();return app.render();}

test('配置柜体新增自定义名称，真实服务将元存分并刷新名称选择，不串材料或五金',async t=>{
 const app=await harness(t);let tree=app.render();assert.deepEqual(rows(tree),[app.configured.id]);button(tree,'新增柜体').props.onClick();tree=app.render();
 assert.equal(choice(tree,'费用类型').props.value,'柜体');assert.equal(input(tree,'unit').props.value,'㎡');
 input(tree,'name').props.onChange({target:{value:'窗边展示柜'}});input(tree,'model').props.onChange({target:{value:'25mm E0'}});input(tree,'purchase_price').props.onChange({target:{value:'123.45'}});input(tree,'sale_price').props.onChange({target:{value:'456.78'}});
 assert.equal(writes(app).length,0);tree=await save(app);
 assert.equal(writes(app).length,1);assert.equal(writes(app)[0].action,'create_material');assert.equal(writes(app)[0].args.expense_category,'柜体');assert.equal(writes(app)[0].args.purchase_price,123.45);assert.equal(writes(app)[0].args.sale_price,456.78);
 const custom=app.records().find(record=>record.name==='窗边展示柜');assert.equal(custom.purchase_price,12345);assert.equal(custom.sale_price,45678);assert.equal(custom.model,'25mm E0');assert.equal(rows(tree).includes(custom.id),true);assert.equal(app.changes.length,1);
 const options=app.helper.getCabinetOptions(app.changes[0].materials);assert.equal(options.find(option=>option.name==='窗边展示柜').sale_price,45678);
 assert.deepEqual(rows(app.render('材料费用')),[app.material.id]);assert.deepEqual(rows(app.render('五金费用')),[app.hardware.id]);assert.equal(writes(app).length,1);
});

test('常用名称按钮只打开待确认表单，取消不写记录；保存才创建柜体配置',async t=>{
 const app=await harness(t),before=JSON.stringify(app.records());let tree=app.render();button(tree,'酒柜').props.onClick();tree=app.render();assert.equal(input(tree,'name').props.value,'酒柜');assert.equal(choice(tree,'费用类型').props.value,'柜体');
 assert.equal(writes(app).length,0);assert.equal(JSON.stringify(app.records()),before);button(tree,'取消').props.onClick();assert.equal(writes(app).length,0);assert.equal(JSON.stringify(app.records()),before);
 tree=app.render();button(tree,'酒柜').props.onClick();tree=app.render();input(tree,'sale_price').props.onChange({target:{value:'99.95'}});await save(app);
 assert.equal(writes(app).length,1);assert.equal(app.records().find(record=>record.name==='酒柜').sale_price,9995);assert.equal(app.records().length,4);
});

test('切换分类清空柜体选择；删除真实柜体后刷新回退内置名称，其他资料不受影响',async t=>{
 const app=await harness(t);let tree=app.render();find(tree,node=>node.props.label==='选择材料 衣柜','Cabinet selection').props.onChange();tree=app.render();assert.equal(button(tree,'删除所选').props.disabled,false);
 tree=app.render('材料费用');assert.equal(button(tree,'删除所选').props.disabled,true);assert.equal(writes(app).length,0);
 tree=app.render('柜体');find(tree,node=>node.props.label==='选择材料 衣柜','Cabinet selection').props.onChange();tree=app.render();button(tree,'删除所选').props.onClick();await settle();tree=app.render();
 assert.deepEqual(writes(app).map(request=>[request.path,request.action,request.args.id]),[['/api/trash','delete_record',app.configured.id]]);assert.deepEqual(rows(tree),[]);assert.equal(app.records().find(record=>record.id===app.configured.id).deleted,true);
 const options=app.helper.getCabinetOptions(app.changes[0].materials);assert.equal(app.helper.isBuiltinCabinetOption(options.find(option=>option.name==='衣柜')),true);
 assert.equal(app.records().find(record=>record.id===app.material.id).deleted,undefined);assert.equal(app.records().find(record=>record.id===app.hardware.id).deleted,undefined);
 await app.trash.execute('offline-owner','restore_record',{id:app.configured.id});button(tree,'刷新').props.onClick();await settle();tree=app.render();assert.deepEqual(rows(tree),[app.configured.id]);
 const restored=app.helper.getCabinetOptions((await app.catalog.execute('offline-owner','get_catalog')).materials).find(option=>option.name==='衣柜');assert.equal(app.helper.isBuiltinCabinetOption(restored),false);assert.equal(restored.model,'旧18mm');assert.equal(restored.sale_price,48000);
});
