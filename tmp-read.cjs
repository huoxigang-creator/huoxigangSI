const XLSX = require('xlsx');
const f = 'E:/2026年文件/10月份文件/桃李书书院6-2-1302/五金统计/五金销售单价.xlsx';
const wb = XLSX.readFile(f);
const ws = wb.Sheets['五金汇总'];
const d = XLSX.utils.sheet_to_json(ws, {header:1, raw:false});
for (let i = 0; i < Math.min(d.length, 30); i++) {
  console.log(i, JSON.stringify(d[i]));
}
