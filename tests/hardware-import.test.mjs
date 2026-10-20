import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import XLSX from 'xlsx';
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const {parseHardwareRows,hardwareImportInput,markHardwareDuplicates}=await import(url(compile(readFileSync('lib/hardware-import.ts','utf8'))));
test('分段料单只读取五金、铝材和封边；空价格与数量保留',()=>{
 const rows=parseHardwareRows([['1.成品五金'],['序号','类别','名称','编码','规格','','单位','数量','单价'],[1,'成品五金','铰链','001','35mm','','个',6,''],['小计','','','','','','',6],['2.木板'],['名称','单位','数量'],['木板','张',8],['3.封边材料'],['名称','单位','数量'],['封边','米',24.7]],'测试.xlsx');
 assert.deepEqual(rows.map(r=>r.name),['铰链','封边']);
 const input=hardwareImportInput(rows[0],'purchase_price');assert.equal(input.expense_category,'五金费用');assert.equal(input.purchase_price,0);assert.match(input.note,/清单数量：6 个/);assert.match(input.note,/价格待补充/);
 rows[0].price='12.35';assert.equal(hardwareImportInput(rows[0],'sale_price').sale_price,12.35);
 rows[0].price='abc';assert.throws(()=>hardwareImportInput(rows[0],'purchase_price'));
});
test('同编码或同名称规格单位标记重复，源内重复也跳过',()=>{
 const rows=parseHardwareRows([['名称','编码','单位'],['铰链','a','个'],['铰链','b','个'],['拉手','x','个']],'测试');
 const marked=markHardwareDuplicates(rows,[{name:'已有拉手',code:'x',model:'',unit:'个'}]);assert.deepEqual(marked.map(r=>r.selected),[true,false,false]);
});
test('实际全部料单可以识别，不写入用户业务数据',t=>{
 const root=path.resolve('..');let files=0,items=0;
 for(const dir of readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()&&!d.name.startsWith('.'))) for(const name of readdirSync(path.join(root,dir.name)).filter(n=>n.endsWith('全部料单.xlsx'))) {
  const book=XLSX.readFile(path.join(root,dir.name,name));
  for(const sheet of book.SheetNames) {const rows=parseHardwareRows(XLSX.utils.sheet_to_json(book.Sheets[sheet],{header:1,defval:'',raw:true,range:0}),name);rows.forEach(r=>hardwareImportInput(r,'purchase_price'));items+=rows.length;}
  files++;
 }
 if (!files) {t.skip('当前环境没有本地料单');return;} assert.equal(files,9);assert.ok(items>0);console.log(`实际料单验证：${files}份，${items}条明细`);
});
