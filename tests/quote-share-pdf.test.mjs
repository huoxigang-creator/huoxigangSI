import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import {PDFDocument,PDFName,PDFDict,PDFRawStream} from 'pdf-lib';

const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const output='outputs/quote-share';mkdirSync(output,{recursive:true});
writeFileSync(output+'/quote-share-test-font.mjs',readFileSync('assets/fonts/contract-cjk-font.ts','utf8'));
const fontUrl=pathToFileURL(resolve(output+'/quote-share-test-font.mjs')).href;
const quotesUrl=url(compile('lib/quotes.ts'));
const {generateQuoteSharePdf}=await import(url(compile('lib/quote-share-pdf.ts').replaceAll("from 'pdf-lib'",`from '${import.meta.resolve('pdf-lib')}'`).replaceAll("from '@pdf-lib/fontkit'",`from '${import.meta.resolve('@pdf-lib/fontkit')}'`).replaceAll("from 'qrcode/lib/core/qrcode'",`from '${import.meta.resolve('qrcode/lib/core/qrcode.js')}'`).replaceAll("from '../assets/fonts/contract-cjk-font'",`from '${fontUrl}'`).replaceAll("from './quotes'",`from '${quotesUrl}'`)));
const python=process.env.QUOTE_SHARE_TEST_PYTHON||join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const room='room-1',emptyRoom='room-2';
function fixture(){return {company_name:'示例家具有限公司',project_name:'虚构整户项目',customer:'示例客户',title:'四类整户报价单',created:'2026-10-13T00:00:00.000Z',expires_at:'2026-10-20T15:59:59.000Z',rooms:[{id:room,name:'主卧室'},{id:emptyRoom,name:'空厨房'}],items:[{room_id:room,name:'衣柜',category:'柜体',model:'原规格',quantity:2.35,price:480,unit:'㎡',note:'禁止公开行备注CANARY'},{room_id:room,name:'安装',category:'人工费用',model:'',quantity:2,price:10.005,unit:'项'},{room_id:room,name:'补充板材',category:'材料费用',model:'',quantity:1.5,price:25,unit:'张'},{room_id:room,name:'铰链',category:'五金费用',model:'',quantity:3,price:1.5,unit:'只'}],total:119002,settlement:{gross:119002,discount:10000,rounding:2,receivable:109000},customer_note:'包含运输与安装，具体以最终确认方案为准。',collection:{name:'定金',amount:32700},share_url:'https://example.com/q/fictional-fixture',note:'禁止公开内部报价CANARY',phone:'禁止公开电话CANARY',address:'禁止公开地址CANARY',cost:123,profit:'禁止公开利润CANARY'};}
function freezeDeep(value){if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freezeDeep);}return value;}
function inspectPdf(path){return JSON.parse(execFileSync(python,['-X','utf8','-c',`import json,sys,pdfplumber
with pdfplumber.open(sys.argv[1]) as pdf:
 print(json.dumps([{'text':p.extract_text(layout=False),'width':p.width,'height':p.height,'chars':[{'text':c['text'],'x0':c['x0'],'x1':c['x1'],'top':c['top'],'bottom':c['bottom']} for c in p.chars],'images':[{key:image[key] for key in ['x0','x1','top','bottom','width','height','srcsize']} for image in p.images]} for p in pdf.pages],ensure_ascii=False))`,path],{encoding:'utf8',maxBuffer:20*1024*1024}));}

function embeddedImages(pdf){return pdf.getPages().flatMap(page=>{
 const images=page.node.Resources().lookupMaybe(PDFName.of('XObject'),PDFDict);if(!images)return[];
 return images.entries().map(([,ref])=>pdf.context.lookup(ref)).filter(stream=>stream instanceof PDFRawStream&&stream.dict.get(PDFName.of('Subtype'))?.toString()==='/Image').map(stream=>({width:Number(stream.dict.get(PDFName.of('Width'))?.toString()),height:Number(stream.dict.get(PDFName.of('Height'))?.toString()),filter:stream.dict.get(PDFName.of('Filter'))?.toString()}));
});}

