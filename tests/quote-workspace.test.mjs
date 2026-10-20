import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {setImmediate as nextTurn} from 'node:timers/promises';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require=createRequire(import.meta.url),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const project={id:'offline-parent',name:'离线合作项目',customer:'测试客户',address:'测试地址'};
const groupID='45e94923-ef20-4092-b3c6-5c65bb3509ed';
const lines=[
  {category:'人工费用',name:'加工费',model:'',unit:'项',quantity:2,price:50,note:'人工备注'},
  {category:'材料费用',name:'测试板材',model:'18mm',unit:'张',quantity:3,price:100,note:'材料备注'},
  {category:'五金费用',name:'测试铰链',model:'110°',unit:'只',quantity:4,price:10,note:'五金备注'},
];
const quotes=[
  {id:'quote-new',project:project.id,subproject_id:groupID,subproject_name:'小项目甲',title:'小项目甲新版',items:lines,total:44000,adopted:false,created:'2026-10-12T02:00:00Z'},
  {id:'quote-adopted',project:project.id,subproject_id:groupID,subproject_name:'小项目甲',title:'小项目甲初版',items:lines,total:44000,adopted:true,created:'2026-10-12T01:00:00Z'},
  {id:'quote-legacy',project:project.id,title:'历史总报价',items:[{name:'历史项目',unit:'项',quantity:1,price:100}],total:10000,adopted:true,created:'2026-10-11T01:00:00Z'},
];
const preview={fileName:'匿名五金成本.xlsx',sheetName:'明细',priceKind:'cost',sourceTotal:2000,warnings:['成本价格，需确认销售价格。'],rows:[
  {id:'import-1',sourceRow:4,selected:true,category:'五金费用',name:'测试五金甲',model:'甲型',unit:'只',quantity:2,price:10,note:'',sourceAmount:2000,issues:[],acceptDifference:false},
  {id:'import-2',sourceRow:5,selected:true,category:'五金费用',name:'测试五金乙',model:'乙型',unit:'只',quantity:1,price:null,note:'',sourceAmount:null,issues:['原表未提供单价'],acceptDifference:false},
]};

