import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const compile=ts.transpileModule(readFileSync('lib/document-ocr.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {documentOcrWords}=await import('data:text/javascript;base64,'+Buffer.from(compile).toString('base64'));
const symbol=(text,x,width=10)=>({text,bbox:{x0:x,x1:x+width,y0:20,y1:36},confidence:96});
const blocks=words=>[{paragraphs:[{lines:[{words}]}]}];
test('merged OCR word is split using actual character gaps, preserving four source columns',()=>{
 const symbols=[symbol('板',0),symbol('材',10),symbol('1',120),symbol('8',130),symbol('m',140),symbol('m',150),symbol('1',280),symbol('0',290),symbol('张',390)];
 const result=documentOcrWords(blocks([{text:'板材18mm10张',bbox:{x0:0,x1:400,y0:20,y1:36},confidence:40,symbols}]));
 assert.deepEqual(result.map(part=>part.text),['板材','18mm','10','张']);
 assert.deepEqual(result.map(part=>part.bbox.x0),[0,120,280,390]);
 assert.equal(result[2].text,'10');
});
test('normal words retain original text, symbols are optional, empty words disappear',()=>{
 const input=[{text:'A B 型',bbox:{x0:0,x1:50,y0:20,y1:36},symbols:[symbol('A',0),symbol('B',15),symbol('型',30)]},{text:'1.005',bbox:{x0:100,x1:150,y0:20,y1:36},confidence:80},{text:' ',bbox:{x0:180,x1:190,y0:20,y1:36}}];
 assert.deepEqual(documentOcrWords(blocks(input)).map(part=>part.text),['A B 型','1.005']);
 assert.deepEqual(documentOcrWords(null),[]);
});