let generated;
test('Chinese customer PDF uses saved cents, settlement and collection without reading internal data or mutating input',async()=>{
 const snapshot=freezeDeep(fixture()),before=JSON.stringify(snapshot);generated=await generateQuoteSharePdf(snapshot);
 assert.equal(JSON.stringify(snapshot),before);assert.ok(generated instanceof Uint8Array);assert.ok((await PDFDocument.load(generated)).getPageCount()>=1);
 writeFileSync(output+'/quote-share-fixture.pdf',generated);
});
test('actual PDF retains Chinese rooms and four categories, dates and exact saved prices, and excludes internal canaries',{skip:!existsSync(python)},()=>{
 assert.ok(generated);const pages=inspectPdf(output+'/quote-share-fixture.pdf'),flat=pages.map(page=>page.text).join('\n').replace(/\s/g,'');
 for(const term of ['示例家具有限公司','虚构整户项目','示例客户','主卧室','空厨房','暂无报价明细','柜体','人工费用','材料费用','五金费用','480.00','1,128.00','10.01','20.02','1,190.02','100.00','0.02','1,090.00','定金','327.00','包含运输与安装','2026-10-13','2026-10-20','北京时间','扫码查看此版报价与付款安排'])assert.ok(flat.includes(term),term);
 assert.equal(flat.includes('CANARY'),false);assert.equal(flat.includes('付款码'),false);
 for(const page of pages)for(const char of page.chars){assert.ok(char.x0>=43&&char.x1<=page.width-43,'text stays within page margins');assert.ok(char.top>=18&&char.bottom<=page.height-18,'text stays within vertical page margins');}
});
test('long rows and customer explanations paginate, preserving all content and avoiding clipping',async()=>{
 const snapshot=fixture();snapshot.items=[{room_id:'orphan-room',name:'超长明细'+('虚构规格描述'.repeat(340))+'末行标记',model:'保存规格',unit:'项',quantity:1,price:1190.02,category:'材料费用'}];snapshot.customer_note=Array.from({length:120},(_,index)=>'客户说明第'+index+'行：这是虚构的分页验收内容。').join('\n');
 const bytes=await generateQuoteSharePdf(snapshot),path=output+'/quote-share-pagination.pdf';writeFileSync(path,bytes);assert.ok((await PDFDocument.load(bytes)).getPageCount()>=5);
 if(existsSync(python)){const pages=inspectPdf(path),flat=pages.map(page=>page.text).join('\n').replace(/\s/g,'');for(const term of ['未分配空间','末行标记','客户说明第119行','定金','327.00'])assert.ok(flat.includes(term),term);const nameColumn=pages.slice(0,2).flatMap(page=>page.chars.filter(char=>char.x0>=76.9&&char.x1<=336.3&&char.top>96&&char.bottom<page.height-60)).map(char=>char.text).join('');assert.ok(nameColumn.includes(snapshot.items[0].name),'all source name characters survive long row pagination');for(const page of pages)for(const char of page.chars){assert.ok(char.x0>=43&&char.x1<=page.width-43);assert.ok(char.top>=18&&char.bottom<=page.height-18);}}
});
test('empty quotations have valid zero totals without inventing payment instructions',async()=>{
 const snapshot=fixture();snapshot.items=[];snapshot.total=0;snapshot.settlement=null;snapshot.collection=null;delete snapshot.share_url;
 const path=output+'/quote-share-empty.pdf';writeFileSync(path,await generateQuoteSharePdf(snapshot));
 if(existsSync(python)){const text=inspectPdf(path).map(page=>page.text).join('\n').replace(/\s/g,'');assert.ok(text.includes('空厨房'));assert.ok(text.includes('报价合计：0.00元'));assert.equal(text.includes('扫码'),false);assert.equal(text.includes('本次收款'),false);}
});
test('financial mismatches, duplicate rooms, unsupported fonts and unsafe share URLs reject generation',async()=>{
 for(const mutate of [snapshot=>snapshot.total++,snapshot=>snapshot.items[0].quantity=0,snapshot=>snapshot.items[0].price=-1,snapshot=>snapshot.settlement.receivable++,snapshot=>snapshot.settlement.gross++,snapshot=>snapshot.collection.amount=109001,snapshot=>snapshot.rooms.push({...snapshot.rooms[0]}),snapshot=>snapshot.share_url='http://example.com/q/test']){const snapshot=fixture();mutate(snapshot);await assert.rejects(generateQuoteSharePdf(snapshot),/金额|数量|合计|房间|HTTPS/);}
 const snapshot=fixture();snapshot.title=String.fromCodePoint(0x10ffff);await assert.rejects(generateQuoteSharePdf(snapshot),/字体不支持/);
});

