import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const compile=path=>ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const parserUrl=url(compile('lib/dxf-import.ts'));
const {parseDxfText}=await import(parserUrl);
const ent=(type,values)=>[[0,type],...values].flat().join('\n')+'\n';
const doc=(body,blocks='')=>ent('SECTION',[[2,'BLOCKS']])+blocks+ent('ENDSEC',[])+ent('SECTION',[[2,'ENTITIES']])+body+ent('ENDSEC',[])+ent('EOF',[]);
const label=(name='主卧/衣柜',x=500,y=500)=>ent('TEXT',[[1,name],[10,x],[20,y]]);
const dim=(value,x1,y1,x2,y2,x,y)=>ent('DIMENSION',[[70,0],[42,value],[13,x1],[23,y1],[14,x2],[24,y2],[11,x],[21,y]]);
const horizontal=(v,x=0,y=0)=>dim(v,x,y,x+v,y,x+v/2,y-100);
const vertical=(v,x=0,y=0)=>dim(v,x,y,x,y+v,x-100,y+v/2);
test('area uses overall width and height without adding subdivisions',()=>{
 const [r]=parseDxfText(doc(label()+horizontal(2000)+horizontal(1000)+horizontal(1000,1000)+vertical(2400)),'a.dxf');
 assert.equal(r.width,'2000');assert.equal(r.height,'2400');assert.equal(r.selected,true);
});
test('name containing 橱柜 sums all dimensions outside kitchen',()=>{
 const [r]=parseDxfText(doc(label('餐厅/橱柜')+horizontal(2000)+vertical(1000)),'a.dxf');
 assert.equal(r.width,'3000');assert.equal(r.height,'');assert.equal(r.selected,true);
});
test('kitchen adds segments, preserving distinct cabinets',()=>{
 const rows=parseDxfText(doc(label('厨房/地柜')+horizontal(1044)+vertical(2682)+horizontal(1054,1500)+label('厨房/地柜',10000,500)+horizontal(1608,9500)+vertical(1614,10500)),'a.dxf');
 assert.deepEqual(rows.map(r=>r.width),['4780','3222']);
});
test('missing refrigerator cabinet height is retained unselected for manual correction',()=>{
 const [r]=parseDxfText(doc(label('厨房/冰箱柜')+horizontal(2000)),'a.dxf');assert.equal(r.height,'');assert.equal(r.selected,false);assert.match(r.note,/未识别完整/);
});
test('block definitions are ignored unless inserted, including repeated inserts',()=>{
 const blocks=ent('BLOCK',[[2,'cabinet'],[10,0],[20,0]])+label()+horizontal(2000)+vertical(2400)+ent('ENDBLK',[]);
 assert.equal(parseDxfText(doc('',blocks),'a.dxf').length,0);
 const rows=parseDxfText(doc(ent('INSERT',[[2,'cabinet'],[10,10000],[20,0]])+ent('INSERT',[[2,'cabinet'],[10,20000],[20,0]]),blocks),'a.dxf');
 assert.equal(rows.length,2);assert.ok(rows.every(r=>r.width==='2000'&&r.height==='2400'));
});
test('MTEXT and unicode CAD escapes support cabinet labels',()=>{
 const text=ent('MTEXT',[[1,'{\\fArial;餐厅／橱柜}'],[10,500],[20,500]]);
 assert.equal(parseDxfText(doc(text+horizontal(2000)),'a.dxf')[0].width,'2000');
});
// Exercise the real HTTP route and byte-decoding path, replacing only auth/input
// helpers so the regression never opens a database or writes business records.
const stub=url(`export const selectionHeaders={};export const selectionOwner=r=>{if(!r.headers.get('oai-authenticated-user-id'))throw Error('auth');return 'test';};export const selectionInput=r=>r.json();export const selectionFailure=()=>Response.json({error:'auth'},{status:401});`);
const route=await import(url(compile('app/api/cad-recognition/route.ts').replace('../../../lib/dxf-import',parserUrl).replace('../../../lib/material-selection-http',stub)));
test('base64 DXF sent by upload client reaches parser as decoded text',async()=>{
 const content=Buffer.from(doc(label()+horizontal(2000)+vertical(2400))).toString('base64');
 const r=await route.POST(new Request('http://localhost/api/cad-recognition',{method:'POST',headers:{'oai-authenticated-user-id':'test','content-type':'application/json'},body:JSON.stringify({content,encoding:'base64',source:'a.dxf'})}));
 assert.equal(r.status,200);assert.equal((await r.json()).result[0].height,'2400');
});
test('route retains login requirement',async()=>{
 assert.equal((await route.POST(new Request('http://localhost/api/cad-recognition',{method:'POST',body:'{}'}))).status,401);
});
if(process.env.CAD_SAMPLE_PATH)test('provided drawing reads both independent kitchen cabinets',()=>{
 const rows=parseDxfText(fs.readFileSync(process.env.CAD_SAMPLE_PATH,'utf8'),'青河丽景D14-1-502.dxf');
 assert.deepEqual(rows.map(r=>[r.room,r.name,r.width,r.height]),[['厨房','地柜','4780',''],['厨房','地柜','3222','']]);
 fs.mkdirSync('outputs/cad-verification',{recursive:true});fs.writeFileSync('outputs/cad-verification/青河丽景D14-1-502.json',JSON.stringify(rows,null,2));
});

