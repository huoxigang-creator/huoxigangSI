export type DrawingRow={source:string;room:string;name:string;width:string;height:string;price:string;selected:boolean;config?:string;note?:string;previewSvg?:string;previewWarning?:string};
type Word={text:string;bbox:{x0:number;y0:number;x1:number;y1:number}};
/** 把 "1800+1500+700"、"1800 1500 700" 或 "1800、1500" 这类多段宽度求和为一个数字（毫米）。 */
export function sumWidthMm(width:string):number{if(!width.trim())return NaN;const direct=Number(width);if(Number.isFinite(direct))return direct;const nums=width.match(/\d+(?:\.\d+)?/g);if(!nums||!nums.length)return NaN;return nums.reduce((s,n)=>s+Number(n),0);}
export function drawingArea(width:string,height:string){const w=sumWidthMm(width),h=Number(height);return width.trim()&&height.trim()&&Number.isFinite(w)&&Number.isFinite(h)&&w>0&&h>0&&w<=30000&&h<=30000?Math.round(w*h/1000000*100)/100:null;}
/** 只有宽没有高时按延米（米）计价：宽度毫米换算为米，保留 2 位小数；多段宽度自动求和。 */
export function drawingMeters(width:string){const w=sumWidthMm(width);return width.trim()&&Number.isFinite(w)&&w>0&&w<=30000?Math.round(w/1000*100)/100:null;}
/** CAD dimensions are candidates only: the user confirms the axes before import. */
export function drawingFromWords(words:Word[],source:string):DrawingRow{
 let text=words.map(w=>w.text).join(' ').replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,''),room=text.match(/(?:主卧室|次卧室|主卧|次卧|儿童房|客卧|书房|厨房|客餐厅|客厅|餐厅|阳台|玄关|卫生间)/)?.[0]||'',name=text.match(/(?:衣帽柜|衣柜|鞋柜|酒柜|书柜|橱柜|电视柜|储物柜|浴室柜|餐边柜)/)?.[0]||'';
 const numbers=words.filter(w=>/^\d{3,5}(?:\.\d+)?$/.test(w.text.trim())&&Number(w.text)>=100&&Number(w.text)<=30000);
 // Do not guess width/height from unrelated drawing numbers or telephone numbers.
 let width=text.match(/(?:宽度|宽|W)\s*[:：=]?\s*(\d{3,5}(?:\.\d+)?)/i)?.[1]||'',height=text.match(/(?:高度|高|H)\s*[:：=]?\s*(\d{3,5}(?:\.\d+)?)/i)?.[1]||'';
 const candidate=[...new Set(numbers.map(w=>w.text))];
 if(!width&&!height&&candidate.length===2){const a=numbers.find(w=>w.text===candidate[0])!,b=numbers.find(w=>w.text===candidate[1])!;const left=a.bbox.x0<b.bbox.x0?a:b,bottom=left===a?b:a;if(bottom.bbox.y0>left.bbox.y1&&bottom.bbox.x0>left.bbox.x1){width=bottom.text;height=left.text;}}
 let fieldRoom=room,fieldName=name;
 const project=words.find(w=>/^项目名称\s*[:：]?/.test(w.text.trim()));
 if(project){
  const inline=project.text.trim().replace(/^项目名称\s*[:：]?\s*/,''),sameLine=words.filter(w=>w!==project&&w.bbox.x0>=project.bbox.x1&&Math.abs((w.bbox.y0+w.bbox.y1-project.bbox.y0-project.bbox.y1)/2)<=Math.max(project.bbox.y1-project.bbox.y0,w.bbox.y1-w.bbox.y0)*.6).sort((a,b)=>a.bbox.x0-b.bbox.x0);
  const value=inline||sameLine[0]?.text.trim()||'';
  fieldRoom=value&&!/电话|地址|日期|合同|[:：]/.test(value)?value:'';
  // OCR words have no color data: do not guess which of several names is red.
  const names=[...new Set(words.map(w=>w.text.trim()).filter(t=>/^[\u4e00-\u9fff]{0,20}柜$/.test(t)))];fieldName=names.length===1?names[0]:'';
 }
 return {source:source+(candidate.length?'（尺寸候选：'+candidate.join('、')+' mm）':''),room:fieldRoom,name:fieldName,width,height,price:'',selected:true,...(project?{note:'本地OCR无法确认文字颜色，请核对红色柜名及对应尺寸。'}:{})};
}

/** 冰箱柜优先按面积；厨房/橱柜按延米，其余有高算面积、无高算延米。 */
export function isLinearCabinet(row:Pick<DrawingRow,'room'|'name'>){return !row.name.includes('冰箱柜')&&/厨房|橱柜/.test(row.room+' '+row.name);}
export function drawingMeasure(row:DrawingRow){
 const linear=isLinearCabinet(row),area=linear?null:drawingArea(row.width,row.height);
 const meters=area===null&&!row.name.includes('冰箱柜')&&(linear||!row.height.trim())?drawingMeters(row.width):null;
 return {area,meters};
}

/** Duplicate recognition requires the same room, cabinet name AND both dimensions.
 * Keep the first result and its image/file together; incomplete failures remain editable. */
export function uniqueDrawingEntries<T extends {row:DrawingRow}>(entries:T[]):T[]{
 const seen=new Set<string>();
 const dimension=(value:string,width=false)=>{
  const text=value.trim();if(!text)return '';
  const number=width&&/^[\d.\s+、,，]+$/.test(text)?sumWidthMm(text):Number(text);
  return Number.isFinite(number)&&number>0?String(number):text;
 };
 return entries.filter(({row})=>{
  const room=row.room.trim(),name=row.name.trim();if(!room||!name||!row.width.trim())return true;
  const key=JSON.stringify([room.toLowerCase(),name.toLowerCase(),dimension(row.width,true),dimension(row.height)]);
  if(seen.has(key))return false;seen.add(key);return true;
 });
}