test('manual payment-code PNG and JPEG are embedded as original pixels, retain aspect ratio and require merchant confirmation',async()=>{
 for(const image of [{extension:'png',contentType:'image/png',width:720,height:960,drawWidth:240,drawHeight:320},{extension:'jpg',contentType:'image/jpeg',width:960,height:640,drawWidth:306.28,drawHeight:306.28*640/960}]){
  const snapshot=fixture();snapshot.payment_mode='manual_code';snapshot.payment_code={id:'demo-code-only',label:'元数据标签CANARY',content_type:image.contentType,width:1,height:1,url:'https://example.com/never-fetch-this-CANARY',internal:'内部图备注CANARY'};
  if(image.extension==='png')snapshot.collection={name:'报价款'};
  const bytes=readFileSync('tests/fixtures/payment-code-demo.'+image.extension),options={paymentCodeImage:{bytes,contentType:image.contentType,label:'收款码图片排版演示（不可付款）'}},before=JSON.stringify(snapshot),beforeBytes=Buffer.from(bytes);
  freezeDeep(snapshot);const generated=await generateQuoteSharePdf(snapshot,options),pdf=await PDFDocument.load(generated),path=output+'/quote-share-manual-code-'+image.extension+'.pdf';writeFileSync(path,generated);
  assert.equal(JSON.stringify(snapshot),before);assert.deepEqual(bytes,beforeBytes);assert.equal(pdf.getPageCount(),2,'the quotation and payment/reference codes fit in two pages');assert.deepEqual(embeddedImages(pdf).map(({width,height})=>({width,height})),[{width:image.width,height:image.height}]);
  if(image.extension==='jpg')assert.equal(embeddedImages(pdf)[0].filter,'/DCTDecode','JPEG bytes stay in their original image encoding');
  if(existsSync(python)){
   const pages=inspectPdf(path),flat=pages.map(page=>page.text).join('\n').replace(/\s/g,''),images=pages.flatMap(page=>page.images);
   for(const term of ['收款码','收款码图片排版演示（不可付款）','请核对收款方及金额后扫码付款。','付款到账后，由商家核实并确认收款。','查看报价二维码','此二维码仅用于查看报价。'])assert.ok(flat.includes(term),term);
   for(const term of ['CANARY','自动确认','自动识别','已付款','已付','支付成功'])assert.equal(flat.includes(term),false,term);
   assert.equal(images.length,1);assert.deepEqual(images[0].srcsize,[image.width,image.height]);assert.ok(Math.abs(images[0].width-image.drawWidth)<0.01);assert.ok(Math.abs(images[0].height-image.drawHeight)<0.01);
   for(const page of pages)for(const picture of page.images){assert.ok(picture.x0>=60&&picture.x1<=page.width-60);assert.ok(picture.top>=60&&picture.bottom<=page.height-60);assert.equal(page.chars.some(char=>char.x0<picture.x1&&char.x1>picture.x0&&char.top<picture.bottom&&char.bottom>picture.top),false,'PDF text never overlaps the complete uploaded image');}
   if(image.extension==='png'){assert.ok(flat.includes('收款项目：报价款'));assert.equal(flat.includes('本次收款'),false);}
  }
 }
});
test('manual payment metadata without image bytes never fetches an image or invents scan-to-pay instructions',async()=>{
 const snapshot=fixture();snapshot.payment_mode='manual_code';snapshot.collection=null;Object.defineProperty(snapshot,'payment_code',{get(){throw new Error('PDF must never load image metadata');}});
 const bytes=await generateQuoteSharePdf(snapshot),pdf=await PDFDocument.load(bytes),path=output+'/quote-share-manual-code-missing.pdf';writeFileSync(path,bytes);assert.deepEqual(embeddedImages(pdf),[]);
 if(existsSync(python)){const flat=inspectPdf(path).map(page=>page.text).join('\n').replace(/\s/g,'');assert.ok(flat.includes('查看报价二维码'));assert.ok(flat.includes('此二维码仅用于查看报价。'));assert.equal(flat.includes('扫码付款'),false);assert.equal(flat.includes('自动确认'),false);}
});
test('payment image options reject unsupported content types and corrupt images',async()=>{
 for(const paymentCodeImage of [{bytes:new Uint8Array(),contentType:'image/png',label:'演示'},{bytes:new Uint8Array([1,2,3]),contentType:'image/webp',label:'演示'},{bytes:new Uint8Array([1,2,3]),contentType:'image/png',label:'演示'},{bytes:new Uint8Array([1,2,3]),contentType:'image/jpeg',label:'演示'}])await assert.rejects(generateQuoteSharePdf(fixture(),{paymentCodeImage}));
});
