import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const asURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const quotesURL=asURL(compile(readFileSync('lib/quotes.ts','utf8'))),detailsURL=asURL(compile(readFileSync('lib/payment-details.ts','utf8')));
const typesURL=asURL(compile(readFileSync('lib/catalog-types.ts','utf8')).replace("from './payment-details'",`from '${detailsURL}'`));
const businessURL=asURL(compile(readFileSync('lib/business.ts','utf8')).replace("from 'zod'",`from '${import.meta.resolve('zod')}'`).replaceAll("from './payment-details'",`from '${detailsURL}'`).replaceAll("from './quotes'",`from '${quotesURL}'`));
const importURL=asURL(compile(readFileSync('lib/quote-import.ts','utf8')).replaceAll("import('xlsx')",`import('${import.meta.resolve('xlsx')}')`));
const {QUOTE_CATEGORIES,CABINET_NAMES,normalizeQuoteItem}=await import(quotesURL),{quoteSchema,quoteTotal}=await import(businessURL),{materialExpenseCategory}=await import(typesURL);
const {copyQuoteBudget}=await import(asURL(compile(readFileSync('lib/quote-copy.ts','utf8')).replace("from './quotes'",`from '${quotesURL}'`)));
const {parseQuoteImportRows,quoteImportRowIssues,finalizeQuoteImport}=await import(importURL);
const A='60000000-0000-4000-a000-000000000001',B='60000000-0000-4000-a000-000000000002';
const line=(category='柜体',changes={})=>({name:'衣柜',category,unit:'㎡',quantity:2,price:480,model:'18mm',note:'原报价说明',...changes});

