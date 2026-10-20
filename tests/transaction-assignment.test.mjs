import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const asURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const detailsURL=asURL(compile(readFileSync('lib/payment-details.ts','utf8')));
const quotesURL=asURL(compile(readFileSync('lib/quotes.ts','utf8')));
const businessURL=asURL(compile(readFileSync('lib/business.ts','utf8')).replace("from 'zod'",`from '${import.meta.resolve('zod')}'`).replaceAll("from './payment-details'",`from '${detailsURL}'`).replaceAll("from './quotes'",`from '${quotesURL}'`));
const identityURL=asURL(compile(readFileSync('lib/contract-identity.ts','utf8')));
const templateURL=asURL(compile(readFileSync('lib/contract-template.ts','utf8')));
const esignURL=asURL(compile(readFileSync('lib/esign.ts','utf8')).replace("from './contract-identity'",`from '${identityURL}'`));
const pdfURL=asURL('export async function generateContractPdf(){throw Error("PDF should not be called in allocation tests")}');
const {createContractService}=await import(asURL(compile(readFileSync('lib/contracts.ts','utf8')).replace("import { env } from 'cloudflare:workers';",'const env={};').replace("import { env } from './local-env';", 'const env={};').replace("from 'zod'",`from '${import.meta.resolve('zod')}'`).replace("from './contract-template'",`from '${templateURL}'`).replace("from './contract-pdf'",`from '${pdfURL}'`).replace("from './esign'",`from '${esignURL}'`).replace("from './contract-identity'",`from '${identityURL}'`)));
const groupID='58ecc005-d51f-4af7-95c4-76a39d896056';

// Each test uses an isolated in-memory SQLite database and the real service SQL.
async function fixture(t){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('drizzle/0000_slippery_lenny_balinger.sql','utf8'));t.after(()=>sqlite.close());
 const controls={beforeBatch:null,auditFailure:false};
 const database={prepare(sql){let values=[];return{sql,get values(){return values;},bind(...args){values=args;return this;},async all(){return{results:sqlite.prepare(sql).all(...values)};}};},async batch(statements){
  if(controls.beforeBatch){const callback=controls.beforeBatch;controls.beforeBatch=null;await callback();}
  sqlite.exec('BEGIN');try{const results=statements.map(statement=>{if(controls.auditFailure&&statement.values[2]==='audit')throw Error('simulated audit failure');return{meta:{changes:Number(sqlite.prepare(statement.sql).run(...statement.values).changes)}};});sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}
 }};
 globalThis.assignmentTestEnv={DB:database};
 const serviceURL=asURL(compile(readFileSync('lib/service.ts','utf8')).replace("import { env } from 'cloudflare:workers';",'const env=globalThis.assignmentTestEnv;').replace("import { env } from './local-env';", 'const env=globalThis.assignmentTestEnv;').replace("from './business'",`from '${businessURL}'`))+'#'+crypto.randomUUID();
 const {execute,state}=await import(serviceURL);
 const root=await execute('alice','create_project',{name:'离线合作客户',customer:'测试客户'});
 const a=await execute('alice','create_project',{name:'厨房',customer:'测试客户',parent_id:root.id});
 const b=await execute('alice','create_project',{name:'卧室',customer:'测试客户',parent_id:root.id});
 const other=await execute('alice','create_project',{name:'另一个客户',customer:'其他客户'});
 const outside=await execute('alice','create_project',{name:'其他客户下的柜体',customer:'其他客户',parent_id:other.id});
 const customer=await execute('alice','create_project',{name:'终端客户',customer:'终端客户',project_type:'customer'});
 const group=await execute('alice','create_quote',{project_id:root.id,subproject_id:groupID,subproject_name:'旧报价小项目',title:'初版',items:[{name:'柜体',unit:'个',quantity:1,price:300}]});
 await execute('alice','adopt_quote',{id:group.id});
 const legacy=await execute('alice','create_quote',{project_id:root.id,title:'历史报价组',items:[{name:'旧柜体',unit:'个',quantity:1,price:100}]});
 const childQuote=await execute('alice','create_quote',{project_id:a.id,title:'厨房报价',items:[{name:'厨房柜',unit:'个',quantity:1,price:200}]});
 await execute('alice','adopt_quote',{id:childQuote.id});
 const receipt=await execute('alice','record_transaction',{project_id:root.id,type:'收款',amount:100,category:'定金',date:'2026-10-14',note:'保持原备注',request_id:'assignment-receipt-001'});
 const input=(row=receipt,target=a,subproject='')=>({id:row.id,project_id:target.id,subproject_id:subproject,expected_project_id:row.project,expected_subproject_id:row.subproject_id||'',expected_updated:row.updated||row.created});
 const record=id=>{const row=sqlite.prepare('SELECT * FROM records WHERE id=?').get(id);return row?{...row,data:JSON.parse(row.data)}:null;};
 const patch=(id,values)=>{const old=record(id);sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...old.data,...values}),id);};
 const audits=()=>sqlite.prepare("SELECT data FROM records WHERE kind='audit'").all().map(row=>JSON.parse(row.data)).filter(row=>row.action==='assign_transaction_subproject');
 const contract=(id,deleted=false)=>sqlite.prepare('INSERT INTO records(id,owner,kind,project,data,created) VALUES(?,?,?,?,?,?)').run(id,'alice','contract',root.id,JSON.stringify({deleted,receipt_allocations:[{transaction_id:receipt.id,installment_id:crypto.randomUUID(),amount:100}]}),'2026-10-14T01:00:00Z');
 return{execute,state,serviceURL,sqlite,database,controls,root,a,b,other,outside,customer,group,legacy,receipt,input,record,patch,audits,contract};
}

