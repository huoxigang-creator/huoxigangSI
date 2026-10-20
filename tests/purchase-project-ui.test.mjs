import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {setImmediate as nextTurn} from 'node:timers/promises';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url), root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parentID = 'offline-parent';
const groupID = '45e94923-ef20-4092-b3c6-5c65bb3509ed';
const quotes = [
  {id: 'new-version', project: parentID, subproject_id: groupID, subproject_name: '小项目甲', title: '甲新版', created: '2026-10-12T02:00:00Z'},
  {id: 'adopted-version', project: parentID, subproject_id: groupID, subproject_name: '小项目甲', title: '甲初版', adopted: true, created: '2026-10-12T01:00:00Z'},
  {id: 'legacy-version', project: parentID, title: '历史小项目', created: '2026-10-11T02:00:00Z'},
  {id: 'deleted-version', project: parentID, subproject_id: 'deleted-group', subproject_name: '已删除的小项目', deleted: true},
  {id: 'other-parent', project: 'another-parent', subproject_id: 'other-group', subproject_name: '其他合作项目的小项目'},
];
const item = {material_id: '', name: '匿名板材', brand: '', model: '', code: '', attribute: '主材', unit: '张', quantity: 1.125, price: 255, amount: 287, batch: ''};
const oldOrder = {id: 'legacy-order', kind: 'purchase_order', project: parentID, project_id: parentID, number: '历史编号CG001', supplier: '', date: '2026-10-12', note: '保留备注', revision: 'offline-revision', created: '2026-10-12T01:00:00Z', items: [item], total: 287};

// Execute the real component and hooks with an isolated catalog, without DOM or live data.
function harness({orders = [], materials=[],request = async () => ({}), bodyOverflow = ''} = {}) {
  const slots = [], cache = new Map(), effects = [], requests = [], changed = [];
  let cursor = 0, serial = 0, workspaceActive = true, hasEditor = false;
  const listeners = new Map(), extraDialogs = [];
  const panelElement = {closest: () => workspaceActive ? null : {hidden:true}};
  const document = {body:{style:{overflow:bodyOverflow}},querySelectorAll: () => [...(hasEditor ? [panelElement] : []), ...extraDialogs]};
  const window = {confirm: () => true,
    addEventListener(name, listener) {if (!listeners.has(name)) listeners.set(name,new Set()); listeners.get(name).add(listener);},
    removeEventListener(name, listener) {listeners.get(name)?.delete(listener);},
  };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {...React,
    useContext(context) {return typeof context._currentValue === 'boolean' ? workspaceActive && context._currentValue : context._currentValue;},
    useState(initial) {const i = cursor++; if (!slots[i]) slots[i] = {value: typeof initial === 'function' ? initial() : initial}; return [slots[i].value, value => {slots[i].value = typeof value === 'function' ? value(slots[i].value) : value;}];},
    useRef(initial) {const i = cursor++; if (!slots[i]) slots[i] = {value: {current: initial}}; return slots[i].value;},
    useMemo(create, deps) {const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = {value: create(), deps}; return slots[i].value;},
    useCallback(callback, deps) {return hooks.useMemo(() => callback, deps);},
    useEffect(effect, deps) {const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) {const entry={deps,cleanup:slots[i]?.cleanup};slots[i]=entry;effects.push(()=>{entry.cleanup?.();entry.cleanup=effect();});}},
  };
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const module = {exports: {}}; cache.set(path, module);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
    function localRequire(name) {
      if (name === 'react') return hooks;
      if (name === 'lucide-react') return new Proxy({}, {get: (_target, key) => function Icon() {return String(key);}});
      if (name.endsWith('.css')) return {};
      if (name === './document-import') return {default:function DocumentImport(){}};
      if (name.startsWith('.')) {const base = resolve(dirname(path), name), target = [base, base + '.ts', base + '.tsx'].find(existsSync); assert.ok(target, 'Module exists: ' + name); return load(target);}
      return require(name);
    }
    const fetch = async (_url, options) => {
      const input = JSON.parse(options.body); requests.push(input);
      if (input.action === 'get_catalog') return {ok: true, json: async () => ({ok: true, result: {company: {name: '离线公司'}, materials, purchase_orders: orders}})};
      const result = await request(input);
      return {ok: result.ok !== false, json: async () => result.ok === false ? {ok: false, error: result.error || '离线失败'} : {ok: true, result}};
    };
    const evaluate = runInNewContext('(function(exports,require,module){' + code + '\n})', {console, Intl, Date, Set, Map, Error, Number, String, BigInt, fetch, document, crypto: {randomUUID: () => `00000000-0000-4000-a000-${String(++serial).padStart(12, '0')}`}, window});
    evaluate(module.exports, localRequire, module); return module.exports;
  }
  const PurchaseOrders = load(resolve(root, 'app/purchase-orders.tsx')).default;
  const props = {projectId: parentID, projectName: '离线合作项目', companyName: '离线公司', quotes, onChanged: async () => {changed.push(true);}};
  function render(overrides = {}) {cursor = 0; effects.length = 0; const tree = PurchaseOrders({...props, ...overrides});const panel=elements(tree).find(node=>node.props.role==='dialog');hasEditor=Boolean(panel);if(panel?.props.ref)panel.props.ref.current=panelElement;for (const effect of effects.splice(0)) effect(); return tree;}
  function escape() {let stopped=false;const event={key:'Escape',stopImmediatePropagation(){stopped=true;},preventDefault(){}};for(const listener of listeners.get('keydown')||[]){listener(event);if(stopped)break;}return stopped;}
  return {render, props, requests, changed, document, escape, listenerCount:()=>listeners.get('keydown')?.size||0, setActive:value=>{workspaceActive=value;}, setOverlayOpen:value=>{extraDialogs.splice(0,extraDialogs.length,...(value?[{closest:()=>null}]:[]));}};
}
function elements(node) {if (Array.isArray(node)) return node.flatMap(elements); if (!node || typeof node !== 'object' || !node.props) return []; return [node, ...elements(node.props.children)];}
function text(node) {if (Array.isArray(node)) return node.map(text).join(''); if (node === null || node === undefined || typeof node === 'boolean') return ''; return typeof node === 'object' ? text(node.props?.children) : String(node);}
function find(tree, predicate, label) {const node = elements(tree).find(predicate); assert.ok(node, label); return node;}
function button(tree, name) {return find(tree, node => node.type === 'button' && text(node) === name, 'Button: ' + name);}
function field(tree, label) {return find(tree, node => ['input', 'select', 'textarea'].includes(node.type) && node.props['aria-label'] === label, 'Field: ' + label);}
async function settle() {await nextTurn(); await nextTurn();}
async function start(app, overrides = {}) {app.render(overrides); await settle(); return app.render(overrides);}
function openNew(app, overrides = {}) {button(app.render(overrides), '新增采购单').props.onClick(); return app.render(overrides);}
async function save(app, overrides = {}) {const tree = app.render(overrides); await find(tree, node => node.type === 'form', 'Purchase form').props.onSubmit({preventDefault() {}}); await settle(); return app.render(overrides);}
function writes(app) {return app.requests.filter(input => input.action !== 'get_catalog');}

