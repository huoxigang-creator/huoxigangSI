import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const quotes=url(compile('lib/quotes.ts')),exportUrl=url(compile('lib/quote-export.ts').replace("from './quotes'",`from '${quotes}'`));
const {buildQuoteExportSheets}=await import(exportUrl);
const {confirmationLayout,confirmationSvg}=await import(url(compile('lib/quote-confirmation-document.ts').replace("from './quote-export'",`from '${exportUrl}'`)));
for(const price of [450,500,12345678.9])test(`confirmation money ${price} remains one line including subtotals and totals`,()=>{
 const [sheet]=buildQuoteExportSheets({companyName:'离线测试公司',project:{id:'p',name:'样例',project_type:'customer'},quote:{title:'离线样例',rooms:[{id:'room',name:'阳台'}],items:[{name:'洗衣机柜',category:'柜体',room_id:'room',unit:'㎡',quantity:1.18,price}],total:Math.round(1.18*Math.round(price*100))}});
 const before=JSON.stringify(sheet),layout=confirmationLayout(sheet);let money=0;
 layout.rows.forEach((row,r)=>{for(const cell of row.cells){assert.ok(Number.isFinite(cell.x+cell.width));if(cell.color==='#ff5722'){money++;assert.equal(cell.lines.length,1);assert.equal(cell.lines[0],cell.text);assert.ok(cell.text.length*cell.fontSize*.55<=cell.width-12);}}});
 assert.ok(money>=4);assert.equal(JSON.stringify(sheet),before);assert.ok(!confirmationSvg(sheet).includes('NaN'));
});