test('已有手工收款移动到真实子项目，保留金额与ID并立即更新父子余额',async t=>{
 const app=await fixture(t),before=app.record(app.receipt.id),saved=await app.execute('alice','assign_transaction_subproject',app.input());
 assert.equal(saved.id,app.receipt.id);assert.equal(saved.project,app.a.id);assert.equal(saved.created,before.created);
 for(const field of ['amount','type','category','date','note','request_id'])assert.equal(saved[field],before.data[field]);
 assert.equal(app.record(saved.id).project,app.a.id);assert.equal(app.record(saved.id).data.project_id,app.a.id);
 const state=await app.state('alice');assert.equal(state.transactions.length,1);assert.equal(state.projects.find(row=>row.id===app.root.id).received,0);assert.equal(state.projects.find(row=>row.id===app.a.id).received,10000);assert.equal(state.projects.find(row=>row.id===app.a.id).remaining,10000);
 assert.equal(state.projects.reduce((sum,row)=>sum+row.received,0),10000);assert.equal(app.audits().length,1);assert.equal(app.audits()[0].from_project_id,app.root.id);assert.equal(app.audits()[0].to_project_id,app.a.id);
});

test('旧报价UUID与legacy分配保持原project，不重复登记，重复同目标仅有一次审计',async t=>{
 const app=await fixture(t),args=app.input(app.receipt,app.root,groupID);
 const first=await app.execute('alice','assign_transaction_subproject',args),again=await app.execute('alice','assign_transaction_subproject',args);
 assert.equal(first.project,app.root.id);assert.equal(first.subproject_id,groupID);assert.equal(again.id,first.id);assert.equal(app.audits().length,1);
 const legacy=await app.execute('alice','assign_transaction_subproject',app.input(first,app.root,'legacy'));
 assert.equal(legacy.subproject_id,'legacy');assert.equal(legacy.amount,10000);assert.equal((await app.state('alice')).transactions.length,1);assert.equal(app.audits().length,2);
});

test('不可跨客户、跨账号、选客户整户、选择空父容器或失效报价组',async t=>{
 const app=await fixture(t);
 await assert.rejects(app.execute('','assign_transaction_subproject',app.input()),error=>error.status===401);
 await assert.rejects(app.execute('bob','assign_transaction_subproject',app.input()),error=>error.status===404);
 await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input(app.receipt,app.outside)),/不能跨客户/);
 await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input(app.receipt,app.customer)),/终端客户/);
 await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input(app.receipt,app.root)),/请选择/);
 await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input(app.receipt,app.root,crypto.randomUUID())),/报价小项目不存在/);
 assert.equal(app.record(app.receipt.id).project,app.root.id);assert.equal(app.audits().length,0);
});

test('报价/商户自动收款归属锁定，作废或删除的手工流水不能分配',async t=>{
 const app=await fixture(t);
 for(const field of ['source_quote_id','payment_provider','wechat_transaction_id','payment_order_id']){
  app.patch(app.receipt.id,{[field]:'existing-source'});await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input()),/已锁定/);app.patch(app.receipt.id,{[field]:''});
 }
 app.patch(app.receipt.id,{void:true});await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input()),/已作废/);
 app.patch(app.receipt.id,{void:false,deleted:true});await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input()),error=>error.status===404);
 assert.equal(app.audits().length,0);
});

