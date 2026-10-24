import {normalizeQuoteItem,QUOTE_CATEGORIES,quotePriceCents,quoteLineAmountCents,type QuoteCategory,type QuoteItem} from './quotes';
import {materialExpenseCategory,type MaterialRecord} from './catalog-types';
import {hardwareCatalogRow,type QuoteImportRow} from './quote-import';

const safeAmount=(quantity:number,price:number)=>{try{return quoteLineAmountCents(quantity,price);}catch{return null;}};
const norm=(v:string)=>v.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
type RawItems=ReadonlyArray<Partial<QuoteItem>|null|undefined>;
export type QuoteProfitRawItem=Omit<Partial<QuoteItem>,'quantity'|'price'> & {quantity?:number|'';price?:number|''};
export type QuoteCostLine={
 index:number;
 item:QuoteItem;
 salePrice:number|null;
 saleAmount:number|null;
 costPrice:number|null;
 costAmount:number|null;
 margin:number|null;
 marginRate:number|null;
 costIssue?:string;
 saleIssue?:string;
};
export type QuoteCostSummary={sales:number|null;cost:number|null;margin:number|null;marginRate:number|null;knownCost:number|null;unknownCostCount:number};

function lineCost(item:QuoteItem,index:number,catalog:ReadonlyArray<MaterialRecord>){
 if(!Number.isFinite(item.quantity)||item.quantity<=0)return {price:null,amount:null,issue:`第${index+1}行 ${item.name}：数量无效`};
 let cents:number|null=null;
 const candidates=catalog.filter(row=>!row.deleted&&materialExpenseCategory(row)===item.category);
 if(item.category==='五金费用'){
  const row:QuoteImportRow={id:String(index),sourceRow:index+1,selected:true,category:item.category,name:item.name,model:item.model,unit:item.unit,quantity:item.quantity,price:null,note:'',sourceAmount:null,issues:[],acceptDifference:false};
  const match=hardwareCatalogRow(row,candidates.map(c=>({...c,sale_price:c.purchase_price})));
  if(match.price!==null)cents=Math.round(match.price*100);
 }else{
  let matches=candidates.filter(row=>norm(row.name)===norm(item.name));
  const modelMatches=matches.filter(row=>norm(row.model)===norm(item.model));
  if(modelMatches.length)matches=modelMatches;
  else if(item.model)matches=[];
  if(matches.length===1&&norm(matches[0].unit)===norm(item.unit))cents=matches[0].purchase_price;
 }
 if(cents===null||!Number.isSafeInteger(cents)||cents<0)return {price:null,amount:null,issue:`第${index+1}行 ${item.name} ${item.model}：未匹配到唯一且单位一致的${item.category}成本价`};
 const amount=safeAmount(item.quantity,cents/100);
 if(amount===null||!Number.isSafeInteger(amount))return {price:cents,amount:null,issue:`第${index+1}行成本超出计算范围`};
 return {price:cents,amount};
}

/** Existing callers retain their cost/totals/issues shape and matching rules. */
export function quoteCost(rawItems:RawItems,catalog:ReadonlyArray<MaterialRecord>){
 const totals:Record<string,number>=Object.fromEntries(QUOTE_CATEGORIES.map(c=>[c,0])),issues:string[]=[];
 for(const [index,raw] of rawItems.entries()){
  const item=normalizeQuoteItem(raw),result=lineCost(item,index,catalog);
  if(result.issue){issues.push(result.issue);continue;}
  totals[item.category]+=result.amount!;
 }
 const total=Object.values(totals).reduce((s,n)=>s+n,0);
 if(!Number.isSafeInteger(total))issues.push('成本合计超出计算范围');
 return {cost:issues.length?null:total,totals,issues};
}

const completeSum=(values:(number|null)[])=>{
 if(values.some(value=>value===null))return null;
 const total=values.reduce<number>((sum,value)=>sum+value!,0);
 return Number.isSafeInteger(total)?total:null;
};

/** A partial matched subtotal must never be represented as the complete cost. */
export function summarizeQuoteCostLines(lines:ReadonlyArray<QuoteCostLine>):QuoteCostSummary{
 const sales=completeSum(lines.map(line=>line.saleAmount)),cost=completeSum(lines.map(line=>line.costAmount));
 const difference=sales!==null&&cost!==null?sales-cost:null;
 const margin=difference!==null&&Number.isSafeInteger(difference)?difference:null;
 return {sales,cost,margin,marginRate:margin!==null&&sales!==null&&sales>0?margin/sales:null,knownCost:completeSum(lines.map(line=>line.costAmount??0)),unknownCostCount:lines.filter(line=>line.costAmount===null).length};
}

/** Read-only estimate: original quote sales, current catalog purchase costs, in cents. */
export function quoteCostDetails(rawItems:ReadonlyArray<QuoteProfitRawItem|null|undefined>,catalog:ReadonlyArray<MaterialRecord>){
 const lines:QuoteCostLine[]=rawItems.map((raw,index)=>{
  const item=normalizeQuoteItem(raw as Partial<QuoteItem>);
  if(raw?.quantity==='')item.quantity=Number.NaN;
  if(raw?.price==='')item.price=Number.NaN;
  const cost=lineCost(item,index,catalog);
  const cents=Number.isFinite(item.price)&&item.price>=0&&item.price<=100000000?quotePriceCents(item.price):NaN;
  const validPrice=Number.isFinite(item.price)&&item.price>=0&&Number.isSafeInteger(cents)&&cents>=0;
  const salePrice=validPrice?cents:null;
  const amount=validPrice&&Number.isFinite(item.quantity)&&item.quantity>0?safeAmount(item.quantity,item.price):null;
  const saleAmount=amount!==null&&Number.isSafeInteger(amount)?amount:null;
  const difference=saleAmount!==null&&cost.amount!==null?saleAmount-cost.amount:null;
  const margin=difference!==null&&Number.isSafeInteger(difference)?difference:null;
  return {index,item,salePrice,saleAmount,costPrice:cost.price,costAmount:cost.amount,margin,marginRate:margin!==null&&saleAmount!==null&&saleAmount>0?margin/saleAmount:null,...(cost.issue?{costIssue:cost.issue}:{}),...(saleAmount===null?{saleIssue:`第${index+1}行 ${item.name}：销售价格、数量或报价额无效`}:{})};
 });
 const summary=summarizeQuoteCostLines(lines),categories=Object.fromEntries(QUOTE_CATEGORIES.map(category=>[category,summarizeQuoteCostLines(lines.filter(line=>line.item.category===category))])) as Record<QuoteCategory,QuoteCostSummary>;
 return {lines,summary,categories,issues:[...new Set(lines.flatMap(line=>[line.costIssue,line.saleIssue].filter((issue):issue is string=>Boolean(issue))))]};
}

