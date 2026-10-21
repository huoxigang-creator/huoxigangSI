import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const code=ts.transpileModule(readFileSync('lib/statistics.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {periodTransactions}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('年、月及日期范围包含首尾，按流水日期排除作废和删除，不使用建档日期',()=>{
 const rows=[{date:'2025-12-31',amount:50,type:'收款'},{date:'2026-01-01',amount:100,type:'收款'},{date:'2026-10-21',amount:30,type:'付款'},{date:'2026-10-31',amount:20,type:'收款'},{date:'2026-10-21',amount:999,type:'收款',void:true},{date:'2026-10-21',amount:999,type:'收款',deleted:true}];
 assert.equal(periodTransactions(rows,'年','2026','','','').length,3);assert.equal(periodTransactions(rows,'月','','2026-10','','').length,2);
 const selected=periodTransactions(rows,'日期','','','2026-10-21','2026-10-31');assert.equal(selected.length,2);assert.equal(selected.reduce((s,t)=>s+(t.type==='收款'?t.amount:-t.amount),0),-10);assert.deepEqual(periodTransactions(rows,'日期','','','2026-10-31','2026-10-01'),[]);
});
