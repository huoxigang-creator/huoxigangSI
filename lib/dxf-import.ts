import type {DrawingRow} from './drawing-import';
export class CadImportError extends Error{constructor(message:string,public status=400){super(message);}}
export type CadRow=DrawingRow;
type Ent={type:string;vals:Map<number,string[]>};
const v=(e:Ent,c:number)=>e.vals.get(c)?.[0]?.trim()??'';
const n=(e:Ent,c:number,fallback=NaN)=>v(e,c)===''?fallback:Number(v(e,c));
const clean=(s:string)=>s.replace(/\\U\+([0-9a-f]{4})/gi,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/\\P/g,' ').replace(/\\[A-Za-z][^;]*;/g,'').replace(/[{}]/g,'').trim();
type Point={x:number;y:number};
type Dim=Point&{value:number;axis:'x'|'y'|'other';start:number;end:number;line:number;a:Point;b:Point;def:Point};
type Box={left:number;right:number;bottom:number;top:number};
const contains=(b:Box,p:Point)=>p.x>=b.left&&p.x<=b.right&&p.y>=b.bottom&&p.y<=b.top;

/** Only placed model entities are measured; unused block definitions and dimension
 * display blocks must never become extra cabinets or duplicate dimensions. */
export function parseDxfText(text:string,source:string):CadRow[]{
 if(text.startsWith('AutoCAD Binary DXF'))throw new CadImportError('请将二进制DXF另存为ASCII DXF后上传');
 const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/),ents:Ent[]=[];
 const types=new Set(['SECTION','ENDSEC','LAYER','BLOCK','ENDBLK','INSERT','TEXT','MTEXT','ATTRIB','DIMENSION','LWPOLYLINE','LINE','CIRCLE','ARC','POLYLINE','VERTEX','SEQEND']);
 const codes=new Set([8,62,420,1,2,3,10,11,13,14,20,21,23,24,40,41,42,50,51,60,67,70]);
 let cur:Ent|null=null;
 for(let i=0;i+1<lines.length;i+=2){const code=Number(lines[i].trim());if(!Number.isInteger(code))continue;
  if(code===0){if(cur)ents.push(cur);const type=lines[i+1].trim();cur=types.has(type)?{type,vals:new Map()}:null;}
  else if(cur&&codes.has(code)){const a=cur.vals.get(code)||[];a.push(lines[i+1]);cur.vals.set(code,a);}
 }
 if(cur)ents.push(cur);
 for(let i=0;i<ents.length;i++)if(ents[i].type==='POLYLINE'){
  const e=ents[i];if(n(e,70,0)&(8|16|64))continue;
  const xs:string[]=[],ys:string[]=[],bulges:string[]=[];
  for(let j=i+1;j<ents.length&&ents[j].type==='VERTEX';j++){xs.push(v(ents[j],10));ys.push(v(ents[j],20));bulges.push(v(ents[j],42)||'0');}
  e.type='LWPOLYLINE';e.vals.set(10,xs);e.vals.set(20,ys);e.vals.set(42,bulges);
 }
 let section='',block:Ent[]|null=null,unit=4;
 const layers=new Map<string,Ent>();
 const model:Ent[]=[],blocks=new Map<string,{base:Point;entities:Ent[]}>();
 // INSUNITS describes drawing coordinates, not DIMENSION text overrides.
 for(let i=0;i+1<lines.length;i+=2)if(lines[i].trim()==='9'&&lines[i+1].trim()==='$INSUNITS')unit=Number(lines[i+3]?.trim())||4;
 const mm=({1:25.4,2:304.8,4:1,5:10,6:1000} as Record<number,number>)[unit];
 if(!mm)throw new CadImportError('暂不支持此DXF长度单位，请另存为毫米单位的DXF');
 for(const e of ents){
  if(e.type==='SECTION'){section=v(e,2);continue;}
  if(e.type==='ENDSEC'){section='';block=null;continue;}
  if(section==='TABLES'&&e.type==='LAYER')layers.set(v(e,2),e);
  if(section==='BLOCKS'){
   if(e.type==='BLOCK'){block=[];blocks.set(v(e,2),{base:{x:n(e,10,0),y:n(e,20,0)},entities:block});}
   else if(e.type==='ENDBLK')block=null;else block?.push(e);
  }else if(section==='ENTITIES'&&n(e,67,0)!==1)model.push(e);
 }
 // Expand referenced 2D blocks with their insertion, scale, rotation and base point.
 type Matrix=[number,number,number,number,number,number];
 const identity:Matrix=[1,0,0,1,0,0];
 const point=(m:Matrix,x:number,y:number):Point=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]});
 const placed:{e:Ent;m:Matrix;red:boolean}[]=[];
 const isRed=(e:Ent,layer:string,inherited=false):boolean=>{
  const color=n(e,420);if(Number.isFinite(color)){const r=(color>>16)&255,g=(color>>8)&255,b=color&255;return r>150&&r>g*1.5&&r>b*1.5;}
  const aci=n(e,62,256);if(aci===0)return inherited;if(aci!==256)return aci===1;
  const l=e.type==='LAYER'?undefined:layers.get(layer);return l?isRed(l,'',false):false;
 };
 function expand(es:Ent[],m:Matrix,path:string[],parentLayer='0',parentRed=false){for(const e of es){
  const layer=v(e,8)==='0'||!v(e,8)?parentLayer:v(e,8),red=isRed(e,layer,parentRed);
  if(placed.length>=100000)throw new CadImportError('CAD图块过于复杂，请拆分图纸后上传');
  if(e.type!=='INSERT'){if(n(e,60,0)!==1&&['TEXT','MTEXT','ATTRIB','DIMENSION','LWPOLYLINE','LINE','CIRCLE','ARC'].includes(e.type))placed.push({e,m,red});continue;}
  const key=v(e,2),b=blocks.get(key);if(!b||path.includes(key)||path.length>=12)continue;
  if(placed.length>100000)throw new CadImportError('CAD图块过于复杂，请拆分图纸后上传');
  const a=n(e,50,0)*Math.PI/180,sx=n(e,41,1),sy=n(e,42,1),c=Math.cos(a),s=Math.sin(a);
  const q:Matrix=[c*sx,s*sx,-s*sy,c*sy,n(e,10,0)-c*sx*b.base.x+s*sy*b.base.y,n(e,20,0)-s*sx*b.base.x-c*sy*b.base.y];
  const r=point(m,q[4],q[5]);
  expand(b.entities,[m[0]*q[0]+m[2]*q[1],m[1]*q[0]+m[3]*q[1],m[0]*q[2]+m[2]*q[3],m[1]*q[2]+m[3]*q[3],r.x,r.y],[...path,key],layer,red);
 }}
 expand(model,identity,[]);
 // Title-block drawings use only the project-name field and red cabinet labels.
 // Read placed text (including transformed blocks), never unused definitions.
 const texts=placed.filter(({e})=>['TEXT','MTEXT','ATTRIB'].includes(e.type)).map(({e,m,red})=>({e,red,...point(m,n(e,10),n(e,20)),size:n(e,40,40)*Math.hypot(m[0],m[1]),text:clean((e.vals.get(3)||[]).join('')+v(e,1))})).filter(t=>t.text&&Number.isFinite(t.x+t.y));
 const roomFields=texts.flatMap(t=>{
  const match=t.text.match(/^项目名称\s*[:：]?\s*(.*)$/);if(!match)return [];
  let room=match[1].trim();
  if(!room){const candidates=texts.filter(p=>p!==t&&p.x>t.x&&p.x-t.x<t.size*20&&Math.abs(p.y-t.y)<Math.max(t.size,p.size)*.8).sort((a,b)=>a.x-b.x);room=candidates[0]?.text||'';}
  return room&&room.length<=50&&!/[:：/／]|电话|地址|日期|合同|项目名称/.test(room)?[{...t,room}]:[];
 });
 const cabinetName=(text:string)=>/^(?:[\u4e00-\u9fffA-Za-z0-9（）()_-]{0,25}柜|岛台|中岛|榻榻米|台面|床头|护墙)$/.test(text);
 const templateMode=roomFields.length>0&&texts.some(t=>t.red&&cabinetName(t.text));
 const anchors:(Point&{room:string;name:string})[]=[],dims:Dim[]=[],boxes:Box[]=[];
 if(templateMode)for(const t of texts.filter(t=>t.red&&cabinetName(t.text))){
  const field=[...roomFields].sort((a,b)=>Math.hypot(a.x-t.x,a.y-t.y)-Math.hypot(b.x-t.x,b.y-t.y))[0];
  if(!anchors.some(a=>a.name===t.text&&Math.hypot(a.x-t.x,a.y-t.y)<.01))anchors.push({x:t.x,y:t.y,room:field.room,name:t.text});
 }

 const seen=new Set<string>();
 for(const {e,m} of placed){
  if(['TEXT','MTEXT','ATTRIB'].includes(e.type)){
   if(templateMode)continue;
   const raw=clean((e.vals.get(3)||[]).join('')+v(e,1));
   const match=raw.match(/^(.{1,50}?)\s*[/／]\s*(.{1,100})$/);if(!match||!/柜|岛台|榻榻米|中岛|台面|床头|护墙/.test(match[2]))continue;
   const p=point(m,n(e,10),n(e,20));if(!Number.isFinite(p.x+p.y))continue;
   const key=`${raw}|${p.x.toFixed(2)}|${p.y.toFixed(2)}`;if(seen.has(key))continue;seen.add(key);
   anchors.push({...p,room:match[1].trim(),name:match[2].trim()});
  }else if(e.type==='DIMENSION'){
   // Radius, angle and diameter dimensions do not measure cabinet projection.
   if(![0,1].includes(n(e,70,0)&7))continue;
   const a=point(m,n(e,13),n(e,23)),b=point(m,n(e,14),n(e,24));
   const p=point(m,n(e,11,n(e,10)),n(e,21,n(e,20)));
   if(!Number.isFinite(a.x+a.y+b.x+b.y+p.x+p.y))continue;
   const dx=Math.abs(b.x-a.x),dy=Math.abs(b.y-a.y),axis=dy<Math.max(0.01,dx*0.001)?'x':dx<Math.max(0.01,dy*0.001)?'y':'other';
   const label=clean(v(e,1)),override=/^\d+(?:\.\d+)?(?:\s*mm)?$/i.test(label)?parseFloat(label):NaN;
   const localDistance=Math.hypot(n(e,14)-n(e,13),n(e,24)-n(e,23));
   const scale=localDistance>0?Math.hypot(dx,dy)/localDistance:1;
   const value=Number.isFinite(override)?override*scale:Math.round(n(e,42,localDistance)*mm*scale);
   if(value<=0||value>30000||!Number.isFinite(value))continue;
   dims.push({...p,a,b,def:v(e,10)&&v(e,20)?point(m,n(e,10),n(e,20)):p,value,axis,start:axis==='y'?Math.min(a.y,b.y):Math.min(a.x,b.x),end:axis==='y'?Math.max(a.y,b.y):Math.max(a.x,b.x),line:axis==='y'?p.x:p.y});
  }else if(e.type==='LWPOLYLINE'&&(n(e,70,0)&1)){
   const xs=e.vals.get(10)||[],ys=e.vals.get(20)||[];
   if(xs.length!==4||ys.length!==4||(e.vals.get(42)||[]).some(s=>Number(s)!==0))continue;
   const ps=xs.map((x,i)=>point(m,Number(x),Number(ys[i])));
   const box={left:Math.min(...ps.map(p=>p.x)),right:Math.max(...ps.map(p=>p.x)),bottom:Math.min(...ps.map(p=>p.y)),top:Math.max(...ps.map(p=>p.y))};
   if(ps.every(p=>(Math.abs(p.x-box.left)<0.01||Math.abs(p.x-box.right)<0.01)&&(Math.abs(p.y-box.bottom)<0.01||Math.abs(p.y-box.top)<0.01)))boxes.push(box);
  }
 }
 const frames=anchors.map(a=>templateMode?undefined:boxes.filter(b=>contains(b,a)&&dims.some(d=>contains(b,d))&&anchors.filter(p=>contains(b,p)).length===1).sort((a,b)=>(a.right-a.left)*(a.top-a.bottom)-(b.right-b.left)*(b.top-b.bottom))[0]);
 const buckets=anchors.map(()=>[] as Dim[]);
 for(const d of dims){let best=-1,distance=Infinity;
  const framed=frames.map((b,i)=>b&&contains(b,d)?i:-1).filter(i=>i>=0);
  for(let i=0;i<anchors.length;i++){const frame=frames[i];if(framed.length&&!framed.includes(i)||!framed.length&&frame&&!contains(frame,d))continue;
   const dist=Math.hypot(d.x-anchors[i].x,d.y-anchors[i].y);if(dist<distance){distance=dist;best=i;}}
  if(best>=0)buckets[best].push(d);
 }
 // For projected area choose an overall dimension, or the outermost non-overlapping
 // dimension chain. Internal subdivisions must not be added to the overall width.
 function overall(ds:Dim[]):{value:number;formula:string}|null{
  if(!ds.length)return null;
  const groups:Dim[][]=[];
  for(const d of ds){const g=groups.find(g=>Math.abs(g[0].line-d.line)<0.5);if(g)g.push(d);else groups.push([d]);}
  return groups.map(g=>{const sorted=[...g].sort((a,b)=>a.start-b.start||b.end-a.end);const keep:Dim[]=[];
   for(const d of sorted){if(keep.some(p=>d.start<p.end-0.5))continue;keep.push(d);}
   return {value:keep.reduce((s,d)=>s+d.value,0),formula:keep.map(d=>d.value).join('+')};
  }).sort((a,b)=>b.value-a.value)[0];
 }
 // Preview geometry is independent from measurement: no invented cabinet rectangles.
 // Only safe SVG primitives are emitted; CAD text is escaped, never inserted as markup.
 const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
 const fmt=(x:number)=>String(Math.round(x*1000)/1000);
 const bounds=(ps:Point[]):Box=>({left:Math.min(...ps.map(p=>p.x)),right:Math.max(...ps.map(p=>p.x)),bottom:Math.min(...ps.map(p=>p.y)),top:Math.max(...ps.map(p=>p.y))});
 const overlap=(a:Box,b:Box)=>a.left<=b.right&&a.right>=b.left&&a.bottom<=b.top&&a.top>=b.bottom;
 const pad=(b:Box,p:number):Box=>({left:b.left-p,right:b.right+p,bottom:b.bottom-p,top:b.top+p});
 const union=(a:Box,b:Box):Box=>({left:Math.min(a.left,b.left),right:Math.max(a.right,b.right),bottom:Math.min(a.bottom,b.bottom),top:Math.max(a.top,b.top)});
 const graphics:{box:Box;svg:string;shape:boolean}[]=[];
 function path(ps:Point[],closed=false){if(ps.length<2||!ps.every(p=>Number.isFinite(p.x+p.y)))return;
  graphics.push({box:bounds(ps),shape:true,svg:`<path d="M${ps.map(p=>fmt(p.x)+','+fmt(-p.y)).join(' L')}${closed?' Z':''}" fill="none"/>`});
 }
 for(const {e,m} of placed){
  if(e.type==='LINE')path([point(m,n(e,10),n(e,20)),point(m,n(e,11),n(e,21))]);
  if(e.type==='LWPOLYLINE'){
   const xs=e.vals.get(10)||[],ys=e.vals.get(20)||[],bulges=e.vals.get(42)||[];
   if(xs.length>10000)continue;
   const raw=xs.map((x,i)=>({x:Number(x),y:Number(ys[i])})),ps:Point[]=[];
   const closed=!!(n(e,70,0)&1);
   for(let j=0;j<raw.length;j++){
    const a=raw[j],b=raw[(j+1)%raw.length];ps.push(point(m,a.x,a.y));
    const bulge=Number(bulges[j]||0);if(!bulge||j===raw.length-1&&!closed)continue;
    const dx=b.x-a.x,dy=b.y-a.y,cx=(a.x+b.x)/2-dy*(1-bulge*bulge)/(4*bulge),cy=(a.y+b.y)/2+dx*(1-bulge*bulge)/(4*bulge);
    const angle=4*Math.atan(bulge),start=Math.atan2(a.y-cy,a.x-cx),r=Math.hypot(a.x-cx,a.y-cy),steps=Math.ceil(Math.abs(angle)*12);
    for(let k=1;k<steps;k++)ps.push(point(m,cx+r*Math.cos(start+angle*k/steps),cy+r*Math.sin(start+angle*k/steps)));
   }path(ps,closed);
  }
  if(e.type==='CIRCLE'||e.type==='ARC'){
   const r=n(e,40),cx=n(e,10),cy=n(e,20),start=e.type==='ARC'?n(e,50,0)*Math.PI/180:0;
   let sweep=e.type==='ARC'?(n(e,51,360)*Math.PI/180-start+Math.PI*2)%(Math.PI*2):Math.PI*2;
   if(sweep===0)sweep=Math.PI*2;const steps=Math.max(8,Math.ceil(sweep*16));
   if(r>0)path(Array.from({length:steps+1},(_,j)=>point(m,cx+r*Math.cos(start+sweep*j/steps),cy+r*Math.sin(start+sweep*j/steps))),e.type==='CIRCLE');
  }
  if(['TEXT','MTEXT','ATTRIB'].includes(e.type)){
   const text=clean((e.vals.get(3)||[]).join('')+v(e,1)).slice(0,500),p=point(m,n(e,10),n(e,20));
   if(templateMode&&!anchors.some(a=>a.name===text&&Math.hypot(a.x-p.x,a.y-p.y)<.01))continue;
   const size=n(e,40,40)*Math.hypot(m[0],m[1]),angle=n(e,50,0)+Math.atan2(m[1],m[0])*180/Math.PI;
   if(text&&size>0&&Number.isFinite(size+p.x+p.y+angle))graphics.push({box:pad(bounds([p]),size*text.length),shape:false,svg:`<text x="${fmt(p.x)}" y="${fmt(-p.y)}" font-size="${fmt(size)}" transform="rotate(${fmt(-angle)} ${fmt(p.x)} ${fmt(-p.y)})" fill="${templateMode?'#bb3030':'#203449'}" stroke="none">${esc(text)}</text>`});
  }
 }
 let previewBytes=0;
 function preview(i:number):Pick<CadRow,'previewSvg'|'previewWarning'>{
  const a=anchors[i],ds=buckets[i],points=[a,...ds.flatMap(d=>[d.a,d.b,d,d.def])];
  let box=bounds(points),span=Math.max(box.right-box.left,box.top-box.bottom,100);
  if(frames[i])box=union(box,frames[i]);span=Math.max(box.right-box.left,box.top-box.bottom,100);
  // Include nearby complete outlines, without pulling in the next cabinet drawing.
  const search=pad(box,span*.18),shapes=graphics.filter(g=>g.shape&&overlap(g.box,search)&&g.box.right-g.box.left<=span*2&&g.box.top-g.box.bottom<=span*2).filter(g=>{
   const p={x:(g.box.left+g.box.right)/2,y:(g.box.bottom+g.box.top)/2};
   return anchors.every((other,j)=>j===i||Math.hypot(p.x-a.x,p.y-a.y)<=Math.hypot(p.x-other.x,p.y-other.y));
  });
  if(!shapes.length)return {previewWarning:'未找到可显示的二维柜体线条，请上传原图截图核对。'};
  for(const g of shapes)box=union(box,g.box);span=Math.max(box.right-box.left,box.top-box.bottom,100);box=pad(box,span*.08);
  const width=box.right-box.left,height=box.top-box.bottom,fontSize=span*.018,stroke=span/1400;
  const selected=graphics.filter(g=>overlap(g.box,box));
  if(selected.length>15000)return {previewWarning:'此柜体图形过于复杂，请上传截图核对。'};
  const annotations=ds.map(d=>{
   const p=d.axis==='x'?{x:d.a.x,y:d.def.y}:{x:d.def.x,y:d.a.y},q=d.axis==='x'?{x:d.b.x,y:d.def.y}:{x:d.def.x,y:d.b.y};
   if(d.axis==='other')return '';
   const seg=(a:Point,b:Point)=>`<path d="M${fmt(a.x)},${fmt(-a.y)} L${fmt(b.x)},${fmt(-b.y)}"/>`;
   const tick=(p:Point)=>seg({x:p.x-fontSize*.2,y:p.y-fontSize*.2},{x:p.x+fontSize*.2,y:p.y+fontSize*.2});
   const rotate=d.axis==='y'?` transform="rotate(-90 ${fmt(d.x)} ${fmt(-d.y)})"`:'';
   return `<g stroke="#bb3030">${seg(d.a,p)}${seg(d.b,q)}${seg(p,q)}${tick(p)}${tick(q)}<text x="${fmt(d.x)}" y="${fmt(-d.y)}"${rotate} text-anchor="middle" font-size="${fmt(fontSize)}" fill="#bb3030" stroke="white" stroke-width="${fmt(fontSize*.2)}" paint-order="stroke">${d.value}</text></g>`;
  }).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${Math.max(200,Math.min(2400,Math.round(1600*height/width)))}" viewBox="${fmt(box.left)} ${fmt(-box.top)} ${fmt(width)} ${fmt(height)}"><rect x="${fmt(box.left)}" y="${fmt(-box.top)}" width="${fmt(width)}" height="${fmt(height)}" fill="white"/><g stroke="#263b50" stroke-width="${fmt(stroke)}" stroke-linejoin="round" font-family="Microsoft YaHei,Arial,sans-serif">${selected.map(g=>g.svg).join('')}${annotations}</g></svg>`;
  previewBytes+=svg.length;
  if(svg.length>2000000||previewBytes>12000000)return {previewWarning:'此柜体图形过于复杂，请上传截图核对。'};
  return {previewSvg:svg,previewWarning:'CAD二维局部预览；尺寸标注依原文件重绘，不含填充、外部参照及三维实体，请对照原文件核对。'};
 }
 return anchors.map((a,i):CadRow=>{
  const ds=buckets[i],kitchen=!a.name.includes('冰箱柜')&&/厨房|橱柜/.test(a.room+' '+a.name);
  const w=overall(ds.filter(d=>d.axis==='x')),h=overall(ds.filter(d=>d.axis==='y'));
  const total=Math.round(ds.reduce((s,d)=>s+d.value,0)*100)/100;
  const width=kitchen?total:w?.value??0,height=kitchen?0:h?.value??0;
  const complete=width>0&&width<=30000&&(height<=30000&&(height>0||!a.name.includes('冰箱柜')));
  const formula=kitchen?`${ds.map(d=>d.value).join('+')}=${total}mm`:height>0?`${w?.formula||'?'} × ${h?.formula||'?'} mm`:`${w?.formula||'?'} mm 延米`;
  return {...preview(i),source,room:a.room,name:a.name,width:width>0&&width<=30000?String(width):'',height:height>0&&height<=30000?String(height):'',price:'',selected:complete,config:'',note:complete?formula:`尺寸未识别完整，请核对宽高：${formula}`};
 });
}