// Drive the real component and selection hook without DOM/network or user data.
function harness({catalog={materials:[{id:'hw',name:'测试五金甲',model:'甲型',unit:'只',expense_category:'五金费用',sale_price:1500}],purchase_orders:[]},previewResult=preview,request=async()=>({ok:true})}={}) {
  const slots=[],cache=new Map(),effects=[],mutations=[],downloads=[],requests=[],confirmations=[],blobs=[];
  let cursor=0,serial=0;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const hooks={...React,
  useContext(context){return context._currentValue;},
    useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
    useRef(initial){const i=cursor++;if(!slots[i])slots[i]={value:{current:initial}};return slots[i].value;},
    useMemo(create,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:create(),deps};return slots[i].value;},
    useCallback(callback,deps){return hooks.useMemo(()=>callback,deps);},
    useEffect(effect,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){slots[i]={deps};effects.push(effect);}},
  };
  function load(path){if(cache.has(path))return cache.get(path).exports;const module={exports:{}};cache.set(path,module);const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    function localRequire(name){if(name==='react')return hooks;if(name==='lucide-react')return new Proxy({},{get:(_target,key)=>function Icon(){return String(key);}});if(name.endsWith('.css'))return {};
      if(name==='./document-import')return {default:function DocumentImport(){}};
      if(name.endsWith('/trash-client'))return {trashRequest:async(action,args)=>{requests.push({action,args:JSON.parse(JSON.stringify(args))});return request(action,args);}};
      if(name.endsWith('/quote-export'))return {downloadQuoteExcel:async args=>{downloads.push(args);}};
      if(name.startsWith('.')){const base=resolve(dirname(path),name),target=[base,base+'.ts',base+'.tsx'].find(existsSync);assert.ok(target,'Module exists: '+name);const result=load(target);if(name.endsWith('/quote-import'))return {...result,parseQuoteImport:async()=>JSON.parse(JSON.stringify(previewResult))};return result;}
      return require(name);
    }
    const document={createElement:()=>({click(){},remove(){}}),querySelector:()=>null,body:{style:{overflow:''},appendChild(){}}};
    const evaluate=runInNewContext('(function(exports,require,module){'+code+'\n})',{console,Intl,Date,Set,Map,Error,Number,String,Blob,document,fetch:async()=>({ok:true,json:async()=>({ok:true,result:catalog})}),crypto:{randomUUID:()=>`00000000-0000-4000-a000-${String(++serial).padStart(12,'0')}`},URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:offline';},revokeObjectURL(){}},setTimeout:fn=>{fn();return 0;},window:{confirm:message=>{confirmations.push(message);return true;},addEventListener(){},removeEventListener(){}}});evaluate(module.exports,localRequire,module);return module.exports;
  }
  const Workspace=load(resolve(root,'app/quote-workspace.tsx')).default;
  const props={projectId:project.id,projectName:project.name,project,companyName:'离线测试公司',items:quotes,busy:false,mutate:async(action,args)=>{mutations.push({action,args:JSON.parse(JSON.stringify(args))});return true;},onDeleted:async()=>{}};
  function render(overrides={}){cursor=0;effects.length=0;const tree=Workspace({...props,...overrides});for(const effect of effects.splice(0))effect();return tree;}
  return {render,props,mutations,downloads,requests,confirmations,blobs};
}
function elements(node){if(Array.isArray(node))return node.flatMap(elements);if(!node||typeof node!=='object'||!node.props)return [];return [node,...elements(node.props.children)];}
function text(node){if(Array.isArray(node))return node.map(text).join('');if(node===null||node===undefined||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);return text(node.props?.children);}
function find(tree,predicate,label){const node=elements(tree).find(predicate);assert.ok(node,label);return node;}
function button(tree,label){return find(tree,node=>node.type==='button'&&text(node)===label,'Button: '+label);}
function input(tree,label){return find(tree,node=>node.type==='input'&&node.props['aria-label']===label,'Input: '+label);}
function checkbox(tree,label){return find(tree,node=>node.props.label===label,'Checkbox: '+label);}
function dialog(tree,label){return find(tree,node=>node.props.role==='dialog'&&node.props['aria-labelledby']===label,'Dialog: '+label);}
function tab(tree,category,editor=false){const list=find(tree,node=>node.props.role==='tablist'&&node.props['aria-label']===(editor?'编辑费用类别':'报价费用类别'),'Tab list');return find(list,node=>node.props.role==='tab'&&text(node).startsWith(category),'Tab: '+category);}
function field(tree,placeholder){return find(tree,node=>node.type==='input'&&node.props.placeholder===placeholder,'Field: '+placeholder);}
async function settle(){await nextTurn();await nextTurn();}
function openNew(app){button(app.render(),'新建项目报价').props.onClick();return app.render();}
async function openImport(app){let tree=openNew(app);tab(tree,'五金费用',true).props.onClick();tree=app.render();input(tree,'导入五金明细文件').props.onChange({target:{files:[{name:'offline.xlsx'}]}});await settle();return app.render();}

test('同组两个版本展示一个小项目，三类明细单独切换且采纳金额只算一次',()=>{
  const app=harness();let tree=app.render();assert.equal(elements(tree).filter(node=>node.type==='article'&&node.props.className?.includes('qwCard')).length,2);assert.match(text(tree),/已采纳总额¥540\.00/);
  for(const [category,name] of [['人工费用','加工费'],['材料费用','测试板材'],['五金费用','测试铰链']]){tab(tree,category).props.onClick();tree=app.render();const panel=find(tree,node=>node.props.role==='tabpanel','Category panel');assert.equal(panel.props['aria-label'],category);assert.match(text(panel),new RegExp(name));assert.equal(elements(panel).filter(node=>node.type==='tr').length,2);}
  assert.equal(button(tree,'编辑草稿').props.disabled,true);assert.equal(button(tree,'复制为新版').props.disabled,false);
});

test('新建小项目保存三类完整明细、元单价和独立UUID，不提交UI行key',async()=>{
  const app=harness();let tree=openNew(app);field(tree,'如：吾悦南区东苑6-3-502').props.onChange({target:{value:'新增小项目'}});tree=app.render();
  input(tree,'人工费用第1行名称').props.onChange({target:{value:'加工费'}});input(tree,'人工费用第1行数量').props.onChange({target:{value:'2'}});input(tree,'人工费用第1行销售单价').props.onChange({target:{value:'50'}});
  for(const [category,name,price] of [['材料费用','板材','100'],['五金费用','铰链','10']]){tree=app.render();tab(tree,category,true).props.onClick();tree=app.render();button(tree,'添加'+category.replace('费用','')+'明细').props.onClick();tree=app.render();input(tree,category+'第1行名称').props.onChange({target:{value:name}});input(tree,category+'第1行销售单价').props.onChange({target:{value:price}});}
  tree=app.render();find(dialog(tree,'qwEditorTitle'),node=>node.type==='form','Editor form').props.onSubmit({preventDefault(){}});await settle();
  assert.equal(app.mutations.length,1);const {action,args}=app.mutations[0];assert.equal(action,'create_quote');assert.equal(args.project_id,project.id);assert.equal(args.subproject_name,'新增小项目');assert.equal(args.title,'新增小项目');assert.match(args.subproject_id,/^[a-f0-9-]{36}$/);assert.deepEqual(args.items.map(row=>row.category),['人工费用','材料费用','五金费用']);assert.deepEqual(args.items.map(row=>row.price),[50,100,10]);assert.ok(args.items.every(row=>!('key' in row)));assert.equal(app.props.items.length,3);
});

test('同小项目复制为新版保留分组；编辑移动只交换当前类别的槽位',async()=>{
  const app=harness();let tree=app.render();button(tree,'复制为新版').props.onClick();tree=app.render();find(dialog(tree,'qwEditorTitle'),node=>node.type==='form','Editor form').props.onSubmit({preventDefault(){}});await settle();assert.equal(app.mutations[0].args.subproject_id,groupID);assert.equal(app.mutations[0].args.title,'小项目甲');assert.equal(app.mutations[0].args.subproject_name,'小项目甲');assert.deepEqual(app.mutations[0].args.items,lines);
  const reordered=[{...quotes[0],items:[lines[0],lines[1],{...lines[0],name:'安装费'}]}];
  const edit=harness();tree=edit.render({items:reordered});button(tree,'编辑草稿').props.onClick();tree=edit.render({items:reordered});const table=find(tree,node=>node.props.onRowsReorder&&node.props.className?.includes('qwEditorTable'),'Editable managed table'),rows=elements(table).filter(node=>node.type==='tr'&&node.props['data-row-id']);table.props.onRowsReorder(rows.map(row=>row.props['data-row-id']).reverse());tree=edit.render({items:reordered});find(dialog(tree,'qwEditorTitle'),node=>node.type==='form','Editor form').props.onSubmit({preventDefault(){}});await settle();assert.deepEqual(edit.mutations[0].args.items.map(row=>row.name),['安装费','测试板材','加工费']);
});

test('五金导入使用配置销售价，未匹配按0元加入可导入后补填，只追加本地草稿',async()=>{
 const app=harness();let tree=await openImport(app);const panel=dialog(tree,'qwImportTitle');assert.equal(elements(panel).some(node=>node.type==='select'),false);assert.equal(input(tree,'导入第4行销售单价').props.value,15);assert.equal(input(tree,'导入第5行销售单价').props.value,0);assert.equal(button(tree,'加入五金明细（2 条）').props.disabled,false);
 button(tree,'加入五金明细（2 条）').props.onClick();tree=app.render();assert.equal(input(tree,'五金费用第1行名称').props.value,'测试五金甲');assert.equal(input(tree,'五金费用第1行销售单价').props.value,15);assert.equal(input(tree,'五金费用第2行名称').props.value,'测试五金乙');assert.equal(input(tree,'五金费用第2行销售单价').props.value,0);assert.equal(app.mutations.length,0);
});

test('取消导入和取消编辑都不保存业务，Excel下载仅传已保存的完整报价',async()=>{
  const app=harness();let tree=await openImport(app);button(tree,'取消导入').props.onClick();tree=app.render();assert.equal(elements(tree).some(node=>node.props['aria-labelledby']==='qwImportTitle'),false);assert.equal(elements(tree).some(node=>node.props['aria-labelledby']==='qwEditorTitle'),true);button(tree,'取消').props.onClick();tree=app.render();button(tree,'下载 Excel').props.onClick();await settle();assert.equal(app.mutations.length,0);assert.equal(app.downloads.length,1);assert.equal(app.downloads[0].quote.id,'quote-adopted');assert.equal(app.downloads[0].quote.items.length,3);assert.equal(app.downloads[0].project.name,project.name);assert.equal(app.downloads[0].companyName,'离线测试公司');
});

test('小项目勾选选中全部版本，删除只请求所选版本并保留恢复提示',async()=>{
  const app=harness();let tree=app.render();checkbox(tree,'选择项目全部版本 小项目甲').props.onChange();tree=app.render();button(tree,'删除所选版本').props.onClick();await settle();assert.deepEqual(app.requests.map(row=>row.args.id).sort(),['quote-adopted','quote-new']);assert.match(app.confirmations[0],/2 个报价版本.*可恢复/);assert.equal(app.mutations.length,0);
});

test('报价CSV导出阻止名称和备注被Excel当公式执行',async()=>{
  const unsafe={...quotes[0],adopted:true,items:[{...lines[2],name:'=HYPERLINK("unsafe")',note:' @SUM(1,2)'}]};const app=harness();const tree=app.render({items:[unsafe]});button(tree,'下载 CSV').props.onClick();assert.equal(app.blobs.length,1);const csv=await app.blobs[0].text();assert.match(csv,/"'=HYPERLINK/);assert.match(csv,/"' @SUM/);assert.equal(app.mutations.length,0);
});


test('选择人工配置按本合作项目全部采购单尺寸厚度汇总，允许手动覆盖且取消不保存',async()=>{
  const material={id:'labor',name:'加工费（48尺）',model:'18mm',unit:'张',expense_category:'人工费用',attribute:'人工',sale_price:3500,purchase_price:99999};
  const row=(name,model,quantity)=>({name,model,quantity,attribute:'主材',unit:'张'});
  const app=harness({catalog:{materials:[material],purchase_orders:[{project_id:project.id,items:[row('品牌甲18mm','48尺',2),row('品牌乙18mm','48尺',3),row('品牌乙5mm','48尺',40)]},{project_id:project.id,items:[row('花色丙18mm','4×8尺',4)]},{project_id:'other',items:[row('其他项目18mm','48尺',100)]}]}});
  openNew(app);await settle();let tree=app.render();input(tree,'人工费用第1行名称').props.onFocus();tree=app.render();find(tree,node=>node.props.role==='option'&&text(node)==='加工费（48尺） / 18mm','Labor option').props.onClick();tree=app.render();
  assert.equal(input(tree,'人工费用第1行名称').props.value,material.name);assert.equal(input(tree,'人工费用第1行规格型号').props.value,'18mm');assert.equal(input(tree,'人工费用第1行数量').props.value,9);assert.equal(input(tree,'人工费用第1行销售单价').props.value,35);
  input(tree,'人工费用第1行数量').props.onChange({target:{value:'11'}});tree=app.render();assert.equal(input(tree,'人工费用第1行数量').props.value,11);button(tree,'取消').props.onClick();assert.equal(app.mutations.length,0);
});


test('报价下拉选择独立项目后按其ID和名称保存，不写合作方的报价',async()=>{
 const app=harness();app.props.projectOptions=[{id:'child-a',name:'独立项目甲'},{id:'child-b',name:'独立项目乙'}];let tree=openNew(app);const choice=find(tree,node=>node.type==='select'&&node.props['aria-label']==='关联项目名称','Project choice');assert.equal(choice.props.value,'');choice.props.onChange({target:{value:'child-b'}});tree=app.render();input(tree,'人工费用第1行名称').props.onChange({target:{value:'手工安装'}});tree=app.render();input(tree,'人工费用第1行数量').props.onChange({target:{value:'1'}});tree=app.render();await find(dialog(tree,'qwEditorTitle'),node=>node.type==='form','Form').props.onSubmit({preventDefault(){}});await settle();assert.equal(app.mutations[0].args.project_id,'child-b');assert.equal(app.mutations[0].args.subproject_name,'独立项目乙');assert.equal(app.mutations[0].args.title,'独立项目乙');
});

test('普通合作项目数量完成自动续行，重复blur不重复，保存仅提交已填写行',async()=>{
 const app=harness();let tree=openNew(app);field(tree,'如：吾悦南区东苑6-3-502').props.onChange({target:{value:'自动续行项目'}});tree=app.render();input(tree,'人工费用第1行名称').props.onChange({target:{value:'手工安装'}});input(tree,'人工费用第1行数量').props.onChange({target:{value:'2'}});tree=app.render();input(tree,'人工费用第1行数量').props.onBlur();tree=app.render();assert.equal(input(tree,'人工费用第2行名称').props.value,'');input(tree,'人工费用第1行数量').props.onBlur();tree=app.render();assert.equal(elements(dialog(tree,'qwEditorTitle')).filter(node=>node.type==='input'&&node.props['aria-label']?.endsWith('行数量')).length,2);find(dialog(tree,'qwEditorTitle'),node=>node.type==='form','Form').props.onSubmit({preventDefault(){}});await settle();assert.equal(app.mutations[0].args.items.length,1);assert.equal(app.mutations[0].args.items[0].name,'手工安装');assert.equal(app.mutations[0].args.items[0].quantity,2);assert.equal('auto' in app.mutations[0].args.items[0],false);
});

const scannedRow=(patch={})=>({id:'offline-scan',selected:true,category:'材料费用',name:'识别板材',model:'18mm',brand:'原品牌',code:'板-001',unit:'张',quantity:'2.5',price:'￥1,200.00元',sourceAmount:'3000',note:'识别备注',batch:'原批次',source:'离线文件第1行',attribute:'主材',...patch});
const documentImport=tree=>find(tree,node=>node.props.mode==='quote'&&typeof node.props.onApply==='function','Document import');

test('项目报价编辑复用客户全屏布局，上传入口紧邻分类，默认空行可替换且只改草稿',()=>{
 const app=harness();let tree=openNew(app),editor=dialog(tree,'qwEditorTitle');assert.match(editor.props.className,/qwCustomerDialog.*qwProjectDialog/);assert.ok(elements(tree).some(node=>node.props.className==='qwOverlay qwCustomerEditorOverlay'));
 const bar=find(editor,node=>node.props.className==='qwCategoryImportBar','Category import bar');assert.ok(elements(bar).some(node=>node.props.role==='tablist'));const upload=documentImport(bar);assert.equal(upload.props.maxItems,500);assert.equal(upload.props.currentItemCount,0);upload.props.onBusyChange(true);tree=app.render();assert.equal(documentImport(tree).props.disabled,false);assert.equal(find(tree,node=>node.props['aria-label']==='关闭报价编辑','Close editor').props.disabled,true);assert.equal(button(tree,'保存报价草稿').props.disabled,true);
 documentImport(tree).props.onApply([scannedRow({note:'备'.repeat(510)}),scannedRow({id:'second',category:'五金费用',name:'铰链',quantity:'1',price:'0'})]);documentImport(tree).props.onBusyChange(false);tree=app.render();assert.equal(tab(tree,'材料费用',true).props['aria-selected'],true);assert.equal(input(tree,'材料费用第1行数量').props.value,2.5);assert.equal(input(tree,'材料费用第1行销售单价').props.value,1200);assert.equal(input(tree,'材料费用第1行备注').props.value.length,500);assert.match(text(editor=dialog(tree,'qwEditorTitle')),/分布在材料费用、五金费用/);assert.equal(elements(editor).some(node=>node.props.className==='qwEditorSidebar'),false);assert.equal(app.mutations.length,0);
 const css=readFileSync(resolve(root,'app/quote-workspace.css'),'utf8');assert.match(css,/qwCustomerEditorOverlay>\.qwCustomerDialog\{[^}]*height:100dvh[^}]*max-width:none/);assert.match(css,/qwProjectEditorMain>\.qwTableWrap\{[^}]*flex:1[^}]*overflow:auto/);assert.match(css,/qwCustomerDialog \.qwDialogFoot\{[^}]*flex-shrink:0/);
});

