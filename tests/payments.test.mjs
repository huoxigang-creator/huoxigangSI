import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

async function moduleFromURL(path){const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');}
async function moduleFrom(path, useZod = false) {
  let output = ts.transpileModule(readFileSync(path, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  if (useZod) {output = output.replace("from 'zod'", `from '${import.meta.resolve('zod')}'`);const details=await moduleFromURL('lib/payment-details.ts');const quotes=await moduleFromURL('lib/quotes.ts');output=output.replaceAll("from './payment-details'", `from '${details}'`).replaceAll("from './quotes'", `from '${quotes}'`);}
  return import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'));
}
const {paymentCategoryTotals, receiptProfit} = await moduleFrom('lib/payments.ts');
const {summarize} = await moduleFrom('lib/business.ts', true);

test('分类累计兼容历史名称，只计本项目未作废付款，保留其他分类', () => {
  const rows = [
    {project: 'p', type: '付款', category: '材料', amount: 10001},
    {project: 'p', type: '付款', category: '材料付款', amount: 2050},
    {project: 'p', type: '付款', category: '五金', amount: 5500},
    {project: 'p', type: '付款', category: '运输付款', amount: 1000},
    {project: 'p', type: '付款', category: '安装', amount: 20000},
    {project: 'p', type: '付款', category: '外定项目', amount: 30000},
    {project: 'p', type: '付款', category: '其他', amount: 9900},
    {project: 'p', type: '付款', category: '五金付款', amount: 90000, void: true},
    {project: 'p', type: '收款', category: '材料付款', amount: 400000},
    {project: 'other', type: '付款', category: '安装付款', amount: 800000},
  ];
  const before = JSON.stringify(rows);
  const result = paymentCategoryTotals(rows, 'p');
  assert.deepEqual(result.totals, {'材料付款': 12051, '五金付款': 5500, '运输付款': 1000, '安装付款': 20000, '外定项目付款': 30000});
  assert.equal(result.other, 9900);
  assert.equal(JSON.stringify(rows), before);
});

test('实际利润按收款减付款，未收尾款与预算不影响；作废和其他项目隔离', () => {
  const projects = [{id: 'p', budget: 100000}];
  const quotes = [{project: 'p', adopted: true, total: 2400000}];
  const receipt = {project: 'p', type: '收款', amount: 2000000};
  const payment = {project: 'p', type: '付款', amount: 300000};
  let [summary] = summarize(projects, quotes, [receipt, payment, {project: 'other', type: '付款', amount: 800000}]);
  assert.equal(receiptProfit(summary.received, summary.paid), 1700000);
  assert.equal(summary.remaining, 400000);
  [summary] = summarize(projects, quotes, [receipt, {...payment, void: true}]);
  assert.equal(receiptProfit(summary.received, summary.paid), 2000000);
  [summary] = summarize(projects, quotes, [receipt, {...payment, amount: 2500001}]);
  assert.equal(receiptProfit(summary.received, summary.paid), -500001);
});
