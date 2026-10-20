import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import XLSX from 'xlsx';

const compile = source => ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const quotesURL = url(compile(readFileSync('lib/quotes.ts', 'utf8')));
const exportURL = url(compile(readFileSync('lib/quote-export.ts', 'utf8')).replace("from './quotes'", `from '${quotesURL}'`).replaceAll("import('xlsx')", `import('${import.meta.resolve('xlsx')}')`));
const {buildQuoteExportSheets, createQuoteWorkbook, createQuoteExcelBytes, quoteExcelFileName, downloadQuoteExcel,getQuoteSettlement} = await import(exportURL);
function fixture() {return {
  project: {id:'offline-project',name:'匿名父项目',customer:'匿名客户',phone:'000',address:'匿名地址'}, companyName:'匿名公司',
  quote: {id:'offline-quote',subproject_name:'匿名小项目',title:'第二版',created:'2026-10-11T23:30:00Z',adopted:true,total:7802,note:'原样备注',items:[
    {name:'匿名人工',category:'人工费用',model:'',unit:'张',quantity:2,price:10.005,note:'人工备注'},
    {name:'匿名材料',category:'材料费用',model:'A',unit:'张',quantity:1.5,price:25,note:'材料备注'},
    {name:'匿名五金',category:'五金费用',model:'B',unit:'个',quantity:2,price:10.25,note:'五金备注'},
  ]},
};}

test('one template statement groups all categories and reconciles saved totals without mutation',()=>{
 const input=fixture(),before=JSON.stringify(input),sheets=buildQuoteExportSheets(input),s=sheets[0];
 assert.equal(sheets.length,1);assert.deepEqual(s.rows[2],['编号','项目','规格型号','单位','数量','单价','金额','上传附件']);
 assert.equal(s.rows[s.totalRow][6],78.02);assert.deepEqual(s.sectionRows.slice(0,3).map(r=>s.rows[r][0]),['人工费用','材料费用','五金费用']);
 assert.deepEqual(s.sectionRows.slice(0,3).map(r=>s.rows[r][6]),[20.02,37.5,20.5]);assert.equal(JSON.stringify(input),before);
});
test('empty expense sections disappear, legacy lines remain materials',()=>{
 const input=fixture();input.quote.items=[{name:'旧明细',unit:'项',quantity:1,price:8}];input.quote.total=800;
 const s=buildQuoteExportSheets(input)[0];assert.deepEqual(s.sectionRows.map(r=>s.rows[r][0]),['材料费用','费用项']);assert.equal(s.rows[s.totalRow][6],8);
});
test('actual downloaded OOXML has template colors, numeric cells, borders, A4 pagination and repeating headings',async()=>{
 const bytes=await createQuoteExcelBytes(fixture()),saved=XLSX.read(bytes,{type:'buffer',cellStyles:true,cellNF:true}),zip=XLSX.CFB.read(bytes,{type:'buffer'}),xml=new TextDecoder().decode(XLSX.CFB.find(zip,'/xl/worksheets/sheet1.xml').content),styles=new TextDecoder().decode(XLSX.CFB.find(zip,'/xl/styles.xml').content);
 writeFileSync('outputs/quote-layout-check.xlsx',bytes);assert.equal(saved.SheetNames.length,1);assert.equal(saved.Sheets['报价清单'].F5.v,10.01);assert.equal(saved.Sheets['报价清单'].G5.v,20.02);assert.equal(saved.Sheets['报价清单'].F5.z,'0.00');assert.equal(saved.Sheets['报价清单'].H3.v,'上传附件');
 assert.match(xml,/paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/);assert.match(xml,/pageSetUpPr fitToPage="1"/);assert.match(styles,/FF99CCFF/);assert.match(styles,/FFC0C0C0/);assert.match(styles,/FFFF5722/);assert.match(styles,/FFD9D9D9/);
 const feeRow=xml.match(/<row[^>]*>(?:(?!<\/row>).)*?费用项.*?<\/row>/s);assert.ok(feeRow,'费用项行存在');assert.match(feeRow[0],/s="7"/,'费用项行用黄底样式');
 assert.match(xml,/<c r="I3"[^>]*s="8"/,'表格右侧区域用浅灰线样式');assert.match(xml,/<c r="A19"[^>]*s="8"/,'表格底部区域用浅灰线样式');assert.match(xml,/<c r="B16"[^>]*s="10"/,'落款区单元格仍为浅灰边框');assert.match(xml,/<c r="A4"[^>]*s="3"/,'表体分类段保持灰底黑框');
 assert.equal(saved.Workbook.Names.find(n=>n.Name==='_xlnm.Print_Titles').Ref,"'报价清单'!$1:$3");assert.ok(xml.indexOf('<printOptions')<xml.indexOf('<pageMargins'));assert.ok(xml.indexOf('<pageSetup')<xml.indexOf('<ignoredErrors'));
});
test('formula-like names stay literal and inaccurate totals block download',async()=>{
 const input=fixture();input.quote.items[0].name='=1+1';const bytes=await createQuoteExcelBytes(input),s=XLSX.read(bytes,{type:'buffer'}).Sheets['报价清单'];assert.equal(s.B5.v,'=1+1');assert.equal(s.B5.f,undefined);
 input.quote.total++;assert.throws(()=>buildQuoteExportSheets(input),/合计与已保存总额不一致/);
});

