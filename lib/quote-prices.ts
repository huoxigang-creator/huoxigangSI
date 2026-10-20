export type QuotePriceType='sale'|'internal'|'contract';
export const priceField=(type:QuotePriceType)=>type==='internal'?'internal_price':type==='contract'?'contract_price':'sale_price';
export function materialQuotePrices(material:{sale_price:number;internal_price?:number;contract_price?:number},type:QuotePriceType){
 const sale_price=material.sale_price/100,internal_price=material.internal_price===undefined?undefined:material.internal_price/100,contract_price=material.contract_price===undefined?undefined:material.contract_price/100;
 return {sale_price,...(internal_price===undefined?{}:{internal_price}),...(contract_price===undefined?{}:{contract_price}),price:(type==='internal'?internal_price:type==='contract'?contract_price:sale_price)??sale_price};
}
