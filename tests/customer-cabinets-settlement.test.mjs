import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const asURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const quotesURL=asURL(compile(readFileSync('lib/quotes.ts','utf8')));
const detailsURL=asURL(compile(readFileSync('lib/payment-details.ts','utf8')));
const businessURL=asURL(compile(readFileSync('lib/business.ts','utf8')).replace("from 'zod'",`from '${import.meta.resolve('zod')}'`).replaceAll("from './payment-details'",`from '${detailsURL}'`).replaceAll("from './quotes'",`from '${quotesURL}'`));
const {quoteSchema,customerSettlementSchema,quoteTotal}=await import(businessURL);
const {normalizeQuoteItem}=await import(quotesURL);
const A='50000000-0000-4000-a000-000000000001',B='50000000-0000-4000-a000-000000000002',C='50000000-0000-4000-a000-000000000003',D='50000000-0000-4000-a000-000000000004';
const rooms=[{id:A,name:'主卧室'},{id:B,name:'厨房'}],cabinets=[{id:C,room_id:A,name:'衣柜'},{id:D,room_id:B,name:'空橱柜'}];
const line=(price=100)=>({room_id:A,cabinet_id:C,name:'柜体板材',category:'材料费用',model:'18mm',unit:'项',quantity:1,price,note:'原行备注'});
const input=(project_id,title='第一版',price=100)=>({project_id,title,rooms:structuredClone(rooms),cabinets:structuredClone(cabinets),items:[line(price)],note:'报价备注'});

