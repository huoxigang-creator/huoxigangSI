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
const {taskSchema,normalizeTaskReminder}=await import(businessURL);
const {planTaskReminder,taskReminderKey,taskDueMilliseconds}=await import(asURL(compile(readFileSync('lib/task-reminders.ts','utf8'))));
async function fixture(t){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('drizzle/0000_slippery_lenny_balinger.sql','utf8'));t.after(()=>sqlite.close());
 const database={prepare(sql){let args=[];return {sql,get args(){return args;},bind(...values){args=values;return this;},async all(){return {results:sqlite.prepare(sql).all(...args)};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(statement=>({meta:{changes:Number(sqlite.prepare(statement.sql).run(...statement.args).changes)}}));sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 globalThis.taskReminderTestEnv={DB:database};
 const serviceURL=asURL(compile(readFileSync('lib/service.ts','utf8')).replace("import { env } from 'cloudflare:workers';",'const env=globalThis.taskReminderTestEnv;').replace("import { env } from './local-env';", 'const env=globalThis.taskReminderTestEnv;').replace("from './business'",`from '${businessURL}'`))+'#'+crypto.randomUUID();
 const {execute,state}=await import(serviceURL);
 const project=await execute('alice','create_project',{name:'提醒测试项目',customer:'测试客户'});
 return {sqlite,execute,state,project};
}
const instant=value=>Date.parse('2026-10-12T'+value+':00.000Z');
const task=(id,time,extra={})=>({id,title:'任务 '+id,due_at:'2026-10-12T'+time+':00.000Z',...extra});

test('提醒时间需要真实日期、合法时分秒和显式时区，并归一 UTC',()=>{
 assert.equal(normalizeTaskReminder('2026-10-12T15:30:00+08:00'),'2026-10-12T07:30:00.000Z');
 assert.equal(normalizeTaskReminder('2024-02-29T23:59:59.123Z'),'2024-02-29T23:59:59.123Z');
 assert.equal(normalizeTaskReminder(''),'');
 for(const invalid of ['2026-02-29T12:00:00Z','2026-02-30T12:00:00Z','2026-10-12','2026-10-12T12:00:00','2026-10-12T24:00:00Z','2026-10-12T12:60:00Z','2026-10-12T12:00:60Z','2026-10-12T12:00:00+24:00','2026-10-12T12:00:00+08:60','2026-10-12T12:00:00.1234Z'])assert.equal(normalizeTaskReminder(invalid),null,invalid);
});

test('日期截止任务继续有效，非法日期/时间不落入 schema，空时间显式取消',()=>{
 const base={project_id:'p',title:'测量'};
 assert.equal(taskSchema.parse({...base,date:'2026-10-12'}).due_at,undefined);
 assert.equal(taskSchema.parse({...base,due_at:''}).due_at,'');
 assert.equal(taskSchema.parse({...base,due_at:'2026-10-12T15:30:00+08:00'}).due_at,'2026-10-12T07:30:00.000Z');
 assert.throws(()=>taskSchema.parse({...base,date:'2026-02-30'}));
 assert.throws(()=>taskSchema.parse({...base,due_at:'2026-10-12T15:30:00'}));
});

test('新增时间持久化，完成/再编辑省略时间仍保留，修改或清空时间有效',async t=>{
 const app=await fixture(t),args={project_id:app.project.id,title:'测量',date:'2026-10-12',due_at:'2026-10-12T15:30:00+08:00'};
 const created=await app.execute('alice','create_task',args);
 const completed=await app.execute('alice','update_task',{id:created.id,project_id:app.project.id,title:'测量完成',done:true});
 assert.equal(completed.due_at,'2026-10-12T07:30:00.000Z');assert.equal(completed.date,'2026-10-12');assert.equal(completed.created,created.created);assert.equal(completed.done,true);
 const changed=await app.execute('alice','update_task',{id:created.id,...args,due_at:'2026-10-13T15:30:00+08:00',done:false});
 assert.equal(changed.due_at,'2026-10-13T07:30:00.000Z');assert.equal(changed.date,'2026-10-13');
 await app.execute('alice','update_task',{id:created.id,...args,due_at:'',date:''});
 const current=(await app.state('alice')).tasks[0];assert.equal(current.due_at,'');assert.equal(current.date,'');
 assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='transaction'").get().n,0);
});

test('仅提供提醒时间或日期不一致时，待办日期统一按北京时间派生',async t=>{
 const app=await fixture(t);
 const created=await app.execute('alice','create_task',{project_id:app.project.id,title:'跨日提醒',due_at:'2026-10-12T23:30:00Z'});
 assert.equal(created.date,'2026-10-13');
 const changed=await app.execute('alice','update_task',{id:created.id,project_id:app.project.id,title:'跨日修改',date:'2026-10-12',due_at:'2026-10-12T18:00:00-08:00'});
 assert.equal(changed.due_at,'2026-10-13T02:00:00.000Z');assert.equal(changed.date,'2026-10-13');
});

test('账号/项目隔离、软删不提醒，旧日期任务不产生午夜提醒',async t=>{
 const app=await fixture(t),legacy=await app.execute('alice','create_task',{project_id:app.project.id,title:'旧截止日',date:'2026-10-12'});
 assert.equal(legacy.due_at,'');assert.equal(planTaskReminder([legacy],instant('00:00'),instant('23:59'),new Set()),null);
 assert.equal((await app.state('alice')).reminder_scope,'alice');assert.equal((await app.state('bob')).reminder_scope,'bob');assert.equal((await app.state('bob')).tasks.length,0);
 await assert.rejects(app.execute('bob','update_task',{id:legacy.id,project_id:app.project.id,title:'越权'}),error=>error.status===404);
 const other=await app.execute('alice','create_project',{name:'另一项目',customer:'测试客户'});
 await assert.rejects(app.execute('alice','update_task',{id:legacy.id,project_id:other.id,title:'移动'}),error=>error.status===400);
 app.sqlite.prepare("UPDATE records SET data=json_set(data,'$.deleted',json('true')) WHERE id=?").run(legacy.id);
 assert.equal((await app.state('alice')).tasks.length,0);
 await assert.rejects(app.execute('alice','update_task',{id:legacy.id,project_id:app.project.id,title:'恢复覆盖'}),error=>error.status===404);
});

test('初次开启排除过去任务、仅到点任务候选、完成删除日期型均忽略',()=>{
 const rows=[task('old','09:59'),task('next','10:01'),task('done','10:00',{done:true}),task('deleted','10:00',{deleted:true}),{id:'date',title:'旧日期',date:'2026-10-12'},task('bad','10:00',{due_at:'2026-02-30T10:00:00Z'})];
 assert.equal(planTaskReminder(rows,instant('10:00'),instant('10:00'),new Set()),null);
 const plan=planTaskReminder(rows,instant('10:00'),instant('10:01'),new Set());assert.equal(plan.latest.id,'next');assert.equal(plan.additional,0);
 assert.equal(taskDueMilliseconds(rows.at(-1)),null);
});

test('后台唤醒合并新截止任务为最新一项，按 id+时间去重，改时可以再提醒',()=>{
 const rows=[task('first','10:01'),task('latest','10:03'),task('latest','10:03')],seen=new Set();
 const plan=planTaskReminder(rows,instant('10:00'),instant('10:05'),seen);assert.equal(plan.latest.id,'latest');assert.equal(plan.additional,1);assert.equal(plan.keys.length,2);
 for(const key of plan.keys)seen.add(key);
 assert.equal(planTaskReminder(rows,instant('10:00'),instant('10:06'),seen),null);
 const moved=task('latest','10:07');assert.notEqual(taskReminderKey(moved),taskReminderKey(rows[1]));assert.equal(planTaskReminder([moved],instant('10:00'),instant('10:07'),seen).latest.id,'latest');
 assert.equal(planTaskReminder(rows,instant('10:08'),instant('10:07'),seen),null);
});
