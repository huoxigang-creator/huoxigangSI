import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
const compile=text=>ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const details=url(compile(readFileSync('lib/payment-details.ts','utf8')));
const quotes=url(compile(readFileSync('lib/quotes.ts','utf8')));
const business=url(compile(readFileSync('lib/business.ts','utf8')).replace("from 'zod'",`from '${import.meta.resolve('zod')}'`).replaceAll("from './payment-details'",`from '${details}'`).replaceAll("from './quotes'",`from '${quotes}'`));
async function fixture(t){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('drizzle/0000_slippery_lenny_balinger.sql','utf8'));t.after(()=>sqlite.close());
 function prepare(sql){let args=[];return {bind(...values){args=values;return this},async all(){return {results:sqlite.prepare(sql).all(...args)}},run(){const result=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(result.changes)}}}}}
 const database={prepare,async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(statement=>statement.run());sqlite.exec('COMMIT');return results}catch(error){sqlite.exec('ROLLBACK');throw error}}};
 globalThis.trashIntegrationEnv={DB:database};
 const serviceCode=compile(readFileSync('lib/service.ts','utf8')).replace("import { env } from 'cloudflare:workers';",'const env=globalThis.trashIntegrationEnv;').replace("import { env } from './local-env';", 'const env=globalThis.trashIntegrationEnv;').replace("from './business'",`from '${business}'`);
 const {execute,state}=await import(url(serviceCode)+'#'+crypto.randomUUID());
 const trashCode=compile(readFileSync('lib/trash.ts','utf8')).replace("import { env } from 'cloudflare:workers';",'const env=globalThis.trashIntegrationEnv;').replace("import { env } from './local-env';", 'const env=globalThis.trashIntegrationEnv;');
 const {createTrashService}=await import(url(trashCode)+'#'+crypto.randomUUID());
 const trash=createTrashService({database:()=>database,bucket:()=>undefined});
 return {sqlite,execute,state,trash};
}

test('项目删除与恢复按父子状态过滤，流水金额保留且不会重复计账',async t=>{
 const {sqlite,execute,state,trash}=await fixture(t);
 const p=await execute('alice','create_project',{name:'测试主项目',customer:'测试客户'});
 const other=await execute('alice','create_project',{name:'另一个项目',customer:'另一客户'});
 const quote=await execute('alice','create_quote',{project_id:p.id,title:'总价',items:[{name:'总价',unit:'项',quantity:1,price:24000}]});await execute('alice','adopt_quote',{id:quote.id});
 const common={project_id:p.id,category:'材料付款',date:'2026-10-12'};
 const receipt=await execute('alice','record_transaction',{...common,type:'收款',amount:20000,request_id:'integration-receipt'});
 const payment=await execute('alice','record_transaction',{...common,type:'付款',amount:10559,payment_items:[{name:'板材款',amount:9939},{name:'封边条款',amount:620}],request_id:'integration-payment'});
 const task=await execute('alice','create_task',{project_id:p.id,title:'待跟踪任务'});
 const original=sqlite.prepare('SELECT created FROM records WHERE id=?').get(payment.id).created;
 await trash.execute('alice','delete_record',{id:payment.id});await trash.execute('alice','delete_record',{id:task.id});
 let data=await execute('alice','get_project',{id:p.id});assert.equal(data.project.paid,0);assert.equal(data.project.cash,2000000);assert.equal(data.transactions.length,1);assert.equal(data.tasks.length,0);
 const deleted=JSON.parse(sqlite.prepare('SELECT data FROM records WHERE id=?').get(payment.id).data);assert.equal(deleted.amount,1055900);assert.equal(deleted.deleted,true);
 await trash.execute('alice','delete_record',{id:p.id});
 const hidden=await state('alice');assert.deepEqual(hidden.projects.map(value=>value.id),[other.id]);assert.equal(hidden.transactions.length,0);assert.equal(hidden.quotes.length,0);
 await assert.rejects(execute('alice','get_project',{id:p.id}),/不存在/);
 const bin=await trash.execute('alice','list');assert.equal(bin.records.find(value=>value.id===p.id).parentDeleted,false);assert.equal(bin.records.find(value=>value.id===payment.id).parentDeleted,true);
 await trash.execute('alice','restore_record',{id:p.id});
 data=await execute('alice','get_project',{id:p.id});assert.equal(data.project.paid,0);assert.equal(data.transactions.length,1);assert.equal(data.tasks.length,0);
 await trash.execute('alice','restore_record',{id:payment.id});await trash.execute('alice','restore_record',{id:task.id});
 data=await execute('alice','get_project',{id:p.id});assert.equal(data.project.paid,1055900);assert.equal(data.project.cash,944100);assert.equal(data.project.remaining,400000);assert.equal(data.transactions.length,2);assert.equal(data.tasks.length,1);
 assert.equal(sqlite.prepare('SELECT created FROM records WHERE id=?').get(payment.id).created,original);
 await trash.execute('alice','delete_record',{id:receipt.id});data=await execute('alice','get_project',{id:p.id});assert.equal(data.project.received,0);assert.equal(data.project.cash,-1055900);
 await trash.execute('alice','restore_record',{id:receipt.id});assert.equal((await execute('alice','get_project',{id:p.id})).project.cash,944100);
 await assert.rejects(trash.execute('bob','delete_record',{id:p.id}),/无权/);assert.equal((await state('bob')).projects.length,0);
});

test('删除采纳报价更新合同金额，恢复遇新采纳版本时回到草稿',async t=>{
 const {execute,trash}=await fixture(t);
 const p=await execute('alice','create_project',{name:'报价恢复项目',customer:'测试客户'});
 const q1=await execute('alice','create_quote',{project_id:p.id,title:'第一版',items:[{name:'柜体',unit:'项',quantity:1,price:100}]});await execute('alice','adopt_quote',{id:q1.id});
 await trash.execute('alice','delete_record',{id:q1.id});assert.equal((await execute('alice','get_project',{id:p.id})).project.contract,0);
 const q2=await execute('alice','create_quote',{project_id:p.id,title:'第二版',items:[{name:'柜体',unit:'项',quantity:1,price:200}]});await execute('alice','adopt_quote',{id:q2.id});
 const restored=await trash.execute('alice','restore_record',{id:q1.id});assert.equal(restored.restoredAsDraft,true);
 const data=await execute('alice','get_project',{id:p.id});assert.equal(data.project.contract,20000);assert.equal(data.quotes.filter(value=>value.adopted).length,1);assert.equal(data.quotes.find(value=>value.id===q1.id).adopted,false);
});
