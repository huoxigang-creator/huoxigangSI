import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import {runInNewContext} from 'node:vm';import {setImmediate as turn} from 'node:timers/promises';
function fixture(){let decode,respond,fetches=0;const stages=[];const module={exports:{}};class Image{naturalWidth=100;naturalHeight=100;decode(){return new Promise(r=>decode=r);}}
 const document={createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,TEST'})};
 const code=ts.transpileModule(fs.readFileSync('lib/image-recognition-client.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(code,{module,exports:module.exports,Image,document,URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL(){}},DOMException,fetch:async(_url,options)=>{fetches++;assert.equal(JSON.parse(options.body).multiple,true);return new Promise(r=>respond=r);}});
 return {request:module.exports.requestImageRecognition,stages,decode:()=>decode(),respond:()=>respond(Response.json({result:[{room:'阳台',name:'洗衣机柜'}]})),get fetches(){return fetches;}};
}
test('image upload announces preparing immediately, then uploading/analysis only after image decode',async()=>{
 const f=fixture(),p=f.request(new File(['image'],'test.png',{type:'image/png'}),'drawing',new AbortController().signal,undefined,true,m=>f.stages.push(m));assert.match(f.stages[0],/准备上传/);assert.equal(f.fetches,0);f.decode();await turn();assert.equal(f.fetches,1);assert.match(f.stages[1],/正在上传并解析图片/);f.respond();assert.equal((await p).length,1);
});
test('cancel during image preparation never sends an upload request',async()=>{
 const f=fixture(),abort=new AbortController(),p=f.request(new File(['image'],'test.png',{type:'image/png'}),'drawing',abort.signal,undefined,true,m=>f.stages.push(m));abort.abort();f.decode();await assert.rejects(p,/已取消/);assert.equal(f.fetches,0);
});
