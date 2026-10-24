import type {DrawingRow} from './drawing-import';
export class CadImportError extends Error{constructor(message:string,public status=400){super(message);}}
export type CadRow=DrawingRow;

/** 解析 DXF 文本：提取柜体锚点文字（含 / 的房间/柜名）与 DIMENSION 尺寸标注，
 *  每个尺寸按位置归属最近的锚点，大框内所有尺寸相加作为总宽（延米，mm），高度留空。
 *  与截图识别不同：一个 CAD 文件可含多个柜体名称和多个尺寸，各自独立计算。 */
export function parseDxfText(text:string,source:string):CadRow[]{
 const lines=text.split(/\r?\n/);
 // 组码对序列
 const pairs:[number,string][]=[];
 for(let i=0;i+1<lines.length;i+=2){
  const code=Number(lines[i].trim());
  if(Number.isNaN(code))continue;
  pairs.push([code,lines[i+1]]);
 }
 // 切分实体：code 0 开始新实体
 type Ent={type:string;vals:Map<number,string[]>};
 const ents:Ent[]=[];
 let cur:Ent|null=null;
 for(const [code,val] of pairs){
  if(code===0){
   if(cur)ents.push(cur);
   cur={type:val.trim(),vals:new Map()};
  }else if(cur){
   const arr=cur.vals.get(code)||[];arr.push(val);cur.vals.set(code,arr);
  }
 }
 if(cur)ents.push(cur);
 const v=(e:Ent,code:number)=>e.vals.get(code)?.[0]??'';
 const vn=(e:Ent,code:number):number=>{const s=v(e,code).trim();const n=Number(s);return Number.isFinite(n)?n:NaN;};
 // 1. 锚点：TEXT 中含 '/' 的 房间/柜名；按坐标去重，且柜名需含柜体关键词（过滤水槽"台上/台下盆"等说明文字）
 const anchors:{raw:string;room:string;name:string;x:number;y:number}[]=[];
 const seen=new Set<string>();
 const cabinetWord=/柜|岛台|榻榻米|中岛|台面/;
 for(const e of ents){
  if(e.type!=='TEXT')continue;
  const raw=v(e,1).trim();
  if(!raw||!raw.includes('/'))continue;
  const x=vn(e,10),y=vn(e,20);
  if(Number.isNaN(x)||Number.isNaN(y))continue;
  const parts=raw.split('/');
  const room=parts[0].trim();
  const name=parts.slice(1).join('/').trim();
  if(!name||!cabinetWord.test(name))continue;
  const key=`${raw}|${Math.round(x)}|${Math.round(y)}`;
  if(seen.has(key))continue;
  seen.add(key);
  anchors.push({raw,room,name,x,y});
 }
 // 2. 尺寸：DIMENSION 的测量值（code 1 文字或 42 实际值），位置取 defpoint(10/20) 与 defpoint2(13/23) 中点
 const dims:{value:number;x:number;y:number}[]=[];
 for(const e of ents){
  if(e.type!=='DIMENSION')continue;
  let value=vn(e,1);
  if(Number.isNaN(value)||value<=0||value>30000)value=vn(e,42);
  if(Number.isNaN(value)||value<=0||value>30000)continue;
  const x1=vn(e,10),y1=vn(e,20),x2=vn(e,13),y2=vn(e,23);
  if(Number.isNaN(x1)||Number.isNaN(y1))continue;
  const mx=Number.isFinite(x2)?(x1+x2)/2:x1,my=Number.isFinite(y2)?(y1+y2)/2:y1;
  dims.push({value:Math.round(value),x:mx,y:my});
 }
 // 3. 归属：每个尺寸归到最近锚点（欧氏距离），锚点无尺寸则跳过
 const buckets:Map<number,number[]>=new Map();
 for(const d of dims){
  let best=-1,bestD=Infinity;
  for(let i=0;i<anchors.length;i++){
   const a=anchors[i];
   const dist=Math.hypot(d.x-a.x,d.y-a.y);
   if(dist<bestD){bestD=dist;best=i;}
  }
  if(best<0)continue;
  const arr=buckets.get(best)||[];arr.push(d.value);buckets.set(best,arr);
 }
 // 4. 生成行：width=该锚点所有尺寸之和（mm），厨房留空高度（延米）
 const rows:CadRow[]=[];
 for(let i=0;i<anchors.length;i++){
  const a=anchors[i];
  const vals=(buckets.get(i)||[]).sort((p,q)=>p-q);
  if(!vals.length)continue;
  const total=vals.reduce((s,n)=>s+n,0);
  if(total<=0||total>30000)continue;
  const formula=vals.join('+');
  rows.push({
   source:source+(formula?`（${formula}）`:''),
   room:a.room,
   name:a.name,
   width:String(total),
   height:a.room.includes('厨房')?'':'',
   price:'',
   selected:true,
   config:'',
   note:formula?`尺寸公式：${formula}=${total}mm`:'',
  });
 }
 return rows;
}
