import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const asURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const quotesURL=asURL(compile(readFileSync('lib/quotes.ts','utf8')));
const copyURL=asURL(compile(readFileSync('lib/quote-copy.ts','utf8')).replace("from './quotes'",`from '${quotesURL}'`));
const {copyQuoteBudget}=await import(copyURL);
const A='30000000-0000-4000-a000-000000000001',B='30000000-0000-4000-a000-000000000002',C='30000000-0000-4000-a000-000000000003';
const X='40000000-0000-4000-a000-000000000001',Y='40000000-0000-4000-a000-000000000002',Z='40000000-0000-4000-a000-000000000003';
const ids=(...values)=>{let i=0;return {createId:()=>values[i++]};};
const line=(room_id=A,changes={})=>({room_id,name:'衣柜',category:'材料费用',model:'18mm E0',unit:'㎡',quantity:1.5,price:1.005,note:'原行备注',...changes});
const fixture=()=>({id:'source-quote',project_id:'source-project',subproject_id:C,adopted:true,total:100,title:'已采纳来源版本',rooms:[{id:B,name:'厨房'},{id:A,name:'主卧室'},{id:C,name:'空次卧'}],items:[line(A),line(B,{name:'拉手',category:'五金费用',model:'细杆',unit:'个',quantity:2,price:10.25}),line(A,{name:'安装费',category:'人工费用',model:'',unit:'项',quantity:1,price:100})],note:'原报价备注'});
const cents=items=>items.reduce((sum,item)=>sum+Math.round(item.quantity*Math.round(item.price*100)),0);

test('全部房间生成新UUID，按原归属映射并保持顺序名称',()=>{
 const source=fixture(),copied=copyQuoteBudget(source,ids(X,Y,Z));
 assert.deepEqual(copied.rooms,[{id:X,name:'厨房'},{id:Y,name:'主卧室'},{id:Z,name:'空次卧'}]);
 assert.deepEqual(copied.items.map(item=>item.room_id),[Y,X,Y]);
 assert.ok(copied.rooms.every(room=>!source.rooms.some(old=>old.id===room.id)));
});

test('原价数量规格类别单位行备注逐字段保留，金额完全一致',()=>{
 const source=fixture(),copied=copyQuoteBudget(source,ids(X,Y,Z));
 assert.deepEqual(copied.items.map(({room_id,...item})=>item),source.items.map(({room_id,...item})=>item));
 assert.equal(cents(copied.items),cents(source.items));assert.equal(cents(copied.items),12200);assert.equal(copied.note,source.note);
});

test('复制不修改源对象，冻结源报价也能复制',()=>{
 const source=fixture(),before=JSON.stringify(source);
 source.rooms.forEach(Object.freeze);source.items.forEach(Object.freeze);Object.freeze(source.rooms);Object.freeze(source.items);Object.freeze(source);
 copyQuoteBudget(source,ids(X,Y,Z));assert.equal(JSON.stringify(source),before);
});

test('包含空房间的零明细草稿保留全部空间，不添加多余整体空间',()=>{
 const source={rooms:fixture().rooms,items:[],note:'待填'},copied=copyQuoteBudget(source,ids(X,Y,Z));
 assert.equal(copied.rooms.length,3);assert.deepEqual(copied.rooms.map(room=>room.name),['厨房','主卧室','空次卧']);assert.deepEqual(copied.items,[]);assert.equal(copied.note,'待填');
});

test('无房间旧普通报价统一归整体空间并按旧显示规则补齐字段',()=>{
 const source={title:'旧报价',items:[{name:'旧衣柜',unit:'项',quantity:2,price:100}]},copied=copyQuoteBudget(source,ids(X));
 assert.deepEqual(copied.rooms,[{id:X,name:'整体空间'}]);assert.deepEqual(copied.items,[{room_id:X,name:'旧衣柜',category:'材料费用',model:'',unit:'项',quantity:2,price:100,note:''}]);assert.equal(copied.note,'');
 assert.deepEqual(copyQuoteBudget({rooms:[],items:[]},ids(Y)),{rooms:[{id:Y,name:'整体空间'}],cabinets:[],items:[],note:''});
});

