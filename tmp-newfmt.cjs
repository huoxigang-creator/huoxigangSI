const {parseQuoteImportRows, mergeQuoteImportRows} = require('./lib/quote-import.ts');
// 模拟新格式料单行
const rows = [
  { name: '普通灯带', model: '1882*1 1513*1 731*2', quantity: 1, unit: '米', section: '成品五金' },
  { name: '成品圆弧柜体色', model: '242*1', quantity: 1, unit: '米', section: '铝材' },
  { name: '成品圆弧柜体色', model: '582*1 917*1', quantity: 1, unit: '米', section: '铝材' },
];
const {rows: merged, notices} = mergeQuoteImportRows(rows);
for (const r of merged) {
  console.log(r.name, '|', r.model, '|', r.quantity, r.unit);
}
for (const n of notices) console.log(n);