async function fixture(t){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('drizzle/0000_slippery_lenny_balinger.sql','utf8'));t.after(()=>sqlite.close());
 const controls={beforeBatch:null};const database={prepare(sql){let args=[];return {sql,get args(){return args;},bind(...values){args=values;return this;},async all(){return {results:sqlite.prepare(sql).all(...args)};}};},async batch(statements){if(controls.beforeBatch){const callback=controls.beforeBatch;controls.beforeBatch=null;await callback();}sqlite.exec('BEGIN');try{const results=statements.map(statement=>({meta:{changes:Number(sqlite.prepare(statement.sql).run(...statement.args).changes)}}));sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 globalThis.cabinetCategoryEnv={DB:database};
 const serviceURL=asURL(compile(readFileSync('lib/service.ts','utf8')).replace("import { env } from 'cloudflare:workers';",'const env=globalThis.cabinetCategoryEnv;').replace("import { env } from './local-env';", 'const env=globalThis.cabinetCategoryEnv;').replace("from './business'",`from '${businessURL}'`))+'#'+crypto.randomUUID();
 const catalogURL=asURL(compile(readFileSync('lib/catalog.ts','utf8')).replace("import { env } from 'cloudflare:workers';",'const env=globalThis.cabinetCategoryEnv;').replace("import { env } from './local-env';", 'const env=globalThis.cabinetCategoryEnv;').replace("from 'zod'",`from '${import.meta.resolve('zod')}'`).replace("from './catalog-types'",`from '${typesURL}'`).replace("from './quotes'",`from '${quotesURL}'`))+'#'+crypto.randomUUID();
 const {execute,state}=await import(serviceURL),{createCatalogService}=await import(catalogURL),catalog=createCatalogService({database:()=>database});
 const project=await execute('alice','create_project',{project_type:'customer',name:'测试家庭',customer:'测试客户'});
 const quote=(category='柜体')=>({project_id:project.id,title:'第一版',rooms:[{id:A,name:'主卧室'}],items:[line(category,{room_id:A})]}),material=(changes={})=>({name:'衣柜',expense_category:'柜体',attribute:'主材',unit:'㎡',model:'18mm',purchase_price:200,sale_price:480,...changes});
 const record=id=>{const row=sqlite.prepare('SELECT * FROM records WHERE id=?').get(id);return row&&{...row,data:JSON.parse(row.data)};};
 return {execute,state,catalog,project,quote,material,record,sqlite,controls,serviceURL,catalogURL};
}

test('柜体是第四报价类别，默认名称供选择，老主辅材不隐式重分类',()=>{
 assert.deepEqual(QUOTE_CATEGORIES,['柜体','人工费用','材料费用','五金费用']);assert.deepEqual(CABINET_NAMES,['衣柜','鞋柜','酒柜','地柜','吊柜','电视柜','书柜','餐边柜','浴室柜']);
 assert.equal(materialExpenseCategory({expense_category:'柜体',attribute:'主材'}),'柜体');assert.equal(materialExpenseCategory({attribute:'主材'}),'材料费用');assert.equal(materialExpenseCategory({attribute:'辅材'}),'材料费用');assert.equal(materialExpenseCategory({attribute:'人工'}),'人工费用');assert.equal(normalizeQuoteItem(line()).category,'柜体');
 const ordinary=quoteSchema.parse({project_id:'p',title:'平级柜体报价',items:[line()]});assert.equal(ordinary.items[0].category,'柜体');assert.equal(ordinary.cabinets,undefined);
});

test('客户平级柜体报价保存和编辑无需柜体层级，采纳及优惠按原金额规则',async t=>{
 const app=await fixture(t),q=await app.execute('alice','create_quote',app.quote());assert.equal(q.items[0].category,'柜体');assert.equal(q.total,96000);assert.equal(q.cabinets,undefined);assert.equal(q.items[0].cabinet_id,undefined);
 const edited=await app.execute('alice','update_quote',{...app.quote(),id:q.id,title:'第二版',items:[line('柜体',{room_id:A,price:500}),line('人工费用',{room_id:A,name:'安装费',quantity:1,price:100})]});assert.equal(edited.total,110000);
 await app.execute('alice','adopt_quote',{id:q.id});await app.execute('alice','set_customer_settlement',{project_id:app.project.id,discount_amount:50,rounding_amount:0,note:'客户确认'});
 const p=(await app.state('alice')).projects[0];assert.deepEqual([p.contract,p.receivable,p.discount,p.cash],[110000,105000,5000,0]);
});

test('自定义柜体配置保存分价格，编辑省略分类仍保留柜体，可建立独立副本',async t=>{
 const app=await fixture(t),saved=await app.catalog.execute('alice','create_material',app.material({id:'custom-cabinet',name:'转角展示柜',purchase_price:199.995,sale_price:1.005}));assert.deepEqual([saved.expense_category,saved.purchase_price,saved.sale_price],['柜体',20000,101]);
 const update={...app.material({name:'转角展示柜调整',purchase_price:220,sale_price:520}),id:saved.id,revision:saved.revision};delete update.expense_category;
 const edited=await app.catalog.execute('alice','update_material',update);assert.equal(edited.expense_category,'柜体');assert.equal(edited.sale_price,52000);
 const copy=await app.catalog.execute('alice','create_material',app.material({name:edited.name+'（副本）',purchase_price:edited.purchase_price/100,sale_price:edited.sale_price/100}));assert.notEqual(copy.id,edited.id);assert.equal(copy.expense_category,'柜体');assert.equal(copy.sale_price,edited.sale_price);
 assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='transaction'").get().n,0);await assert.rejects(app.catalog.execute('bob','update_material',{...update,revision:edited.revision}),error=>error.status===404);
});

test('旧层级元信息和原明细在读取、更新省略及复制时完整保留，不迁移源记录',async t=>{
 const app=await fixture(t),q=await app.execute('alice','create_quote',{...app.quote('材料费用'),cabinets:[{id:B,room_id:A,name:'历史衣柜分组'}],items:[line('材料费用',{room_id:A,cabinet_id:B})]}),before=app.record(q.id);
 const source=(await app.state('alice')).quotes.find(quote=>quote.id===q.id),copied=copyQuoteBudget(source);assert.equal(app.record(q.id).data.items[0].category,'材料费用');assert.deepEqual(app.record(q.id),before);
 assert.equal(copied.cabinets[0].name,'历史衣柜分组');assert.notEqual(copied.cabinets[0].id,B);assert.equal(copied.items[0].cabinet_id,copied.cabinets[0].id);assert.equal(copied.items[0].category,'材料费用');assert.equal(quoteTotal(copied.items),before.data.total);
 const args={...app.quote('材料费用'),id:q.id,title:'改版',items:before.data.items};await app.execute('alice','update_quote',args);assert.deepEqual(app.record(q.id).data.cabinets,before.data.cabinets);assert.equal(app.record(q.id).data.items[0].cabinet_id,B);
 const flat=copyQuoteBudget({rooms:source.rooms,items:[line('柜体',{room_id:A})]});assert.equal(flat.items[0].category,'柜体');assert.equal(flat.items[0].cabinet_id,undefined);assert.deepEqual(flat.cabinets,[]);
});

test('柜体报价资料不进入新采购，原人工关联兼容且无自动付款',async t=>{
 const app=await fixture(t),cabinet=await app.catalog.execute('alice','create_material',app.material()),labor=await app.catalog.execute('alice','create_material',app.material({name:'安装费',expense_category:'人工费用',attribute:'人工'}));
 const order=material_id=>({project_id:app.project.id,date:'2026-10-13',items:[{material_id,name:'项目',unit:'㎡',quantity:1,price:200}]});
 await assert.rejects(app.catalog.execute('alice','create_purchase_order',order(cabinet.id)),/不能关联柜体/);
 const laborOrder=await app.catalog.execute('alice','create_purchase_order',order(labor.id));assert.equal(laborOrder.total,20000);
 await assert.rejects(app.catalog.execute('alice','create_purchase_order',{...order(cabinet.id),items:[{...order(cabinet.id).items[0],expense_category:'柜体'}]}),/Invalid enum|柜体/);
 const board=await app.catalog.execute('alice','create_material',app.material({name:'板材',expense_category:'材料费用'})),saved=await app.catalog.execute('alice','create_purchase_order',order(board.id));assert.equal(saved.total,20000);assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='transaction'").get().n,0);
});

test('采购旧快照在配置改为柜体后仍能原样更新，新关联和变动行被阻止',async t=>{
 const app=await fixture(t),board=await app.catalog.execute('alice','create_material',app.material({name:'原材料',expense_category:'材料费用'})),args={project_id:app.project.id,date:'2026-10-13',items:[{material_id:board.id,name:'原采购',unit:'㎡',quantity:1,price:200}]},saved=await app.catalog.execute('alice','create_purchase_order',args);
 await app.catalog.execute('alice','update_material',{...app.material({name:'原材料',expense_category:'柜体'}),id:board.id,revision:board.revision});
 const updated=await app.catalog.execute('alice','update_purchase_order',{...args,id:saved.id,revision:saved.revision,note:'补充备注'});assert.deepEqual(updated.items,saved.items);assert.equal(updated.total,saved.total);
 await assert.rejects(app.catalog.execute('alice','update_purchase_order',{...args,id:updated.id,revision:updated.revision,items:[{...args.items[0],quantity:2}]}),/不能关联柜体/);
});

test('采购读取后配置并发改为柜体，原子分类guard拒绝新增且不写假审计',async t=>{
 const app=await fixture(t),board=await app.catalog.execute('alice','create_material',app.material({name:'板材',expense_category:'材料费用'}));
 app.controls.beforeBatch=async()=>{await app.catalog.execute('alice','update_material',{...app.material({name:'板材',expense_category:'柜体'}),id:board.id,revision:board.revision});};
 await assert.rejects(app.catalog.execute('alice','create_purchase_order',{project_id:app.project.id,date:'2026-10-13',items:[{material_id:board.id,name:'板材',unit:'㎡',quantity:1,price:200}]}),error=>error.status===409);assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='purchase_order'").get().n,0);
});

test('柜体表格导入与其余三类平级保留原价数量和总额算法',()=>{
 const preview=parseQuoteImportRows([['费用类别','名称','单位','数量','单价'],['柜体','衣柜','㎡',2,480],['人工费用','安装费','项',1,100],['材料费用','板材','张',1.5,25],['五金费用','拉手','个',4,5]]),items=finalizeQuoteImport(preview.rows,'sales',false);assert.deepEqual(items.map(item=>item.category),QUOTE_CATEGORIES);assert.equal(quoteTotal(items),111750);
 assert.deepEqual(quoteImportRowIssues(preview.rows[0]),[]);assert.equal(items[0].price,480);assert.equal(items[0].quantity,2);
});

test('MCP柜体类别和配置写入语义一致，不需要柜体层级或新的配置action',async t=>{
 const app=await fixture(t),routeURL=asURL(compile(readFileSync('app/mcp/route.ts','utf8')).replace("from '../../lib/service'",`from '${app.serviceURL}'`).replace("from '../../lib/catalog'",`from '${app.catalogURL}'`)),{POST}=await import(routeURL);
 const request=body=>POST(new Request('https://category.test/mcp',{method:'POST',headers:{'oai-authenticated-user-id':'alice'},body:JSON.stringify({jsonrpc:'2.0',id:1,...body})}));
 const listed=(await(await request({method:'tools/list'})).json()).result.tools,create=listed.find(tool=>tool.name==='create_material'),quote=listed.find(tool=>tool.name==='create_quote');assert.deepEqual(create.inputSchema.properties.expense_category.enum,QUOTE_CATEGORIES);assert.deepEqual(quote.inputSchema.properties.items.items.properties.category.enum,QUOTE_CATEGORIES);assert.match(quote.inputSchema.properties.cabinets.description,/仅兼容旧报价/);
 const result=(await(await request({method:'tools/call',params:{name:'create_material',arguments:app.material({name:'玄关鞋柜',expense_category:'柜体'})}})).json()).result;assert.equal(result.isError,undefined);assert.equal(JSON.parse(result.content[0].text).expense_category,'柜体');assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='transaction'").get().n,0);
});
