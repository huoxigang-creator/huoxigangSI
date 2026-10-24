import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync('lib/drawing-import.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {drawingArea,drawingMeters,drawingFromWords,drawingMeasure,uniqueDrawingEntries}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const word=(text,x0=0,y0=0,x1=x0+20,y1=y0+10)=>({text,bbox:{x0,y0,x1,y1}});
test('projection uses mm and rejects invalid dimensions',()=>{assert.equal(drawingArea('2373','2480'),5.89);for(const value of ['','-1','NaN','Infinity','30001'])assert.equal(drawingArea(value,'2480'),null);});
test('meters uses width mm when height missing',()=>{assert.equal(drawingMeters('3294'),3.29);assert.equal(drawingMeters('1000'),1);for(const value of ['','-1','NaN','Infinity','30001'])assert.equal(drawingMeters(value),null);});
test('CAD overall left and bottom dimensions map to height and width',()=>{const row=drawingFromWords([word('主'),word('卧'),word('室'),word('衣柜'),word('2480',160,340),word('2373',450,670)],'图纸.png');assert.equal(row.room,'主卧室');assert.equal(row.name,'衣柜');assert.equal(row.width,'2373');assert.equal(row.height,'2480');assert.equal(row.price,'');});
test('missing labels and ambiguous dimensions stay unassigned',()=>{const row=drawingFromWords([word('衣柜'),word('2373'),word('2480'),word('600'),word('45634564564')],'一楼衣柜.png');assert.equal(row.room,'');assert.equal(row.width,'');assert.equal(row.height,'');assert.ok(!row.source.includes('45634564564'));});
test('explicit width and height survive unrelated dimension candidates',()=>{const row=drawingFromWords([word('宽度:2373'),word('高度:2480'),word('600')],'图纸');assert.equal(row.width,'2373');assert.equal(row.height,'2480');});

test('pricing is identical for preview totals and draft import',()=>{
const row={source:'test',room:'厨房',name:'冰箱柜',width:'900',height:'2400',price:'',selected:true};
assert.deepEqual(drawingMeasure(row),{area:2.16,meters:null});
assert.deepEqual(drawingMeasure({...row,height:''}),{area:null,meters:null});
assert.deepEqual(drawingMeasure({...row,name:'地柜'}),{area:null,meters:0.9});
assert.deepEqual(drawingMeasure({...row,room:'客厅',name:'电视柜',width:'2000',height:''}),{area:null,meters:2});
assert.deepEqual(drawingMeasure({...row,room:'客厅',name:'电视柜',width:'2000',height:'500'}),{area:1,meters:null});
assert.deepEqual(drawingMeasure({...row,room:'客厅',name:'电视柜',height:'bad'}),{area:null,meters:null});
assert.deepEqual(drawingMeasure({...row,room:'餐厅',name:'橱柜'}),{area:null,meters:0.9});
});


test('recognition hides only matches on room, name, width AND height, across screenshot and CAD sources',()=>{
 const row={source:'one.png',room:'主卧',name:'衣柜',width:'2000',height:'2400',price:'',selected:true};
 const entries=[{row,image:'first-image',file:'first-file'},
 {row:{...row,source:'two.dxf'},image:'duplicate-image',file:null},
 {row:{...row,room:'次卧'},image:'other-room',file:'other-room-file'},
 {row:{...row,name:'书柜'},image:'other-name',file:'other-name-file'},
 {row:{...row,width:'2100'},image:'other-width',file:null},
 {row:{...row,height:'2500'},image:'other-height',file:null}];
 const kept=uniqueDrawingEntries(entries);assert.equal(kept.length,5);assert.deepEqual(kept.map(e=>e.image),['first-image','other-room','other-name','other-width','other-height']);assert.equal(kept[0].file,'first-file');assert.equal(entries.length,6);
 const appended=uniqueDrawingEntries([...kept,...entries]);assert.deepEqual(appended,kept);
});
test('equivalent dimension notation deduplicates while width-only and width-height stay distinct',()=>{
 const row={source:'one.png',room:'厨房',name:'地柜',width:'1000+1000',height:'',price:'',selected:true};
 const entries=[row,{...row,width:'2000.0'},{...row,width:'2000',height:'2400'}].map(row=>({row}));
 assert.equal(uniqueDrawingEntries(entries).length,2);
 const missing={...row,room:'',name:'',width:''};assert.equal(uniqueDrawingEntries([{row:missing},{row:missing}]).length,2);
});

test('local OCR uses project field as room and flags color ambiguity without importing title notes',()=>{
 const words=[word('项目名称',0,500,100,520),word('南次卧',120,500,200,520),word('联系电话',0,540),word('19000000000',120,540),word('衣柜',500,200),word('2340',100,100),word('1576',500,400),word('材质及五金说明',800,500)];
 const row=drawingFromWords(words,'截图.png');assert.equal(row.room,'南次卧');assert.equal(row.name,'衣柜');assert.match(row.note,/核对红色柜名/);assert.equal(row.config,undefined);assert.equal(drawingFromWords([...words,word('鞋柜',700,200)],'截图.png').name,'');
});