test('孤立和未归属明细不丢失，集中归新增整体空间，原房间保留',()=>{
 const source={rooms:[{id:A,name:'客厅'}],items:[line(A),line(B),{...line(),room_id:undefined},line('invalid-room')]},copied=copyQuoteBudget(source,ids(X,Y));
 assert.deepEqual(copied.rooms,[{id:X,name:'客厅'},{id:Y,name:'整体空间'}]);assert.equal(copied.items.length,4);assert.deepEqual(copied.items.map(item=>item.room_id),[X,Y,Y,Y]);assert.equal(cents(copied.items),cents(source.items));
 const invalid=copyQuoteBudget({rooms:[{id:'invalid-room',name:'保留空空间'}],items:[line('invalid-room')]},ids(X,Y));assert.deepEqual(invalid.rooms.map(room=>room.name),['保留空空间','整体空间']);assert.equal(invalid.items[0].room_id,Y);
});

test('重复源编号明确拒绝，大小写映射可靠且生成编号冲突拒绝',()=>{
 const source={rooms:[{id:A,name:'主卧'},{id:A.toUpperCase(),name:'次卧'}],items:[line()]};
 assert.throws(()=>copyQuoteBudget(source,ids(X,Y)),/重复房间编号/);
 const copied=copyQuoteBudget({rooms:[{id:A.toUpperCase(),name:'主卧'}],items:[line(A)]},ids(X.toUpperCase()));assert.equal(copied.items[0].room_id,X);
 assert.throws(()=>copyQuoteBudget(fixture(),ids(X,X,Z)),/新房间编号重复/);
 assert.throws(()=>copyQuoteBudget(fixture(),ids(A,Y,Z)),/新房间编号重复/);
 assert.throws(()=>copyQuoteBudget(fixture(),ids('invalid')),/新房间编号无效/);
});

test('复制结果与源不存在可变别名，版本和业务元信息不进入预算',()=>{
 const source=fixture(),copied=copyQuoteBudget(source,ids(X,Y,Z));assert.deepEqual(Object.keys(copied).sort(),['cabinets','items','note','rooms']);
 assert.notEqual(copied.rooms,source.rooms);assert.notEqual(copied.items,source.items);assert.notEqual(copied.rooms[0],source.rooms[0]);assert.notEqual(copied.items[0],source.items[0]);
 copied.rooms[0].name='目的地厨房';copied.items[0].price=999;assert.equal(source.rooms[0].name,'厨房');assert.equal(source.items[0].price,1.005);
 source.rooms[1].name='来源改名';source.items[1].note='来源备注更新';assert.equal(copied.rooms[1].name,'主卧室');assert.equal(copied.items[1].note,'原行备注');
});

