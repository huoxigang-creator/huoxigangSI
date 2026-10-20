import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const quotes=url(compile('lib/quotes.ts')),details=url(compile('lib/payment-details.ts'));
const types=url(compile('lib/catalog-types.ts').replaceAll("from './payment-details'",`from '${details}'`));
const {getCabinetOptions,isBuiltinCabinetOption}=await import(url(compile('lib/cabinet-catalog.ts').replaceAll("from './quotes'",`from '${quotes}'`).replaceAll("from './catalog-types'",`from '${types}'`)));
const {CABINET_NAMES}=await import(quotes);
const record=(id,name,category='柜体',overrides={})=>({id,name,expense_category:category,model:'18mm E0',unit:'㎡',purchase_price:12345,sale_price:48000,revision:'original-revision',areas:['卧室'],...overrides});

test('常用柜体名称仅为未持久化选项，价格零值且每次计算不共享可变预设',()=>{
 const first=getCabinetOptions([]),second=getCabinetOptions([]);
 assert.deepEqual(first.map(option=>option.name),[...CABINET_NAMES]);
 assert.ok(first.every(option=>isBuiltinCabinetOption(option)&&option.expense_category==='柜体'&&option.project===''&&option.revision===''&&option.purchase_price===0&&option.sale_price===0));
 assert.equal(new Set(first.map(option=>option.id)).size,first.length);
 first[0].name='改动临时选择';first[0].areas.push('临时');
 assert.equal(second[0].name,CABINET_NAMES[0]);assert.deepEqual(second[0].areas,[]);
});

test('配置同名柜体覆盖内置名称，多个真实型号价格不被合并或改写，其他类别不串入',()=>{
 const source=[record('configured-wardrobe',' 衣柜 '),record('wardrobe-second','衣柜','柜体',{model:'25mm',sale_price:52000}),record('custom','窗边展示柜'),record('material','鞋柜','材料费用'),record('hardware','拉手','五金费用'),record('labor','安装','人工费用'),record('deleted','酒柜','柜体',{deleted:true})];
 const before=JSON.stringify(source);source.forEach(Object.freeze);Object.freeze(source);
 const options=getCabinetOptions(source);
 assert.deepEqual(options.filter(option=>!isBuiltinCabinetOption(option)).map(option=>[option.id,option.model,option.sale_price]),[['configured-wardrobe','18mm E0',48000],['wardrobe-second','25mm',52000],['custom','18mm E0',48000]]);
 assert.equal(options.filter(option=>option.name.trim()==='衣柜').length,2);
 assert.equal(options.some(option=>option.id==='material'||option.id==='hardware'||option.id==='labor'||option.id==='deleted'),false);
 assert.equal(options.filter(option=>option.name==='鞋柜').length,1);assert.equal(isBuiltinCabinetOption(options.find(option=>option.name==='鞋柜')),true);
 assert.equal(isBuiltinCabinetOption(options.find(option=>option.name==='酒柜')),true);
 assert.equal(JSON.stringify(source),before);
});

test('删除与刷新重算选项：被删常用名称回退预设，自定义消失，恢复配置按新价格覆盖',()=>{
 const old=[record('wardrobe','衣柜'),record('custom','窗边展示柜')];
 assert.equal(isBuiltinCabinetOption(getCabinetOptions(old).find(option=>option.name==='衣柜')),false);
 const removed=old.map(option=>({...option,deleted:true})),fallback=getCabinetOptions(removed);
 assert.equal(isBuiltinCabinetOption(fallback.find(option=>option.name==='衣柜')),true);assert.equal(fallback.some(option=>option.name==='窗边展示柜'),false);
 const refreshed=getCabinetOptions([{...old[0],sale_price:60000,model:'刷新型号',revision:'new-revision'}]);
 const wardrobe=refreshed.find(option=>option.name==='衣柜');assert.equal(isBuiltinCabinetOption(wardrobe),false);assert.equal(wardrobe.sale_price,60000);assert.equal(wardrobe.model,'刷新型号');
 assert.equal(old[0].sale_price,48000);assert.equal(old[0].model,'18mm E0');
});
