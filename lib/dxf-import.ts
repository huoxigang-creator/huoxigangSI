import type {DrawingRow} from './drawing-import';
export class CadImportError extends Error{constructor(message:string,public status=400){super(message);}}
export type CadRow=DrawingRow;
type Ent={type:string;vals:Map<number,string[]>};
const v=(e:Ent,c:number)=>e.vals.get(c)?.[0]?.trim()??'';
const n=(e:Ent,c:number,fallback=NaN)=>v(e,c)===''?fallback:Number(v(e,c));
const clean=(s:string)=>s.replace(/\\U\+([0-9a-f]{4})/gi,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/\\P/g,' ').replace(/\\[A-Za-z][^;]*;/g,'').replace(/[{}]/g,'').trim();
type Point={x:number;y:number};
type Dim=Point&{value:number;axis:'x'|'y'|'other';start:number;end:number;line:number};
type Box={left:number;right:number;bottom:number;top:number};
const contains=(b:Box,p:Point)=>p.x>=b.left&&p.x<=b.right&&p.y>=b.bottom&&p.y<=b.top;

/** Only placed model entities are measured; unused block definitions and dimension
 * display blocks must never become extra cabinets or duplicate dimensions. */
export function parseDxfText(text:string,source:string):CadRow[]{
 if(text.startsWith('AutoCAD Binary DXF'))throw new CadImportError('请将二进制DXF另存为ASCII DXF后上传');
 const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/),ents:Ent[]=[];
 const types=new Set(['SECTION','ENDSEC','BLOCK','ENDBLK','INSERT','TEXT','MTEXT','ATTRIB','DIMENSION','LWPOLYLINE']);
 const codes=new Set([1,2,3,10,11,13,14,20,21,23,24,41,42,50,67,70]);
 let cur:Ent|null=null;
 for(let i=0;i+1<lines.length;i+=2){const code=Number(lines[i].trim());if(!Number.isInteger(code))continue;
  if(code===0){if(cur)ents.push(cur);const type=lines[i+1].trim();cur=types.has(type)?{type,vals:new Map()}:null;}
  else if(cur&&codes.has(code)){const a=cur.vals.get(code)||[];a.push(lines[i+1]);cur.vals.set(code,a);}
 }
 if(cur)ents.push(cur);
 let section='',block:Ent[]|null=null,unit=4;
 const model:Ent[]=[],blocks=new Map<string,{base:Point;entities:Ent[]}>();
 // INSUNITS describes drawing coordinates, not DIMENSION text overrides.
 for(let i=0;i+1<lines.length;i+=2)if(lines[i].trim()==='9'&&lines[i+1].trim()==='$INSUNITS')unit=Number(lines[i+3]?.trim())||4;
 const mm=({1:25.4,2:304.8,4:1,5:10,6:1000} as Record<number,number>)[unit];
 if(!mm)throw new CadImportError('暂不支持此DXF长度单位，请另存为毫米单位的DXF');
 for(const e of ents){
  if(e.type==='SECTION'){section=v(e,2);continue;}
  if(e.type==='ENDSEC'){section='';block=null;continue;}
  if(section==='BLOCKS'){
   if(e.type==='BLOCK'){block=[];blocks.set(v(e,2),{base:{x:n(e,10,0),y:n(e,20,0)},entities:block});}
   else if(e.type==='ENDBLK')block=null;else block?.push(e);
  }else if(section==='ENTITIES'&&n(e,67,0)!==1)model.push(e);
 }
 // Expand referenced 2D blocks with their insertion, scale, rotation and base point.
 type Matrix=[number,number,number,number,number,number];
 const identity:Matrix=[1,0,0,1,0,0];
 const point=(m:Matrix,x:number,y:number):Point=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]});
 const placed:{e:Ent;m:Matrix}[]=[];
 function expand(es:Ent[],m:Matrix,path:string[]){for(const e of es){
  if(e.type!=='INSERT'){if(['TEXT','MTEXT','ATTRIB','DIMENSION','LWPOLYLINE'].includes(e.type))placed.push({e,m});continue;}
  const key=v(e,2),b=blocks.get(key);if(!b||path.includes(key)||path.length>=12)continue;
  if(placed.length>100000)throw new CadImportError('CAD图块过于复杂，请拆分图纸后上传');
  const a=n(e,50,0)*Math.PI/180,sx=n(e,41,1),sy=n(e,42,1),c=Math.cos(a),s=Math.sin(a);
  const q:Matrix=[c*sx,s*sx,-s*sy,c*sy,n(e,10,0)-c*sx*b.base.x+s*sy*b.base.y,n(e,20,0)-s*sx*b.base.x-c*sy*b.base.y];
  const r=point(m,q[4],q[5]);
  expand(b.entities,[m[0]*q[0]+m[2]*q[1],m[1]*q[0]+m[3]*q[1],m[0]*q[2]+m[2]*q[3],m[1]*q[2]+m[3]*q[3],r.x,r.y],[...path,key]);
 }}
 expand(model,identity,[]);
 const anchors:(Point&{room:string;name:string})[]=[],dims:Dim[]=[],boxes:Box[]=[];
 const seen=new Set<string>();
 for(const {e,m} of placed){
  if(['TEXT','MTEXT','ATTRIB'].includes(e.type)){
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
   dims.push({...p,value,axis,start:axis==='y'?Math.min(a.y,b.y):Math.min(a.x,b.x),end:axis==='y'?Math.max(a.y,b.y):Math.max(a.x,b.x),line:axis==='y'?p.x:p.y});
  }else if(e.type==='LWPOLYLINE'&&(n(e,70,0)&1)){
   const xs=e.vals.get(10)||[],ys=e.vals.get(20)||[];
   if(xs.length!==4||ys.length!==4||(e.vals.get(42)||[]).some(s=>Number(s)!==0))continue;
   const ps=xs.map((x,i)=>point(m,Number(x),Number(ys[i])));
   const box={left:Math.min(...ps.map(p=>p.x)),right:Math.max(...ps.map(p=>p.x)),bottom:Math.min(...ps.map(p=>p.y)),top:Math.max(...ps.map(p=>p.y))};
   if(ps.every(p=>(Math.abs(p.x-box.left)<0.01||Math.abs(p.x-box.right)<0.01)&&(Math.abs(p.y-box.bottom)<0.01||Math.abs(p.y-box.top)<0.01)))boxes.push(box);
  }
 }
 const frames=anchors.map(a=>boxes.filter(b=>contains(b,a)&&anchors.filter(p=>contains(b,p)).length===1).sort((a,b)=>(a.right-a.left)*(a.top-a.bottom)-(b.right-b.left)*(b.top-b.bottom))[0]);
 const buckets=anchors.map(()=>[] as Dim[]);
 for(const d of dims){let best=-1,distance=Infinity;
  const framed=frames.map((b,i)=>b&&contains(b,d)?i:-1).filter(i=>i>=0);
  for(let i=0;i<anchors.length;i++){if(framed.length&&!framed.includes(i)||!framed.length&&frames[i]&&!contains(frames[i],d))continue;
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
 return anchors.map((a,i):CadRow=>{
  const ds=buckets[i],kitchen=!a.name.includes('冰箱柜')&&/厨房|橱柜/.test(a.room+' '+a.name);
  const w=overall(ds.filter(d=>d.axis==='x')),h=overall(ds.filter(d=>d.axis==='y'));
  const total=Math.round(ds.reduce((s,d)=>s+d.value,0)*100)/100;
  const width=kitchen?total:w?.value??0,height=kitchen?0:h?.value??0;
  const complete=width>0&&width<=30000&&(height<=30000&&(height>0||!a.name.includes('冰箱柜')));
  const formula=kitchen?`${ds.map(d=>d.value).join('+')}=${total}mm`:height>0?`${w?.formula||'?'} × ${h?.formula||'?'} mm`:`${w?.formula||'?'} mm 延米`;
  return {source,room:a.room,name:a.name,width:width>0&&width<=30000?String(width):'',height:height>0&&height<=30000?String(height):'',price:'',selected:complete,config:'',note:complete?formula:`尺寸未识别完整，请核对宽高：${formula}`};
 });
}