test('项目名称按当前合作项目的报价小项目去重，采纳版本优先且不猜选默认项目', async () => {
  const app = harness({orders: [oldOrder]}); let tree = await start(app); assert.match(text(tree), /未关联报价小项目/); assert.equal(elements(tree).filter(node => node.type === 'th' && text(node) === '项目名称').length, 1); assert.equal(elements(tree).some(node => node.type === 'th' && text(node) === '采购单号'), false);
  tree = openNew(app); const choice = field(tree, '采购项目名称'); assert.equal(choice.props.value, ''); assert.equal(choice.props.required, true); const options = elements(choice).filter(node => node.type === 'option'); assert.deepEqual(options.map(node => [node.props.value, text(node)]), [['', '请选择报价里的小项目'], ['adopted-version', '小项目甲'], ['legacy-version', '历史小项目']]); assert.equal(elements(tree).some(node => node.props['aria-label'] === '采购单号'), false); assert.match(text(tree), /采购数量供所选小项目后续计算人工费用/); assert.equal(writes(app).length, 0);
});

test('新单保存报价关联和原始小数数量单位，失败重试保留同一隐藏编号与请求ID', async () => {
  let attempts = 0; const app = harness({request: async () => ++attempts === 1 ? {ok: false, error: '测试保存失败'} : {}}); await start(app); let tree = openNew(app); field(tree, '采购项目名称').props.onChange({target: {value: 'adopted-version'}}); field(tree, '材料名称1').props.onChange({target: {value: '测试板材'}}); field(tree, '材料单位1').props.onChange({target: {value: '张'}}); field(tree, '采购数量1').props.onChange({target: {value: '1.125'}}); field(tree, '采购单价1').props.onChange({target: {value: '2.55'}});
  tree = await save(app); assert.match(text(tree), /测试保存失败/); await save(app); const submitted = writes(app); assert.equal(submitted.length, 2); assert.deepEqual(submitted[0], submitted[1]); const args = submitted[0].args; assert.equal(submitted[0].action, 'create_purchase_order'); assert.equal(args.source_quote_id, 'adopted-version'); assert.equal(args.project_id, parentID); assert.match(args.number, /^CG-\d{8}-[\da-f-]{36}$/); assert.ok(args.number.endsWith(args.id)); assert.equal(args.items[0].quantity, 1.125); assert.equal(args.items[0].unit, '张'); assert.equal(args.items[0].price, 2.55); assert.ok(!('rowId' in args.items[0])); assert.ok(!('subproject_name' in args)); assert.equal(app.changed.length, 1);
});

