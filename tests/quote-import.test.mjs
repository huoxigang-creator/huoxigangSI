import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as XLSX from 'xlsx';

const source = readFileSync('lib/quote-import.ts', 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText.replace("import('xlsx')", `import('${import.meta.resolve('xlsx')}')`);
const {mergeQuoteImportRows,hardwareCatalogPreview, hardwareCatalogRow, parseQuoteImportRows, parseQuoteImport, finalizeQuoteImport, quoteImportTemplate, quoteImportNumber, quoteImportRowIssues} = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const header = ['序号', '名称', '规格', '单位', '数量', '销售单价', '金额', '备注'];
const basic = () => parseQuoteImportRows([header, [1, '匿名配件', 'A', '个', 3, 2.50, 7.50, '']]);

test('毫米灯带合计后转米，两位小数；免拉手取末段，挂衣杆取首段',()=>{
 const row=(name,model,quantity,unit='个')=>({...basic().rows[0],name,model,quantity,unit});
 const result=mergeQuoteImportRows([row('普通灯带','2598mm',2598,'毫米'),row('普通灯带','713mm',713,'mm'),row('普通灯带','1687mm',1687,'毫米'),row('L型免拉手','58.0*25.0*1914.0',2),row('普通挂衣杆','737.0*0.0*0.0',2)]).rows;
 assert.equal(result[0].unit,'米');assert.equal(result[0].quantity,5);assert.equal(result[1].model,'1914');assert.equal(result[1].quantity,3.83);assert.equal(result[2].model,'737');
 const byCount=mergeQuoteImportRows([row('普通灯带','2598',2),row('普通灯带','713',1)]).rows[0];assert.equal(byCount.quantity,5.91);assert.equal(byCount.unit,'米');
 const angle=mergeQuoteImportRows([row('免拉手角码','',4)]).rows[0];assert.equal(angle.quantity,4);assert.equal(angle.unit,'个');
 const matched=hardwareCatalogRow(row('普通灯带','',10712,'毫米'),[{id:'led',name:'普通灯带',model:'',unit:'米',expense_category:'五金费用',sale_price:1000}]);assert.equal(matched.quantity,10.71);assert.equal(matched.price,10);
});

test('recognizes separated Chinese sections, cached formulas, pending prices and a non-duplicated control total', () => {
  const preview = parseQuoteImportRows([
    ['匿名五金销售明细'], ['1. 成品五金'], header,
    [1, '匿名铰链', 'A', '个', 5, 2, {f: 'ROUND(E4*F4,2)', v: 10, t: 'n'}, ''],
    [2, '匿名待核算件', 'B', '个', 2, null, '待核算', '单价待核实'],
    ['小计：5个', '', '', '', '', '', 10], [], ['2. 铝材'],
    ['序号', '名称', '规格', '单位', '数量', '成本单价', '成本金额', '备注'],
    [1, '匿名杆件', '1000×2', '根', 2, 8, 16, '元/米；按各长度计价'],
    ['小计：2根', '', '', '', '', '', 16],
    ['五金已计成本（含铝材）', '', '', '', '', '', 26],
    ['未计1项：价格待核算'], ['单价来源：测试说明'],
  ], {fileName: '匿名成本.xlsx', sheetName: '明细'});
  assert.equal(preview.rows.length, 3);
  assert.deepEqual(preview.rows.map(row => row.sourceRow), [4, 5, 10]);
  assert.equal(preview.sourceTotal, 2600);
  assert.equal(preview.priceKind, 'cost');
  assert.equal(preview.rows[1].price, null);
  assert.ok(preview.rows[2].issues.some(issue => issue.includes('改为米')));
  assert.ok(preview.warnings.some(warning => warning.includes('成本')));
  assert.ok(preview.warnings.some(warning => warning.includes('缺少有效单价')));
  assert.throws(() => finalizeQuoteImport(preview.rows, 'cost', false), /确认将成本单价/);
  assert.throws(() => finalizeQuoteImport(preview.rows, 'cost', true), /第 5 行/);
  preview.rows[1].selected = false;
  assert.equal(finalizeQuoteImport(preview.rows, 'cost', true).length, 2);
});

test('strict number parsing preserves zero and rejects partial, negative and unit-bearing values', () => {
  assert.equal(quoteImportNumber(0, true), 0);
  assert.equal(quoteImportNumber('￥1,234.56元', true), 1234.56);
  assert.equal(quoteImportNumber('３.５'), 3.5);
  for (const bad of ['', null, false, '待核算', '12米', '1,00', '4.5元/米', '-3', '3%', '1.2abc', NaN, Infinity]) assert.equal(quoteImportNumber(bad, true), null);
  const preview = parseQuoteImportRows([header, [1, '匿名免费项', '', '项', 1, 0, 0]]);
  assert.equal(finalizeQuoteImport(preview.rows, 'sales', false)[0].price, 0);
});

test('source amount discrepancies require correction or explicit use of the newly calculated amount', () => {
  const preview = parseQuoteImportRows([header, [1, '匿名长度件', '1200×2', '根', 2, 5, 12, '元/米']]);
  const row = preview.rows[0];
  assert.ok(row.issues.some(issue => issue.includes('不同')));
  assert.throws(() => finalizeQuoteImport(preview.rows, 'sales', false), /数量 × 单价/);
  row.quantity = 2.4; row.unit = '米'; row.note = '原数量 2 根；计价长度 2.4 米';
  assert.deepEqual(finalizeQuoteImport(preview.rows, 'sales', false)[0], {name: '匿名长度件', model: '1200×2', unit: '米', category: '五金费用', quantity: 2.4, price: 5, note: row.note});
  row.quantity = 3;
  assert.throws(() => finalizeQuoteImport(preview.rows, 'sales', false), /不同/);
  row.acceptDifference = true;
  const item = finalizeQuoteImport(preview.rows, 'sales', false)[0];
  assert.equal(Math.round(item.quantity * Math.round(item.price * 100)), 1500);
  assert.equal(row.sourceAmount, 1200);
  assert.ok(!('amount' in item), 'the source amount never becomes an override');
});

test('finalize revalidates current values and ignores only explicitly unselected rows', () => {
  const preview = basic();
  preview.rows.push({...preview.rows[0], id: 'bad', sourceRow: 3, price: null, selected: false});
  preview.rows[0].issues = ['旧提示'];
  assert.equal(finalizeQuoteImport(preview.rows, 'sales', false).length, 1);
  preview.rows[0].quantity = 0;
  assert.throws(() => finalizeQuoteImport(preview.rows, 'sales', false), /数量须大于 0/);
  preview.rows.forEach(row => row.selected = false);
  assert.throws(() => finalizeQuoteImport(preview.rows, 'sales', false), /至少勾选/);
});

test('supports legacy three categories and normalizes displayed header units without changing amounts', () => {
  const preview = parseQuoteImportRows([
    ['费用分类', '费用名称', '规格型号', '计量单位', '数量（不含损耗）', '综合价（元）', '报价金额（元）', '说明'],
    ['人工费用', '匿名加工', '', '张', 2, 10.005, 20.02, ''],
    ['材料费用', '匿名板材', '', '张', 1, 25, 25, ''],
    ['五金费用', '匿名五金', '', '个', 2, 1, 2, ''],
  ]);
  const items = finalizeQuoteImport(preview.rows, 'sales', false);
  assert.deepEqual(items.map(item => item.category), ['人工费用', '材料费用', '五金费用']);
  assert.equal(Math.round(items[0].quantity * Math.round(items[0].price * 100)), 2002);
});

test('bad formula caches and Excel errors are visible failures, never evaluated or converted to zero', () => {
  assert.throws(() => parseQuoteImportRows([header, [1, '匿名项', '', '个', 2, 3, {f: 'E2*F2', t: 'n'}]]), /公式没有保存计算结果/);
  assert.throws(() => parseQuoteImportRows([header, [1, '匿名项', '', '个', 2, 3, {f: '1\/0', v: 7, t: 'e'}]]), /Excel 公式错误/);
  const preview = parseQuoteImportRows([header, [1, '匿名项', '', '个', 2, '=2+1', '=E2*F2']]);
  assert.equal(preview.rows[0].price, null);
  assert.throws(() => finalizeQuoteImport(preview.rows, 'sales', false), /单价缺失/);
});

test('strict total checks avoid duplicated subtotal rows and reject inconsistent source totals', () => {
  const preview = parseQuoteImportRows([header, [1, '匿名项', '', '个', 2, 3, 6], ['小计', '', '', '', '', '', 6], ['合计', '', '', '', '', '', 6]]);
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.sourceTotal, 600);
  assert.throws(() => parseQuoteImportRows([header, [1, '匿名项', '', '个', 2, 3, 6], ['合计', '', '', '', '', '', 7]]), /源合计 7.00 元.*6.00 元不一致/);
});