async function fixture(t){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('drizzle/0000_slippery_lenny_balinger.sql','utf8'));t.after(()=>sqlite.close());
 const controls={beforeBatch:null,auditFailure:false};
 const database={prepare(sql){let args=[];return {sql,get args(){return args;},bind(...values){args=values;return this;},async all(){return {results:sqlite.prepare(sql).all(...args)};}};},async batch(statements){if(controls.beforeBatch){const cb=controls.beforeBatch;controls.beforeBatch=null;await cb();}sqlite.exec('BEGIN');try{const result=statements.map(statement=>{if(controls.auditFailure&&statement.args[2]==='audit')throw new Error('audit failure');return {meta:{changes:Number(sqlite.prepare(statement.sql).run(...statement.args).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 globalThis.cabinetSettlementEnv={DB:database};
 const serviceURL=asURL(compile(readFileSync('lib/service.ts','utf8')).replace("import { env } from 'cloudflare:workers';",'const env=globalThis.cabinetSettlementEnv;').replace("import { env } from './local-env';", 'const env=globalThis.cabinetSettlementEnv;').replace("from './business'",`from '${businessURL}'`))+'#'+crypto.randomUUID();
 const {execute,state}=await import(serviceURL),trashURL=asURL(compile(readFileSync('lib/trash.ts','utf8')).replace("import { env } from 'cloudflare:workers';",'const env=globalThis.cabinetSettlementEnv;').replace("import { env } from './local-env';", 'const env=globalThis.cabinetSettlementEnv;'))+'#'+crypto.randomUUID(),{createTrashService}=await import(trashURL);
 const trash=createTrashService({database:()=>database,bucket:()=>undefined});
 const customer=await execute('alice','create_project',{project_type:'customer',name:'测试家庭',customer:'测试户主',phone:'123',budget:40});
 const quote=(title='第一版',price=100)=>input(customer.id,title,price),settlement=(discount=0,rounding=0,note='')=>({project_id:customer.id,discount_amount:discount,rounding_amount:rounding,note});
 const record=id=>{const row=sqlite.prepare('SELECT * FROM records WHERE id=?').get(id);return row&&{...row,data:JSON.parse(row.data)};};
 const audits=action=>sqlite.prepare("SELECT data FROM records WHERE kind='audit'").all().map(row=>JSON.parse(row.data)).filter(row=>!action||row.action===action);
 const adopt=async(price=100,title='采纳版')=>{const q=await execute('alice','create_quote',quote(title,price));await execute('alice','adopt_quote',{id:q.id});return q;};
 return {execute,state,trash,customer,quote,settlement,record,audits,controls,sqlite,serviceURL,adopt};
}

test('柜体UUID、房间关联和明细归属验证，旧无柜体明细保持兼容',()=>{
 const base=input('p'),parsed=quoteSchema.parse({...base,cabinets:base.cabinets.map(c=>({...c,id:c.id.toUpperCase(),room_id:c.room_id.toUpperCase()})),items:[{...line(1.005),cabinet_id:C.toUpperCase()}]});
 assert.deepEqual(parsed.cabinets,cabinets);assert.equal(parsed.items[0].cabinet_id,C);assert.equal(normalizeQuoteItem(parsed.items[0]).cabinet_id,C);assert.equal(quoteTotal(parsed.items),100);
 for(const change of [{cabinets:[cabinets[0],cabinets[0]]},{cabinets:[{...cabinets[0],room_id:D}]},{cabinets:[{...cabinets[0],name:'  '}]},{items:[{...line(),cabinet_id:D}]},{items:[{...line(),cabinet_id:A}]},{cabinets:[]}])assert.equal(quoteSchema.safeParse({...base,...change}).success,false);
 assert.equal(quoteSchema.safeParse({...base,items:[{...line(),cabinet_id:undefined}]}).success,true);
 const legacy={project_id:'p',title:'原报价',items:[{name:'旧柜体',unit:'项',quantity:1,price:10}]};assert.equal(quoteSchema.safeParse(legacy).success,true);assert.equal('cabinet_id' in normalizeQuoteItem(legacy.items[0]),false);
});

test('柜体结构保存、空柜体保留，省略更新不剥掉柜体，删除关联柜体拒绝',async t=>{
 const app=await fixture(t),q=await app.execute('alice','create_quote',app.quote());assert.deepEqual(app.record(q.id).data.cabinets,cabinets);
 const update=app.quote('改报价',120);delete update.cabinets;delete update.rooms;
 const saved=await app.execute('alice','update_quote',{...update,id:q.id});assert.deepEqual(saved.cabinets,cabinets);assert.deepEqual(saved.rooms,rooms);assert.equal(saved.items[0].cabinet_id,C);
 const before=app.record(q.id).data;await assert.rejects(app.execute('alice','update_quote',{...app.quote(),id:q.id,cabinets:[cabinets[1]]}),/有效柜体/);assert.deepEqual(app.record(q.id).data,before);
 const empty=await app.execute('alice','create_quote',{...app.quote('先添加柜体'),items:[]});assert.equal(empty.total,0);assert.deepEqual(empty.cabinets,cabinets);
});

test('优惠和抹零结清净应收，不伪造收款或改变现金，报告区分原价与折让',async t=>{
 const app=await fixture(t);await app.adopt();
 await app.execute('alice','record_transaction',{project_id:app.customer.id,type:'收款',amount:90.03,category:'实收',date:'2026-10-13',request_id:'cabinet-settlement-receipt'});
 await app.execute('alice','record_transaction',{project_id:app.customer.id,type:'付款',amount:50,category:'材料',date:'2026-10-13',request_id:'cabinet-settlement-payment'});
 const beforeTx=JSON.stringify((await app.state('alice')).transactions);await app.execute('alice','set_customer_settlement',app.settlement(9.96,0.01,'按客户确认结清'));
 const s=await app.state('alice'),p=s.projects[0];assert.deepEqual([p.contract,p.discount,p.rounding,p.receivable,p.received,p.paid,p.remaining,p.cash,p.estimatedProfit,p.actualGrossProfit],[10000,996,1,9003,9003,5000,0,4003,5003,4003]);
 assert.equal(JSON.stringify(s.transactions),beforeTx);assert.equal(app.record(app.customer.id).data.settlement_note,'按客户确认结清');assert.equal(app.record(app.customer.id).data.discount_amount,996);
 const totals=(await app.execute('alice','get_report',{})).totals;assert.deepEqual([totals.contract,totals.discount,totals.rounding,totals.receivable,totals.remaining,totals.cash],[10000,996,1,9003,0,4003]);
});

test('折让按十进制逐项取分，允许多收款显示负余额，普通项目金额不受影响',async t=>{
 const app=await fixture(t);await app.adopt();await app.execute('alice','set_customer_settlement',app.settlement(1.005,2.005));
 assert.deepEqual([app.record(app.customer.id).data.discount_amount,app.record(app.customer.id).data.rounding_amount],[101,201]);
 await app.execute('alice','record_transaction',{project_id:app.customer.id,type:'收款',amount:100,category:'实收',date:'2026-10-13',request_id:'cabinet-overpayment'});
 const p=(await app.state('alice')).projects[0];assert.equal(p.remaining,-302);assert.equal(p.cash,10000);
 const ordinary=await app.execute('alice','create_project',{name:'合作项目',customer:'客户',budget:10}),q=await app.execute('alice','create_quote',{project_id:ordinary.id,title:'普通报价',items:[{name:'报价',unit:'项',quantity:1,price:20}]});await app.execute('alice','adopt_quote',{id:q.id});
 const old=(await app.state('alice')).projects.find(value=>value.id===ordinary.id);assert.deepEqual([old.contract,old.discount,old.rounding,old.receivable,old.remaining,old.estimatedProfit],[2000,0,0,2000,2000,1000]);
});

test('无采纳时允许折让归零；非零、负数、非有限数、超合同、普通项目和越权均拒绝',async t=>{
 const app=await fixture(t);await app.execute('alice','set_customer_settlement',app.settlement(0,0,'尚未结算'));assert.equal(app.record(app.customer.id).data.discount_amount,0);
 await assert.rejects(app.execute('alice','set_customer_settlement',app.settlement(1)),/不能超过/);
 for(const value of [-1,Infinity,NaN,100000001])assert.equal(customerSettlementSchema.safeParse({...app.settlement(),discount_amount:value}).success,false);
 await app.adopt();await assert.rejects(app.execute('alice','set_customer_settlement',app.settlement(60,41)),/不能超过/);
 await assert.rejects(app.execute('bob','set_customer_settlement',app.settlement(1)),error=>error.status===404);
 const ordinary=await app.execute('alice','create_project',{name:'合作',customer:'客户'});await assert.rejects(app.execute('alice','set_customer_settlement',{...app.settlement(),project_id:ordinary.id}),/仅适用于/);
 await app.trash.execute('alice','delete_record',{id:app.customer.id});await assert.rejects(app.execute('alice','set_customer_settlement',app.settlement()),error=>error.status===404);
});

test('普通客户资料更新保留折让与备注，输入同名字段不能旁路改折让',async t=>{
 const app=await fixture(t);await app.adopt();await app.execute('alice','set_customer_settlement',app.settlement(10,0.01,'折让确认'));
 await app.execute('alice','update_project',{id:app.customer.id,name:'改客户名称',customer:'户主',budget:40,discount_amount:999,rounding_amount:999,settlement_note:'不应覆盖'});
 const p=app.record(app.customer.id).data;assert.equal(p.name,'改客户名称');assert.deepEqual([p.discount_amount,p.rounding_amount,p.settlement_note],[1000,1,'折让确认']);
});

test('相同结算串行或并发重试幂等，一次审计且不新增财务流水',async t=>{
 const app=await fixture(t);await app.adopt();const args=app.settlement(10,1,'相同设置');
 app.controls.beforeBatch=async()=>{await app.execute('alice','set_customer_settlement',args);};await app.execute('alice','set_customer_settlement',args);
 const before=app.record(app.customer.id).data;await app.execute('alice','set_customer_settlement',args);assert.deepEqual(app.record(app.customer.id).data,before);assert.equal(app.audits('set_customer_settlement').length,1);assert.equal((await app.state('alice')).transactions.length,0);
});

test('结算并发内容不同拒绝过期覆盖，先完成金额和备注保留',async t=>{
 const app=await fixture(t);await app.adopt();app.controls.beforeBatch=async()=>{await app.execute('alice','set_customer_settlement',app.settlement(20,0,'先完成'));};
 await assert.rejects(app.execute('alice','set_customer_settlement',app.settlement(10,0,'过期')),error=>error.status===409);assert.deepEqual([app.record(app.customer.id).data.discount_amount,app.record(app.customer.id).data.settlement_note],[2000,'先完成']);assert.equal(app.audits('set_customer_settlement').length,1);
});

test('结算读取后合同降低或取消，原子合同检查拒绝折让超额且无假审计',async t=>{
 const app=await fixture(t),old=await app.adopt(),small=await app.execute('alice','create_quote',app.quote('小金额版本',50));
 app.controls.beforeBatch=async()=>{await app.execute('alice','adopt_quote',{id:small.id});};await assert.rejects(app.execute('alice','set_customer_settlement',app.settlement(60)),error=>error.status===409);
 assert.equal(app.record(old.id).data.adopted,false);assert.equal(app.record(small.id).data.adopted,true);assert.equal((await app.state('alice')).projects[0].discount,0);assert.equal(app.audits('set_customer_settlement').length,0);
 app.controls.beforeBatch=async()=>{await app.execute('alice','unadopt_quote',{id:small.id});};await assert.rejects(app.execute('alice','set_customer_settlement',app.settlement(10)),error=>error.status===409);assert.equal((await app.state('alice')).projects[0].contract,0);
});

test('优惠不能超过新采纳额，取消采纳和删除须先清零，失败保留原采纳',async t=>{
 const app=await fixture(t),old=await app.adopt(),small=await app.execute('alice','create_quote',app.quote('小金额版本',50));await app.execute('alice','set_customer_settlement',app.settlement(80));
 await assert.rejects(app.execute('alice','adopt_quote',{id:small.id}),/先调整或清零/);await assert.rejects(app.execute('alice','unadopt_quote',{id:old.id}),/先调整或清零/);await assert.rejects(app.trash.execute('alice','delete_record',{id:old.id}),/先调整或清零/);
 assert.equal(app.record(old.id).data.adopted,true);assert.equal(app.record(small.id).data.adopted,false);assert.equal(app.audits('adopt_quote').length,1);assert.equal(app.audits('unadopt_quote').length,0);
 await app.execute('alice','set_customer_settlement',app.settlement());await app.execute('alice','unadopt_quote',{id:old.id});await app.execute('alice','unadopt_quote',{id:old.id});assert.equal(app.audits('unadopt_quote').length,1);await app.trash.execute('alice','delete_record',{id:old.id});assert.equal(app.record(old.id).data.deleted,true);
});

test('切换采纳读取后折让增大，两个原子guard保护清理旧版和新目标',async t=>{
 const app=await fixture(t),old=await app.adopt(),small=await app.execute('alice','create_quote',app.quote('小金额版本',50));
 app.controls.beforeBatch=async()=>{await app.execute('alice','set_customer_settlement',app.settlement(80));};await assert.rejects(app.execute('alice','adopt_quote',{id:small.id}),error=>error.status===409);
 assert.equal(app.record(old.id).data.adopted,true);assert.equal(app.record(small.id).data.adopted,false);assert.equal((await app.state('alice')).projects[0].receivable,2000);assert.equal(app.audits('adopt_quote').length,1);
});

test('取消采纳或删除读取后并发设置折让，报价保留且不制造假审计',async t=>{
 const app=await fixture(t),q=await app.adopt();app.controls.beforeBatch=async()=>{await app.execute('alice','set_customer_settlement',app.settlement(20));};await assert.rejects(app.execute('alice','unadopt_quote',{id:q.id}),error=>error.status===409);assert.equal(app.record(q.id).data.adopted,true);
 await app.execute('alice','set_customer_settlement',app.settlement());app.controls.beforeBatch=async()=>{await app.execute('alice','set_customer_settlement',app.settlement(30));};await assert.rejects(app.trash.execute('alice','delete_record',{id:q.id}),error=>error.status===409);
 assert.equal(app.record(q.id).data.deleted,undefined);assert.equal(app.record(q.id).data.adopted,true);assert.equal(app.audits('unadopt_quote').length,0);assert.equal(app.audits('delete_record').length,0);
});

test('结算和资料编辑相互CAS保护，删除客户期间设置结算失败',async t=>{
 const app=await fixture(t);await app.adopt();app.controls.beforeBatch=async()=>{await app.execute('alice','update_project',{id:app.customer.id,name:'先改名称',customer:'户主',budget:40});};
 await assert.rejects(app.execute('alice','set_customer_settlement',app.settlement(10)),error=>error.status===409);assert.equal(app.record(app.customer.id).data.name,'先改名称');assert.equal((await app.state('alice')).projects[0].discount,0);
 app.controls.beforeBatch=async()=>{await app.execute('alice','set_customer_settlement',app.settlement(20));};await assert.rejects(app.execute('alice','update_project',{id:app.customer.id,name:'过期名称',customer:'户主',budget:40}),error=>error.status===409);assert.equal(app.record(app.customer.id).data.discount_amount,2000);assert.equal(app.record(app.customer.id).data.name,'先改名称');
 app.controls.beforeBatch=async()=>{await app.trash.execute('alice','delete_record',{id:app.customer.id});};await assert.rejects(app.execute('alice','set_customer_settlement',app.settlement(30)),error=>error.status===409);assert.equal(app.record(app.customer.id).data.deleted,true);assert.equal(app.record(app.customer.id).data.discount_amount,2000);
});

test('审计失败回滚结算整个保存，金额备注与财务流水保持原样',async t=>{
 const app=await fixture(t);await app.adopt();const before=app.record(app.customer.id).data;app.controls.auditFailure=true;
 await assert.rejects(app.execute('alice','set_customer_settlement',app.settlement(10,1,'不应保存')),/audit failure/);assert.deepEqual(app.record(app.customer.id).data,before);assert.equal(app.audits('set_customer_settlement').length,0);assert.equal((await app.state('alice')).transactions.length,0);
});

test('报价和客户恢复保留柜体与结算，新采纳存在时旧报价恢复草稿',async t=>{
 const app=await fixture(t),old=await app.adopt();await app.trash.execute('alice','delete_record',{id:old.id});const current=await app.adopt(150,'现版本');await app.execute('alice','set_customer_settlement',app.settlement(80));
 const restored=await app.trash.execute('alice','restore_record',{id:old.id});assert.equal(restored.restoredAsDraft,true);assert.deepEqual(restored.record.cabinets,cabinets);assert.equal(app.record(current.id).data.adopted,true);assert.equal((await app.state('alice')).projects[0].receivable,7000);
 await app.trash.execute('alice','delete_record',{id:app.customer.id});await app.trash.execute('alice','restore_record',{id:app.customer.id});assert.equal((await app.state('alice')).projects[0].discount,8000);
});

test('MCP声明柜体关联及结算字段，输入元返回分与非收款语义明确',async t=>{
 const app=await fixture(t),routeURL=asURL(compile(readFileSync('app/mcp/route.ts','utf8')).replace("from '../../lib/service'",`from '${app.serviceURL}'`).replace("import { catalogExecute, CatalogError } from '../../lib/catalog';",'const catalogExecute=()=>{}; class CatalogError extends Error {}'));
 const {POST}=await import(routeURL),response=await POST(new Request('https://test.local/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}));
 const tools=(await response.json()).result.tools,quote=tools.find(t=>t.name==='create_quote'),settlement=tools.find(t=>t.name==='set_customer_settlement');assert.equal(quote.inputSchema.properties.cabinets.maxItems,500);assert.equal(quote.inputSchema.properties.items.items.properties.cabinet_id.format,'uuid');assert.deepEqual(settlement.inputSchema.required,['project_id','discount_amount','rounding_amount']);assert.match(settlement.description,/不是收款/);assert.match(settlement.description,/输入金额单位元，返回分/);assert.match(tools.find(t=>t.name==='get_report').description,/receivable.*折让后应收/);
});