test('同小项目可新增多个采购单，隐藏编号独立，关联不改变采购数量', async () => {
  const app = harness(); await start(app); for (let index = 0; index < 2; index++) {let tree = openNew(app); field(tree, '采购项目名称').props.onChange({target: {value: 'adopted-version'}}); field(tree, '材料名称1').props.onChange({target: {value: '测试板材'}}); await save(app);}
  const submitted = writes(app); assert.equal(submitted.length, 2); assert.notEqual(submitted[0].args.id, submitted[1].args.id); assert.notEqual(submitted[0].args.number, submitted[1].args.number); assert.equal(submitted[0].args.source_quote_id, submitted[1].args.source_quote_id); assert.equal(submitted[0].args.items[0].quantity, 1);
});

test('历史无关联单不借用旧编号猜项目，可原样编辑，也可用户明确补关联', async () => {
  const app = harness({orders: [oldOrder]}); let tree = await start(app); find(tree, node => node.type === 'button' && node.props.className === 'link' && text(node) === '编辑', 'Row edit').props.onClick(); tree = app.render(); assert.equal(field(tree, '采购项目名称').props.value, ''); assert.equal(field(tree, '采购项目名称').props.required, false); assert.match(text(tree), /尚未关联报价小项目/); await save(app); assert.equal(writes(app)[0].args.number, oldOrder.number); assert.ok(!('source_quote_id' in writes(app)[0].args)); assert.equal(writes(app)[0].args.items[0].quantity, item.quantity); assert.equal(writes(app)[0].args.items[0].unit, item.unit);
  tree = app.render(); find(tree, node => node.type === 'button' && node.props.className === 'link' && text(node) === '编辑', 'Row edit').props.onClick(); tree = app.render(); field(tree, '采购项目名称').props.onChange({target: {value: 'legacy-version'}}); await save(app); assert.equal(writes(app)[1].args.source_quote_id, 'legacy-version'); assert.equal(writes(app)[1].args.number, oldOrder.number); assert.equal(writes(app)[1].args.items[0].quantity, item.quantity);
});

test('已保存关联的报价来源不在活动列表时仍显示名称快照，编辑不改原关联', async () => {
  const linked = {...oldOrder, source_quote_id: 'removed-source', subproject_id: groupID, subproject_name: '原小项目名称'}; const app = harness({orders: [linked]}); let tree = await start(app); assert.match(text(tree), /原小项目名称/); find(tree, node => node.type === 'button' && node.props.className === 'link' && text(node) === '编辑', 'Row edit').props.onClick(); tree = app.render(); const choice = field(tree, '采购项目名称'); assert.equal(choice.props.value, 'removed-source'); assert.equal(choice.props.required, true); assert.equal(find(choice, node => node.type === 'option' && node.props.value === 'removed-source', 'Saved association').props.children.join(''), '原小项目名称（保留原关联）'); await save(app); const args = writes(app)[0].args; assert.ok(!('source_quote_id' in args)); assert.equal(args.number, oldOrder.number); assert.equal(args.items[0].quantity, item.quantity);
});

test('暂无报价小项目阻止新单保存，必选以及失效选择均不发出写请求', async () => {
  const app = harness(); let tree = await start(app, {quotes: []}); tree = openNew(app, {quotes: []}); assert.match(text(tree), /请先进入本项目的报价页面新建小项目/); assert.equal(button(tree, '保存采购单').props.disabled, true); await save(app, {quotes: []}); assert.equal(writes(app).length, 0);
  const another = harness(); await start(another); tree = openNew(another); field(tree, '材料名称1').props.onChange({target: {value: '测试板材'}}); tree = await save(another); assert.match(text(tree), /请选择报价里的小项目名称/); assert.equal(writes(another).length, 0); field(tree, '采购项目名称').props.onChange({target: {value: 'adopted-version'}}); tree = await save(another, {quotes: []}); assert.match(text(tree), /所选报价小项目已不可用/); assert.equal(writes(another).length, 0);
});


