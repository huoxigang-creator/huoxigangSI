const {mergeQuoteImportRows} = require('./lib/quote-import.ts');
const rows = [
  { name: '极简玻璃门', model: '0.8×1', quantity: 1, unit: '㎡', section: '成品五金' },
];
const {rows: merged} = mergeQuoteImportRows(rows);
console.log(JSON.stringify(merged[0], null, 2));
