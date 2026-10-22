const XLSX = require('xlsx');
const fs = require('fs');
const dir = 'E:/2026年文件/10月份文件/云顶东苑10-2-404/五金统计';
const files = [];
function walk(d) { for (const f of fs.readdirSync(d)) { const p = d+'/'+f; const s = fs.statSync(p); if (s.isDirectory()) walk(p); else if (f.endsWith('.xlsx') && !f.startsWith('~')) files.push(p); } }
walk(dir);
for (const f of files) {
  const wb = XLSX.readFile(f);
  for (const sn of wb.SheetNames) {
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sn], {header:1, raw:true});
    data.forEach((row, i) => {
      const str = JSON.stringify(row);
      if (/踢脚线/.test(str) || /17\.0/.test(str)) {
        console.log(f.split('/').pop(), '| row', i, '|', str);
      }
    });
  }
}
