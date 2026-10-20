import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inflateSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import test from 'node:test';
import ts from 'typescript';
import {PDFDocument} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import 'tesseract.js'; // Resolve its Node environment before adding the canvas document adapter.
import CFB from 'cfb';

// This executes the real reader with Node-only PDF canvas/OCR adapters. It does
// not claim to exercise browser workers or create any business records.
const pdfPackageEntry=import.meta.resolve('pdfjs-dist');
const pdfEntry=pdfPackageEntry.replace('/build/pdf.mjs','/legacy/build/pdf.mjs');
const canvasRequire=createRequire(pdfEntry);
const {createCanvas,DOMMatrix,ImageData,Path2D,GlobalFonts}=canvasRequire('@napi-rs/canvas');
Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,document:{createElement(name){assert.equal(name,'canvas');return createCanvas(1,1);}}});
GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc','Fixture CJK');
// Node has no DOMParser. The DOCX adapter uses Python's standard XML parser,
// preserving the tree/namespace operations consumed by the actual reader.
const python=join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const parseXml=`import sys,json,xml.etree.ElementTree as ET
def node(e):
 return {'tag':e.tag,'text':''.join(e.itertext()),'children':[node(c) for c in e]}
try: print(json.dumps(node(ET.fromstring(sys.stdin.buffer.read())),ensure_ascii=False))
except ET.ParseError: print(json.dumps({'error':True}))`;
class XmlNode{
 constructor(value){this.localName=value.tag?.split('}').at(-1);this.textContent=value.text||'';this.children=(value.children||[]).map(child=>new XmlNode(child));}
 getElementsByTagName(name){const localName=name.split(':').at(-1);return this.children.flatMap(child=>[...(child.localName===localName?[child]:[]),...child.getElementsByTagName(name)]);}
 querySelector(name){return name==='parsererror'&&this.error?this:null;}
}
globalThis.DOMParser=class{parseFromString(xml){const value=JSON.parse(execFileSync(python,['-X','utf8','-c',parseXml],{input:xml,encoding:'utf8'}));const document=new XmlNode(value);document.error=!!value.error;return document;}};
const output=resolve('outputs/document-scan/pdf');
const cache=resolve('.sites-runtime/ocr-full-test-cache');
mkdirSync(output,{recursive:true});mkdirSync(cache,{recursive:true});
const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const parserUrl=url(compile('lib/document-import.ts'));
const ocrUrl=url(compile('lib/document-ocr.ts'));
const parsers=await import(parserUrl);
const ocrAdapter=url(`
 import {createWorker as realWorker,OEM} from ${JSON.stringify(import.meta.resolve('tesseract.js'))};
 import {writeFileSync} from 'node:fs';
 export {OEM};
 export async function createWorker(language,engine,options){
  const worker=await realWorker(language,engine,{langPath:${JSON.stringify(resolve('public/assets/document-ocr/languages/full'))},cachePath:${JSON.stringify(cache)},gzip:true,logger:options.logger});
  const recognize=worker.recognize.bind(worker);
  worker.recognize=(canvas,...arguments_)=>{const png=canvas.toBuffer('image/png');writeFileSync(${JSON.stringify(join(output,'rendered-scanned-page.png'))},png);return recognize(png,...arguments_);};
  return worker;
 }
`);
const worker=pathToFileURL(join(dirname(fileURLToPath(pdfEntry)),'pdf.worker.mjs')).href;
const reader=await import(url(compile('lib/document-scan.ts')
 .replace("from './document-import'",`from '${parserUrl}'`)
 .replace("from './document-ocr'",`from '${ocrUrl}'`)
 .replaceAll("import('pdfjs-dist')",`import('${pdfEntry}')`)
 .replaceAll("import('tesseract.js')",`import('${ocrAdapter}')`)
 .replace(/pdfjs\.GlobalWorkerOptions\.workerSrc\s*=\s*ROOT\s*\+\s*'\/pdf\/pdf\.worker\.min\.mjs'/,`pdfjs.GlobalWorkerOptions.workerSrc=${JSON.stringify(worker)}`)
 .replaceAll("import('xlsx')",`import('${import.meta.resolve('xlsx')}')`)
 .replaceAll("import('cfb')",`import('${import.meta.resolve('cfb')}')`)));
