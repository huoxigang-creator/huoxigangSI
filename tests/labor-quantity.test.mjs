import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
const module={exports:{}};const code=ts.transpileModule(readFileSync(new URL('../lib/labor-quantity.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
runInNewContext('(function(exports,module){'+code+'\n})')(module.exports,module);
const {laborQuantity,boardSize,thickness}=module.exports;
const labor={name:'加工费（48尺）',model:'18mm',unit:'张'};
const row=(name,model,quantity,unit='张')=>({name,model,quantity,unit,attribute:'主材'});
const order=(items,extra={})=>({project_id:'p',items,...extra});
test('按尺寸厚度跨品牌花色、跨采购单累计；排除其他项目、已删除与不同厚度尺寸',()=>{
 const orders=[order([row('品牌甲18mm','48尺',2),row('花色乙18mm','4×8尺',3),row('丙18mm','1220*2440',4),row('5mm','48尺',20),row('18mm','49尺',30)]),order([row('丁18mm','48尺',0.5)]),order([row('18mm','48尺',100)],{project_id:'other'}),order([row('18mm','48尺',200)],{deleted:true})];
 assert.equal(laborQuantity(labor,orders,'p').quantity,9.5);
});
test('单位不混算、不识别规则不猜测，无匹配显示0',()=>{
 assert.equal(laborQuantity(labor,[order([row('18mm','48尺',3,'平方米')])],'p').quantity,null);
 assert.equal(laborQuantity({...labor,name:'安装费'},[],'p').quantity,null);
 assert.equal(laborQuantity(labor,[],'p').quantity,0);
});
test('完整厚度匹配、全角写法、重复同厚度与冲突厚度',()=>{
 assert.equal(boardSize('加工费（４８尺）'),'4x8');assert.equal(thickness('18mm 18mm'),'18');assert.equal(thickness('118mm'),null);assert.equal(thickness('18mm 5mm'),null);
 assert.equal(laborQuantity({...labor,name:'加工费（49尺）',model:'5mm'},[order([row('甲5毫米','4*9尺',7),row('乙18mm','49尺',2)])],'p').quantity,7);
});

test('背板加工费按配置厚度累计所有尺寸',()=>{assert.equal(laborQuantity({...labor,name:'加工费（背板）',model:'5mm'},[order([row('甲5mm','48尺',2),row('乙5mm','49尺',3),row('丙18mm','48尺',100)])],'p').quantity,5);});

test('电梯上楼费数量=全部5mm板+18mm板数量之和，忽略其他厚度与其他项目',()=>{
 const orders=[order([row('甲5mm','48尺',2),row('乙18mm','49尺',30),row('丙5mm','48尺',7),row('丁18mm','48尺',1.5),row('戊9mm','48尺',99)]),order([row('己18mm','48尺',4)],{project_id:'other'}),order([row('庚18mm','48尺',50)],{deleted:true})];
 assert.equal(laborQuantity({...labor,name:'电梯上楼费',model:'',unit:'项'},orders,'p').quantity,40.5);
});
test('运输费数量默认为1，不读取采购单',()=>{
 assert.equal(laborQuantity({...labor,name:'运输费',model:'',unit:'项'},[order([row('甲18mm','48尺',88)])],'p').quantity,1);
 assert.equal(laborQuantity({...labor,name:'运输费',model:'',unit:'项'},[],'p').quantity,1);
});
