import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require=createRequire(import.meta.url),cache=new Map();
function load(path){
 if(cache.has(path))return cache.get(path).exports;
 const module={exports:{}};cache.set(path,module);
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 function localRequire(name){if(name==='react')return {...React,useSyncExternalStore:(_subscribe,getSnapshot)=>getSnapshot()};if(name==='react-dom')return {createPortal:children=>children};if(name.startsWith('.')){const base=resolve(dirname(path),name),target=[base,base+'.ts',base+'.tsx'].find(existsSync);assert.ok(target,name);return load(target);}return require(name);}
 runInNewContext('(function(exports,module,require){'+code+'\n})',{console,Intl,Set,Map,Number,String,Error,document:{body:{}}})(module.exports,module,localRequire);
 return module.exports;
}
const {default:Print,buildCustomerQuotePrintGroups}=load(resolve('app/customer-quote-print.tsx'));
const A='81000000-0000-4000-a000-000000000001',B='81000000-0000-4000-a000-000000000002',X='82000000-0000-4000-a000-000000000001',Y='82000000-0000-4000-a000-000000000002',Z='82000000-0000-4000-a000-000000000003';
const line=(room_id,name,category,quantity,price,cabinet_id)=>({room_id,cabinet_id,name,category,quantity,price,model:'原规格',unit:'项',note:'原明细备注'});
function fixture(){return {title:'整户版本',company:'测试公司',rooms:[{id:A,name:'主卧'},{id:B,name:'厨房'}],cabinets:[{id:X,room_id:A,name:'衣柜'},{id:Z,room_id:A,name:'待填柜'},{id:Y,room_id:B,name:'地柜'}],lines:[line(A,'衣柜安装','人工费用',2,10.005,X),line(A,'公共材料','材料费用',1,50),line(B,'地柜板材','材料费用',2,100,Y),line(B,'地柜拉手','五金费用',3,1.5,Y)],total:27452,note:'原整户备注'};}
function elements(node){if(Array.isArray(node))return node.flatMap(elements);if(!React.isValidElement(node))return[];return [node,...elements(node.props.children)];}
function text(node){if(Array.isArray(node))return node.map(text).join('');return React.isValidElement(node)?text(node.props.children):typeof node==='string'||typeof node==='number'?String(node):'';}
function printRows(input){return elements(Print(input)).filter(node=>node.type==='tr');}

test('整户打印与下载Excel同版式：表头、分类段、小计、空柜体、费用项黄底齐全',()=>{
 const input=fixture(),before=JSON.stringify(input),rows=printRows(input),labels=rows.map(text);
 assert.equal(labels[0],'整户版本的清单报价');
 assert.equal(labels[1],'客户姓名：  客户地址：  客户电话：');
 assert.match(labels[2],/编号/);assert.match(labels[2],/项目/);assert.match(labels[2],/规格型号/);assert.match(labels[2],/上传附件/);
 for(const label of ['空间：主卧','公共明细','柜体：衣柜','柜体：待填柜','空间：厨房','柜体：地柜','暂无报价明细'])assert.ok(labels.includes(label),label+' 缺失');
 for(const money of ['衣柜柜体小计20.02','待填柜柜体小计0.00','主卧小计70.02','地柜柜体小计204.50','厨房小计204.50','报价合计274.52'])assert.ok(labels.includes(money),money+' 缺失');
 assert.equal(labels.filter(label=>/^\d/.test(label)).length,4,'四条明细行');
 assert.ok(labels.some(label=>label.startsWith('备注：原明细备注')));
 assert.ok(labels.some(label=>label==='报价备注：原整户备注'));
 const yellow=rows.find(row=>String(row.props.className||'').includes('qwXlsYellow'));assert.equal(text(yellow),'费用项');
 assert.equal(JSON.stringify(input),before);
});

test('无柜体历史报价与未分配空间兼容，不生成柜体段或丢行',()=>{
 const input=fixture();delete input.cabinets;input.lines=input.lines.map(({cabinet_id,...item})=>item);
 let labels=printRows(input).map(text);
 assert.equal(labels.some(label=>label.startsWith('柜体：')),false);
 assert.equal(labels.filter(label=>/^\d/.test(label)).length,4);
 input.rooms=[];input.lines=input.lines.map(({room_id,...item})=>item);
 labels=printRows(input).map(text);
 assert.ok(labels.includes('空间：未分配空间'));
 assert.ok(labels.includes('报价合计274.52'));
});