test('enforces backend limits and required headers rather than silently dropping records', () => {
  assert.throws(() => parseQuoteImportRows([['随意说明'], ['没有表头']]), /未找到明细表头/);
  assert.throws(() => parseQuoteImportRows([header]), /没有可导入的明细/);
  assert.throws(() => parseQuoteImportRows([['名称', '名称', '数量', '单价'], ['a', 'b', 1, 2]]), /重复/);
  const row = basic().rows[0];
  for (const [field, value, expected] of [['quantity', 100001, /数量/], ['price', 10000001, /单价/], ['name', 'x'.repeat(101), /名称/], ['model', 'x'.repeat(101), /规格/], ['unit', 'x'.repeat(11), /单位/], ['note', 'x'.repeat(501), /备注/], ['category', '其它', /请选择柜体/]]) {
    assert.ok(quoteImportRowIssues({...row, [field]: value}).some(issue => expected.test(issue)));
  }
  assert.throws(() => parseQuoteImportRows([header, ...Array.from({length: 501}, (_, index) => [index, '匿名项', '', '项', 1, 1, 1])]), /最多支持 500 条/);
});

function excelFile(bookType) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['匿名销售明细'], header, [1, '匿名配件', 'M', '个', 4, 1.25, 5]]);
  XLSX.utils.book_append_sheet(book, sheet, '匿名明细');
  const bytes = XLSX.write(book, {type: 'buffer', bookType});
  return new File([bytes], '匿名明细.' + (bookType === 'biff8' ? 'xls' : 'xlsx'));
}
test('parses xlsx and old xls files locally with the same preview contract', async () => {
  for (const format of ['xlsx', 'biff8']) {
    const preview = await parseQuoteImport(excelFile(format));
    assert.equal(preview.sheetName, '匿名明细');
    assert.equal(preview.rows.length, 1);
    assert.equal(preview.rows[0].sourceRow, 3);
    assert.equal(preview.rows[0].sourceAmount, 500);
    assert.equal(finalizeQuoteImport(preview.rows, 'sales', false)[0].price, 1.25);
  }
});