test('客户上传绑定识别开始时选中的房间，保留原房间和旧行，保留零价与规范数字',async()=>{
 const app=harness();app.props.customerMode=true;app.props.items=[{...quotes[0],note:'历史整户报价备注继续保留',rooms:[{id:'room-a',name:'客厅'},{id:'room-b',name:'卧室'}],items:[{...lines[0],room_id:'room-a'},{...lines[1],room_id:'room-b'}]}];let tree=app.render();button(tree,'编辑草稿').props.onClick();tree=app.render();find(dialog(tree,'qwEditorTitle'),node=>node.props.editable&&node.props.rooms,'Editable rooms').props.onSelect('room-b');tree=app.render();let upload=documentImport(tree);upload.props.onBusyChange(true);tree=app.render();upload=documentImport(tree);upload.props.onApply([scannedRow({quantity:'1,234',price:'0'}),scannedRow({id:'labor-row',category:'人工费用',name:'安装',price:'￥12.50'})]);upload.props.onBusyChange(false);tree=app.render();assert.equal(tab(tree,'人工费用',true).props['aria-selected'],true);assert.equal(app.mutations.length,0);assert.match(text(dialog(tree,'qwEditorTitle')),/已复制 2 条到“卧室”/);
 const editor=dialog(tree,'qwEditorTitle'),header=find(editor,node=>node.props.className==='qwDialogHead qwCustomerEditorHead','Compact customer header'),form=find(editor,node=>node.type==='form','Form');assert.ok(input(header,'报价版本名称').props.required);assert.ok(button(header,'查看利润'));assert.ok(elements(form).includes(input(header,'报价版本名称')),'Version name remains inside its saving form');assert.equal(elements(editor).some(node=>node.props.className==='qwNoteLabel'),false);assert.ok(input(editor,'人工费用第1行备注'));
 form.props.onSubmit({preventDefault(){}});await settle();const {args}=app.mutations[0];assert.equal(args.project_id,project.id);assert.deepEqual(args.rooms,app.props.items[0].rooms);assert.equal(args.items.length,4);assert.deepEqual(args.items.slice(0,2),app.props.items[0].items);assert.ok(args.items.slice(2).every(item=>item.room_id==='room-b'));assert.equal(args.items[2].quantity,1234);assert.equal(args.items[2].price,0);assert.equal(args.items[3].price,12.5);assert.equal(args.note,app.props.items[0].note||'');assert.ok(args.items.every(item=>!('key' in item)&&!('source' in item)));
});