test('采购下拉直接选择独立项目，没有报价也可按其项目ID保存',async()=>{
 const app=harness();app.props.projectOptions=[{id:'child-a',name:'独立甲'},{id:'child-b',name:'独立乙'}];app.props.quotes=[];await start(app);let tree=openNew(app);assert.equal(field(tree,'采购独立项目名称').props.value,'');field(tree,'采购独立项目名称').props.onChange({target:{value:'child-b'}});tree=app.render();field(tree,'材料名称1').props.onChange({target:{value:'板材'}});tree=await save(app);assert.equal(writes(app).length,1);assert.equal(writes(app)[0].args.project_id,'child-b');assert.equal('source_quote_id' in writes(app)[0].args,false);
});

test('父项目采购单列表同时显示独立项目的已保存采购单',async()=>{
 const childOrder={...oldOrder,id:'child-order',project_id:'child-a',number:'CG-独立甲001',subproject_name:'',items:[{...item}]};
 const app=harness({orders:[childOrder]});app.props.projectOptions=[{id:'child-a',name:'独立甲'},{id:'child-b',name:'独立乙'}];const tree=await start(app);
 assert.match(text(tree),/独立甲/);assert.match(text(tree),/1 项材料/);assert.equal(writes(app).length,0);
 const alone=harness({orders:[childOrder]});const lone=await start(alone);assert.ok(!text(lone).includes('独立甲'),'无独立项目选项时不显示他项目采购单');
});


test('材料五金清单分开筛选，切换保留已填明细；数量完成仅追加一空行且保存忽略空行',async()=>{
 const material=(id,name,expense_category)=>({...item,id,name,expense_category,purchase_price:500,attribute:'辅材'});
 const app=harness({materials:[material('board','板材','材料费用'),material('hinge','铰链','五金费用'),material('labor','加工','人工费用')]});await start(app);let tree=openNew(app);field(tree,'采购项目名称').props.onChange({target:{value:'adopted-version'}});tree=app.render();assert.equal(elements(tree).some(n=>n.type==='h3'&&text(n)==='采购明细'),false);
 assert.equal(elements(tree).some(n=>n.type==='th'&&text(n)==='材料库选择'),false);
 const openPicker=()=>{field(tree,'材料名称1').props.onFocus({currentTarget:{}});tree=app.render();};
 const pickerNames=()=>{const panel=find(tree,n=>n.props['aria-label']==='材料库下拉选择','Material picker panel');return elements(panel).filter(n=>n.type==='b').map(text);};
 openPicker();assert.deepEqual(pickerNames(),['板材']);find(tree,n=>n.type==='button'&&text(n).startsWith('板材'),'Picker option 板材').props.onClick();tree=app.render();assert.equal(field(tree,'材料名称1').props.value,'板材');field(tree,'采购数量1').props.onChange({target:{value:'3'}});tree=app.render();field(tree,'采购数量1').props.onBlur();tree=app.render();assert.equal(field(tree,'采购数量2').props.value,'');assert.equal(field(tree,'采购数量2').props.required,false);field(tree,'采购数量1').props.onBlur();tree=app.render();assert.equal(elements(tree).filter(n=>n.type==='input'&&n.props['aria-label']?.startsWith('采购数量')).length,2);
 find(tree,n=>n.props.role==='tab'&&text(n)==='五金费用','Hardware tab').props.onClick();tree=app.render();openPicker();assert.deepEqual(pickerNames(),['铰链']);find(tree,n=>n.type==='button'&&text(n).startsWith('铰链'),'Picker option 铰链').props.onClick();tree=app.render();field(tree,'采购数量1').props.onChange({target:{value:'5'}});tree=app.render();field(tree,'采购数量1').props.onBlur();tree=app.render();assert.equal(field(tree,'采购数量2').props.value,'');assert.match(text(tree),/¥40\.00/);
 find(tree,n=>n.props.role==='tab'&&text(n)==='材料费用','Material tab').props.onClick();tree=app.render();assert.equal(field(tree,'材料名称1').props.value,'板材');assert.equal(field(tree,'采购数量1').props.value,'3');await save(app);assert.equal(writes(app)[0].args.items.length,2);assert.deepEqual(writes(app)[0].args.items.map(i=>[i.name,i.quantity,i.expense_category]),[['板材',3,'材料费用'],['铰链',5,'五金费用']]);assert.ok(writes(app)[0].args.items.every(i=>!('autoEmpty' in i)));
});