test('严格输入拒绝金额等额外字段和缺失并发凭据，不能借分配改变账目',async t=>{
 const app=await fixture(t),before=app.record(app.receipt.id);
 for(const extra of [{amount:200},{type:'付款'},{note:'覆盖'},{voucher_project_id:app.outside.id}])await assert.rejects(app.execute('alice','assign_transaction_subproject',{...app.input(),...extra}),error=>error.name==='ZodError');
 const args=app.input();delete args.expected_updated;await assert.rejects(app.execute('alice','assign_transaction_subproject',args),error=>error.name==='ZodError');
 assert.deepEqual(app.record(app.receipt.id),before);assert.equal(app.audits().length,0);
});

test('并发改归属、原归属凭据或更新时间不符均409，不覆盖另一操作',async t=>{
 const app=await fixture(t);
 for(const patch of [{expected_project_id:app.b.id},{expected_subproject_id:'legacy'},{expected_updated:'stale-revision'}])await assert.rejects(app.execute('alice','assign_transaction_subproject',{...app.input(),...patch}),error=>error.status===409);
 app.controls.beforeBatch=async()=>{await app.execute('alice','assign_transaction_subproject',app.input(app.receipt,app.b));};
 await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input()),error=>error.status===409);
 assert.equal(app.record(app.receipt.id).project,app.b.id);assert.equal(app.audits().length,1);
});

test('同时分配同一目标幂等返回，CAS失败不会增加第二条审计',async t=>{
 const app=await fixture(t),args=app.input();let first;
 app.controls.beforeBatch=async()=>{first=await app.execute('alice','assign_transaction_subproject',args);};
 const saved=await app.execute('alice','assign_transaction_subproject',args);assert.equal(saved.id,first.id);assert.equal(saved.project,first.project);assert.equal(app.audits().length,1);assert.equal((await app.state('alice')).transactions.length,1);
});

test('snapshot后流水被作废或目标项目被删除，原子更新拒绝并无分配审计',async t=>{
 const app=await fixture(t);
 app.controls.beforeBatch=()=>app.patch(app.receipt.id,{void:true});await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input()),error=>error.status===409);assert.equal(app.record(app.receipt.id).project,app.root.id);assert.equal(app.audits().length,0);
 app.patch(app.receipt.id,{void:false});app.controls.beforeBatch=()=>app.patch(app.a.id,{deleted:true});await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input()),error=>error.status===409);assert.equal(app.record(app.receipt.id).project,app.root.id);assert.equal(app.audits().length,0);
});

test('并发删除报价组或给目标增加分组不会把流水落入不存在或未选的小项目',async t=>{
 const app=await fixture(t);
 app.controls.beforeBatch=()=>app.patch(app.group.id,{deleted:true});await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input(app.receipt,app.root,groupID)),error=>error.status===409);
 app.controls.beforeBatch=async()=>{await app.execute('alice','create_quote',{project_id:app.a.id,subproject_id:crypto.randomUUID(),subproject_name:'并发新增分组',title:'新报价',items:[{name:'柜体',unit:'个',quantity:1,price:100}]});};
 await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input()),error=>error.status===409);assert.equal(app.record(app.receipt.id).project,app.root.id);assert.equal(app.audits().length,0);
});

test('已关联分期的流水即使合同已回收也锁定，原子guard拒绝并发新关联',async t=>{
 const app=await fixture(t);app.contract('active-contract');
 await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input()),/请先在合同中解除/);
 await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input(app.receipt,app.root,groupID)),/请先在合同中解除/);
 app.sqlite.prepare("UPDATE records SET data=json_set(data,'$.deleted',json('true')) WHERE id='active-contract'").run();
 await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input()),/请先恢复合同并解除/);
 app.sqlite.prepare("DELETE FROM records WHERE id='active-contract'").run();app.controls.beforeBatch=()=>app.contract('concurrent-contract');
 await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input()),error=>error.status===409);assert.equal(app.record(app.receipt.id).project,app.root.id);assert.equal(app.audits().length,0);
});

