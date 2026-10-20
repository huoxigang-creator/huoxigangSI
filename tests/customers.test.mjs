import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import XLSX from 'xlsx';

const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const asURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const quotesURL=asURL(compile(readFileSync('lib/quotes.ts','utf8')));
const detailsURL=asURL(compile(readFileSync('lib/payment-details.ts','utf8')));
const businessURL=asURL(compile(readFileSync('lib/business.ts','utf8')).replace("from 'zod'",`from '${import.meta.resolve('zod')}'`).replaceAll("from './payment-details'",`from '${detailsURL}'`).replaceAll("from './quotes'",`from '${quotesURL}'`));
const exportURL=asURL(compile(readFileSync('lib/quote-export.ts','utf8')).replace("from './quotes'",`from '${quotesURL}'`).replaceAll("import('xlsx')",`import('${import.meta.resolve('xlsx')}')`));
const {quoteSchema,quoteTotal}=await import(businessURL);
const {normalizeQuoteItem}=await import(quotesURL);
const {buildQuoteExportSheets,createQuoteExcelBytes}=await import(exportURL);
const A='20000000-0000-4000-a000-000000000001',B='20000000-0000-4000-a000-000000000002',C='20000000-0000-4000-a000-000000000003';
const rooms=[{id:B,name:'厨房'},{id:A,name:'主卧室'},{id:C,name:'空次卧'}];
const line=(room_id=A,price=100)=>({room_id,name:'衣柜',unit:'㎡',quantity:1.5,price,category:'材料费用',model:'18mm',note:''});

