import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const quotes=url(compile('lib/quotes.ts')),details=url(compile('lib/payment-details.ts'));
const catalog=url(compile('lib/catalog-types.ts').replaceAll("from './payment-details'",`from '${details}'`));
const imports=url(compile('lib/quote-import.ts').replaceAll("import('xlsx')",`import('${import.meta.resolve('xlsx')}')`));
const {quoteCost,quoteCostDetails,summarizeQuoteCostLines}=await import(url(compile('lib/quote-profit.ts').replaceAll("from './quotes'",`from '${quotes}'`).replaceAll("from './catalog-types'",`from '${catalog}'`).replaceAll("from './quote-import'",`from '${imports}'`)));
const material=(name,category,price,model='')=>({id:name,name,expense_category:category,purchase_price:price,sale_price:99999,model,unit:'张'});
test('cost sums legacy quantities and cent costs without reclassifying prior categories',()=>{
 const lines=[{name:'加工费',category:'人工费用',model:'18mm',unit:'张',quantity:40,price:50},{name:'板材',category:'材料费用',unit:'张',quantity:2.5,price:200},{name:'层板托',category:'五金费用',unit:'张',quantity:10,price:2}];
 const result=quoteCost(lines,[material('加工费','人工费用',2000,'18mm'),material('板材','材料费用',10000),material('层板托','五金费用',50)]);
 assert.equal(result.cost,105500);assert.deepEqual(result.totals,{'柜体':0,'人工费用':80000,'材料费用':25000,'五金费用':500});assert.equal(result.issues.length,0);
});
test('cabinet costs use only explicit cabinet catalog prices and keep saved sale prices intact',()=>{
 const lines=[{name:'衣柜',category:'柜体',unit:'张',quantity:2.5,price:480},{name:'安装费',category:'人工费用',unit:'张',quantity:1,price:200},{name:'板材',category:'材料费用',unit:'张',quantity:2,price:100},{name:'拉手',category:'五金费用',unit:'张',quantity:4,price:5}],before=JSON.stringify(lines);
 const catalog=[material('衣柜','柜体',20000),material('衣柜','材料费用',99999),material('安装费','人工费用',5000),material('板材','材料费用',5000),material('拉手','五金费用',100)];
 const result=quoteCost(lines,catalog);assert.deepEqual(result.totals,{'柜体':50000,'人工费用':5000,'材料费用':10000,'五金费用':400});assert.equal(result.cost,65400);assert.deepEqual(result.issues,[]);
 const sales=lines.reduce((sum,item)=>sum+Math.round(item.quantity*Math.round(item.price*100)),0);assert.equal(sales-result.cost,96600);assert.equal(JSON.stringify(lines),before);
 assert.equal(quoteCost([lines[0]],[material('衣柜','材料费用',20000)]).cost,null);
});
test('missing, ambiguous, wrong model and wrong unit costs remain unknown; explicit zero is valid',()=>{
 const line={name:'加工费',category:'人工费用',unit:'张',model:'18mm',quantity:1,price:50};
 for(const rows of [[],[material('加工费','人工费用',100,'5mm')],[{...material('加工费','人工费用',100,'18mm'),unit:'个'}],[material('加工费','人工费用',100,'18mm'),material('加工费','人工费用',200,'18mm')]])assert.equal(quoteCost([line],rows).cost,null);
 assert.equal(quoteCost([line],[material('加工费','人工费用',0,'18mm')]).cost,0);
});