const scannedRow=(patch={})=>({id:'offline-scan',selected:true,category:'材料费用',name:'识别板材',model:'18mm',brand:'原品牌',code:'板-001',unit:'张',quantity:'2.5',price:'￥1,200.00元',sourceAmount:'3000',note:'识别备注',batch:'原批次',source:'离线文件第1行',attribute:'辅材',...patch});
const documentImport=tree=>find(tree,node=>node.props.mode==='purchase'&&typeof node.props.onApply==='function','Document import');

test('采购上传紧邻分类，替换完全空默认行，多分类保留原品牌型号代码批次且不关联材料库',async()=>{
 const matching={id:'matching-material',name:'识别板材',model:'18mm',unit:'张',purchase_price:77700,expense_category:'材料费用'};
 const app=harness({materials:[matching]});await start(app);let tree=openNew(app);field(tree,'采购项目名称').props.onChange({target:{value:'adopted-version'}});tree=app.render();const bar=find(tree,node=>node.props.className==='purchaseCategoryImportBar','Import bar');assert.ok(elements(bar).some(node=>node.props.role==='tablist'));let upload=documentImport(bar);assert.equal(upload.props.maxItems,200);assert.equal(upload.props.currentItemCount,0);upload.props.onBusyChange(true);tree=app.render();assert.equal(documentImport(tree).props.disabled,false);assert.equal(find(tree,node=>node.type==='fieldset','Main fields').props.disabled,true);assert.equal(find(tree,node=>node.props['aria-label']==='关闭采购单表单','Close form').props.disabled,true);assert.equal(button(tree,'保存采购单').props.disabled,true);
 assert.ok(elements(tree).filter(node=>node.type==='fieldset').every(node=>!elements(node).some(child=>child.props.mode==='purchase')),'Upload hidden file input stays outside disabled fieldsets for retry');upload=documentImport(tree);upload.props.onApply([scannedRow(),scannedRow({id:'hardware',category:'五金费用',name:'识别铰链',brand:'品牌乙',model:'110°',code:'HW-002',unit:'只',quantity:'1,234',price:'0',batch:'批次乙'})]);upload.props.onBusyChange(false);tree=app.render();assert.equal(find(tree,node=>node.props.role==='tab'&&text(node)==='材料费用','Material tab').props['aria-selected'],true);assert.equal(field(tree,'材料名称1').props.value,'识别板材');assert.equal(field(tree,'材料品牌1').props.value,'原品牌');assert.equal(field(tree,'采购数量1').props.value,'2.5');assert.equal(field(tree,'采购单价1').props.value,'1200');assert.match(text(tree),/分布在材料费用、五金费用/);assert.equal(writes(app).length,0);
 await save(app);const {args}=writes(app)[0];assert.equal(args.project_id,parentID);assert.equal(args.source_quote_id,'adopted-version');assert.equal(args.items.length,2);assert.equal(args.note,'识别板材：识别备注\n识别铰链：识别备注');assert.deepEqual(args.items.map(row=>[row.material_id,row.brand,row.model,row.code,row.attribute,row.batch,row.quantity,row.price,row.expense_category]),[['','原品牌','18mm','板-001','辅材','原批次',2.5,1200,'材料费用'],['','品牌乙','110°','HW-002','辅材','批次乙',1234,0,'五金费用']]);assert.ok(args.items.every(row=>!('source' in row)&&!('rowId' in row)));assert.equal(matching.purchase_price,77700);assert.ok(writes(app).every(request=>request.action==='create_purchase_order'));
});

test('上传编辑已存采购单保留手填五金分类、材料快照与原关联，新行独立追加且只显式保存采购单',async()=>{
 const linked={...oldOrder,source_quote_id:'adopted-version',subproject_name:'原小项目',items:[{...item,expense_category:'五金费用'}]};const app=harness({orders:[linked]});let tree=await start(app);find(tree,node=>node.type==='button'&&node.props.className==='link'&&text(node)==='编辑','Edit order').props.onClick();tree=app.render();assert.equal(find(tree,node=>node.props.role==='tab'&&text(node)==='五金费用','Initial hardware tab').props['aria-selected'],true);assert.equal(field(tree,'材料名称1').props.value,item.name);let upload=documentImport(tree);assert.equal(upload.props.currentItemCount,1);upload.props.onBusyChange(true);tree=app.render();upload=documentImport(tree);upload.props.onApply([scannedRow({category:'五金费用',name:'原图五金',unit:'只',price:'10',quantity:'3'})]);upload.props.onBusyChange(false);tree=app.render();assert.equal(find(tree,node=>node.props.role==='tab'&&text(node)==='五金费用','Hardware tab').props['aria-selected'],true);assert.equal(field(tree,'材料名称2').props.value,'原图五金');assert.equal(writes(app).length,0);await save(app);const {args}=writes(app)[0];assert.equal(args.id,oldOrder.id);assert.equal(args.revision,oldOrder.revision);assert.equal(args.number,oldOrder.number);assert.equal(args.note,oldOrder.note+'\n原图五金：识别备注');assert.ok(!('source_quote_id' in args));assert.equal(args.items.length,2);const {amount,...snapshot}=linked.items[0];assert.deepEqual(args.items[0],{...snapshot,price:item.price/100});assert.equal(args.items[1].material_id,'');assert.equal(writes(app)[0].action,'update_purchase_order');
});

