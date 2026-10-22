const {parseQuoteImportRows, mergeQuoteImportRows} = require('./lib/quote-import.ts');
const XLSX = require('xlsx');
const f = 'E:/2026年文件/10月份文件/云顶东苑10-2-404/五金统计/G20264-6云顶东苑10-2-404厨房/G20264-6云顶东苑10-2-404厨房-全部料单.xlsx';
const wb = XLSX.readFile(f);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1, raw:true});
const parsed = parseQuoteImportRows(data);
const {rows} = mergeQuoteImportRows(parsed.rows);
for (const r of rows) {
  if (/踢脚线/.test(r.name)) {
    console.log('merged:', r.name, '| model=', JSON.stringify(r.model), '| qty=', r.quantity, '| unit=', r.unit);
  }
}