const roomA='71000000-0000-4000-a000-000000000001',roomB='71000000-0000-4000-a000-000000000002',cabinetA='72000000-0000-4000-a000-000000000001',cabinetB='72000000-0000-4000-a000-000000000002',emptyCabinet='72000000-0000-4000-a000-000000000003';
function cabinetsFixture(){return {project:{id:'offline-customer',name:'匿名家庭',project_type:'customer'},companyName:'匿名公司',quote:{title:'整户版本',adopted:true,rooms:[{id:roomA,name:'主卧'},{id:roomB,name:'厨房'}],cabinets:[{id:cabinetB,room_id:roomB,name:'地柜'},{id:cabinetA,room_id:roomA,name:'衣柜'},{id:emptyCabinet,room_id:roomA,name:'待填柜'}],items:[{room_id:roomA,cabinet_id:cabinetA,name:'衣柜安装',category:'人工费用',quantity:2,price:10.005,unit:'项',note:'原备注'},{room_id:roomB,cabinet_id:cabinetB,name:'地柜板材',category:'材料费用',quantity:2,price:100,unit:'张'},{room_id:roomB,cabinet_id:cabinetB,name:'地柜拉手',category:'五金费用',quantity:3,price:1.5,unit:'个'},{room_id:roomA,name:'公共五金',category:'五金费用',quantity:1,price:50,unit:'项'}],total:27452}};}
test('柜体Excel按房间柜体类别分组，保留空柜体与公共明细且小计精确',async()=>{
 const input=cabinetsFixture(),before=JSON.stringify(input),sheet=buildQuoteExportSheets(input)[0],sections=sheet.sectionRows.map(r=>sheet.rows[r][0]);
 assert.deepEqual(sections.filter(label=>label.startsWith('空间：')||label.startsWith('柜体：')||label==='公共明细'),['空间：主卧','公共明细','柜体：衣柜','柜体：待填柜','空间：厨房','柜体：地柜']);
 assert.deepEqual(sheet.subtotalRows.map(r=>[sheet.rows[r][0],sheet.rows[r][6]]),[['衣柜柜体小计',20.02],['待填柜柜体小计',0],['主卧小计',70.02],['地柜柜体小计',204.5],['厨房小计',204.5],['报价合计',274.52]]);assert.equal(JSON.stringify(input),before);
 const book=XLSX.read(await createQuoteExcelBytes(input),{type:'buffer'}),rows=XLSX.utils.sheet_to_json(book.Sheets['报价清单'],{header:1});assert.equal(rows.find(row=>row[0]==='待填柜柜体小计')[6],0);assert.equal(rows.find(row=>row[1]==='衣柜安装')[6],20.02);assert.equal(rows.filter(row=>typeof row[0]==='number').length,4);
});
test('导出拒绝孤儿柜体、无效明细柜体、重复柜体及跨房间归属，完整性检查仍优先',()=>{
 let input=cabinetsFixture();input.quote.cabinets[0].room_id=emptyCabinet;assert.throws(()=>buildQuoteExportSheets(input),/柜体未关联有效房间/);
 input=cabinetsFixture();input.quote.items[0].cabinet_id=emptyCabinet;input.quote.cabinets=input.quote.cabinets.filter(c=>c.id!==emptyCabinet);assert.throws(()=>buildQuoteExportSheets(input),/明细未关联有效柜体/);
 input=cabinetsFixture();input.quote.items[0].cabinet_id=cabinetB;assert.throws(()=>buildQuoteExportSheets(input),/所属房间不一致/);
 input=cabinetsFixture();input.quote.cabinets.push({...input.quote.cabinets[0]});assert.throws(()=>buildQuoteExportSheets(input),/柜体信息无效/);
 input=cabinetsFixture();input.quote.total++;assert.throws(()=>buildQuoteExportSheets(input),/合计与已保存总额不一致/);
});
test('采纳整户导出显示原报价优惠抹零应收，草稿及普通项目不借用结算',()=>{
 const input=cabinetsFixture();Object.assign(input.project,{discount_amount:300,rounding_amount:2,receivable:27150});const sheet=buildQuoteExportSheets(input)[0];
 assert.equal(sheet.rows[sheet.totalRow][6],274.52);assert.deepEqual(sheet.rows.filter(row=>['原报价','优惠','抹零','应收金额'].includes(row[0])).map(row=>[row[0],row[6]]),[['原报价',274.52],['优惠',3],['抹零',0.02],['应收金额',271.5]]);
 input.quote.adopted=false;assert.equal(buildQuoteExportSheets(input)[0].rows.some(row=>row[0]==='应收金额'),false);input.quote.adopted=true;input.project.project_type='project';assert.equal(buildQuoteExportSheets(input)[0].rows.some(row=>row[0]==='应收金额'),false);
 assert.deepEqual(getQuoteSettlement(100,{adopted:true,discount_amount:100,rounding_amount:0,receivable:0}),{gross:100,discount:100,rounding:0,receivable:0});assert.equal(getQuoteSettlement(100,{adopted:false,discount_amount:200}),null);assert.throws(()=>getQuoteSettlement(100,{adopted:true,discount_amount:101}),/结算金额无效/);assert.throws(()=>getQuoteSettlement(100,{adopted:true,discount_amount:1,receivable:100}),/结算金额无效/);
});