test('refrigerator cabinet in kitchen keeps width and height for area',()=>{
const [r]=parseDxfText(doc(label('厨房/橱柜冰箱柜')+horizontal(900)+vertical(2400)),'a.dxf');assert.equal(r.width,'900');assert.equal(r.height,'2400');assert.equal(r.selected,true);
});
test('TV cabinet with width alone uses meters; width and height uses area',()=>{
const [linear]=parseDxfText(doc(label('客厅/电视柜')+horizontal(2000)),'a.dxf');assert.equal(linear.width,'2000');assert.equal(linear.height,'');assert.equal(linear.selected,true);
const [area]=parseDxfText(doc(label('客厅/电视柜')+horizontal(2000)+vertical(500)),'a.dxf');assert.equal(area.width,'2000');assert.equal(area.height,'500');
});

test('binary DXF route returns expected cabinets and keeps source name',async()=>{
 const body=doc(label('厨房/冰箱柜')+horizontal(900)+vertical(2400));
 const r=await route.POST(new Request('http://localhost/api/cad-recognition',{method:'POST',headers:{'oai-authenticated-user-id':'test','content-type':'application/octet-stream','x-cad-source':encodeURIComponent('测试.dxf')},body}));
 assert.equal(r.status,200);const value=await r.json();assert.equal(value.result[0].height,'2400');assert.equal(value.result[0].source,'测试.dxf');
});
test('binary upload rejects oversize advertised body and cross-origin request',async()=>{
 for(const [extra,status] of [[{'content-length':String(100*1024*1024+1)},413],[{'origin':'https://other.example'},403]]){
 const r=await route.POST(new Request('http://localhost/api/cad-recognition',{method:'POST',headers:{'oai-authenticated-user-id':'test','content-type':'application/octet-stream',...extra},body:'x'}));assert.equal(r.status,status);
 }
});
if(process.env.CAD_LARGE_TEST)test('exactly 100MB binary DXF parses successfully without business writes',async()=>{
 const base=doc(label('客厅/电视柜')+horizontal(2000));
 const body=Buffer.alloc(100*1024*1024,32);body.write(base,0,'utf8');
 const r=await route.POST(new Request('http://localhost/api/cad-recognition',{method:'POST',headers:{'oai-authenticated-user-id':'test','content-type':'application/octet-stream','content-length':String(body.length)},body}));
 assert.equal(r.status,200);assert.equal((await r.json()).result[0].width,'2000');
});

const outline=(x=0,y=0,w=2000,h=2400)=>ent('LWPOLYLINE',[[70,1],[10,x],[20,y],[10,x+w],[20,y],[10,x+w],[20,y+h],[10,x],[20,y+h]]);
test('each cabinet preview contains original outline and assigned dimensions only',()=>{
 const rows=parseDxfText(doc(label()+outline()+horizontal(2000)+vertical(2400)+label('次卧/衣柜',10500,500)+outline(10000,0,1800,2100)+horizontal(1800,10000)+vertical(2100,10000)),'preview.dxf');
 assert.match(rows[0].previewSvg,/>2000<\/text>/);assert.match(rows[0].previewSvg,/>2400<\/text>/);
 assert.doesNotMatch(rows[0].previewSvg,/>1800<\/text>/);assert.doesNotMatch(rows[1].previewSvg,/>2400<\/text>/);
 assert.match(rows[1].previewSvg,/>2100<\/text>/);assert.match(rows[0].previewSvg,/<path/);
});
test('CAD text is inert and the preview never invents missing cabinet geometry',()=>{
 const [safe]=parseDxfText(doc(label('主卧/衣柜<script>alert(1)</script>')+outline()+horizontal(2000)),'x.dxf');
 assert.ok(safe.previewSvg);assert.doesNotMatch(safe.previewSvg,/<script|onload|foreignObject/);assert.match(safe.previewSvg,/&lt;script&gt;/);
 const [missing]=parseDxfText(doc(label()+horizontal(2000)),'x.dxf');assert.equal(missing.previewSvg,undefined);assert.match(missing.previewWarning,/未找到/);
});
test('legacy 2D polyline and rotated inserted graphics remain visible without changing measurements',()=>{
 const poly=ent('POLYLINE',[[70,1]])+[[0,0],[2000,0],[2000,2400],[0,2400]].map(([x,y])=>ent('VERTEX',[[10,x],[20,y]])).join('')+ent('SEQEND',[]);
 const blocks=ent('BLOCK',[[2,'cab'],[10,0],[20,0]])+label()+poly+horizontal(2000)+vertical(2400)+ent('ENDBLK',[]);
 const [r]=parseDxfText(doc(ent('INSERT',[[2,'cab'],[10,10000],[20,5000],[50,180]]),blocks),'x.dxf');
 assert.equal(r.width,'2000');assert.equal(r.height,'2400');assert.match(r.previewSvg,/8000,-5000/);
});
