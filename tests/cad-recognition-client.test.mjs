import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const compiled=ts.transpileModule(fs.readFileSync('lib/cad-recognition-client.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {requestCadRecognition,validateCadFiles}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const file=new File(['test dxf'],'test.dxf');
async function withFetch(response,run){const old=globalThis.fetch;globalThis.fetch=async()=>response;try{await run();}finally{globalThis.fetch=old;}}
test('HTML 413 explains server upload size instead of JSON syntax',async()=>withFetch(new Response('<html><h1>413 Request Entity Too Large</h1></html>',{status:413}),()=>assert.rejects(requestCadRecognition(file),/服务器上传大小限制/)));
test('HTML login and gateway failures have clear messages',async()=>{
 for(const [status,pattern] of [[401,/登录已失效/],[502,/暂时不可用/],[504,/暂时不可用/],[404,/HTTP 404/]])await withFetch(new Response('<html>error</html>',{status}),()=>assert.rejects(requestCadRecognition(file),pattern));
});
test('JSON errors remain readable and successful rows retain their format',async()=>{
 await withFetch(Response.json({error:'请先登录'},{status:401}),()=>assert.rejects(requestCadRecognition(file),/请先登录/));
 const rows=[{room:'厨房',name:'地柜',width:'4780',height:''}];
 await withFetch(Response.json({result:rows}),async()=>assert.deepEqual(await requestCadRecognition(file),rows));
});

test('100MB and 30 files allowed, 100MB plus one byte and 31 files rejected',()=>{
 const max={name:'large.dxf',size:100*1024*1024};
 assert.doesNotThrow(()=>validateCadFiles(Array(30).fill(max)));
 assert.throws(()=>validateCadFiles(Array(31).fill(max)),/30/);
 assert.throws(()=>validateCadFiles([{...max,size:max.size+1}]),/100MB/);
});
test('upload sends original binary without base64 expansion',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async(url,init)=>{assert.equal(init.body,file);assert.equal(init.headers['Content-Type'],'application/octet-stream');assert.equal(init.headers['X-CAD-Source'],'test.dxf');return Response.json({result:[{width:'1000'}]});};
 try{await requestCadRecognition(file);}finally{globalThis.fetch=old;}
});