test('手工付款多次移动保存最初单据origin、付款明细与请求ID',async t=>{
 const app=await fixture(t);const payment=await app.execute('alice','record_transaction',{project_id:app.root.id,type:'付款',amount:123.45,payment_items:[{name:'板材',amount:123.45}],category:'材料',date:'2026-10-14',note:'有单据的付款',request_id:'assignment-payment-001'});
 let moved=await app.execute('alice','assign_transaction_subproject',app.input(payment));
 assert.equal(moved.voucher_project_id,app.root.id);
 moved=await app.execute('alice','assign_transaction_subproject',app.input(moved,app.b));
 moved=await app.execute('alice','assign_transaction_subproject',app.input(moved,app.root,groupID));
 assert.equal(moved.voucher_project_id,app.root.id);assert.equal(moved.id,payment.id);assert.equal(moved.amount,12345);assert.deepEqual(moved.payment_items,payment.payment_items);assert.equal(moved.request_id,payment.request_id);assert.equal(moved.note,payment.note);
 assert.equal((await app.state('alice')).transactions.filter(row=>row.type==='付款').length,1);
});

test('归属先提交后，基于旧流水snapshot的合同关联即使同project也原子拒绝',async t=>{
 const app=await fixture(t),contractID=crypto.randomUUID(),revision=crypto.randomUUID(),installmentID=crypto.randomUUID();
 app.sqlite.prepare('INSERT INTO records(id,owner,kind,project,data,created) VALUES(?,?,?,?,?,?)').run(contractID,'alice','contract',app.root.id,JSON.stringify({revision,status:'draft',receipt_allocations:[],installments:[{id:installmentID,name:'定金',ratio:100,amount:20000}]}),'2026-10-14T01:00:00Z');
 const contracts=createContractService({database:()=>app.database,bucket:()=>undefined,environment:()=>({})});
 app.controls.beforeBatch=async()=>{await app.execute('alice','assign_transaction_subproject',app.input(app.receipt,app.root,groupID));};
 await assert.rejects(contracts.execute('alice','allocate_receipts',{id:contractID,revision,allocations:[{transaction_id:app.receipt.id,installment_id:installmentID,amount:10}]}),error=>error.status===409);
 assert.deepEqual(app.record(contractID).data.receipt_allocations,[]);assert.equal(app.record(app.receipt.id).data.subproject_id,groupID);assert.equal(app.audits().length,1);
});

test('审计插入失败原子回滚归属，原流水JSON和单据origin不变',async t=>{
 const app=await fixture(t),before=app.record(app.receipt.id);app.controls.auditFailure=true;
 await assert.rejects(app.execute('alice','assign_transaction_subproject',app.input()),/simulated audit failure/);assert.deepEqual(app.record(app.receipt.id),before);assert.equal(app.audits().length,0);
});

test('HTTP API校验登录与同源，MCP只暴露归属字段并可调用同一服务',async t=>{
 const app=await fixture(t);
 const api=await import(asURL(compile(readFileSync('app/api/manage/route.ts','utf8')).replace("from '../../../lib/service'",`from '${app.serviceURL}'`)));
 const request=(owner,origin='https://assignment.test')=>new Request('https://assignment.test/api/manage',{method:'POST',headers:{'Content-Type':'application/json',...(owner?{'oai-authenticated-user-id':owner}:{}),origin},body:JSON.stringify({action:'assign_transaction_subproject',args:app.input()})});
 assert.equal((await api.POST(request(null))).status,401);assert.equal((await api.POST(request('alice','https://other.test'))).status,403);
 const mcp=await import(asURL(compile(readFileSync('app/mcp/route.ts','utf8')).replace("from '../../lib/service'",`from '${app.serviceURL}'`).replace(/import \{ catalogExecute, CatalogError \} from '..\/..\/lib\/catalog';/,'const catalogExecute=async()=>({});class CatalogError extends Error{};')));
 const call=body=>mcp.POST(new Request('https://assignment.test/mcp',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':'alice'},body:JSON.stringify(body)}));
 const listed=await (await call({jsonrpc:'2.0',id:1,method:'tools/list'})).json();const tool=listed.result.tools.find(row=>row.name==='assign_transaction_subproject');assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,false);assert.equal(tool.inputSchema.properties.amount,undefined);assert.deepEqual(tool.inputSchema.required,['id','project_id','subproject_id','expected_project_id','expected_subproject_id','expected_updated']);
 const assigned=await (await call({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'assign_transaction_subproject',arguments:app.input()}})).json();assert.equal(assigned.result.isError,undefined);assert.equal(JSON.parse(assigned.result.content[0].text).project,app.a.id);assert.equal(app.audits().length,1);
});