test('部分填写的默认行不替换，未知柜体保留名称并提示，原有保存规则继续有效',async()=>{
 const app=harness();let tree=openNew(app);field(tree,'如：吾悦南区东苑6-3-502').props.onChange({target:{value:'识别项目'}});input(tree,'人工费用第1行备注').props.onChange({target:{value:'用户已填备注'}});tree=app.render();let upload=documentImport(tree);assert.equal(upload.props.currentItemCount,1);upload.props.onBusyChange(true);tree=app.render();upload=documentImport(tree);upload.props.onApply([scannedRow({category:'柜体',name:'原表异形柜',unit:'㎡',price:'50'})]);upload.props.onBusyChange(false);tree=app.render();assert.match(text(dialog(tree,'qwEditorTitle')),/柜体名称未匹配配置，已保留原名称/);const picker=find(tree,node=>node.props.label==='柜体第1行名称','Cabinet picker');assert.equal(picker.props.value,'原表异形柜');tab(tree,'人工费用',true).props.onClick();tree=app.render();assert.equal(input(tree,'人工费用第1行备注').props.value,'用户已填备注');input(tree,'人工费用第1行名称').props.onChange({target:{value:'用户安装'}});tree=app.render();input(tree,'人工费用第1行数量').props.onChange({target:{value:'1'}});tree=app.render();find(dialog(tree,'qwEditorTitle'),node=>node.type==='form','Form').props.onSubmit({preventDefault(){}});await settle();assert.equal(app.mutations[0].args.items[1].name,'原表异形柜');
});

