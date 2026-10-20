import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
async function module(path){const output=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));}
const {createProjectFileHandlers}=await module('app/api/project-files/handlers.ts');
const {createPaymentVoucherHandlers}=await module('app/api/payment-vouchers/handlers.ts');
const uuid='28a749eb-8d66-411f-b393-f5c36b9d4582';
const owner='alice',project='project-001',transaction='tx:alice:request001';
function fixture(type){
 const key=type==='project'?owner+'/'+project+'/files/'+uuid:owner+'/'+project+'/payment-vouchers/'+encodeURIComponent(transaction)+'/'+uuid;
 const object={key,size:4,uploaded:new Date('2026-10-12T00:00:00Z'),body:new Uint8Array([1,2,3,4]),customMetadata:{name:'单据.pdf',category:'合同',project_id:project,transaction_id:transaction,created:'2026-10-12T00:00:00Z'}};
 let deleted=false,puts=0;
 const bucket={head:async()=>object,get:async()=>object,list:async()=>({objects:[object],truncated:false}),put:async()=>{puts++;throw new Error('不应写R2')}};
 const deps={bucket:()=>bucket,authorize:async()=>({project:{id:project},transactions:[{id:transaction,project,type:'付款'}]}),deletedKeys:async()=>new Set(deleted?[key]:[])};
 const handlers=type==='project'?createProjectFileHandlers(deps):createPaymentVoucherHandlers(deps);
 const base='https://example.test/api/'+(type==='project'?'project-files':'payment-vouchers');
 const params={project_id:project,...(type==='payment'?{transaction_id:transaction}:{})};
 const req=(extra={})=>new Request(base+'?'+new URLSearchParams({...params,...extra}),{headers:{'oai-authenticated-user-id':owner}});
 return {key,handlers,base,params,req,setDeleted:value=>{deleted=value},puts:()=>puts};
}
for(const type of ['project','payment'])test(type+'文件软删后隐藏列表并阻止下载，恢复后同一原文件再可见',async()=>{
 const f=fixture(type);
 let response=await f.handlers.GET(f.req()); assert.equal((await response.json()).files.length,1);
 f.setDeleted(true);
 response=await f.handlers.GET(f.req()); assert.deepEqual((await response.json()).files,[]);
 response=await f.handlers.GET(f.req({key:f.key}));assert.equal(response.status,404);
 f.setDeleted(false);
 response=await f.handlers.GET(f.req());assert.equal((await response.json()).files[0].key,f.key);
 response=await f.handlers.GET(f.req({key:f.key}));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal(f.puts(),0);
});
test('已软删单据的同编号上传重试不得取消删除或假报上传成功',async()=>{
 const f=fixture('payment'); f.setDeleted(true);
 const form=new FormData();form.set('project_id',project);form.set('transaction_id',transaction);form.set('attachment_id',uuid);form.set('file',new File(['data'],'单据.pdf'));
 const response=await f.handlers.POST(new Request(f.base,{method:'POST',body:form,headers:{origin:'https://example.test','oai-authenticated-user-id':owner}}));
 assert.equal(response.status,409);assert.match((await response.json()).error,/回收站/);assert.equal(f.puts(),0);
});