test('采购部分填写默认行不会被替换；200行上限、识别期间提交与取消晚回调都保护原草稿',async()=>{
 const partial=harness();await start(partial);let tree=openNew(partial);field(tree,'材料品牌1').props.onChange({target:{value:'用户预填品牌'}});tree=partial.render();let upload=documentImport(tree);assert.equal(upload.props.currentItemCount,1);upload.props.onBusyChange(true);tree=partial.render();upload=documentImport(tree);upload.props.onApply([scannedRow()]);upload.props.onBusyChange(false);tree=partial.render();assert.equal(field(tree,'材料品牌1').props.value,'用户预填品牌');assert.equal(field(tree,'材料名称2').props.value,'识别板材');assert.equal(writes(partial).length,0);
 const full={...oldOrder,items:Array.from({length:200},(_,index)=>({...item,name:'旧材料'+index}))};const app=harness({orders:[full]});tree=await start(app);find(tree,node=>node.type==='button'&&node.props.className==='link'&&text(node)==='编辑','Edit order').props.onClick();tree=app.render();upload=documentImport(tree);assert.equal(upload.props.currentItemCount,200);upload.props.onBusyChange(true);tree=app.render();upload=documentImport(tree);await find(tree,node=>node.type==='form','Form').props.onSubmit({preventDefault(){}});assert.equal(writes(app).length,0);upload.props.onApply([scannedRow()]);tree=app.render();assert.match(text(tree),/超过每张采购单 200 条/);assert.equal(documentImport(tree).props.currentItemCount,200);upload.props.onBusyChange(false);upload.props.onApply([scannedRow()]);tree=app.render();assert.equal(documentImport(tree).props.currentItemCount,200);field(tree,'采购数量200').props.onBlur();tree=app.render();assert.equal(documentImport(tree).props.currentItemCount,200);app.props.projectId='other-offline';app.render();upload.props.onApply([scannedRow()]);tree=app.render();assert.equal(elements(tree).some(node=>node.props['aria-labelledby']==='purchase-order-title'),false);assert.equal(writes(app).length,0);
});

test('识别行备注按名称追加采购备注，保留原文字，只加入已选非空备注',async()=>{
 const app=harness();await start(app);let tree=openNew(app);field(tree,'采购备注').props.onChange({target:{value:'现有采购备注\n保留第二行'}});tree=app.render();let upload=documentImport(tree);upload.props.onBusyChange(true);tree=app.render();upload=documentImport(tree);upload.props.onApply([scannedRow({note:'尺寸待复核\n运输请防潮'}),scannedRow({id:'empty-note',name:'无备注五金',category:'五金费用',note:'  ',price:'0'}),scannedRow({id:'unselected-note',selected:false,name:'未勾选材料',note:'不得复制'})]);upload.props.onBusyChange(false);tree=app.render();assert.equal(field(tree,'采购备注').props.value,'现有采购备注\n保留第二行\n识别板材：尺寸待复核\n运输请防潮');assert.equal(documentImport(tree).props.currentItemCount,2);assert.match(text(tree),/明细备注已追加到采购备注/);assert.equal(writes(app).length,0);
});