test('profit detail preserves rooms, legacy cabinet references and original prices with identical four-category costs',()=>{
 const roomA='room-a',roomB='room-b',cabinet='legacy-cabinet';
 const lines=[{name:'衣柜',category:'柜体',unit:'张',quantity:2.35,price:480,room_id:roomA,cabinet_id:cabinet,note:'原价格'}, {name:'安装费',category:'人工费用',unit:'张',quantity:2,price:10.005,room_id:roomA}, {name:'板材',category:'材料费用',unit:'张',quantity:1.5,price:25,room_id:roomB}, {name:'拉手',category:'五金费用',unit:'张',quantity:3,price:1.5,room_id:roomB}];
 const costs=[material('衣柜','柜体',30000),material('安装费','人工费用',501),material('板材','材料费用',1000),material('拉手','五金费用',50)];
 const before=JSON.stringify({lines,costs});Object.freeze(lines);lines.forEach(Object.freeze);Object.freeze(costs);costs.forEach(Object.freeze);
 const old=quoteCost(lines,costs),report=quoteCostDetails(lines,costs);
 assert.deepEqual(report.lines.map(line=>line.saleAmount),[112800,2002,3750,450]);
 assert.equal(report.summary.sales,119002);assert.equal(report.summary.cost,old.cost);assert.equal(old.cost,73152);assert.equal(report.summary.margin,45850);assert.equal(report.summary.marginRate,45850/119002);
 for(const category of ['柜体','人工费用','材料费用','五金费用'])assert.equal(report.categories[category].cost,old.totals[category]);
 assert.equal(report.lines[0].item.room_id,roomA);assert.equal(report.lines[0].item.cabinet_id,cabinet);assert.equal(report.lines[1].salePrice,1001);assert.equal(report.lines[1].costPrice,501);assert.equal(report.lines[0].item.price,480);
 const bedroom=summarizeQuoteCostLines(report.lines.filter(line=>line.item.room_id===roomA));assert.equal(bedroom.sales,114802);assert.equal(bedroom.cost,71502);assert.equal(bedroom.margin,43300);
 assert.equal(JSON.stringify({lines,costs}),before);
});

test('unknown costs never turn into zero or complete totals; zero and loss are valid when explicitly configured',()=>{
 const line={name:'板材',category:'材料费用',unit:'张',quantity:2,price:50};
 const result=quoteCostDetails([line,{...line,name:'未配置'}],[material('板材','材料费用',8000)]);
 assert.equal(result.lines[0].costAmount,16000);assert.equal(result.lines[0].margin,-6000);assert.equal(result.lines[0].marginRate,-0.6);
 for(const field of ['costPrice','costAmount','margin','marginRate'])assert.equal(result.lines[1][field],null);
 assert.equal(result.summary.sales,20000);assert.equal(result.summary.knownCost,16000);assert.equal(result.summary.cost,null);assert.equal(result.summary.margin,null);assert.equal(result.summary.marginRate,null);assert.equal(result.summary.unknownCostCount,1);assert.match(result.lines[1].costIssue,/未匹配到唯一/);
 const zero=quoteCostDetails([line],[material('板材','材料费用',0)]);assert.equal(zero.summary.cost,0);assert.equal(zero.summary.margin,10000);assert.equal(zero.summary.marginRate,1);
 const free=quoteCostDetails([{...line,price:0}],[material('板材','材料费用',100)]);assert.equal(free.summary.margin,-200);assert.equal(free.summary.marginRate,null);
});

test('partial drafts and overflow show unknown values, while legacy missing display fields remain compatible',()=>{
 const line={name:'板材',category:'材料费用',unit:'张',quantity:2,price:50},costs=[material('板材','材料费用',1000)];
 const quantity=quoteCostDetails([{...line,quantity:''}],costs);assert.equal(quantity.lines[0].saleAmount,null);assert.equal(quantity.lines[0].costAmount,null);assert.equal(quantity.summary.margin,null);assert.match(quantity.lines[0].costIssue,/数量无效/);
 const price=quoteCostDetails([{...line,price:''}],costs);assert.equal(price.lines[0].salePrice,null);assert.equal(price.summary.sales,null);assert.equal(price.summary.cost,2000);assert.equal(price.summary.margin,null);
 const bad=quoteCostDetails([{...line,quantity:Number.MAX_SAFE_INTEGER}],costs);assert.equal(bad.summary.cost,null);assert.equal(bad.summary.sales,null);assert.equal(bad.summary.margin,null);assert.match(bad.lines[0].costIssue,/超出计算范围/);
 const legacy=quoteCostDetails([{name:'板材',category:'材料费用',unit:'张',price:50}],costs);assert.equal(legacy.lines[0].item.quantity,1);assert.equal(legacy.summary.cost,1000);
});
