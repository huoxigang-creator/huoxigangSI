const {parseQuoteImportRows, mergeQuoteImportRows} = require('./lib/quote-import.ts');
const XLSX = require('xlsx');
const fs = require('fs');
const dir = 'E:/2026年文件/10月份文件/云顶东苑10-2-404/五金统计';
const files = [];
function walk(d) { for (const f of fs.readdirSync(d)) { const p = d+'/'+f; const s = fs.statSync(p); if (s.isDirectory()) walk(p); else if (f.endsWith('.xlsx') && !f.startsWith('~')) files.push(p); } }
walk(dir);
let allRows = [];
for (const f of files) {
  const wb = XLSX.readFile(f);
  for (const sn of wb.SheetNames) {
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sn], {header:1, raw:true});
    allRows = allRows.concat(parseQuoteImportRows(data).rows);
  }
}
const {rows} = mergeQuoteImportRows(allRows);
for (const r of rows) {
  if (/灯带|挂衣杆|免拉手/.test(r.name) && !/角码|封口|连接|堵头/.test(r.name)) {
    console.log(r.name, '|', r.model, '|', r.quantity, r.unit);
  }
}