test('采购备注合计恰好2000字可以复制，超出时不追加行、不截断或修改原备注',async()=>{
 for(const [length,accepted] of [[1990,true],[1991,false]]){
  const app=harness();await start(app);let tree=openNew(app);const original='原'.repeat(length);field(tree,'采购备注').props.onChange({target:{value:original}});field(tree,'材料名称1').props.onChange({target:{value:'原有草稿材料'}});tree=app.render();let upload=documentImport(tree);upload.props.onBusyChange(true);tree=app.render();upload=documentImport(tree);upload.props.onApply([scannedRow({name:'板',note:'备'.repeat(7)})]);upload.props.onBusyChange(false);tree=app.render();assert.equal(field(tree,'材料名称1').props.value,'原有草稿材料');assert.equal(field(tree,'采购备注').props.value,accepted?original+'\n板：'+'备'.repeat(7):original);assert.equal(documentImport(tree).props.currentItemCount,accepted?2:1);if(accepted)assert.equal(field(tree,'采购备注').props.value.length,2000);else{assert.match(text(find(tree,node=>node.props.role==='alert','Length alert')),/超过 2000 字.*原草稿已保留/);assert.ok(!elements(tree).some(node=>node.props['aria-label']==='材料名称2'));}assert.equal(writes(app).length,0);
 }
});

test('采购四栏明细复制保留空价和原材料快照，未补价保存拒绝而显式零价合法',async()=>{
 const linked={...oldOrder,source_quote_id:'adopted-version',subproject_name:'原小项目'},matching={id:'catalog-match',name:'四栏原表板材',model:'18mm',unit:'张',purchase_price:77700,expense_category:'材料费用'};
 const app=harness({orders:[linked],materials:[matching]}),source=JSON.stringify(linked);let tree=await start(app);find(tree,node=>node.type==='button'&&node.props.className==='link'&&text(node)==='编辑','Edit order').props.onClick();tree=app.render();let upload=documentImport(tree);upload.props.onBusyChange(true);tree=app.render();upload=documentImport(tree);upload.props.onApply([scannedRow({name:'四栏原表板材',model:'18mm',quantity:'1.005',unit:'张',price:' ',sourceAmount:'',note:'原备注待核对'})]);upload.props.onBusyChange(false);tree=app.render();
 assert.equal(field(tree,'材料名称1').props.value,item.name);assert.equal(field(tree,'采购单价1').props.value,'2.55');assert.equal(field(tree,'材料名称2').props.value,'四栏原表板材');assert.equal(field(tree,'材料型号2').props.value,'18mm');assert.equal(field(tree,'采购数量2').props.value,'1.005');assert.equal(field(tree,'材料单位2').props.value,'张');assert.equal(field(tree,'采购单价2').props.value,'');assert.equal(field(tree,'采购备注').props.value,oldOrder.note+'\n四栏原表板材：原备注待核对');assert.equal(writes(app).length,0);assert.equal(JSON.stringify(linked),source);
 tree=await save(app);assert.equal(writes(app).length,0);assert.match(text(tree),/请检查数量和单价/);assert.equal(field(tree,'采购单价2').props.value,'');field(tree,'采购单价2').props.onChange({target:{value:'0'}});tree=await save(app);assert.equal(writes(app).length,1);const {action,args}=writes(app)[0];assert.equal(action,'update_purchase_order');assert.equal(args.id,oldOrder.id);assert.equal(args.number,oldOrder.number);assert.equal(args.revision,oldOrder.revision);assert.ok(!('source_quote_id' in args));const {amount,...snapshot}=linked.items[0];assert.deepEqual(args.items[0],{...snapshot,price:item.price/100});assert.deepEqual([args.items[1].name,args.items[1].model,args.items[1].quantity,args.items[1].unit,args.items[1].price,args.items[1].material_id],['四栏原表板材','18mm',1.005,'张',0,'']);assert.equal(JSON.stringify(linked),source);assert.equal(matching.purchase_price,77700);
});

test('采购复制缺价可留空但已填非法价和缺名称单位数量仍拒绝，不发保存请求',async()=>{
 for(const patch of [{price:'识别错误'},{price:'-1'},{price:'',quantity:''},{price:'',name:''},{price:'',unit:''}]){
  const app=harness({orders:[oldOrder]});let tree=await start(app);find(tree,node=>node.type==='button'&&node.props.className==='link'&&text(node)==='编辑','Edit order').props.onClick();tree=app.render();let upload=documentImport(tree);upload.props.onBusyChange(true);tree=app.render();upload=documentImport(tree);upload.props.onApply([scannedRow(patch)]);upload.props.onBusyChange(false);tree=app.render();assert.equal(documentImport(tree).props.currentItemCount,1);assert.match(text(tree),/核对材料或五金分类、名称、单位、数量和已填写的单价/);assert.equal(writes(app).length,0);assert.equal(field(tree,'材料名称1').props.value,item.name);
 }
});