test('parses UTF-8 CSV with quoted commas and supplies a blank Excel-friendly template', async () => {
  const preview = await parseQuoteImport(new File(['\uFEFF名称,规格型号,单位,数量,销售单价,金额,备注\r\n匿名配件,M,个,2,3,6,"含逗号,的备注"'], '匿名.csv'));
  assert.equal(preview.rows[0].note, '含逗号,的备注');
  assert.equal(preview.priceKind, 'sales');
  assert.equal(finalizeQuoteImport(preview.rows, 'sales', false)[0].quantity, 2);
  assert.ok(quoteImportTemplate().startsWith('\uFEFF名称,规格型号,单位,数量,销售单价,金额,备注'));
  assert.equal(quoteImportTemplate().trim().split('\n').length, 2);
});

test('rejects unsupported or oversized files before parsing', async () => {
  await assert.rejects(() => parseQuoteImport(new File(['x'], '匿名.pdf')), /支持 .xlsx/);
  await assert.rejects(() => parseQuoteImport({name: '匿名.xlsx', size: 10 * 1024 * 1024 + 1}), /10MB/);
});


test('四列导入忽略源单价金额备注，销售单价匹配配置中的五金费用',()=>{
 const parsed=parseQuoteImportRows([['名称','规格型号','数量','单位','采购单价','金额','备注','销售单价'],['铰链','A',3,'只',{f:'NO_CACHE()'},999,'成本备注',777]],{catalogPrices:true});
 const materials=[{name:'铰链',model:'A',unit:'只',expense_category:'五金费用',sale_price:1250,purchase_price:200}];
 const result=hardwareCatalogPreview(parsed,materials);assert.equal(result.rows[0].price,12.5);assert.equal(result.rows[0].sourceAmount,null);assert.equal(result.rows[0].note,'');assert.equal(result.sourceTotal,null);assert.equal(result.priceKind,'sales');assert.equal(finalizeQuoteImport(result.rows,'sales',false)[0].price,12.5);
 assert.equal(parseQuoteImportRows([['名称','规格型号','数量','单位'],['铰链','A',2,'只']],{catalogPrices:true}).rows.length,1);
 assert.equal(quoteImportTemplate(true),'\uFEFF名称,规格型号,数量,单位\r\n,,,\r\n');
});
test('同名型号消歧、缺配置和不同单位按0元加入不猜价；只读销售价且保留零',()=>{
 const row=parseQuoteImportRows([['名称','规格型号','数量','单位'],[' 铰链 ','B',2,'只']],{catalogPrices:true}).rows[0];
 const material=(model,price,extra={})=>({name:'铰链',model,unit:'只',expense_category:'五金费用',sale_price:price,...extra});
 assert.equal(hardwareCatalogRow(row,[material('A',100),material('B',0)]).price,0);
 for(const result of [hardwareCatalogRow({...row,model:''},[material('A',100),material('B',200)]),hardwareCatalogRow(row,[material('B',200,{deleted:true}),material('B',300,{expense_category:'材料费用'})]),hardwareCatalogRow(row,[material('B',200,{unit:'米'})])]) {
   assert.equal(result.price,0);assert.match(result.issues[0],/按 0 元加入/);
 }
 assert.equal(finalizeQuoteImport([hardwareCatalogRow(row,[])],'sales',false)[0].price,0);
});


