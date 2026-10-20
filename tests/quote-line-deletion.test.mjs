import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const quotesURL=url(compile(readFileSync('lib/quotes.ts','utf8'))),detailsURL=url(compile(readFileSync('lib/payment-details.ts','utf8')));
const businessURL=url(compile(readFileSync('lib/business.ts','utf8')).replace("from 'zod'",`from '${import.meta.resolve('zod')}'`).replaceAll("from './payment-details'",`from '${detailsURL}'`).replaceAll("from './quotes'",`from '${quotesURL}'`));
const A='60000000-0000-4000-a000-000000000001',B='60000000-0000-4000-a000-000000000002',C='60000000-0000-4000-a000-000000000003';
const rooms=[{id:A,name:'主卧室'},{id:B,name:'厨房'}],cabinets=[{id:C,room_id:A,name:'旧柜体结构'}];
const lines=[
 {room_id:A,name:'衣柜',category:'柜体',model:'20mm',unit:'㎡',quantity:1.25,price:10.01,note:'保留原价'},
 {room_id:A,cabinet_id:C,name:'板材',category:'材料费用',model:'18mm',unit:'张',quantity:2,price:20,note:'旧结构'},
 {room_id:B,name:'安装',category:'人工费用',model:'',unit:'项',quantity:3,price:13,note:''},
 {room_id:B,name:'铰链',category:'五金费用',model:'标准',unit:'个',quantity:4,price:2.5,note:''},
];
async function fixture(t){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('drizzle/0000_slippery_lenny_balinger.sql','utf8'));t.after(()=>sqlite.close());
 const controls={beforeBatch:null,auditFailure:false};
 const database={prepare(sql){let args=[];return {sql,get args(){return args;},bind(...values){args=values;return this;},async all(){return {results:sqlite.prepare(sql).all(...args)};}};},async batch(statements){if(controls.beforeBatch){const cb=controls.beforeBatch;controls.beforeBatch=null;await cb();}sqlite.exec('BEGIN');try{const result=statements.map(statement=>{if(controls.auditFailure&&statement.args[2]==='audit')throw Error('audit failure');return {meta:{changes:Number(sqlite.prepare(statement.sql).run(...statement.args).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 globalThis.quoteLineDeletionEnv={DB:database};
 const serviceURL=url(compile(readFileSync('lib/service.ts','utf8')).replace("import { env } from 'cloudflare:workers';",'const env=globalThis.quoteLineDeletionEnv;').replace("import { env } from './local-env';", 'const env=globalThis.quoteLineDeletionEnv;').replace("from './business'",`from '${businessURL}'`))+'#'+crypto.randomUUID();
 const {execute,state,BusinessError}=await import(serviceURL);
 const {createTrashService}=await import(url(compile(readFileSync('lib/trash.ts','utf8')).replace("import { env } from 'cloudflare:workers';",'const env=globalThis.quoteLineDeletionEnv;').replace("import { env } from './local-env';", 'const env=globalThis.quoteLineDeletionEnv;'))+'#'+crypto.randomUUID());
 const trash=createTrashService({database:()=>database,bucket:()=>undefined});
 const customer=await execute('alice','create_project',{project_type:'customer',name:'删除验收家庭',customer:'示例户主'});
 const quote=await execute('alice','create_quote',{project_id:customer.id,title:'整户草稿',rooms,cabinets,items:lines,note:'原报价备注'});
 const record=id=>{const row=sqlite.prepare('SELECT * FROM records WHERE id=?').get(id);return row&&{...row,data:JSON.parse(row.data)};};
 const backups=()=>sqlite.prepare("SELECT * FROM records WHERE kind='quote' AND json_extract(data,'$.deleted')=1").all().map(row=>({...row,data:JSON.parse(row.data)}));
 const request=(indexes=[0,2],q=quote)=>({id:q.id,item_indexes:indexes,expected_updated:q.updated||q.created,expected_items:structuredClone(q.items)});
 const audits=()=>sqlite.prepare("SELECT * FROM records WHERE kind='audit' AND json_extract(data,'$.action')='delete_quote_items'").all();
 return {execute,state,trash,customer,quote,record,backups,request,audits,controls,sqlite,serviceURL,BusinessError};
}

test('删除源索引对应明细，保留其他房间类别及旧结构；回收站恢复为完整未采纳旧版',async t=>{
 const app=await fixture(t),before=app.record(app.quote.id).data;
 const result=await app.execute('alice','delete_quote_items',app.request());
 assert.deepEqual(result.items,[before.items[1],before.items[3]]);assert.equal(result.total,5000);assert.deepEqual(result.rooms,rooms);assert.deepEqual(result.cabinets,cabinets);assert.equal(result.note,'原报价备注');
 const [backup]=app.backups();assert.equal(backup.data.source_quote_id,app.quote.id);assert.equal(backup.data.adopted,false);assert.deepEqual(backup.data.items,before.items);assert.deepEqual(backup.data.rooms,rooms);assert.deepEqual(backup.data.cabinets,cabinets);assert.equal(backup.data.total,before.total);assert.equal(app.audits().length,1);
 const listed=(await app.trash.execute('alice','list')).records;assert.equal(listed.length,1);assert.match(listed[0].name,/删除明细前副本/);
 await app.trash.execute('alice','restore_record',{id:backup.id});
 const restored=(await app.state('alice')).quotes.find(q=>q.id===backup.id);assert.deepEqual(restored.items,before.items);assert.equal(restored.adopted,false);assert.equal(restored.total,before.total);assert.equal((await app.state('alice')).projects[0].contract,0);
});

test('删除全部草稿明细可保存零报价，不变动已采纳合同、优惠抹零和真实现金',async t=>{
 const app=await fixture(t),adopted=await app.execute('alice','create_quote',{project_id:app.customer.id,title:'已采纳报价',rooms,items:[{...lines[0],quantity:1,price:100}]});
 await app.execute('alice','adopt_quote',{id:adopted.id});await app.execute('alice','set_customer_settlement',{project_id:app.customer.id,discount_amount:5,rounding_amount:0.01,note:'折让'});
 await app.execute('alice','record_transaction',{project_id:app.customer.id,type:'收款',amount:90,category:'实收',date:'2026-10-13',request_id:'line-deletion-receipt'});
 const before=await app.state('alice');await app.execute('alice','delete_quote_items',app.request([0,1,2,3]));const after=await app.state('alice');
 assert.deepEqual(app.record(app.quote.id).data.items,[]);assert.equal(app.record(app.quote.id).data.total,0);assert.deepEqual(after.transactions,before.transactions);
 for(const field of ['contract','discount','rounding','receivable','received','remaining','cash'])assert.equal(after.projects[0][field],before.projects[0][field]);
 assert.equal(after.quotes.find(q=>q.id===adopted.id).adopted,true);
});

test('越权、已采纳、非法索引和陈旧页面均拒绝，重复请求不再误删其他行',async t=>{
 const app=await fixture(t),request=app.request();await assert.rejects(app.execute('bob','delete_quote_items',request),error=>error.status===404);
 for(const indexes of [[],[0,0],[-1],[4],[0.5],['0'],null])await assert.rejects(app.execute('alice','delete_quote_items',{...request,item_indexes:indexes}));
 await assert.rejects(app.execute('alice','delete_quote_items',{...request,expected_updated:'old'}),error=>error.status===409);
 await assert.rejects(app.execute('alice','delete_quote_items',{...request,expected_items:[...request.expected_items].reverse()}),error=>error.status===409);
 await app.execute('alice','delete_quote_items',request);const after=app.record(app.quote.id).data;
 await assert.rejects(app.execute('alice','delete_quote_items',request),error=>error.status===409);assert.deepEqual(app.record(app.quote.id).data,after);assert.equal(app.backups().length,1);assert.equal(app.audits().length,1);
 const current=(await app.state('alice')).quotes.find(q=>q.id===app.quote.id);await app.execute('alice','adopt_quote',{id:current.id});await assert.rejects(app.execute('alice','delete_quote_items',app.request([0],current)),/已采纳报价/);
});

test('读取后报价被采纳或父客户被删除，原子保护拒绝且不留假备份或审计',async t=>{
 const app=await fixture(t),raw=app.record(app.quote.id).data;
 app.controls.beforeBatch=()=>app.sqlite.prepare("UPDATE records SET data=json_set(data,'$.adopted',json('true')) WHERE id=?").run(app.quote.id);
 await assert.rejects(app.execute('alice','delete_quote_items',app.request()),error=>error.status===409);assert.deepEqual(app.record(app.quote.id).data.items,raw.items);assert.equal(app.backups().length,0);assert.equal(app.audits().length,0);
 app.sqlite.prepare("UPDATE records SET data=json_set(data,'$.adopted',json('false')) WHERE id=?").run(app.quote.id);
 app.controls.beforeBatch=()=>app.sqlite.prepare("UPDATE records SET data=json_set(data,'$.deleted',json('true')) WHERE id=?").run(app.customer.id);
 await assert.rejects(app.execute('alice','delete_quote_items',app.request()),error=>error.status===409);assert.deepEqual(app.record(app.quote.id).data.items,raw.items);assert.equal(app.backups().length,0);assert.equal(app.audits().length,0);
});

test('备份与删除在同一事务，审计失败全部回滚；API延续登录与同源限制',async t=>{
 const app=await fixture(t),before=app.record(app.quote.id).data;app.controls.auditFailure=true;
 await assert.rejects(app.execute('alice','delete_quote_items',app.request()),/audit failure/);assert.deepEqual(app.record(app.quote.id).data,before);assert.equal(app.backups().length,0);
 const routeURL=url(compile(readFileSync('app/api/manage/route.ts','utf8')).replace("from '../../../lib/service'",`from '${app.serviceURL}'`));const {POST}=await import(routeURL);
 const send=(owner,origin)=>POST(new Request('https://delete.test/api/manage',{method:'POST',headers:{'Content-Type':'application/json',...(owner?{'oai-authenticated-user-id':owner}:{}),origin},body:JSON.stringify({action:'delete_quote_items',args:app.request()})}));
 assert.equal((await send(null,'https://delete.test')).status,401);assert.equal((await send('alice','https://evil.test')).status,403);app.controls.auditFailure=false;assert.equal((await send('alice','https://delete.test')).status,200);
});

test('最长中文和跨截断边界的emoji标题副本恢复后仍能编辑且保留完整原明细',async t=>{
 const app=await fixture(t),suffix='（删除明细前副本）',boundary=100-suffix.length;
 const titles=['中'.repeat(100),'中'.repeat(boundary-1)+'😀'+'尾'.repeat(99-boundary)];
 for(const title of titles){
  assert.equal(title.length,100);
  const quote=await app.execute('alice','create_quote',{project_id:app.customer.id,title,rooms,cabinets,items:lines,note:'原始长标题报价'});
  await app.execute('alice','delete_quote_items',app.request([0],quote));
  const backup=app.backups().find(value=>value.data.source_quote_id===quote.id);assert.ok(backup);assert.ok(backup.data.title.length<=100);assert.ok(backup.data.title.endsWith(suffix));assert.equal(backup.data.title.isWellFormed(),true);
  await app.trash.execute('alice','restore_record',{id:backup.id});
  const restored=(await app.state('alice')).quotes.find(value=>value.id===backup.id);assert.deepEqual(restored.items,quote.items);assert.deepEqual(restored.rooms,rooms);assert.deepEqual(restored.cabinets,cabinets);assert.equal(restored.adopted,false);
  const edited=await app.execute('alice','update_quote',{...restored,project_id:app.customer.id,note:'恢复后可以编辑'});assert.equal(edited.title,backup.data.title);assert.equal(edited.note,'恢复后可以编辑');assert.deepEqual(edited.items,quote.items);assert.equal(edited.adopted,false);assert.equal((await app.state('alice')).projects[0].contract,0);
 }
});