const D='50000000-0000-4000-a000-000000000001',E='50000000-0000-4000-a000-000000000002',F='50000000-0000-4000-a000-000000000003';
const M='60000000-0000-4000-a000-000000000001',N='60000000-0000-4000-a000-000000000002',P='60000000-0000-4000-a000-000000000003';
function cabinetFixture(){const source=fixture();source.cabinets=[{id:D,room_id:A,name:'空衣柜'},{id:E,room_id:B,name:'厨房地柜'},{id:F,room_id:A,name:'主卧衣柜'}];source.items=[line(A,{cabinet_id:F}),line(B,{cabinet_id:E,name:'厨房拉手',category:'五金费用'}),line(A,{name:'旧公共安装费',category:'人工费用'})];return source;}
test('跨客户复制柜体保留名称、全局顺序、空柜体和公共明细，所有关系重建',()=>{
 const source=cabinetFixture(),before=JSON.stringify(source),copied=copyQuoteBudget(source,ids(X,Y,Z,M,N,P));
 assert.deepEqual(copied.cabinets,[{id:M,room_id:Y,name:'空衣柜'},{id:N,room_id:X,name:'厨房地柜'},{id:P,room_id:Y,name:'主卧衣柜'}]);
 assert.deepEqual(copied.items.map(item=>[item.room_id,item.cabinet_id]),[[Y,P],[X,N],[Y,undefined]]);assert.equal(cents(copied.items),cents(source.items));assert.equal(JSON.stringify(source),before);
 assert.ok(copied.cabinets.every(cabinet=>!source.cabinets.some(old=>old.id===cabinet.id)));assert.ok(!('cabinet_id' in copied.items[2]));
 copied.cabinets[0].name='新空柜';copied.items[0].price=999;assert.equal(source.cabinets[0].name,'空衣柜');assert.equal(source.items[0].price,1.005);
});
test('柜体来源与明细关联按大小写重映射，冻结来源无修改',()=>{
 const source=cabinetFixture();source.cabinets[2].id=F.toUpperCase();source.cabinets[2].room_id=A.toUpperCase();source.items[0].room_id=A.toUpperCase();source.cabinets.forEach(Object.freeze);source.items.forEach(Object.freeze);source.rooms.forEach(Object.freeze);Object.freeze(source.cabinets);Object.freeze(source.items);Object.freeze(source.rooms);Object.freeze(source);
 const copied=copyQuoteBudget(source,ids(X,Y,Z,M,N,P));assert.equal(copied.items[0].cabinet_id,P);assert.equal(copied.items[0].room_id,Y);assert.equal(copied.cabinets[2].room_id,Y);
});
test('重复柜体、孤儿柜体、跨房间明细及无效柜体引用均明确拒绝',()=>{
 let source=cabinetFixture();source.cabinets.push({...source.cabinets[0],id:D.toUpperCase()});assert.throws(()=>copyQuoteBudget(source),/重复柜体编号/);
 source=cabinetFixture();source.cabinets[0].room_id=X;assert.throws(()=>copyQuoteBudget(source),/柜体未关联有效房间/);
 source=cabinetFixture();source.items[0].cabinet_id=X;assert.throws(()=>copyQuoteBudget(source),/明细未关联有效柜体/);
 source=cabinetFixture();source.items[0].room_id=B;assert.throws(()=>copyQuoteBudget(source),/所属房间不一致/);
 source=cabinetFixture();delete source.items[0].room_id;assert.throws(()=>copyQuoteBudget(source),/所属房间不一致/);
 source=cabinetFixture();source.cabinets=[];assert.throws(()=>copyQuoteBudget(source),/明细未关联有效柜体/);
});
test('生成器不能复用源柜体编号或任意新房间柜体编号',()=>{
 assert.throws(()=>copyQuoteBudget(cabinetFixture(),ids(D,Y,Z,M,N,P)),/编号重复/);
 assert.throws(()=>copyQuoteBudget(cabinetFixture(),ids(X,Y,Z,X,N,P)),/编号重复/);
 const copied=copyQuoteBudget(cabinetFixture());assert.equal(new Set([...copied.rooms,...copied.cabinets].map(value=>value.id)).size,6);
});

test('默认生成器每次复制得到独立UUID，明细全部指向自己的房间',()=>{
 const source=fixture(),first=copyQuoteBudget(source),second=copyQuoteBudget(source),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 assert.ok(first.rooms.every(room=>uuid.test(room.id)));assert.equal(new Set([...first.rooms,...second.rooms].map(room=>room.id)).size,6);
 for(const copy of [first,second])assert.ok(copy.items.every(item=>copy.rooms.some(room=>room.id===item.room_id)));
});

test('柜体作为第四类普通行复制，四类历史价格和数量不变且旧分组关联仍保留',()=>{
 const source={rooms:[{id:A,name:'主卧室'},{id:B,name:'空厨房'}],items:[
  line(A,{category:'柜体',name:'衣柜',quantity:2.35,price:480}),
  line(A,{category:'人工费用',name:'安装',quantity:2,price:10.005}),
  line(A,{category:'材料费用',name:'补充板材',quantity:1.5,price:25}),
  line(A,{category:'五金费用',name:'铰链',quantity:3,price:1.5}),
 ],note:'沿用原报价价格'};
 const before=JSON.stringify(source),copied=copyQuoteBudget(source,ids(X,Y));
 assert.deepEqual(copied.items.map(({room_id,...item})=>item),source.items.map(({room_id,...item})=>item));
 assert.deepEqual(copied.items.map(item=>item.category),['柜体','人工费用','材料费用','五金费用']);
 assert.deepEqual(copied.cabinets,[]);assert.ok(copied.items.every(item=>!('cabinet_id' in item)));
 assert.equal(cents(copied.items),119002);assert.equal(JSON.stringify(source),before);
 source.cabinets=[{id:D,room_id:A,name:'旧分组衣柜'}];source.items[0].cabinet_id=D;
 const legacy=copyQuoteBudget(source,ids(X,Y,M));
 assert.equal(legacy.items[0].category,'柜体');assert.equal(legacy.items[0].price,480);
 assert.equal(legacy.items[0].cabinet_id,M);assert.equal(legacy.items[0].room_id,X);
 assert.deepEqual(legacy.cabinets,[{id:M,room_id:X,name:'旧分组衣柜'}]);assert.equal(cents(legacy.items),119002);
});
