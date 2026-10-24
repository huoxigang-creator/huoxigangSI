import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import ts from 'typescript';
import {PDFDocument} from 'pdf-lib';
const compile=p=>ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const source=compile('lib/drawing-review-pdf.ts').replace("from 'pdf-lib'",`from '${import.meta.resolve('pdf-lib')}'`).replace("from '@pdf-lib/fontkit'",`from '${import.meta.resolve('@pdf-lib/fontkit')}'`).replace("from '../assets/fonts/contract-cjk-font'",`from '${url(compile('assets/fonts/contract-cjk-font.ts'))}'`).replace("from './drawing-import'",`from '${url(compile('lib/drawing-import.ts'))}'`);
const {generateDrawingReviewPdf}=await import(url(source));
const python=process.env.PDF_TEST_PYTHON||join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
test('customer review PDF preserves edited area and meters, page-image pairing and includes unit price below each drawing',async()=>{
 const base={source:'合成测试.dxf',room:'厨房',name:'地柜',width:'5000',height:'',price:'1987654321',selected:true,note:'原标注4780mm'};
 const entries=[{row:Object.freeze(base),image:'cab-1'},{row:Object.freeze({...base,room:'主卧',name:'衣柜',width:'2000',height:'2400'}),image:'cab-2'}];
 const before=JSON.stringify(entries),loaded=[];
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cL1sAAAAASUVORK5CYII=','base64');
 const bytes=await generateDrawingReviewPdf(entries,async src=>{loaded.push(src);return png;});
 assert.deepEqual(loaded,['cab-1','cab-2']);assert.equal(JSON.stringify(entries),before);assert.equal((await PDFDocument.load(bytes)).getPageCount(),2);
 fs.mkdirSync('outputs/drawing-review-test',{recursive:true});const path='outputs/drawing-review-test/review.pdf';fs.writeFileSync(path,bytes);
 const pages=JSON.parse(execFileSync(python,['-X','utf8','-c',`from pypdf import PdfReader
import json,sys
r=PdfReader(sys.argv[1]);print(json.dumps([{'text':p.extract_text(),'images':len(p.images)} for p in r.pages],ensure_ascii=False))`,path],{encoding:'utf8'}));
 assert.match(pages[0].text,/5000/);assert.match(pages[0].text,/5.00 延米/);assert.match(pages[1].text,/4.80 ㎡/);assert.ok(pages.every(p=>p.images===1&&p.text.includes('1987654321')));assert.ok(!pages[0].text.includes('柜体合计'));assert.match(pages[1].text,/4.80 ㎡ \+ 5.00 延米/);assert.ok(pages[0].text.indexOf('来源文件')<pages[0].text.indexOf('当前数量'));assert.match(pages[0].text,/原标注4780mm/);assert.ok(pages.every(p=>!p.text.includes('客户核对')&&!p.text.includes('日期')));
});
test('no selection and broken image fail explicitly instead of exporting an incomplete sheet',async()=>{
 await assert.rejects(generateDrawingReviewPdf([],async()=>new Uint8Array()),/勾选/);
 await assert.rejects(generateDrawingReviewPdf([{row:{source:'a',room:'主卧',name:'衣柜',width:'2000',height:'2400',price:'',selected:true},image:'bad'}],async()=>{throw Error('bad');}),/第1个柜体图形读取失败/);
});

test('long cabinet information continues without truncation and totals remain on the final page',async()=>{
 const row={source:'测试.png',room:'主卧',name:'衣柜',width:'2000',height:'2400',price:'',selected:true,config:'配置详情'.repeat(700)+'末尾核验标记'};
 const bytes=await generateDrawingReviewPdf([{row}],async()=>{throw Error('unused');});
 const path='outputs/drawing-review-test/long.pdf';fs.writeFileSync(path,bytes);
 const pages=JSON.parse(execFileSync(python,['-X','utf8','-c',`import pdfplumber,json,sys
with pdfplumber.open(sys.argv[1]) as pdf:
 print(json.dumps([{'text':p.extract_text(),'within':all(15<=c['top'] and c['bottom']<=825 for c in p.chars)} for p in pdf.pages],ensure_ascii=False))`,path],{encoding:'utf8'}));
 assert.ok(pages.length>1);assert.ok(pages.every(p=>p.within));assert.ok(pages.at(-1).text.includes('末尾核验标记'));assert.ok(pages.slice(0,-1).every(p=>!p.text.includes('柜体合计')));assert.match(pages.at(-1).text,/4.80/);
});