test('报价满500行拒绝追加；识别期间无法保存，取消或切换项目后晚到回调不写入',async()=>{
 const app=harness();app.props.items=[{...quotes[0],items:Array.from({length:500},(_,index)=>({...lines[1],name:'材料'+index}))}];let tree=app.render();button(tree,'编辑草稿').props.onClick();tree=app.render();let upload=documentImport(tree);assert.equal(upload.props.currentItemCount,500);upload.props.onBusyChange(true);tree=app.render();upload=documentImport(tree);await find(dialog(tree,'qwEditorTitle'),node=>node.type==='form','Form').props.onSubmit({preventDefault(){}});assert.equal(app.mutations.length,0);upload.props.onApply([scannedRow()]);tree=app.render();assert.match(text(dialog(tree,'qwEditorTitle')),/超过每份报价 500 条/);assert.equal(documentImport(tree).props.currentItemCount,500);upload.props.onBusyChange(false);upload.props.onApply([scannedRow()]);tree=app.render();assert.equal(documentImport(tree).props.currentItemCount,500);app.props.projectId='other-offline';app.render();upload.props.onApply([scannedRow()]);tree=app.render();assert.equal(elements(tree).some(node=>node.props['aria-labelledby']==='qwEditorTitle'),false);assert.equal(app.mutations.length,0);
});

