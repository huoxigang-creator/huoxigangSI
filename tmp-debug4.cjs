const {mergeQuoteImportRows} = require('./lib/quote-import.ts');
const rows = [
  { name: '普通灯带', model: '1882*1 1513*1 731*2', quantity: 1, unit: '米', section: '成品五金' },
];
const {rows: merged} = mergeQuoteImportRows(rows);
console.log(JSON.stringify(merged[0], null, 2));