test('新房间报价四类并列导出，柜体普通行逐项取分与整户折让精确一致',async()=>{
 const input={project:{id:'offline-customer',name:'匿名客户',project_type:'customer',discount_amount:10000,rounding_amount:2,receivable:109000},companyName:'匿名公司',quote:{title:'四类整户报价',adopted:true,rooms:[{id:roomA,name:'主卧'},{id:roomB,name:'空厨房'}],items:[
  {room_id:roomA,name:'衣柜',category:'柜体',model:'原型号',quantity:2.35,price:480,unit:'㎡',note:'原柜体价格'},
  {room_id:roomA,name:'安装',category:'人工费用',quantity:2,price:10.005,unit:'项'},
  {room_id:roomA,name:'补充板材',category:'材料费用',quantity:1.5,price:25,unit:'张'},
  {room_id:roomA,name:'铰链',category:'五金费用',quantity:3,price:1.5,unit:'只'},
 ],total:119002}};
 const before=JSON.stringify(input),sheet=buildQuoteExportSheets(input)[0];
 assert.deepEqual(sheet.sectionRows.map(index=>sheet.rows[index][0]),['空间：主卧','柜体','人工费用','材料费用','五金费用','空间：空厨房','费用项']);
 assert.deepEqual(sheet.rows.filter(row=>['柜体','人工费用','材料费用','五金费用'].includes(row[0])).map(row=>[row[0],row[6]]),[['柜体',1128],['人工费用',20.02],['材料费用',37.5],['五金费用',4.5]]);
 assert.deepEqual(sheet.subtotalRows.map(index=>[sheet.rows[index][0],sheet.rows[index][6]]),[['主卧小计',1190.02],['空厨房小计',0],['报价合计',1190.02],['原报价',1190.02],['优惠',100],['抹零',.02],['应收金额',1090]]);
 const saved=XLSX.read(await createQuoteExcelBytes(input),{type:'buffer'}),rows=XLSX.utils.sheet_to_json(saved.Sheets['报价清单'],{header:1});
 assert.deepEqual(rows.filter(row=>typeof row[0]==='number').map(row=>[row[1],row[5],row[6]]),[['衣柜',480,1128],['安装',10.01,20.02],['补充板材',25,37.5],['铰链',1.5,4.5]]);
 assert.equal(rows.find(row=>row[1]==='衣柜')[2],'原型号');
 assert.equal(JSON.stringify(input),before);input.quote.total++;assert.throws(()=>buildQuoteExportSheets(input),/合计与已保存总额不一致/);
});

test('旧柜体分组元数据下仍包含新增柜体类别的全部行，兼容小计与原价',()=>{
 const input=cabinetsFixture();input.quote.items.unshift({room_id:roomA,cabinet_id:cabinetA,name:'旧柜体成品价',category:'柜体',quantity:1.5,price:480,unit:'㎡',note:'历史价格'});input.quote.total+=72000;
 const sheet=buildQuoteExportSheets(input)[0];
 assert.deepEqual(sheet.rows.find(row=>row[1]==='旧柜体成品价').slice(3,7),['㎡',1.5,480,720]);
 assert.equal(sheet.rows.filter(row=>typeof row[0]==='number').length,5);assert.equal(sheet.rows.find(row=>row[0]==='衣柜柜体小计')[6],740.02);assert.equal(sheet.rows[sheet.totalRow][6],994.52);
});