test('四栏客户明细复制保留缺价和房间旧行，正式保存要求补价且显式零价合法',async()=>{
 const matching={id:'same-name',name:'四栏原表板材',model:'18mm',unit:'张',sale_price:99900,expense_category:'材料费用'},app=harness({catalog:{materials:[matching],purchase_orders:[]}});
 app.props.customerMode=true;app.props.items=[{...quotes[0],rooms:[{id:'room-a',name:'客厅'},{id:'room-b',name:'卧室'}],items:[{...lines[0],room_id:'room-a'},{...lines[1],room_id:'room-b'}]}];const source=JSON.stringify(app.props.items);
 let tree=app.render();button(tree,'编辑草稿').props.onClick();await settle();tree=app.render();find(dialog(tree,'qwEditorTitle'),node=>node.props.editable&&node.props.rooms,'Editable rooms').props.onSelect('room-b');tree=app.render();let upload=documentImport(tree);upload.props.onBusyChange(true);tree=app.render();upload=documentImport(tree);upload.props.onApply([scannedRow({name:'四栏原表板材',model:'18mm',quantity:'1.005',unit:'张',price:'  ',sourceAmount:'',note:''})]);upload.props.onBusyChange(false);tree=app.render();
 assert.equal(input(tree,'材料费用第1行名称').props.value,'测试板材');assert.equal(input(tree,'材料费用第2行名称').props.value,'四栏原表板材');assert.equal(input(tree,'材料费用第2行规格型号').props.value,'18mm');assert.equal(input(tree,'材料费用第2行数量').props.value,1.005);assert.equal(input(tree,'材料费用第2行单位').props.value,'张');assert.equal(input(tree,'材料费用第2行销售单价').props.value,'');assert.equal(app.mutations.length,0);assert.equal(JSON.stringify(app.props.items),source);
 await find(dialog(tree,'qwEditorTitle'),node=>node.type==='form','Form').props.onSubmit({preventDefault(){}});tree=app.render();assert.equal(app.mutations.length,0);assert.match(text(dialog(tree,'qwEditorTitle')),/核对各类明细/);assert.equal(input(tree,'材料费用第2行销售单价').props.value,'');input(tree,'材料费用第2行销售单价').props.onChange({target:{value:'0'}});tree=app.render();await find(dialog(tree,'qwEditorTitle'),node=>node.type==='form','Form').props.onSubmit({preventDefault(){}});await settle();
 assert.equal(app.mutations.length,1);const {action,args}=app.mutations[0];assert.equal(action,'update_quote');assert.equal(args.id,quotes[0].id);assert.deepEqual(args.rooms,app.props.items[0].rooms);assert.deepEqual(args.items.slice(0,2),app.props.items[0].items);assert.deepEqual([args.items[2].name,args.items[2].model,args.items[2].quantity,args.items[2].unit,args.items[2].price,args.items[2].room_id],['四栏原表板材','18mm',1.005,'张',0,'room-b']);assert.equal(JSON.stringify(app.props.items),source);assert.equal(matching.sale_price,99900);
});