test('按配置名称识别带花色规格的五金、通用铰链和别名，价格只取销售价',()=>{
 const base=parseQuoteImportRows([['名称','规格型号','数量','单位'],['待填','',4,'个']],{catalogPrices:true}).rows[0];
 const materials=[{name:'铰链（所有名称含铰链的材料）',model:'',unit:'个',expense_category:'五金费用',sale_price:600,purchase_price:200},{name:'新款层板托',model:'',unit:'个',expense_category:'五金费用',sale_price:150},{name:'三合一',model:'',unit:'个',expense_category:'五金费用',sale_price:50}];
 for(const [name,price] of [['银色铝门直铰链',6],['新款层板托 枪灰色12mm',1.5],['新款12mm三合一',0.5]]){const result=hardwareCatalogRow({...base,name},materials);assert.equal(result.price,price);assert.equal(result.name,name);assert.match(result.issues[0],/五金配置/);}
 assert.equal(hardwareCatalogRow({...base,name:'不存在的圆弧板'},materials).price,0);
 assert.equal(hardwareCatalogRow({...base,name:'250mm三节轨',unit:'付'},[{name:'250mm三节抽／三节轨',model:'',unit:'付',expense_category:'五金费用',sale_price:2000}]).price,20);
 assert.equal(hardwareCatalogRow({...base,name:'300mm三节轨',unit:'付'},[{name:'250mm三节抽／三节轨',model:'',unit:'付',expense_category:'五金费用',sale_price:2000}]).price,0);
});
