const {parseQuoteImportRows, mergeQuoteImportRows} = require('./lib/quote-import.ts');
const XLSX = require('xlsx');
const fs = require('fs');
const dir = 'E:/2026年文件/10月份文件/云顶东苑10-2-404/五金统计';
const files = [];
function walk(d) { for (const f of fs.readdirSync(d)) { const p = d+'/'+f; const s = fs.statSync(p); if (s.isDirectory()) walk(p); else if (f.endsWith('.xlsx') && !f.startsWith('~')) files.push(p); } }
walk(dir);
console.log('文件数:', files.length);
let allRows = [];
for (const f of files) {
  const wb = XLSX.readFile(f);
  for (const sn of wb.SheetNames) {
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sn], {header:1, raw:true});
    allRows = allRows.concat(parseQuoteImportRows(data).rows);
  }
}
const {rows, notices} = mergeQuoteImportRows(allRows);
console.log('\n=== 五金汇总 ===');
console.log('序号 | 名称 | 规格 | 数量 | 单位');
rows.forEach((r, i) => {
  const spec = r.model || '—';
  console.log((i+1) + ' | ' + r.name + ' | ' + spec + ' | ' + r.quantity + ' | ' + r.unit);
});
console.log('\n=== 提示 ===');
for (const n of notices) console.log(n);