test('只有采纳报价打印结算行，草稿不显示原报价优惠抹零应收',()=>{
 const input=fixture();input.settlement={adopted:true,discount_amount:300,rounding_amount:2,receivable:27150};
 let labels=printRows(input).map(text);
 assert.ok(labels.includes('原报价274.52'));assert.ok(labels.includes('优惠3.00'));assert.ok(labels.includes('抹零0.02'));assert.ok(labels.includes('应收金额271.50'));
 input.settlement.adopted=false;labels=printRows(input).map(text);
 assert.equal(labels.some(label=>label.startsWith('应收金额')),false);
 assert.ok(labels.includes('报价合计274.52'));
});

test('孤儿柜体、跨房间引用和保存总额不一致均明确阻止打印错误清单',()=>{
 let input=fixture();input.cabinets[0].room_id=Z;assert.throws(()=>buildCustomerQuotePrintGroups(input.rooms,input.lines,input.cabinets),/柜体未关联有效房间/);assert.match(text(Print(input)),/柜体未关联有效房间/);assert.equal(elements(Print(input)).some(node=>node.type==='table'),false);
 input=fixture();input.lines[0].cabinet_id=Y;assert.throws(()=>buildCustomerQuotePrintGroups(input.rooms,input.lines,input.cabinets),/所属房间不一致/);
 input=fixture();input.total++;const tree=Print(input);assert.match(text(tree),/合计与已保存总额不一致/);assert.equal(elements(tree).some(node=>node.type==='table'),false);
});

test('明细照片渲染到上传附件列，落款区用浅灰边框类',()=>{
 const input=fixture();input.lines[0].photos=[{key:'k1',name:'现场图.png'},{key:'k2',name:'细部图.png'}];
 const tree=Print(input),imgs=elements(tree).filter(node=>node.type==='img');
 assert.equal(imgs.length,2);
 assert.equal(imgs[0].props.src,'/api/quote-item-photos?key=k1');
 assert.equal(imgs[1].props.src,'/api/quote-item-photos?key=k2');
 const rows=elements(tree).filter(node=>node.type==='tr');
 const total=rows.find(row=>text(row).startsWith('报价合计'));assert.ok(!String(total.props.className||'').includes('qwXlsTail'),'合计行保持黑框');
 for(const prefix of ['乙方：','时间：']){const sign=rows.filter(row=>text(row).startsWith(prefix));assert.equal(sign.length,1,prefix);assert.ok(String(sign[0].props.className||'').includes('qwXlsTail'),prefix+' 落款应为浅灰');}
});

test('四并列类别整户打印含柜体普通行并按 Excel 版式汇总',()=>{
 const input={title:'四类报价',company:'测试公司',rooms:[{id:A,name:'主卧'},{id:B,name:'空厨房'}],lines:[
  {...line(A,'衣柜','柜体',2.35,480),unit:'㎡'},
  line(A,'安装','人工费用',2,10.005),
  line(A,'补充板材','材料费用',1.5,25),
  line(A,'铰链','五金费用',3,1.5),
 ],total:119002,settlement:{adopted:true,discount_amount:10000,rounding_amount:2,receivable:109000}};
 const before=JSON.stringify(input),labels=printRows(input).map(text);
 assert.ok(labels.includes('柜体1128.00'));assert.ok(labels.includes('人工费用20.02'));assert.ok(labels.includes('材料费用37.50'));assert.ok(labels.includes('五金费用4.50'));
 assert.ok(labels.includes('主卧小计1190.02'));assert.ok(labels.includes('空厨房小计0.00'));
 assert.ok(labels.some(label=>/^1衣柜原规格㎡2\.35480\.001128\.00/.test(label)));
 assert.ok(labels.includes('报价合计1190.02'));assert.ok(labels.includes('优惠100.00'));assert.ok(labels.includes('抹零0.02'));assert.ok(labels.includes('应收金额1090.00'));
 assert.equal(JSON.stringify(input),before);
 input.settlement.adopted=false;assert.equal(printRows(input).map(text).some(label=>label.startsWith('应收金额')),false);
});