const options={mode:'purchase',defaultCategory:'材料费用'};
const matrix=[['材料名称','规格型号','单位','数量','单价','金额'],['板材','18mm','张','10','120.00','1200.00'],['铰链','304','只','24','5.50','132.00']];
const positions=[20,175,365,445,545,665];
let fontBytes;
function bundledFont(){if(!fontBytes){const base64=readFileSync('assets/fonts/contract-cjk-font.ts','utf8').match(/CONTRACT_CJK_FONT_BASE64='([^']+)'/)[1];fontBytes=inflateSync(Buffer.from(base64,'base64'));}return fontBytes;}
async function fixturePdf(scanned=false,pages=1){
 const pdf=await PDFDocument.create();let image,font;
 if(scanned){const canvas=createCanvas(1600,470),context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,1600,470);context.fillStyle='#000';context.font='36px "Fixture CJK"';for(const [row,values] of matrix.entries())for(const [index,text] of values.entries())context.fillText(text,positions[index]*2,105+row*130);const png=canvas.toBuffer('image/png');writeFileSync(join(output,'fictional-scan-source.png'),png);image=await pdf.embedPng(png);}
 else{pdf.registerFontkit(fontkit);font=await pdf.embedFont(bundledFont(),{subset:true});}
 for(let pageIndex=0;pageIndex<pages;pageIndex++){const page=pdf.addPage([800,235]);if(image)page.drawImage(image,{x:0,y:0,width:800,height:235});else for(const [row,values] of matrix.entries())for(const [index,text] of values.entries())page.drawText(text,{x:positions[index],y:182-row*65,size:18,font});}
 return pdf.save();
}
function assertTable(preview,{scanned=false}={}){
 assert.equal(preview.rows.length,2,JSON.stringify(preview));
 const board=preview.rows.find(row=>row.name.replace(/\s/g,'')==='板材'),hinge=preview.rows.find(row=>row.model==='304');assert.ok(board,JSON.stringify(preview));assert.ok(hinge,JSON.stringify(preview));
 assert.equal(board.model,'18mm');assert.equal(board.unit,'张');assert.equal(board.quantity,'10');assert.equal(board.price,'120');assert.equal(board.sourceAmount,'1200');
 assert.equal(hinge.unit,'只');assert.equal(hinge.quantity,'24');assert.equal(hinge.price,'5.5');assert.equal(hinge.sourceAmount,'132');assert.ok(hinge.name.trim());
 if(!scanned)assert.equal(hinge.name,'铰链');
 assert.ok(preview.rows.every(row=>row.source.includes('第1页')));assert.deepEqual(parsers.validateDocumentImportRows(preview.rows,'purchase'),[]);
}

test('real Chinese text PDF is read through PDF.js geometry into two valid rows without OCR',async()=>{
 const bytes=await fixturePdf();writeFileSync(join(output,'fictional-text-table.pdf'),bytes);const progress=[];
 const preview=await reader.readDocumentFiles([new File([bytes],'虚构文字报价.pdf')],{...options,onProgress:(message,value)=>progress.push([message,value])});assertTable(preview);assert.ok(!preview.warnings.some(value=>value.includes('图片识别结果')));assert.equal(progress.at(-1)[1],100);writeFileSync(join(output,'text-preview.json'),JSON.stringify(preview,null,2));
});
test('real scanned PDF is rendered by PDF.js and recognized by the local Chinese Tesseract worker',async()=>{
 const bytes=await fixturePdf(true);writeFileSync(join(output,'fictional-scanned-table.pdf'),bytes);const progress=[];
 const preview=await reader.readDocumentFiles([new File([bytes],'虚构扫描采购.pdf')],{...options,onProgress:(message,value)=>progress.push([message,value])});assertTable(preview,{scanned:true});assert.ok(preview.warnings.some(value=>value.includes('图片识别结果')));assert.ok(progress.some(([message])=>message.includes('正在识别')));assert.equal(progress.at(-1)[1],100);writeFileSync(join(output,'scanned-preview.json'),JSON.stringify(preview,null,2));
});
test('real eleven-page PDF is rejected before any page rendering or OCR',async()=>{
 const bytes=await fixturePdf(false,11);await assert.rejects(reader.readDocumentFiles([new File([bytes],'虚构超页数.pdf')],options),/最多识别 10 页/);
});
function fixtureDocx(documentXml){
 const zip=CFB.utils.cfb_new();
 CFB.utils.cfb_add(zip,'[Content_Types].xml',Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'));
 CFB.utils.cfb_add(zip,'_rels/.rels',Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'));
 if(documentXml!==undefined)CFB.utils.cfb_add(zip,'word/document.xml',Buffer.from(documentXml));
 return new Uint8Array(CFB.write(zip,{type:'array',fileType:'zip'}));
}
test('real DOCX ZIP and XML table run through the reader with the Node XML tree adapter',async()=>{
 const table=matrix.map(row=>'<w:tr>'+row.map(text=>'<w:tc><w:p><w:r><w:t>'+text.slice(0,1)+'</w:t></w:r><w:r><w:t>'+text.slice(1)+'</w:t></w:r></w:p></w:tc>').join('')+'</w:tr>').join('');
 const bytes=fixtureDocx('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>'+table+'</w:tbl></w:body></w:document>');writeFileSync(join(output,'fictional-table.docx'),bytes);
 const preview=await reader.readDocumentFiles([new File([bytes],'虚构Word采购.docx')],options);assert.equal(preview.rows.length,2);assert.deepEqual(preview.rows.map(row=>[row.name,row.model,row.unit,row.quantity,row.price,row.sourceAmount]),[['板材','18mm','张','10','120','1200'],['铰链','304','只','24','5.5','132']]);assert.ok(preview.rows.every(row=>row.source.includes('表格1')));assert.deepEqual(parsers.validateDocumentImportRows(preview.rows,'purchase'),[]);writeFileSync(join(output,'docx-preview.json'),JSON.stringify(preview,null,2));
});
test('real DOCX archives with missing or malformed XML body are rejected clearly',async()=>{
 await assert.rejects(reader.readDocumentFiles([new File([fixtureDocx(undefined)],'缺正文.docx')],options),/缺少正文/);
 await assert.rejects(reader.readDocumentFiles([new File([fixtureDocx('<broken>')],'损坏正文.docx')],options),/内容损坏/);
});