async function fixture(t){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('drizzle/0000_slippery_lenny_balinger.sql','utf8'));t.after(()=>sqlite.close());
 const controls={beforeBatch:null,auditFailure:false};
 const database={prepare(sql){let args=[];return {sql,get args(){return args;},bind(...values){args=values;return this;},async all(){return {results:sqlite.prepare(sql).all(...args)};}};},async batch(statements){if(controls.beforeBatch){const cb=controls.beforeBatch;controls.beforeBatch=null;await cb();}sqlite.exec('BEGIN');try{const result=statements.map(statement=>{if(controls.auditFailure&&statement.args[2]==='audit')throw new Error('audit failure');return {meta:{changes:Number(sqlite.prepare(statement.sql).run(...statement.args).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 globalThis.customerTestEnv={DB:database};
 const serviceURL=asURL(compile(readFileSync('lib/service.ts','utf8')).replace("import { env } from 'cloudflare:workers';",'const env=globalThis.customerTestEnv;').replace("import { env } from './local-env';", 'const env=globalThis.customerTestEnv;').replace("from './business'",`from '${businessURL}'`))+'#'+crypto.randomUUID();
 const {execute,state}=await import(serviceURL);
 const customer=await execute('alice','create_project',{project_type:'customer',name:'测试家庭',customer:'测试户主',budget:80});
 const quote=(title='第一版',items=[line()])=>({project_id:customer.id,title,rooms:structuredClone(rooms),items});
 const record=id=>{const row=sqlite.prepare('SELECT * FROM records WHERE id=?').get(id);return row&&{...row,data:JSON.parse(row.data)};};
 const audits=action=>sqlite.prepare("SELECT data FROM records WHERE kind='audit'").all().map(row=>JSON.parse(row.data)).filter(row=>!action||row.action===action);
 return {execute,state,customer,quote,record,audits,controls,sqlite,serviceURL};
}

test('房间顺序、大小写UUID、零明细房间和原逐项取分规则',()=>{
 const quote=quoteSchema.parse({project_id:'p',title:'房间报价',rooms:rooms.map(room=>({...room,id:room.id.toUpperCase()})),items:[line(A.toUpperCase(),1.005)]});
 assert.deepEqual(quote.rooms,rooms);assert.equal(quote.items[0].room_id,A);assert.equal(quoteTotal(quote.items),150);assert.equal(normalizeQuoteItem(quote.items[0]).room_id,A);
 assert.equal(quoteSchema.safeParse({project_id:'p',title:'先添加房间',rooms:[rooms[0]],items:[]}).success,true);
 assert.equal(quoteSchema.safeParse({project_id:'p',title:'普通空报价',items:[]}).success,false);
 for(const changes of [{rooms:[rooms[0],rooms[0]],items:[]},{rooms:[{id:A,name:'   '}],items:[]},{rooms,items:[line('bad')]},{rooms:[rooms[0]],items:[line(A)]},{rooms,items:[{...line(),room_id:undefined}]},{items:[line()]}])assert.equal(quoteSchema.safeParse({project_id:'p',title:'错误报价',...changes}).success,false);
});

test('终端客户类型持久保存，旧项目读取默认且省略更新不转类型',async t=>{
 const app=await fixture(t);assert.equal(app.customer.kind,'project');assert.equal(app.customer.project_type,'customer');
 const edited=await app.execute('alice','update_project',{id:app.customer.id,name:'更新家庭',customer:'测试户主'});assert.equal(edited.project_type,'customer');
 const oldId=crypto.randomUUID(),raw=JSON.stringify({name:'旧合作项目',customer:'旧客户',budget:0});app.sqlite.prepare('INSERT INTO records VALUES (?,?,?,?,?,?)').run(oldId,'alice','project',oldId,raw,'2026-10-12');
 assert.equal((await app.state('alice')).projects.find(p=>p.id===oldId).project_type,'project');assert.equal(app.sqlite.prepare('SELECT data FROM records WHERE id=?').get(oldId).data,raw);
 const updated=await app.execute('alice','update_project',{id:oldId,name:'更新旧项目',customer:'旧客户'});assert.equal(updated.project_type,'project');
 assert.deepEqual((await app.execute('alice','list_projects',{project_type:'customer'})).map(p=>p.id),[app.customer.id]);
 await assert.rejects(app.execute('bob','get_project',{id:app.customer.id}),error=>error.status===404);
 await assert.rejects(app.execute('alice','create_project',{parent_id:app.customer.id,name:'独立项目',customer:'户主'}),/不能添加独立项目/);
 await assert.rejects(app.execute('alice','create_project',{project_type:'customer',parent_id:oldId,name:'子客户',customer:'户主'}),/不能归属于/);
});

test('客户报价必须是整户房间报价，可先保存空草稿并保留省略的房间',async t=>{
 const app=await fixture(t),draft=await app.execute('alice','create_quote',app.quote('空房间',[]));assert.equal(draft.total,0);assert.deepEqual(draft.rooms,rooms);
 const full=app.quote('补明细',[line(A,1.005),line(B,20)]);delete full.rooms;
 const saved=await app.execute('alice','update_quote',{...full,id:draft.id});assert.deepEqual(saved.rooms,rooms);assert.equal(saved.total,3150);
 await assert.rejects(app.execute('alice','create_quote',{...app.quote(),rooms:undefined}),/至少需要一个房间|报价明细必须关联/);
 await assert.rejects(app.execute('alice','create_quote',{...app.quote(),subproject_id:C}),/不能建立独立小项目/);
 await assert.rejects(app.execute('alice','update_quote',{...app.quote(),id:draft.id,rooms:[rooms[0]]}),/报价明细必须关联/);
 assert.deepEqual(app.record(draft.id).data.rooms,rooms);
});

test('整户新版本只采纳一个，房间合计、实际收款付款与利润一致',async t=>{
 const app=await fixture(t),q1=await app.execute('alice','create_quote',app.quote('旧版',[line(A,100),line(B,50)])),q2=await app.execute('alice','create_quote',app.quote('新版',[line(A,120),line(B,80)]));
 await app.execute('alice','adopt_quote',{id:q1.id});await app.execute('alice','adopt_quote',{id:q2.id});
 assert.equal(app.record(q1.id).data.adopted,false);assert.equal(app.record(q2.id).data.adopted,true);
 await assert.rejects(app.execute('alice','update_quote',{...app.quote(),id:q2.id}),/已采纳/);
 await app.execute('alice','record_transaction',{project_id:app.customer.id,type:'收款',amount:200,category:'定金',date:'2026-10-13',request_id:'customer-receipt-01'});
 await app.execute('alice','record_transaction',{project_id:app.customer.id,type:'付款',amount:50,category:'材料',date:'2026-10-13',request_id:'customer-payment-01'});
 const p=(await app.state('alice')).projects[0];assert.deepEqual([p.contract,p.received,p.paid,p.remaining,p.cash,p.estimatedProfit,p.actualGrossProfit],[30000,20000,5000,10000,15000,22000,25000]);
});

test('客户报价并发采纳和过期更新保留整户唯一版本，不丢失房间',async t=>{
 const app=await fixture(t),old=await app.execute('alice','create_quote',app.quote('旧')),next=await app.execute('alice','create_quote',app.quote('新',[line(A,200)])),other=await app.execute('alice','create_quote',app.quote('并发',[line(B,300)]));
 await app.execute('alice','adopt_quote',{id:old.id});app.controls.beforeBatch=async()=>{await app.execute('alice','adopt_quote',{id:other.id});};await app.execute('alice','adopt_quote',{id:next.id});
 assert.deepEqual((await app.state('alice')).quotes.filter(q=>q.adopted).map(q=>q.id),[next.id]);
 app.controls.beforeBatch=async()=>{await app.execute('alice','update_quote',{...app.quote('抢先编辑',[line(B,400)]),id:other.id});};await assert.rejects(app.execute('alice','update_quote',{...app.quote('过期',[line(A,1)]),id:other.id}),error=>error.status===409);
 assert.deepEqual(app.record(other.id).data.rooms,rooms);assert.equal(app.record(other.id).data.title,'抢先编辑');
});

test('类型转换和子项目或报价新建之间的竞争由数据库保护',async t=>{
 const app=await fixture(t),root=await app.execute('alice','create_project',{name:'空项目',customer:'客户'});
 app.controls.beforeBatch=async()=>{await app.execute('alice','update_project',{id:root.id,name:'转终端客户',customer:'客户',project_type:'customer'});};
 await assert.rejects(app.execute('alice','create_project',{parent_id:root.id,name:'迟到子项目',customer:'客户'}),error=>error.status===409);assert.equal(app.record(root.id).data.project_type,'customer');
 const p=await app.execute('alice','create_project',{name:'空项目二',customer:'客户'});
 app.controls.beforeBatch=async()=>{await app.execute('alice','update_project',{id:p.id,name:'转终端客户二',customer:'客户',project_type:'customer'});};
 await assert.rejects(app.execute('alice','create_quote',{project_id:p.id,title:'迟到普通报价',items:[{name:'报价',unit:'项',quantity:1,price:10}]}),error=>error.status===409);
 const p3=await app.execute('alice','create_project',{name:'空项目三',customer:'客户'});
 app.controls.beforeBatch=async()=>{await app.execute('alice','create_project',{parent_id:p3.id,name:'先完成子项目',customer:'客户'});};
 await assert.rejects(app.execute('alice','update_project',{id:p3.id,name:'迟到转换',customer:'客户',project_type:'customer'}),error=>error.status===409);assert.equal(app.record(p3.id).data.project_type,'project');
 const p4=await app.execute('alice','create_project',{name:'空项目四',customer:'客户'});
 app.controls.beforeBatch=async()=>{await app.execute('alice','create_quote',{project_id:p4.id,title:'先完成普通报价',items:[{name:'报价',unit:'项',quantity:1,price:10}]});};
 await assert.rejects(app.execute('alice','update_project',{id:p4.id,name:'迟到转换二',customer:'客户',project_type:'customer'}),error=>error.status===409);assert.equal(app.record(p4.id).data.project_type,'project');
 assert.equal(app.audits('create_quote').length,1);
});

test('已有报价或回收站子项目不能转换类型，避免恢复后产生错误归属',async t=>{
 const app=await fixture(t),q=await app.execute('alice','create_quote',app.quote());
 await assert.rejects(app.execute('alice','update_project',{id:app.customer.id,project_type:'project',name:'转项目',customer:'客户'}),/不能切换项目类型/);assert.equal(app.record(q.id).data.total,15000);
 const p=await app.execute('alice','create_project',{name:'合作',customer:'客户'}),child=await app.execute('alice','create_project',{parent_id:p.id,name:'子项目',customer:'客户'});
 app.sqlite.prepare("UPDATE records SET data=json_set(data,'$.deleted',json('true')) WHERE id=?").run(child.id);
 await assert.rejects(app.execute('alice','update_project',{id:p.id,project_type:'customer',name:'客户',customer:'客户'}),/不能切换项目类型/);
});

test('房间导出保留顺序和空房间，房间小计与总价沿用精确取分',async()=>{
 const input={project:{id:'test-customer',name:'测试家庭',project_type:'customer'},companyName:'测试公司',quote:{title:'第一版',rooms,items:[line(A,1.005),line(B,20)],total:3150}},before=JSON.stringify(input);
 const sheet=buildQuoteExportSheets(input)[0];assert.deepEqual(sheet.sectionRows.map(r=>sheet.rows[r][0]).filter(name=>name.startsWith('空间：')),['空间：厨房','空间：主卧室','空间：空次卧']);
 assert.deepEqual(sheet.subtotalRows.map(r=>sheet.rows[r][7]),[30,1.5,0,31.5]);assert.equal(JSON.stringify(input),before);
 const bytes=await createQuoteExcelBytes(input),book=XLSX.read(bytes,{type:'buffer'}),rowsOut=XLSX.utils.sheet_to_json(book.Sheets['报价清单'],{header:1});
 assert.equal(rowsOut.find(row=>row[0]==='厨房小计')[7],30);assert.equal(rowsOut.find(row=>row[0]==='报价合计')[7],31.5);
 assert.throws(()=>buildQuoteExportSheets({...input,quote:{...input.quote,rooms:[rooms[0]]}}),/有效房间/);
 const empty=buildQuoteExportSheets({...input,quote:{...input.quote,items:[],total:0}})[0];assert.deepEqual(empty.subtotalRows.map(r=>empty.rows[r][7]),[0,0,0,0]);
});

test('MCP声明客户类型、房间结构、空房间草稿和整户采纳语义',async t=>{
 const app=await fixture(t),routeURL=asURL(compile(readFileSync('app/mcp/route.ts','utf8')).replace("from '../../lib/service'",`from '${app.serviceURL}'`).replace("import { catalogExecute, CatalogError } from '../../lib/catalog';",'const catalogExecute=()=>{}; class CatalogError extends Error {}'));
 const {POST}=await import(routeURL),response=await POST(new Request('https://test.local/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}));
 const tools=(await response.json()).result.tools,create=tools.find(t=>t.name==='create_project'),quote=tools.find(t=>t.name==='create_quote');
 assert.deepEqual(create.inputSchema.properties.project_type.enum,['project','customer']);assert.equal(quote.inputSchema.properties.rooms.maxItems,100);assert.equal(quote.inputSchema.properties.items.minItems,0);assert.equal(quote.inputSchema.properties.items.items.properties.room_id.format,'uuid');assert.match(tools.find(t=>t.name==='adopt_quote').description,/终端客户.*整户/);
});
