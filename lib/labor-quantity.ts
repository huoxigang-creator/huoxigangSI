import type {PurchaseOrderRecord} from './catalog-types';

function normalized(value:string){return value.normalize('NFKC').toLowerCase().replace(/\s+/g,'');}
export function boardSize(value:string):string|null {
  const text=normalized(value);
  const feet=text.match(/(?:^|[^\d])([3-6])(?:[x×*乘]?)([6-9]|1[02])尺/);
  if(feet)return `${feet[1]}x${feet[2]}`;
  const dimensions=text.match(/(?:^|[^\d])(1220|2440|2745|2750|3050)[x×*乘](1220|2440|2745|2750|3050)(?:mm|毫米)?(?:$|[^\d])/);
  if(dimensions){const sides=[Number(dimensions[1]),Number(dimensions[2])].sort((a,b)=>a-b);if(sides[0]===1220)return ({2440:'4x8',2745:'4x9',2750:'4x9',3050:'4x10'} as Record<number,string>)[sides[1]]||null;}
  return null;
}
export function thickness(value:string):string|null {
  const matches=[...normalized(value).matchAll(/(?<![\d.])(\d+(?:\.\d+)?)(?:mm|毫米)(?=$|[^a-z])/g)].map(match=>Number(match[1])).filter(value=>value>0&&value<100);
  const unique=[...new Set(matches)];return unique.length===1?String(unique[0]):null;
}
export function laborQuantity(labor:{name:string;model:string;unit:string},orders:PurchaseOrderRecord[],projectId:string){
  const laborName=normalized(labor.name);
  const scoped=orders.filter(order=>order.project_id===projectId&&!order.deleted).flatMap(order=>order.items).filter(item=>item.attribute!=='人工');
  if(laborName.includes('电梯')){
    const quantity=Math.round(scoped.reduce((sum,item)=>{const gauge=thickness(item.name+' '+item.model);return gauge==='5'||gauge==='18'?sum+(Number.isFinite(item.quantity)&&item.quantity>0?item.quantity:0):sum;},0)*1e6)/1e6;
    return {quantity,notice:''};
  }
  if(laborName.includes('运输'))return {quantity:1,notice:''};
  const size=boardSize(labor.name+' '+labor.model),gauge=thickness(labor.model)||thickness(labor.name);
  const backboard=normalized(labor.name).includes('背板');
  if((!size&&!backboard)||!gauge)return {quantity:null,notice:'未识别尺寸或厚度，请手动填写数量。'};
  const matched=scoped.filter(item=>(!size||boardSize(item.name+' '+item.model)===size)&&thickness(item.name+' '+item.model)===gauge);
  if(matched.some(item=>normalized(item.unit)!==normalized(labor.unit)))return {quantity:null,notice:'匹配采购明细的单位与人工配置不同，请核对单位后手动填写，避免混算。'};
  const quantity=Math.round(matched.reduce((sum,item)=>sum+(Number.isFinite(item.quantity)&&item.quantity>0?item.quantity:0),0)*1e6)/1e6;
  return {quantity,notice:`本合作项目 ${matched.length} 条采购明细合计 ${quantity} ${labor.unit}（${size?size.replace('x','×')+'尺 / ':''}${gauge}mm），不区分名称、品牌和花色。`};
}
