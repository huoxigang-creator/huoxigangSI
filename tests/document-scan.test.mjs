import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as XLSX from 'xlsx';
import CFB from 'cfb';
import {createWorker,OEM} from 'tesseract.js';
import {mkdirSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const parserUrl=url(compile('lib/document-import.ts'));
const ocrUrl=url(compile('lib/document-ocr.ts'));
const parsers=await import(parserUrl);
const {documentOcrWords}=await import(ocrUrl);
const reader=await import(url(compile('lib/document-scan.ts').replace("from './drawing-import'",`from '${url(compile('lib/drawing-import.ts'))}'`).replace("from './document-import'",`from '${parserUrl}'`).replace("from './document-ocr'",`from '${ocrUrl}'`).replaceAll("import('xlsx')",`import('${import.meta.resolve('xlsx')}')`).replaceAll("import('cfb')",`import('${import.meta.resolve('cfb')}')`)));
const options={mode:'purchase',defaultCategory:'材料费用'};
const file=(name,text,type='text/plain')=>new File([text],name,{type});

test('document reader handles actual CSV/Excel/TSV without fetching images or saving records',async()=>{
 const matrix=[['材料名称','规格型号','品牌','编码','单位','数量','采购单价','金额','批次'],['板材','18mm','示例品牌','TEST-001','张',10,120,1200,'测试批次']];
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(matrix),'明细');
 const csv=file('隔离样例.csv',XLSX.utils.sheet_to_csv(book.Sheets['明细'])),excel=new File([XLSX.write(book,{type:'array',bookType:'xlsx'})],'隔离样例.xlsx'),tsv=file('隔离样例.tsv',matrix.map(row=>row.join('\t')).join('\n'));
 const progress=[];const result=await reader.readDocumentFiles([csv,excel,tsv],{...options,onProgress:(message,value)=>progress.push([message,value])});
 assert.equal(result.rows.length,3);assert.equal(result.priceKind,'cost');for(const row of result.rows){assert.equal(row.name,'板材');assert.equal(row.price,'120');assert.equal(row.quantity,'10');assert.equal(row.brand,'示例品牌');assert.equal(row.code,'TEST-001');assert.equal(row.batch,'测试批次');}
 assert.ok(result.warnings.some(value=>value.includes('内容相同')));assert.equal(progress.at(-1)[1],100);assert.ok(progress.every(([,value])=>value>=0&&value<=100));
 assert.deepEqual(parsers.validateDocumentImportRows(result.rows,'purchase'),[]);
});
test('reader rejects invalid formats, empty and oversized batches before parsing, and respects abort',async()=>{
 for(const files of [[],Array.from({length:6},()=>file('x.csv','a')), [file('x.exe','a')],[file('x.csv','')],[file('x.png',new Uint8Array(10*1024*1024+1))]])assert.throws(()=>reader.validateDocumentFiles(files));
 const controller=new AbortController();controller.abort();await assert.rejects(reader.readDocumentFiles([file('x.csv','name,quantity,price\nx,1,2')],{...options,signal:controller.signal}),error=>error.name==='AbortError');
});
test('incomplete formula cache is blocked and missing literal prices stay empty',async()=>{
 const matrix=[['名称','单位','数量','单价'],['板材','张',10,'']];const result=await reader.readDocumentFiles([file('x.csv',matrix.map(row=>row.join(',')).join('\n'))],options);assert.equal(result.rows[0].price,'');assert.ok(parsers.validateDocumentImportRows(result.rows,'purchase').some(value=>value.includes('单价')));
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(matrix);sheet.D2={f:'SUM(D3:D4)',t:'n'};XLSX.utils.book_append_sheet(book,sheet,'明细');
 const zip=CFB.read(new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'})),{type:'array'}),entry=CFB.find(zip,'/xl/worksheets/sheet1.xml'),xml=Buffer.from(entry.content).toString('utf8'),uncalculated=xml.replace(/(<c\b[^>]*\br="D2"[\s\S]*?<\/f>)<v>[\s\S]*?<\/v>/,'$1');assert.match(uncalculated,/<f>SUM/);assert.doesNotMatch(uncalculated,/<f>SUM[\s\S]*?<v>/);entry.content=Buffer.from(uncalculated);entry.size=entry.content.length;
 await assert.rejects(reader.readDocumentFiles([new File([new Uint8Array(CFB.write(zip,{type:'array',fileType:'zip'}))],'formula.xlsx')],options),/公式|计算/);
});
test('mixed cost and sales input still requires cost-price acknowledgement in quote preview',()=>{
 const source=[['名称','单位','数量','单价'],['铰链','只',2,5]],one=parsers.parseDocumentTable(source,{...options,source:'成本样例'}),two=parsers.parseDocumentTable(source,{...options,source:'销售样例'});one.priceKind='cost';two.priceKind='sales';const result=reader.mergeDocumentPreviews([one,two]);assert.equal(result.priceKind,'cost');assert.ok(result.warnings.some(value=>value.includes('单价用途不同')));
});
test('expanded archive size is bounded independently of compressed upload length',()=>{
 assert.doesNotThrow(()=>reader.validateDocumentArchive(new Uint8Array([1,2,3])));
 // A fake ZIP header plus oversized central-directory entry is rejected before XLSX parsing.
 const malicious=new Uint8Array(50);malicious.set([80,75,3,4]);const metadata=new DataView(malicious.buffer);metadata.setUint32(4,0x02014b50,true);metadata.setUint32(28,65*1024*1024,true);assert.throws(()=>reader.validateDocumentArchive(malicious),/解压后过大/);
});
test('self-hosted Chinese OCR actually recognizes fictional image quantities and prices',async t=>{
 const python=join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');if(!existsSync(python)){t.skip('Python renderer unavailable');return;}
 mkdirSync('outputs/document-scan',{recursive:true});mkdirSync('.sites-runtime/ocr-full-test-cache',{recursive:true});const imagePath=resolve('outputs/document-scan/识别样例.png');execFileSync(python,['-X','utf8','tests/fixtures/create-document-scan-demo.py',imagePath]);
 const worker=await createWorker('chi_sim',OEM.LSTM_ONLY,{langPath:resolve('public/assets/document-ocr/languages/full'),cachePath:resolve('.sites-runtime/ocr-full-test-cache'),gzip:true});t.after(()=>worker.terminate());
 const result=await worker.recognize(imagePath,{}, {text:true,blocks:true});const words=documentOcrWords(result.data.blocks);
 const preview=parsers.parseDocumentWords(words,{...options,source:'隔离 OCR 样例'});assert.equal(preview.rows.length,2,JSON.stringify(preview));const board=preview.rows.find(row=>row.name.replace(/\s/g,'')==='板材'),hinge=preview.rows.find(row=>row.model==='304');assert.ok(board,result.data.text);assert.ok(hinge,result.data.text);assert.equal(board.model,'18mm');assert.equal(board.unit,'张');assert.equal(board.quantity,'10');assert.equal(board.price,'120');assert.equal(hinge.name.replace(/\s/g,''),'铰链');assert.equal(hinge.unit,'只');assert.equal(hinge.quantity,'24');assert.equal(hinge.price,'5.5');assert.deepEqual(parsers.validateDocumentImportRows(preview.rows,'purchase'),[]);
});

test('actual four-column screenshot imports name specification quantity and unit while price stays blank',async()=>{
 const python=join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
 const imagePath=resolve('outputs/document-scan/四栏截图样例.png');execFileSync(python,['-X','utf8','tests/fixtures/create-document-columns-demo.py',imagePath]);
 const worker=await createWorker('chi_sim',OEM.LSTM_ONLY,{langPath:resolve('public/assets/document-ocr/languages/full'),cachePath:resolve('.sites-runtime/ocr-full-test-cache'),gzip:true});
 try{const result=await worker.recognize(imagePath,{}, {text:true,blocks:true}),preview=parsers.parseDocumentWords(documentOcrWords(result.data.blocks),{...options,source:'四栏截图样例'});
 assert.deepEqual(preview.rows.map(row=>[row.name.replace(/\s/g,''),row.model,row.quantity,row.unit,row.price]),[['板材','18mm','10','张',''],['铰链','304','24','只','']]);
 assert.deepEqual(parsers.validateDocumentImportRows(preview.rows,'quote',{allowMissingPrice:true}),[]);assert.ok(preview.tables?.length);
 }finally{await worker.terminate();}
});