test('单击采购名称打开全屏编辑，取消保留原采购单与输入快照且不保存',async()=>{
 const original=JSON.stringify(oldOrder),app=harness({orders:[oldOrder]});let tree=await start(app);
 find(tree,node=>node.type==='td'&&node.props.title==='单击编辑采购单','Click purchase name').props.onClick();tree=app.render();
 const panel=find(tree,node=>node.props.role==='dialog','Purchase dialog');assert.match(panel.props.className,/tableEditorDialog/);assert.equal(app.document.body.style.overflow,'hidden');
 assert.ok(elements(panel).some(node=>/tableEditorHeader/.test(node.props.className||'')));assert.ok(elements(panel).some(node=>/tableEditorBody/.test(node.props.className||'')));assert.ok(elements(panel).some(node=>/tableEditorFooter/.test(node.props.className||'')));
 const form=find(panel,node=>node.type==='form','Purchase edit form'),sections=React.Children.toArray(form.props.children);
 assert.deepEqual(sections.map(node=>/tableEditorHeader/.test(node.props.className||'')?'header':/tableEditorBody/.test(node.props.className||'')?'body':/tableEditorFooter/.test(node.props.className||'')?'footer':'other'),['header','body','footer'],'scrolling body must be a direct form sibling of the fixed header and footer');
 field(tree,'材料名称1').props.onChange({target:{value:'只在草稿里的新名称'}});field(tree,'材料型号1').props.onChange({target:{value:'只在草稿里的新规格'}});field(tree,'采购备注').props.onChange({target:{value:'不应保存的草稿备注'}});tree=app.render();
 assert.equal(field(tree,'材料名称1').props.value,'只在草稿里的新名称');assert.equal(field(tree,'材料型号1').props.value,'只在草稿里的新规格');
 button(tree,'取消').props.onClick();tree=app.render();assert.ok(!elements(tree).some(node=>node.props.role==='dialog'));assert.equal(app.document.body.style.overflow,'');assert.equal(writes(app).length,0);assert.equal(JSON.stringify(oldOrder),original);
 find(tree,node=>node.type==='td'&&node.props.title==='单击编辑采购单','Reopen purchase by name').props.onClick();tree=app.render();
 assert.equal(field(tree,'材料名称1').props.value,item.name);assert.equal(field(tree,'材料型号1').props.value,item.model);assert.equal(field(tree,'采购备注').props.value,oldOrder.note);assert.equal(writes(app).length,0);
});

test('采购Escape只关闭当前顶层弹窗，字段管理在前时保留采购草稿且不保存',async()=>{
 const app=harness();await start(app);let tree=openNew(app);field(tree,'材料名称1').props.onChange({target:{value:'保留顶层检查草稿'}});tree=app.render();assert.equal(app.listenerCount(),1);
 app.setOverlayOpen(true);assert.equal(app.escape(),false);tree=app.render();assert.ok(elements(tree).some(node=>node.props.role==='dialog'));assert.equal(field(tree,'材料名称1').props.value,'保留顶层检查草稿');assert.equal(writes(app).length,0);
 app.setOverlayOpen(false);assert.equal(app.escape(),true);tree=app.render();assert.ok(!elements(tree).some(node=>node.props.role==='dialog'));assert.equal(app.listenerCount(),0);assert.equal(writes(app).length,0);
});

test('后台采购草稿释放Escape监听，返回后继续保留输入，识别期间也不会被Escape关闭',async()=>{
 const app=harness({bodyOverflow:'scroll'});await start(app);let tree=openNew(app);field(tree,'材料名称1').props.onChange({target:{value:'后台切换保留'}});tree=app.render();assert.equal(app.listenerCount(),1);assert.equal(app.document.body.style.overflow,'hidden');
 app.setActive(false);tree=app.render();assert.equal(app.listenerCount(),0);assert.equal(app.document.body.style.overflow,'scroll');assert.equal(app.escape(),false);assert.equal(field(tree,'材料名称1').props.value,'后台切换保留');assert.equal(writes(app).length,0);
 app.setActive(true);tree=app.render();assert.equal(app.listenerCount(),1);assert.equal(app.document.body.style.overflow,'hidden');assert.equal(field(tree,'材料名称1').props.value,'后台切换保留');
 documentImport(tree).props.onBusyChange(true);tree=app.render();assert.equal(app.escape(),false);tree=app.render();assert.ok(elements(tree).some(node=>node.props.role==='dialog'));assert.equal(field(tree,'材料名称1').props.value,'后台切换保留');
 documentImport(tree).props.onBusyChange(false);tree=app.render();assert.equal(app.escape(),true);tree=app.render();assert.ok(!elements(tree).some(node=>node.props.role==='dialog'));assert.equal(app.document.body.style.overflow,'scroll');assert.equal(writes(app).length,0);
});