test('复制允许空单价但已填非法单价和缺名称单位数量仍拒绝，原报价不变',()=>{
 for(const patch of [{price:'识别错误'},{price:'-1'},{price:'',quantity:''},{price:'',name:''},{price:'',unit:''}]){
  const app=harness();app.props.items=[quotes[0]];let tree=app.render();button(tree,'编辑草稿').props.onClick();tree=app.render();let upload=documentImport(tree);upload.props.onBusyChange(true);tree=app.render();upload=documentImport(tree);upload.props.onApply([scannedRow(patch)]);upload.props.onBusyChange(false);tree=app.render();assert.equal(documentImport(tree).props.currentItemCount,3);assert.match(text(dialog(tree,'qwEditorTitle')),/核对名称、单位、数量和已填写的单价/);assert.equal(app.mutations.length,0);
 }
});

test('明显上传识别报价入口始终新建草稿，已有未采纳和已采纳版本均不隐式修改',async()=>{
 for(const records of [[],[quotes[0]],[quotes[1]]]){
  const app=harness();app.props.items=records;const before=JSON.stringify(records);let tree=app.render();button(tree,'上传识别报价').props.onClick();tree=app.render();assert.ok(documentImport(tree).props.requestOpen>0);assert.equal(documentImport(tree).props.currentItemCount,0);assert.match(text(dialog(tree,'qwEditorTitle')),/请选择图片或文件识别，核对后复制到当前草稿/);assert.equal(app.mutations.length,0);
  field(tree,'如：吾悦南区东苑6-3-502').props.onChange({target:{value:'上传新建项目'}});tree=app.render();let upload=documentImport(tree);upload.props.onBusyChange(true);tree=app.render();upload=documentImport(tree);upload.props.onApply([scannedRow({price:'0'})]);upload.props.onBusyChange(false);tree=app.render();await find(dialog(tree,'qwEditorTitle'),node=>node.type==='form','Form').props.onSubmit({preventDefault(){}});await settle();assert.equal(app.mutations.length,1);assert.equal(app.mutations[0].action,'create_quote');assert.ok(!('id' in app.mutations[0].args));assert.notEqual(app.mutations[0].args.subproject_id,groupID);assert.equal(JSON.stringify(records),before);
 }
 const customer=harness();customer.props.customerMode=true;let tree=customer.render();button(tree,'上传识别报价').props.onClick();tree=customer.render();assert.equal(documentImport(tree).props.disabled,true);assert.ok(documentImport(tree).props.requestOpen>0);assert.match(text(dialog(tree,'qwEditorTitle')),/请先添加项目/);assert.equal(find(dialog(tree,'qwEditorTitle'),node=>node.props.editable&&node.props.rooms,'New customer rooms').props.rooms.length,0);assert.equal(customer.mutations.length,0);
});

test('取消上传新草稿后普通编辑不会继承自动文件选择请求',()=>{
 const app=harness();app.props.items=[quotes[0]];let tree=app.render();button(tree,'上传识别报价').props.onClick();tree=app.render();assert.ok(documentImport(tree).props.requestOpen>0);button(tree,'取消').props.onClick();tree=app.render();button(tree,'编辑草稿').props.onClick();tree=app.render();assert.equal(documentImport(tree).props.requestOpen,0);assert.equal(documentImport(tree).props.currentItemCount,3);assert.equal(app.mutations.length,0);
});
